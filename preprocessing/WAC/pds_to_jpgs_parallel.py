#!/usr/bin/env python3
# pds_to_jpgs_parallel.py — PDS3 .IMG → JPG via ISIS (parallelized, minimal changes)
# Usage: python pds_to_jpgs.py <WAC|NAC> <fromDir> <toDir>

import os, sys, subprocess, tempfile, concurrent.futures

print("Starting the directory walk!!!")

# ---- CLI ---------------------------------------------------------------
if len(sys.argv) != 4 or sys.argv[1].upper() not in ("NAC", "WAC"):
    print("Usage: pds_to_jpgs_parallel.py <WAC|NAC> <fromDir> <toDir>")
    sys.exit(1)

CAMERA  = sys.argv[1].upper()
fromdir = os.path.abspath(sys.argv[2])
toDir   = os.path.abspath(sys.argv[3])

# ---- Kernels (absolute paths that worked for you; aliases as fallback) -
IK_OSIRIS      = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_OSIRIS_V17.TI"
IK_OSIRIS_ALT  = "$rosetta/kernels/ik/ROS_OSIRIS_V17.TI"

IAK_NAC        = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/iak/osi_nacAddendum_v004.ti"
IAK_NAC_ALT    = "$rosetta/kernels/iak/osi_nacAddendum_v004.ti"

IAK_WAC        = "/home/djk/anaconda3/envs/asp/data/rosetta/kernels/iak/osi_wacAddendum_v004.ti"
IAK_WAC_ALT    = "$rosetta/kernels/iak/osi_wacAddendum_v004.ti"

MK_TM          = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/mk/ROS_OPS_V350_20220906_001_abhinav.TM"
DSK_SHAPE      = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/dsk/ROS_CG_M004_OSPGDLR_N_V1.BDS"
CK_FILE        = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ck/ROS_SC_MES_160101_160930_V03.bc"

def _exists_or_alias(p: str) -> bool:
    return p.startswith("$") or os.path.exists(p)

def _pick(*candidates) -> str:
    for c in candidates:
        if _exists_or_alias(c):
            return c
    return candidates[-1]

# Fail fast on must-haves
for must in [_pick(IK_OSIRIS, IK_OSIRIS_ALT), MK_TM, DSK_SHAPE, CK_FILE]:
    if not _exists_or_alias(must):
        print(f"[ERROR] Missing kernel file: {must}", file=sys.stderr)
        sys.exit(1)

# ---- Helpers -----------------------------------------------------------
def mirror_root(root: str) -> str:
    rel = os.path.relpath(root, fromdir)
    return os.path.join(toDir, rel)

def parse_date_int(filename: str):
    try:
        return int(filename[1:7])  # YYYYMM for logging only
    except Exception:
        return None

