#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# json_from_pds3_rosetta.py
# Phase-1 metadata builder:
#   view = { 'nm', 'ti', 'rz', 'cv', 'up', 'su', 'sc' }
# Cameras: NAC, WAC, NAVCAM
# - NAC/WAC read .IMG (embedded labels)
# - NAVCAM  reads .LBL (detached labels)
#
# Notes:
# - Except for NAC, we enforce TARGET_TYPE == COMET. (revisit this)
# - Kernel loading follows the early/late split and keeps outputs identical.

import os, re, sys, json, datetime
import spiceypy as spice
import numpy as np

# ----------------------------- CLI -------------------------------------------

if len(sys.argv) != 4 or sys.argv[1].upper() not in ("NAC", "WAC", "NAVCAM"):
    print("Usage: json_from_pds3_rosetta.py <WAC|NAC|NAVCAM> <imgDir> <jpgDir>")
    sys.exit(1)

CAMERA  = sys.argv[1].upper()
imgdir  = os.path.abspath(sys.argv[2])
jpgDir  = os.path.abspath(sys.argv[3])

# --------------------------- Constants / Config ------------------------------

NO_KERNEL, EARLY_KERNEL, LATE_KERNEL = 0, 1, 2
current_kernel = NO_KERNEL

SCREENRES = 2048             # expected active frame (kept from original)
# CROP_MAP  = {2304: 2048, 1152: 1024, 576: 512, 288: 256}  # overscan -> active
OK_RES    = {2048, 1024, 512, 256}

# ---- Kernel paths  ----
IK_OSIRIS_V17 = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_OSIRIS_V17.TI'
IAK_WAC       = '/home/djk/anaconda3/envs/asp/data/rosetta/kernels/iak/osi_wacAddendum_v004.ti'
IAK_NAC       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti'
IK_NAVCAM     = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_NAVCAM_V03.TI'

MK_TM         = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM'
DSK_SHAPE     = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'
CK_LATE       = '/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc'

# Instrument IDs
ID_NAC   = -226113
ID_WAC   = -226112
ID_NAV_A = -226170   # all NAVCAM are CAM1

EARLY_LATE_SPLIT = 201606  # YYYYMM

def _f(path):
    if os.path.exists(path):
        spice.furnsh(path)

# ------------------------------- Labels --------------------------------------

def getHeaderString(path):
    """
    NAVCAM: detached .LBL (read whole file).
    NAC/WAC: .IMG with embedded label; read LABEL_RECORDS * RECORD_BYTES.
    """
    if path.upper().endswith(".LBL"):
        with open(path, "rb") as f:
            return f.read().decode("utf-8", errors="ignore")

    # Embedded label from .IMG
    with open(path, "rb") as f:
        head = f.read(131072)  # 128 KB is plenty for PDS3 label block
    text = head.decode("utf-8", errors="ignore")

    lr_m = re.search(r"\bLABEL_RECORDS\s*=\s*(\d+)", text)
    rb_m = re.search(r"\bRECORD_BYTES\s*=\s*(\d+)", text)
    if not lr_m or not rb_m:
        return text  # fallback (kept minimal)

    lr = int(lr_m.group(1))
    rb = int(rb_m.group(1))
    with open(path, "rb") as f:
        label = f.read(lr * rb)
    return label.decode("utf-8", errors="ignore")

def findKey(pat, text, fileForErr):
    m = re.search(pat, text)
    if not m:
        raise RuntimeError(f"Could not find pattern {pat} in {fileForErr}")
    return m.group(1)

def getObjectString(header):
    """
    Extract the IMAGE object subsection if present; else use whole label.
    """
    m = re.search(r'(?is)OBJECT\s*=\s*IMAGE(.*?)END_OBJECT\s*=\s*IMAGE', header)
    return m.group(1) if m else header

# ------------------------- SPICE + per-view calc -----------------------------

def addCalculatedValues(view, camera='NAC'):
    global current_kernel

    name = view['nm']
    # dateStr used only to decide early/late kernel set; keep original slice for OSIRIS patterns
    # If filename contains YYYYMMDDT..., prefer that; else fallback to original slice.
    m = re.search(r'(\d{8})T', name)
    dateStr = (m.group(1)[:6] if m else name[:7][1:])  # e.g., '201503'
    dateInt = int(dateStr)

    # Load kernels once per era; NAVCAM uses its own IK; NAC/WAC use OSIRIS IK+IAK.
    if (dateInt < EARLY_LATE_SPLIT and current_kernel == NO_KERNEL):
        if camera == 'NAVCAM':
            _f(IK_NAVCAM)
        else:
            _f(IK_OSIRIS_V17)
            _f(IAK_WAC if camera == 'WAC' else IAK_NAC)
        _f(MK_TM)
        _f(DSK_SHAPE)
        current_kernel = EARLY_KERNEL
        print(f"Set Early Kernel with: {name}")
    elif (dateInt >= EARLY_LATE_SPLIT and current_kernel == EARLY_KERNEL):
        spice.kclear()
        if camera == 'NAVCAM':
            _f(IK_NAVCAM)
        else:
            _f(IK_OSIRIS_V17)
            _f(IAK_WAC if camera == 'WAC' else IAK_NAC)
        _f(CK_LATE)
        _f(MK_TM)
        _f(DSK_SHAPE)
        current_kernel = LATE_KERNEL
        print(f"Set Late Kernel with: {name}")

    try:
        et = spice.str2et(view['ti'])

        # Camera frame:
        if camera == 'NAC':
            cam_frame = 'ROS_OSIRIS_NAC'
        elif camera == 'WAC':
            cam_frame = 'ROS_OSIRIS_WAC'
        else:  # NAVCAM
            cam_frame = spice.getfov(ID_NAV_A, 16)[1]   # returns (shape, frame, boresight, n, bounds)

        # Transform into comet-fixed at time et
        cmat = spice.pxform(cam_frame, '67P/C-G_CK', et)

        # boresight +Z; choose +X as "up" (matches your prior convention)
        cv = spice.mxv(cmat, [0.0, 0.0, 1.0]); cv = cv/np.linalg.norm(cv)
        up = spice.mxv(cmat, [1.0, 0.0, 0.0]); up = up/np.linalg.norm(up)

        view['cv']  = cv.tolist()
        view['up']  = up.tolist()

        # Positions (SUN, ROSETTA) in 67P/C-G_CK at 'et'
        sun_pos, _ = spice.spkpos('SUN',     et, '67P/C-G_CK', 'NONE', '67P/C-G')
        sc_pos,  _ = spice.spkpos('ROSETTA', et, '67P/C-G_CK', 'NONE', '67P/C-G')
        view['su'] = sun_pos.tolist()
        view['sc'] = sc_pos.tolist()

    except Exception as e:
        print(f"ERROR: spice failed on {name} at {view['ti']}: {e}")
        return None

    return view

