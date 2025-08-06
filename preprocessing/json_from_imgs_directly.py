# json_from_imgs_directly.py - creates the phase 1 version of the
#  metadata file, imageMetadata_phase1.json, by traversing the .IMG
#  files, and extracting from them: the basename ('nm'), time taken
#  ('ti'), image resolution ('rz'). Then we use the SPICE kernel
#  calculations to add the camera vector ('cv'), camera up vector
#  ('up'), spacecraft position ('sc') and Sun position ('su').

import os
import re
import json
import sys
import datetime
import math
import spiceypy as spice
import numpy as np

NO_KERNEL = 0
EARLY_KERNEL = 1
LATE_KERNEL = 2
current_kernel = NO_KERNEL
FOV = 2.20746
SCREENRES = 2048

def addCalculatedValues(view):
    global current_kernel

    name = view['nm']
    dateStr = name[:7]    # get first 7 chars of name
    dateStr = dateStr[1:] # discard first char
    dateInt = int(dateStr)
    if (dateInt < 201606 and current_kernel == NO_KERNEL): # use the fact that dates are increasing in each successive view
        # Load the necessary SPICE kernels
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti')
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM')
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS')
        current_kernel = EARLY_KERNEL
        print(f"Set Early Kernel with: {name}")
    elif (dateInt >= 201606 and current_kernel == EARLY_KERNEL):
        # Clear the old, and load the newer SPICE kernels
        spice.kclear()
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc')
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti')
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM')
        spice.furnsh('/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS')
        current_kernel = LATE_KERNEL
        print(f"Set Late Kernel with: {name}")

    # Define the time of interest
    et = spice.str2et(view['ti'])
    
    # Get the camera's orientation matrix (C-matrix) at the given time
    cmat = spice.pxform('ROS_OSIRIS_NAC', '67P/C-G_CK', et)

    camera_look_vector = [0, 0, 1]  # camera's look vector in its own frame
    camera_up_vector = [1, 0, 0]    # camera's up vector in its own frame

    cv = spice.mxv(cmat, camera_look_vector) # camera's look vector to P67 coordinates
    up = spice.mxv(cmat, camera_up_vector) # camera's up vector to P67 coordinates

    # Make sure all vectors are normalized
    cv = cv / np.linalg.norm(cv)
    up = up / np.linalg.norm(up)

    view['cv'] = cv.tolist()
    view['up'] = up.tolist()

    # Get the position of the Sun relative to comet 67P
    sun_pos, _ = spice.spkpos('SUN', et, '67P/C-G_CK', 'NONE', '67P/C-G')

    # Get the position of the spacecraft relative to comet 67P
    sc_pos, _ = spice.spkpos('ROS_OSIRIS_NAC', et, '67P/C-G_CK', 'NONE', '67P/C-G')
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
    with open(file, 'r', encoding='utf-8', errors='ignore') as file:
        for line in file:
            if not is_ascii(line):
                break
            result += line
    return result    

def findKey(pattern, header, file):
    match = re.search(pattern, header)
    if match:
        return match.group(1)
    else:
        print(f"ERROR: search pattern {pattern} in file {file}")
        exit(1)

def extractViewData(file):
    view = {}

    base_name = os.path.basename(file) # prepare name field from filename
    period_index = base_name.find('.') 
    if period_index != -1:
        base_name = base_name[:period_index]  # remove extension
    view['nm'] = base_name
    
    header = getHeaderString(file)
    startTime = findKey(r'\s*START_TIME\s*=\s*(\S+)', header, file)
    # stopTime = findKey(r'\s*STOP_TIME\s*=\s*(\S+)', header, file)
    view['ti'] = startTime

    value = findKey(r'\s*LINE_SAMPLES\s*=\s*(\d+)', header, file)
    xres = int(value)
    value = findKey(r'\s*LINES\s*=\s*(\d+)', header, file)
    yres = int(value)
    if (xres != SCREENRES or yres != SCREENRES):
        view['rz'] = xres
        print(f"Odd resolution: {xres} x {yres} in {file}")
    #   return None

    addCalculatedValues(view) 
    return view

fromdir = '/home/djk/cometdata/IMG'
viewArray = []
filesProcessed = 0
filesIncluded = 0

for root, dirs, files in os.walk(fromdir, topdown=True):
    dirs.sort(key=lambda d: int(d)) # sort dirs ascendingly by number (time equiv in this context)
    files.sort()                    # lexicographic sort will work here - step not really necessary

    for file in files:
        if file.endswith(".IMG"):
            # Get the full path of the source file
            src_file = os.path.join(root, file)
            view = extractViewData(src_file)
            filesProcessed += 1
            if view != None:
                viewArray.append(view)
                filesIncluded += 1

print(f"Processed {filesProcessed}, JSON Length: {filesIncluded}", flush=True)

# following line sorts array according to ISO standard time format. Needed to remove last digit of fractional second to make it ISO for sorting
viewArray = sorted(viewArray, key=lambda x: datetime.datetime.strptime(x["ti"][:-1], '%Y-%m-%dT%H:%M:%S.%f'))

print(f"Size of final jsonArray is {len(viewArray)}")
print(f"Size in bytes is {sys.getsizeof(viewArray)}")
with open('imageMetadata_phase1.json', 'w') as f:
    f.write(json.dumps(viewArray, separators=(',', ':')))
