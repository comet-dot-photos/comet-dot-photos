#!/usr/bin/env python3

# organize_imgs.py - creates a tree of PDS image files that are
#  links to the PDS files in <fromDir>, but more clearly
#  organized. New files are placed in subdirectories of the form
#  YYMM, where YY are the last two digits of the year of the image,
#  and MM is the two digit month. This simple organization helps 
#  immensely. All processing of the PDS files then uses this new 
#  folder structure. (Note: the original files are not moved, only
#  hard links are created to them.)

# Works for Rosetta WAC, NAC, and NAVCAM images, and OSIRIS-ReX PolyCam,
#  MapCam, and SamCam images.

import os, sys

if len(sys.argv) != 3 and len(sys.argv) != 4:
    print(f"Usage: {sys.argv[0]} <fromDir> <toDir> [<date_offset>]")
    sys.exit(1)

dateOffset = 1 if len (sys.argv) < 4 else int(sys.argv[3])

fromDir = os.path.abspath(sys.argv[1])
toDir   = os.path.abspath(sys.argv[2])

print("Starting the directory walk!!!")

# Traverse the source directory tree
valid_extensions = (".img", ".lbl", ".fits", ".xml")
filesDone = 0

def extract_date(filename):
    # Extract date from the filename based on known patterns (UTC string in filename)
    # This function may need to be adjusted based on actual filename formats
    t_index = filename.find('T')
    if t_index < 8:
        return None
    return filename[t_index - 8: t_index - 2]  # get date portion of filename

for root, dirs, files in os.walk(fromDir):
    # Loop over the files
    for file in files:
        if file.lower().endswith(valid_extensions):
            # get the date string from the filename
            dateStr = extract_date(file)
            if dateStr is None:
                print(f"Skipping file with unexpected name format: {file}", flush=True)
                continue
            toPath = f'{toDir}/{dateStr}'
            # create the folder if it doesn't already exit
            if not os.path.exists(toPath):
                os.makedirs(toPath)
                print(f"Creating directory: {toPath}", flush=True)

            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(toPath, file)
            # Create a hard link in the new tree
            os.link(src_file, dst_file)

            filesDone += 1
print(f"Finished processing {filesDone}", flush=True)

