#!/usr/bin/env python3

# organize_imgs.py - creates a tree of .IMG files that are links to
#  the .IMG files in the complex OSINAC tree, but more clearly
#  organized. New files are placed in subdirectories of the form
#  YYMM, where YY are the last two digits of the year of the image,
#  and MM is the two digit month. This simple organization helps 
#  immensely. All processing of the .IMG files then uses this new 
#  folder structure. (Note: the original files are not moved, only
#  hard links are created to them.)

import os, sys

if len(sys.argv) != 3:
    print(f"Usage: {sys.argv[0]} <fromDir> <toDir>")
    sys.exit(1)

fromDir = os.path.abspath(sys.argv[1])
toDir   = os.path.abspath(sys.argv[2])

print("Starting the directory walk!!!")

# Traverse the source directory tree

filesDone = 0

for root, dirs, files in os.walk(fromDir):
    # Loop over the files
    for file in files:
        if file.endswith(".IMG"):
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
            # Create a hard link in the new IMG tree
            os.link(src_file, dst_file)

            filesDone += 1
            print(f"Finished {filesDone}", flush=True)

