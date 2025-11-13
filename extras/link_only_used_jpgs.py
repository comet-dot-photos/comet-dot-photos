#!/usr/bin/env python3

# copy_only_used_jpgs.py - walks the J80 (origBase) tree of images, copying only the
#    .jpg files used in the specified viewData file from the oldJPGTree to the newJPGTree.
#
# This is camera-agnostic.

import os, json, shutil, sys

if len(sys.argv) != 4:
    print(f"Usage: {sys.argv[0]} <viewFile> <oldJPGTree> <newJPGTree>"); sys.exit(1)

with open(sys.argv[1], "r") as f:
    data = json.load(f)

# Set of names from JSON (robust to missing 'nm')
names = {item["nm"] for item in data if isinstance(item, dict) and "nm" in item}

print("Starting the directory walk!!!")

fromDir  = sys.argv[2]
toDir  = sys.argv[3]
fromAbs = os.path.abspath(fromDir)
toAbs  = os.path.abspath(toDir)

filesDone = 0

for root, dirs, files in os.walk(fromAbs):
    newRoot = root.replace(fromAbs, toAbs, 1)
    os.makedirs(newRoot, exist_ok=True)

    for file in files:
        base, ext = os.path.splitext(file)
        if ext.lower() == ".jpg" and base in names:
            src_file = os.path.join(root, file)
            dst_file = os.path.join(newRoot, file)
            os.link(src_file, dst_file)
            filesDone += 1

print(f"Finished {filesDone}", flush=True)