def process_one(task):
    """One .IMG → .JPG conversion; returns (ok:bool, message:str)."""
    root, file = task
    if not file.endswith(".IMG"):
        return (False, f"skip (not .IMG): {file}")

    src_file = os.path.join(root, file)
    out_root = mirror_root(root)
    os.makedirs(out_root, exist_ok=True)

    base     = os.path.splitext(file)[0]
    jpg_file = os.path.join(out_root, base + ".jpg")

    # --- unique temp files per task (critical for parallel safety)
    tmpdir = tempfile.gettempdir()
    cub_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".cub"); cub_file = cub_tmp.name; cub_tmp.close()
    png_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png"); png_file = png_tmp.name; png_tmp.close()

    try:
        # .IMG -> .cub
        r = subprocess.run(['rososiris2isis', f'from={src_file}', f'to={cub_file}'], cwd=tmpdir)
        if r.returncode != 0:
            return (False, f"rososiris2isis failed on {src_file}")

        # Log the date for debugging parity with your serial output
        di = parse_date_int(file)
        if di is not None:
            print(f"Date int is {di}", flush=True)
        else:
            print(f"Could not parse YYYYMM from filename: {file}", file=sys.stderr)

        # spiceinit (keeps your current CK override)
        ik_path  = _pick(IK_OSIRIS, IK_OSIRIS_ALT)
        iak_path = _pick(IAK_WAC, IAK_WAC_ALT) if CAMERA == "WAC" else _pick(IAK_NAC, IAK_NAC_ALT)

        spice_args = [
            'spiceinit',
            f'from={cub_file}',
            f'ik={ik_path}',
            f'extra={MK_TM}',
            'shape=user',
            f'model={DSK_SHAPE}',
            f'ck={CK_FILE}',
        ]
        if _exists_or_alias(iak_path):
            spice_args += [f'iak={iak_path}']

        print("spiceinit:", " ".join(spice_args), flush=True)
        r = subprocess.run(spice_args, cwd=tmpdir)
        if r.returncode != 0:
            # keep behavior: print label to help diagnose, then skip
            print(f"spiceinit failed on {cub_file}", file=sys.stderr)
            subprocess.run(["catlab", f"from={cub_file}", "to=stdout"])
            return (False, f"spiceinit failed on {cub_file}")

        # .cub -> .png
        r = subprocess.run(['isis2std', f'from={cub_file}', f'to={png_file}', 'format=png'], cwd=tmpdir)
        if r.returncode != 0:
            return (False, f"isis2std failed on {png_file}")

        # .png -> .jpg
        # Tricky - need to crop images with overscan (problem with WAC for now)
# Map raw-with-overscan -> active science area
        # 2304->2048, 1152->1024, 576->512, 288->256
        # crop_map = {2304: 2048, 1152: 1024, 576: 512, 288: 256}

        # # Query PNG dimensions using ImageMagick 'identify'
        # try:
        #     dim = subprocess.check_output(['identify', '-format', '%w %h', png_file], cwd=tmpdir)
        #     w, h = map(int, dim.decode().strip().split())
        # except Exception:
        #     w = h = 0  # fall back to no-crop if identify is unavailable

        crop_args = []
        # if w == h and w in crop_map:
        #     target = crop_map[w]
        #     crop_args = ['-gravity', 'center', '-crop', f'{target}x{target}+0+0', '+repage']

        # if crop_args:
        #     print(f"Cropping {file} from {w} to {target}", flush=True)

        flip_args = []
        if CAMERA == "WAC":
            flip_args = ['-flop']

        r = subprocess.run(['convert', png_file, *crop_args, *flip_args, '-quality', '80', '-format', 'jpg', jpg_file])
        if r.returncode != 0:
            return (False, f"convert failed on {jpg_file}")

        return (True, jpg_file)

    finally:
        for p in (png_file, cub_file):
            try: os.remove(p)
            except OSError: pass

def default_workers():
    try:
        cpu = os.cpu_count() or 4
        # Good starting point on a 3700X (8c/16t) without thrashing
        return max(1, min(6, cpu - 2))
    except Exception:
        return 4

# ---- Main (fan out work) ----------------------------------------------
def main():
    # Build task list
    tasks = []
    for root, dirs, files in os.walk(fromdir):
        # Ensure mirror exists (harmless if repeated)
        out_root = mirror_root(root)
        os.makedirs(out_root, exist_ok=True)
        for file in files:
            if file.endswith(".IMG"):
                tasks.append((root, file))

    if not tasks:
        print("No .IMG files found.", flush=True)
        return

    workers = int(os.environ.get("PDS2JPGS_WORKERS", default_workers()))
    print(f"Workers: {workers} | Tasks: {len(tasks)}", flush=True)

    done = 0
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as ex:
            for ok, msg in ex.map(process_one, tasks, chunksize=1):
                if ok:
                    done += 1
                    print(f"Finished {done}: {msg}", flush=True)
                else:
                    print(f"Error: {msg}", file=sys.stderr, flush=True)
    except KeyboardInterrupt:
        print("\nInterrupted by user. Partial results kept.", flush=True)

    print(f"All done. Successful JPGs: {done}/{len(tasks)}", flush=True)

if __name__ == "__main__":
    main()
