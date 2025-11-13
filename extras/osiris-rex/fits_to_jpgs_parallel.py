#!/usr/bin/env python3
# fits_to_jpgs_parallel.py
# Usage: fits_to_jpgs_parallel.py <fromDir> <toDir>
#
# Recursively convert all .fits files under <fromDir> to .jpg under <toDir>,
# preserving directory structure. Uses ImageMagick directly (one step).
# JPG quality is controlled by the JPG_QUALITY env var (default 80).
#
# Notes:
# - No flip/flop is applied (FITS pixel ordering assumed standardized).
# - Set IM_CONVERT to override the ImageMagick executable, e.g.:
#     export IM_CONVERT="magick convert"   # Windows / IM 7 multi-binary
# - Control parallelism with FITS2JPGS_WORKERS.

import os
import sys
import shlex
import subprocess
import concurrent.futures

# ---- CLI ---------------------------------------------------------------
if len(sys.argv) != 3:
    print("Usage: fits_to_jpgs_parallel.py <fromDir> <toDir>")
    sys.exit(1)

fromdir = os.path.abspath(sys.argv[1])
todir   = os.path.abspath(sys.argv[2])

# ---- Config / Env ------------------------------------------------------
CONVERT_CMD = os.environ.get("IM_CONVERT", "convert")
# Allow both new and legacy env var names for workers:
def _workers_default():
    try:
        cpu = os.cpu_count() or 4
        return max(1, min(6, cpu - 2))
    except Exception:
        return 4

WORKERS = int(os.environ.get("FITS2JPGS_WORKERS", _workers_default()))
JPG_QUALITY = os.environ.get("JPG_QUALITY", "80")

NEEDED_EXT = ".fits"  # case-insensitive

# ---- Helpers -----------------------------------------------------------
def mirror_root(root: str) -> str:
    rel = os.path.relpath(root, fromdir)
    return os.path.join(todir, rel)

def is_fits(fname: str) -> bool:
    return fname.lower().endswith(NEEDED_EXT)

def build_convert_command(src_file: str, dst_file: str):
    """
    Build the ImageMagick command to convert FITS -> JPG in one step,
    preserving requested quality. No flip/flop performed.
    """
    # Support "magick convert" (IM7 on Windows) if user set IM_CONVERT accordingly.
    # If CONVERT_CMD contains spaces (e.g., "magick convert"), split it safely.
    parts = shlex.split(CONVERT_CMD)
    return parts + [src_file, "-contrast-stretch", "0.5%", "-quality", JPG_QUALITY, dst_file]

def process_one(task):
    """
    Convert one FITS file -> JPG using ImageMagick in one step.
    Returns (ok: bool, message: str)
    """
    root, file = task
    src_file = os.path.join(root, file)
    out_root = mirror_root(root)
    os.makedirs(out_root, exist_ok=True)

    base, _ = os.path.splitext(file)
    jpg_file = os.path.join(out_root, base + ".jpg")

    try:
        cmd = build_convert_command(src_file, jpg_file)
        r = subprocess.run(cmd)
        if r.returncode != 0 or not os.path.exists(jpg_file):
            return (False, f"convert failed: {jpg_file}")
        return (True, jpg_file)
    except Exception as e:
        return (False, f"exception: {e}")

# ---- Main --------------------------------------------------------------
def main():
    # Collect tasks
    tasks = []
    for root, dirs, files in os.walk(fromdir):
        # Pre-create mirror dirs so progress is immediate
        os.makedirs(mirror_root(root), exist_ok=True)
        for f in files:
            if is_fits(f):
                tasks.append((root, f))

    if not tasks:
        print(f"No {NEEDED_EXT} files found under {fromdir}.")
        return

    print(f"FITS->JPG | Workers={WORKERS} | Tasks={len(tasks)} | JPG_QUALITY={JPG_QUALITY}", flush=True)

    done = 0
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=WORKERS) as ex:
            for ok, msg in ex.map(process_one, tasks, chunksize=1):
                if ok:
                    done += 1
                    print(f"[OK {done}/{len(tasks)}] {msg}", flush=True)
                else:
                    print(f"[ERR] {msg}", flush=True)
    except KeyboardInterrupt:
        print("\nInterrupted by user. Partial results kept.", flush=True)

    print(f"All done. Successful JPGs: {done}/{len(tasks)}")

if __name__ == "__main__":
    main()
