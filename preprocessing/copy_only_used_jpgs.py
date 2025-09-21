#!/usr/bin/env python3

# copy_only_used_jpgs.py - walks the J80 (origBase) tree of images, copying only the
#    .jpg files used in the viewData file (specified as the only command-line
#    argument), to a J80New (newBase) tree.

import os, json, shutil, sys

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} <viewFile>"); sys.exit(1)

with open(sys.argv[1], "r") as f:
    data = json.load(f)

# Set of names from JSON (robust to missing 'nm')
names = {item["nm"] for item in data if isinstance(item, dict) and "nm" in item}

print("Starting the directory walk!!!")

fromdir  = "/home/admin/domains/comet.photos/public_html/J80"
origBase = "J80"
newBase  = "J80New"

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    newRoot = root.replace(origBase, newBase, 1)
    os.makedirs(newRoot, exist_ok=True)

    for file in files:
        base, ext = os.path.splitext(file)
        if ext.lower() == ".jpg" and base in names:
            src_file = os.path.join(root, file)
            dst_file = os.path.join(newRoot, file)
            shutil.copy2(src_file, dst_file)
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)
