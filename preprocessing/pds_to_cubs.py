# pds_to_cubs.py - Converts ESA Rosetta OSIRIS PDS3 .IMG files
#   to .CUB files using the USGS tools.

import os
import shutil
import sys
import subprocess

print("Starting the directory walk!!!")

fromdir = "/home/djk/cometdata/OSINAC"
origBase = "OSINAC"
newBase = "CUBS"
toDir = "/home/djk/cometdata/CUBS"
# Traverse the source directory tree

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    newRoot = root.replace(origBase, newBase, 1)
    if not os.path.exists(newRoot):
       os.makedirs(newRoot)
       print(f"Creating directory: {newRoot}", flush=True)
    # Loop over the files
    for file in files:
        if file.endswith(".IMG"):
            # Get the full path of the source file
            src_file = os.path.join(root, file)
            # Get the full path of the destination file
            dst_file = os.path.join(newRoot, file)
            dst_file = dst_file[:-4] + '.cub'  # remove the .IMG and replace with .cub (mostly for spiceinit)
            result = subprocess.run(['rososiris2isis', f'from={src_file}', f'to={dst_file}'])
            if (result.returncode != 0):
                print(f"rososiris2isis failed on {src_file}", file=sys.stderr)
                continue
            dateStr = file[:7]    # get first 7 chars
            dateStr = dateStr[1:] # discard first char
            dateInt = int(dateStr)
            print(f'Date int is {dateInt}', flush=True)
            if (dateInt < 201606): # if earlier than June 2016
                result = subprocess.run(['spiceinit', f'from={dst_file}', 'iak=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti', 'extra=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM', 'shape=user', 'model=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'])
                if (result.returncode != 0):
                    print(f"spiceinit failed on {dst_file}", file=sys.stderr)
                    continue
            else:
                result = subprocess.run(['spiceinit', f'from={dst_file}', 'ck=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc', 'iak=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti', 'extra=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM', 'shape=user', 'model=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'])
                if (result.returncode != 0):
                    print(f"spiceinit failed on {dst_file}", file=sys.stderr)
                    continue
            filesDone += 1
            print(f"Finished {filesDone}", flush=True)
            # print(f"Copying from {src_file} to {dst_file}")
            # Copy the file
            # shutil.copy(src_file, dst_file)
