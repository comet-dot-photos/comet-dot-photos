import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "~/cometdata/CUBS"
origBase = "CUBS"
newBase = "CAMHOLDOUTS"
toDir = "~/cometdata/CAMHOLDOUTS"

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
             [1536, 512],
             # new additions
             [1024, 1],         # midpoints of outer edges
             [1024, 2048],
             [1, 1024],
             [2048, 1024],
             [512, 1],          # the rest
             [1536, 1],
             [1, 512],
             [1024, 512],
             [2048, 512],
             [512, 1024],
             [1536, 1024],
             [1, 1536],
             [1024, 1536],
             [2048, 1536],
             [512, 2048],
             [1536, 2048]
             ]

file = open("cubs_to_try_get_campt_again", "r")
lines = file.readlines()
print(f"Length of lines in file is {len(lines)}")
for line in lines:
    filepath = line.split(":")[0]
    dir, fname = os.path.split(filepath)
    destdir = dir.replace(origBase, newBase, 1)
    if not os.path.exists(destdir):
        os.makedirs(destdir)
    if fname.endswith(".cub"):
        # Get the full path of the source file
        src_file = filepath
        # Get the full path of the destination file
        dst_file = src_file.replace(origBase, newBase, 1)
        dst_file = dst_file[:-4] + '.cam'  # remove the .cub and replace with .cam 

        tries = 0
        foundCount = 0
        for pt in ptsToTest:
            # campt from=~/tst/N20140826T074254573ID4EF22.cub to=campt_sample_output.ct sample=1 line=1
            result = subprocess.run(['campt', f'from={src_file}', f'to={dst_file}', f'sample={pt[0]}', f'line={pt[1]}'])
            tries += 1
            if (result.returncode == 0):
                foundCount += 1
                foundpt = pt
                if (foundCount == 2): break
            else:
                print(f"{src_file}: failed on ({pt[0]}, {pt[1]})", file = sys.stderr)

        if (foundCount == 1):           # look DELTA pixels in each cardinal direction to see if there is a match
            DELTA = 10
            lessX = max(foundpt[0]-DELTA, 0)
            moreX = min(foundpt[0]+DELTA, 2048)
            lessY = max(foundpt[1]-DELTA, 0)
            moreY = min(foundpt[1]+DELTA, 2048)
            newpts = [[lessX, lessY], [foundpt[0], lessY], [moreX, lessY], [lessX, foundpt[1]], [moreX, foundpt[1]], [lessX, moreY], [foundpt[0], moreY], [moreY, moreY]]
            for pt in newpts:
                result = subprocess.run(['campt', f'from={src_file}', f'to={dst_file}', f'sample={pt[0]}', f'line={pt[1]}'])
                tries += 1
                if (result.returncode == 0):
                    foundCount += 1
                    if (foundCount == 2): break
                else:
                    print(f"{src_file}: failed on ({pt[0]}, {pt[1]})", file = sys.stderr)

    if (foundCount < 2):
        print(f"{src_file}: TRIES: {tries}; INSUFFICIENT PIXEL COUNT: {foundCount}", file=sys.stderr)
    else:
        print(f"{src_file}: One more holdout conquered!", file=sys.stderr)
    filesDone += 1
    print(f"Finished {filesDone}", flush=True)

