# json_from_imgs_directly.py - creates the phase 1 version of the
#  metadata file, imageMetadata_phase1.json, by traversing the .IMG
#  files, and extracting from them: the basename ('nm'), time taken
#  ('ti'), image resolution ('rz'). Then we use the SPICE kernel
#  calculations to add the camera vector ('cv'), camera up vector
#  ('up'), spacecraft position ('sc') and Sun position ('su').

import os, re, json, sys, datetime
import spiceypy as spice
import numpy as np

NO_KERNEL = 0
EARLY_KERNEL = 1
LATE_KERNEL  = 2
current_kernel = NO_KERNEL
SCREENRES = 2048

# --- kernel paths (minimal; keep close to original) ---
IK_OSIRIS_V17 = '/home/djk/data/rosetta_updated/kernels/ik/ROS_OSIRIS_V17.TI'
IAK_NAC       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti'
MK_TM         = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM'
DSK_SHAPE     = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'
CK_LATE       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc'

def _f(path):
    if os.path.exists(path):
        spice.furnsh(path)

def _cam_from_header_or_path(header: str, file_path: str) -> str:
    # Prefer INSTRUMENT_ID in header; else sniff path; default NAC
    m = re.search(r'INSTRUMENT_ID\s*=\s*("?)(OSIRIS_\w+)\1', header)
    if m and 'WAC' in m.group(2):
        return 'WAC'
    p = file_path.lower()
    if '/wac/' in p or '_wac' in p or 'osiwac' in p:
        return 'WAC'
    return 'NAC'

def addCalculatedValues(view, camera='NAC'):
    global current_kernel

    name = view['nm']
    dateStr = name[:7][1:]  # e.g., '201503' (keep original slicing)
    dateInt = int(dateStr)

    # Load kernels (once), keep early/late switch. Always load IK + IAK.
    if (dateInt < 201606 and current_kernel == NO_KERNEL):
        _f(IK_OSIRIS_V17)        # defines ROS_OSIRIS_[NAC|WAC] frames + FOV
        _f(IAK_NAC)              # NAC addendum (harmless for WAC; requested to keep)
        _f(MK_TM)                # meta-kernel (FK/CK/PCK/LSK/SCLK/SPKs)
        _f(DSK_SHAPE)            # comet shape model
        current_kernel = EARLY_KERNEL
        print(f"Set Early Kernel with: {name}")
    elif (dateInt >= 201606 and current_kernel == EARLY_KERNEL):
        spice.kclear()
        _f(IK_OSIRIS_V17)
        _f(IAK_NAC)
        _f(CK_LATE)              # late-phase CK override
        _f(MK_TM)
        _f(DSK_SHAPE)
        current_kernel = LATE_KERNEL
        print(f"Set Late Kernel with: {name}")

    et = spice.str2et(view['ti'])

    cam_frame = 'ROS_OSIRIS_NAC' if camera == 'NAC' else 'ROS_OSIRIS_WAC'
    cmat = spice.pxform(cam_frame, '67P/C-G_CK', et)

    # boresight +Z; choose +X as "up" (matches your prior convention)
    cv = spice.mxv(cmat, [0, 0, 1]); cv = cv/np.linalg.norm(cv)
    up = spice.mxv(cmat, [1, 0, 0]); up = up/np.linalg.norm(up)

    view['cv']  = cv.tolist()
    view['up']  = up.tolist()
    view['cam'] = camera

    # Positions in 67P/C-G_CK at 'et' (use physical bodies, not instrument IDs)
    sun_pos, _ = spice.spkpos('SUN',     et, '67P/C-G_CK', 'NONE', '67P/C-G')
    sc_pos,  _ = spice.spkpos('ROSETTA', et, '67P/C-G_CK', 'NONE', '67P/C-G')
    view['su'] = sun_pos.tolist()
    view['sc'] = sc_pos.tolist()
    return view

def is_ascii(s):
    try:
        s.encode('ascii')
    except UnicodeEncodeError:
        return False
    return True

def getHeaderString(file):
    result = ""
    with open(file, 'r', encoding='utf-8', errors='ignore') as fh:
        for line in fh:
            if not is_ascii(line):
                break
            result += line
    return result

def findKey(pattern, header, file):
    match = re.search(pattern, header)
    if match: return match.group(1)
    print(f"ERROR: search pattern {pattern} in file {file}"); sys.exit(1)

def extractViewData(file):
    view = {}
    base_name = os.path.basename(file)
    period_index = base_name.find('.')
    if period_index != -1:
        base_name = base_name[:period_index]
    view['nm'] = base_name

    header = getHeaderString(file)
    startTime = findKey(r'\s*START_TIME\s*=\s*(\S+)', header, file)
    view['ti'] = startTime

    xres = int(findKey(r'\s*LINE_SAMPLES\s*=\s*(\d+)', header, file))
    yres = int(findKey(r'\s*LINES\s*=\s*(\d+)', header, file))
    if (xres != SCREENRES or yres != SCREENRES):
        view['rz'] = xres
        print(f"Odd resolution: {xres} x {yres} in {file}")

    cam = _cam_from_header_or_path(header, file)  # 'NAC' or 'WAC'
    addCalculatedValues(view, camera=cam)
    return view

fromdir = '/home/djk/cometdata/IMG'
viewArray, filesProcessed, filesIncluded = [], 0, 0

for root, dirs, files in os.walk(fromdir, topdown=True):
    dirs.sort(key=lambda d: int(d))
    files.sort()
    for file in files:
        if file.endswith(".IMG"):
            src_file = os.path.join(root, file)
            view = extractViewData(src_file)
            filesProcessed += 1
            if view is not None:
                viewArray.append(view)
                filesIncluded += 1

print(f"Processed {filesProcessed}, JSON Length: {filesIncluded}", flush=True)
# sort by ISO time; remove last digit of fractional seconds for parsing (kept from original)
viewArray = sorted(viewArray, key=lambda x: datetime.datetime.strptime(x["ti"][:-1], '%Y-%m-%dT%H:%M:%S.%f'))
print(f"Size of final jsonArray is {len(viewArray)}")
print(f"Size in bytes is {sys.getsizeof(viewArray)}")
with open('imageMetadata_phase1.json', 'w') as f:
    f.write(json.dumps(viewArray, separators=(',', ':')))
