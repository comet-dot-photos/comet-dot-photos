import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "/home/admin/domains/comet.photos/public_html/PNG"
origBase = "PNG"
newBase = "KTX2"
toDir = "/home/admin/domains/comet.photos/public_html/KTX2"

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
            dst_file = dst_file[:-4] + '.ktx2'  # remove the .png and replace with .ktx2 
            # convert input.png -define ktx:format=astc_4x4 -define ktx:orientation=normal -define ktx:swizzle=rgb -define ktx:supercompression=basisu -define basisu:level=1 -define basisu:max_endpoints=16128 -define basisu:max_selectors=16128 /path/to/output.ktx2
            result = subprocess.run(['convert', f'{src_file}', '-define', 'ktx:format=astc_4x4', '-define', 'ktx:orientation=normal' , '-define', 'ktx:swizzle=rgb', '-define', 'ktx:supercompression=basisu', '-define', 'basisu:level=1', '-define', 'basisu:max_endpoints=16128', '-define', 'basisu:max_selectors=16128', f'{dst_file}'])
            if (result.returncode != 0):
                print(f"convert failed on {dst_file}", file=sys.stderr)
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)
