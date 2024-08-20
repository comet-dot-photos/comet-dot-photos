import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "~/cometdata/CUBS"
#origBase = "OSINAC"
#newBase = "CUBS"
toDir = "~/cometdata/CUBS2"
# Traverse the source directory tree

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    # Loop over the files
    for file in files:
        if file.endswith(".cub"):
            # get the date string from the filename
            dateStr = file[:7]    # get first 7 chars
            dateStr = dateStr[1:] # discard first char
            toPath = f'{toDir}/{dateStr}'
            # create the folder if it doesn't already exit
            if not os.path.exists(toPath):
                os.makedirs(toPath)
                print(f"Creating directory: {toPath}", flush=True)

            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(toPath, file)

            # Move the file from old_dir to new_dir
            shutil.move(src_file, dst_file)
            # print(f'mv {src_file} {dst_file}')
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)

