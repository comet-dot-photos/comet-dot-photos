# generate_pngs.py - extracts .png files from all the .CUB files,
#  using the USGS tools.

# Requires .CUB files - used in Comet.Photos v1 for NAC images

import os
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "/home/djk/cometdata/CUBS"
origBase = "CUBS"
newBase = "PNG"
toDir = "/home/djk/cometdata/PNG"

# Traverse the source directory tree

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    newRoot = root.replace(origBase, newBase, 1)
    if not os.path.exists(newRoot):
       os.makedirs(newRoot)
       print(f"Creating directory: {newRoot}", flush=True)
    # Loop over the files
    for file in files:
        if file.endswith(".cub"):
            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(newRoot, file)
            dst_file = dst_file[:-4] + '.png'  # remove the .cub and replace with .cam 

            # isis2std from=N20140826T074254573ID4EF22.cub to=N20140826T074254573ID4EF22.png
            result = subprocess.run(['isis2std', f'from={src_file}', f'to={dst_file}'])
            # print(f"isis2std from={src_file} to={dst_file}")
            if (result.returncode != 0):
                print(f"isis2std failed on {dst_file}", file=sys.stderr)
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)
