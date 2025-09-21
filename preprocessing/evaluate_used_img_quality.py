#!/usr/bin/env python3

# evaluate_used_img_quality.py - For all .IMG files represented in the JSON file,
# checks the image quality info stored in the .IMG headers and provides some basic stats.

import os, json, re, sys

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} <viewFile>"); sys.exit(1)

fromDir  = "IMG"
filesDone = 0
badCount = 0

def getHeaderString(path):
    # First grab enough to see the LABEL_RECORDS and RECORD_BYTES keywords
    with open(path, "rb") as f:
        head = f.read(131072)  # 128 KB is plenty for OSIRIS labels
    text = head.decode("utf-8", errors="ignore")

    # Find the multipliers
    lr = int(re.search(r"\bLABEL_RECORDS\s*=\s*(\d+)", text).group(1))
    rb = int(re.search(r"\bRECORD_BYTES\s*=\s*(\d+)", text).group(1))

    # Now read exactly the header
    with open(path, "rb") as f:
        label = f.read(lr * rb)

    return label.decode("utf-8", errors="ignore")


def findKey(pattern, header, file):
    match = re.search(pattern, header)
    if match: return match.group(1)
    print(f"ERROR: search pattern {pattern} in file {file}"); sys.exit(1)


def tallyStats(file):
    if not os.path.exists(file):
        print(f"SKIP (missing): {file}")
        return 0

    header = getHeaderString(file)
    dq = findKey(r'\s*DATA_QUALITY_ID\s*=\s*"?([01]+)"?', header, file)

    if '1' in dq:   # any bit set
         return dq

    return 0

    # shutter_found_in_error = re.search(r'\s*SHUTTER_FOUND_IN_ERROR\s*=\s*(\S+)', header, re.IGNORECASE)
    # testmode_flag = re.search(r'\s*TESTMODE_FLAG\s*=\s*(\S+)', header, re.IGNORECASE)
    # rationale_desc = re.search(r'\s*RATIONALE_DESC\s*=\s*"([^"]+)"', header, re.IGNORECASE)


# Set of names from JSON
with open(sys.argv[1], "r") as f:
    data = json.load(f)

names = [item["nm"] for item in data if isinstance(item, dict) and "nm" in item]

for name in names:  
    dateStr = name[1:7]    # get the YYYYMM chars
    fromPath = f'{fromDir}/{dateStr}'
    imgFile = os.path.join(fromPath, name + ".IMG")

    bad_info = tallyStats(imgFile)
    if (bad_info):
        badCount += 1
        print(f"BAD QUALITY: {imgFile} DATA_QUALITY_ID={bad_info}")
    filesDone += 1
    
print(f"Finished {filesDone}, with a bad count of {badCount}", flush=True)
