# json_from_imgs_directly.py - creates the phase 1 version of the
#  metadata file, imageMetadata_phase1.json, by traversing the .IMG
#  files, and extracting from them: the basename ('nm'), time taken
#  ('ti'), image resolution ('rz'). Then we use the SPICE kernel
#  calculations to add the camera vector ('cv'), camera up vector
#  ('up'), spacecraft position ('sc') and Sun position ('su').

import os, re, json, sys, datetime
import spiceypy as spice
import numpy as np

if len(sys.argv) != 4 or sys.argv[1].upper() not in ("NAC", "WAC"):
    print("Usage: pds_to_jpgs.py <WAC|NAC> <imgDir> <jpgDir>")
    sys.exit(1)

CAMERA  = sys.argv[1].upper()
imgdir = os.path.abspath(sys.argv[2])
jpgDir   = os.path.abspath(sys.argv[3])

NO_KERNEL = 0
EARLY_KERNEL = 1
LATE_KERNEL  = 2
current_kernel = NO_KERNEL
SCREENRES = 2048
CROP_MAP = {2304: 2048, 1152: 1024, 576: 512, 288: 256}  # overscan -> active

# --- kernel paths (minimal; keep close to original) ---
IK_OSIRIS_V17 = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_OSIRIS_V17.TI'
IAK_WAC       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_wacAddendum_v004.ti'
IAK_NAC       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti'
MK_TM         = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM'
DSK_SHAPE     = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'
CK_LATE       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc'

def _f(path):
    if os.path.exists(path):
        spice.furnsh(path)

def addCalculatedValues(view, camera='NAC'):
    global current_kernel

    name = view['nm']
    dateStr = name[:7][1:]  # e.g., '201503' (keep original slicing)
    dateInt = int(dateStr)

    # Load kernels (once), keep early/late switch. Always load IK + IAK.
    if (dateInt < 201606 and current_kernel == NO_KERNEL):
        _f(IK_OSIRIS_V17)        # defines ROS_OSIRIS_[NAC|WAC] frames + FOV
        _f(IAK_WAC if camera == 'WAC' else IAK_NAC)              # WAC/NAC
        _f(MK_TM)                # meta-kernel (FK/CK/PCK/LSK/SCLK/SPKs)
        _f(DSK_SHAPE)            # comet shape model
        current_kernel = EARLY_KERNEL
        print(f"Set Early Kernel with: {name}")
    elif (dateInt >= 201606 and current_kernel == EARLY_KERNEL):
        spice.kclear()
        _f(IK_OSIRIS_V17)
        _f(IAK_WAC if camera == 'WAC' else IAK_NAC)
        _f(CK_LATE)              # late-phase CK override
        _f(MK_TM)
        _f(DSK_SHAPE)
        current_kernel = LATE_KERNEL
        print(f"Set Late Kernel with: {name}")

    try:
        et = spice.str2et(view['ti'])

        cam_frame = 'ROS_OSIRIS_NAC' if camera == 'NAC' else 'ROS_OSIRIS_WAC'
        cmat = spice.pxform(cam_frame, '67P/C-G_CK', et)

        # boresight +Z; choose +X as "up" (matches your prior convention)
        cv = spice.mxv(cmat, [0, 0, 1]); cv = cv/np.linalg.norm(cv)
        up = spice.mxv(cmat, [1, 0, 0]); up = up/np.linalg.norm(up)

        view['cv']  = cv.tolist()
        view['up']  = up.tolist()

        # Positions in 67P/C-G_CK at 'et' (use physical bodies, not instrument IDs)
        sun_pos, _ = spice.spkpos('SUN',     et, '67P/C-G_CK', 'NONE', '67P/C-G')
        sc_pos,  _ = spice.spkpos('ROSETTA', et, '67P/C-G_CK', 'NONE', '67P/C-G')
        view['su'] = sun_pos.tolist()
        view['sc'] = sc_pos.tolist()
    except Exception as e:
        print(f"ERROR: spice failed on {name} at {view['ti']}: {e}")
        return None
    
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
    # If it's a square frame with overscan, record the active size instead
    if xres == yres and xres in CROP_MAP:
        view['rz'] = CROP_MAP[xres]
        print(f"Adjusted overscan {xres}→{view['rz']} in {file}")
    else:
        view['rz'] = xres
        if (xres != SCREENRES or yres != SCREENRES):
            print(f"Odd resolution: {xres} x {yres} in {file}")

    addCalculatedValues(view, CAMERA)
    return view

def jpgFileExists(file, jpgDir):
    base, ext = os.path.splitext(file)
    subDir = base[1:7]  # e.g., "201503"
    jpg_file = os.path.join(jpgDir, subDir, base + ".jpg")
    return os.path.exists(jpg_file)

viewArray, filesProcessed, filesIncluded = [], 0, 0

for root, dirs, files in os.walk(imgdir, topdown=True):
    dirs.sort(key=lambda d: int(d))
    files.sort()
    for file in files:
        if file.endswith(".IMG"):
            src_file = os.path.join(root, file)
            view = extractViewData(src_file)
            filesProcessed += 1
            if view is not None and jpgFileExists(file, jpgDir):
                viewArray.append(view)
                filesIncluded += 1

print(f"Processed {filesProcessed}, JSON Length: {filesIncluded}", flush=True)
# sort by ISO time; remove last digit of fractional seconds for parsing (kept from original)
viewArray = sorted(viewArray, key=lambda x: datetime.datetime.strptime(x["ti"][:-1], '%Y-%m-%dT%H:%M:%S.%f'))
print(f"Size of final jsonArray is {len(viewArray)}")
print(f"Size in bytes is {sys.getsizeof(viewArray)}")
with open('imageMetadata_phase1.json', 'w') as f:
    f.write(json.dumps(viewArray, separators=(',', ':')))