# ----------------------------- Per-file parse --------------------------------

def extractViewData(file):
    header = getHeaderString(file)

    # WAC and NAVCAM only filter: TARGET_TYPE must be COMET
    if CAMERA != 'NAC':
        is_comet = re.search(r'(?im)^[ \t]*TARGET_TYPE\s*=\s*["\']?COMET["\']?\b', header) is not None
        if not is_comet:
            print(f"Skipping non-comet target in {file}")
            return None

    base = os.path.basename(file)
    base_noext, _ = os.path.splitext(base)
    view = {'nm': base_noext}

    # Time: START_TIME required (kept from original)
    # If START_TIME missing, fall back to IMAGE_TIME
    try:
        startTime = findKey(r'\s*START_TIME\s*=\s*(\S+)', header, file)
    except Exception:
        startTime = findKey(r'\s*IMAGE_TIME\s*=\s*(\S+)', header, file)
    view['ti'] = startTime

    # Resolution: pull from IMAGE object section
    subHeader = getObjectString(header)
    xres = int(findKey(r'\s*LINE_SAMPLES\s*=\s*(\d+)', subHeader, file))
    yres = int(findKey(r'\s*LINES\s*=\s*(\d+)', subHeader, file))

    # Keep square-frame requirement and warnings
    if xres != yres:
        print(f"NON-SQUARE RESOLUTION - OMITTING: {xres} x {yres} in {file}")
        return None
    if xres not in OK_RES:
        print(f"Unexpected resolution: {xres} x {yres} in {file}")

    view['rz'] = xres  # unchanged: store nominal frame size

    return addCalculatedValues(view, CAMERA)

def jpgFileExists(file, jpgDir):
    """
    NAC/WAC: folder was based on base[1:7] originally.
    NAVCAM: filenames differ; extract YYYYMM from YYYYMMDDT if present.
    """
    base, ext = os.path.splitext(file)
    if CAMERA == 'NAVCAM':
        m = re.search(r'(\d{8})T', base)
        subDir = (m.group(1)[:6] if m else base[1:7])
    else:
        subDir = base[1:7]

    jpg_file = os.path.join(jpgDir, subDir, base + ".jpg")
    isThere = os.path.exists(jpg_file)
    if not isThere:
        print(f"CHECK THIS - MISSING JPG: {jpg_file}")
    return isThere

# ------------------------------ Walk / Collect -------------------------------

viewArray = []
filesProcessed = 0
filesIncluded  = 0

for root, dirs, files in os.walk(imgdir, topdown=True):
    try:
        dirs.sort(key=lambda d: int(d))
    except Exception:
        dirs.sort()
    files.sort()

    for file in files:
        # NAC/WAC read .IMG; NAVCAM reads .LBL
        if (CAMERA in ("NAC", "WAC") and file.upper().endswith(".IMG")) or \
           (CAMERA == "NAVCAM" and file.upper().endswith(".LBL")):
            src_file = os.path.join(root, file)
            try:
                view = extractViewData(src_file)
                filesProcessed += 1
                if view is not None and jpgFileExists(file, jpgDir):
                    viewArray.append(view)
                    filesIncluded += 1
            except Exception as e:
                print(f"[WARN] Skipping {src_file}: {e}")

# ------------------------------- Output --------------------------------------

print(f"Processed {filesProcessed}, JSON Length: {filesIncluded}", flush=True)
# sort by ISO time; remove last digit of fractional seconds for parsing (kept from original)
try:
    viewArray = sorted(viewArray, key=lambda x: datetime.datetime.strptime(x["ti"][:-1], '%Y-%m-%dT%H:%M:%S.%f'))
except Exception:
    # Fallback if fractional seconds formatting differs
    viewArray = sorted(viewArray, key=lambda x: x["ti"])

print(f"Size of final jsonArray is {len(viewArray)}")
print(f"Size in bytes is {sys.getsizeof(viewArray)}")
with open('imageMetadata_phase1.json', 'w') as f:
    f.write(json.dumps(viewArray, separators=(',', ':')))
