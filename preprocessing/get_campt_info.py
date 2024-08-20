import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "~/cometdata/CUBS"
origBase = "CUBS"
newBase = "CAM"
toDir = "~/cometdata/CAM"

# Traverse the source directory tree

filesDone = 0
ptsToTest = [[1024, 1024],
             [1,1],
             [2048, 2048],
             [1, 2048],
             [2048, 1],
             [512, 512],
             [1536, 1536],
             [512, 1536],
             [1536, 512]]


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
            dst_file = dst_file[:-4] + '.cam'  # remove the .cub and replace with .cam 

            foundCount = 0
            for pt in ptsToTest:
                # campt from=~/tst/N20140826T074254573ID4EF22.cub to=campt_sample_output.ct sample=1 line=1
                result = subprocess.run(['campt', f'from={src_file}', f'to={dst_file}', f'sample={pt[0]}', f'line={pt[1]}'])
                if (result.returncode == 0):
                    foundCount += 1
                    if (foundCount == 2): break
                else:
                    print(f"{src_file}: failed on ({pt[0]}, {pt[1]})", file = sys.stderr)
            
            if (foundCount < 2):
                print(f"{src_file}: INSUFFICIENT PIXEL COUNT: {foundCount}", file=sys.stderr)

            filesDone += 1
            print(f"Finished {filesDone}", flush=True)

