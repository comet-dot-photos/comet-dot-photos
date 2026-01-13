# pngs_to_jpgs.py - walks the PNG tree of images to generate .jpg
#  files for each image.
#
# Used in Comet.Photos v1 to generate J80/.jpg files.
# Camera-agnostic.

import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "/home/admin/domains/comet.photos/public_html/PNG"
origBase = "PNG"
newBase = "J80"
toDir = "/home/admin/domains/comet.photos/public_html/J80"

# Traverse the source directory tree

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    newRoot = root.replace(origBase, newBase, 1)
    if not os.path.exists(newRoot):
       os.makedirs(newRoot)
       print(f"Creating directory: {newRoot}", flush=True)
    # Loop over the files
    for file in files:
        if file.endswith(".png"):
            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(newRoot, file)
            dst_file = dst_file[:-4] + '.jpg'  # remove the .cub and replace with .cam 
            # convert  N20140905T064555557ID30F22.png  -quality 90 -format jpg   N20140905T064555557ID30F22.jpg
            result = subprocess.run(['convert', f'{src_file}', '-quality', '80', '-format', 'jpg' , f'{dst_file}'])
            if (result.returncode != 0):
                print(f"convert failed on {dst_file}", file=sys.stderr)
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)
