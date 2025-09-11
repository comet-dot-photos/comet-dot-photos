# pds_to_jpgs.py - creates .jpg files for each .IMG file
#         .IMG -> (temp .cub) -> (temp .png) -> J80/.jpg, then cleanup.

import os
import sys
import subprocess
import tempfile

print("Starting the directory walk!!!")

fromdir  = "/home/djk/cometdata/OSINAC"
origBase = "OSINAC"
newBase  = "J80"   # only final JPGs are mirrored here
toDir    = "/home/djk/cometdata/J80"

filesDone = 0

for root, dirs, files in os.walk(fromdir):
    j80Root = root.replace(origBase, newBase, 1)  # mirror only J80
    if not os.path.exists(j80Root):
        os.makedirs(j80Root)
        print(f"Creating directory: {j80Root}", flush=True)

    for file in files:
        if not file.endswith(".IMG"):
            continue

        # Source and final destination
        src_file = os.path.join(root, file)
        base     = os.path.splitext(file)[0]
        jpg_file = os.path.join(j80Root, base + ".jpg")

        # Build temp paths for .cub and .png (no CUB/PNG trees)
        tmpdir   = tempfile.gettempdir()
        cub_file = os.path.join(tmpdir, base + ".cub")
        png_file = os.path.join(tmpdir, base + ".png")

        try:
            # .IMG -> .cub
            result = subprocess.run(['rososiris2isis', f'from={src_file}', f'to={cub_file}'])
            if result.returncode != 0:
                print(f"rososiris2isis failed on {src_file}", file=sys.stderr)
                continue

            # date-based spiceinit split
            dateStr = file[:7][1:]           # e.g., "N201409..." -> "201409"
            dateInt = int(dateStr)
            print(f'Date int is {dateInt}', flush=True)

            if dateInt < 201606:
                result = subprocess.run([
                    'spiceinit', f'from={cub_file}',
                    'iak=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti',
                    'extra=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM',
                    'shape=user',
                    'model=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'
                ])
            else:
                result = subprocess.run([
                    'spiceinit', f'from={cub_file}',
                    'ck=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc',
                    'iak=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti',
                    'extra=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM',
                    'shape=user',
                    'model=/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS'
                ])
            if result.returncode != 0:
                print(f"spiceinit failed on {cub_file}", file=sys.stderr)
                continue

            # .cub -> (temp) .png
            result = subprocess.run(['isis2std', f'from={cub_file}', f'to={png_file}', 'format=png'])
            if result.returncode != 0:
                print(f"isis2std failed on {png_file}", file=sys.stderr)
                continue

            # (temp) .png -> J80/.jpg (quality 80), as in pngs_to_jpgs.py
            result = subprocess.run(['convert', png_file, '-quality', '80', '-format', 'jpg', jpg_file])
            if result.returncode != 0:
                print(f"convert failed on {jpg_file}", file=sys.stderr)
                continue

            filesDone += 1
            print(f"Finished {filesDone}: {jpg_file}", flush=True)

        finally:
            # always try to clean up temps
            for p in (png_file, cub_file):
                try: os.remove(p)
                except OSError: pass
