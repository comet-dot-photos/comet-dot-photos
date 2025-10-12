#!/usr/bin/env python3
# quick_pds_to_jpgs_parallel.py
# Usage: quick_pds_to_jpgs_parallel.py <NAVCAM|NAC|WAC> <fromDir> <toDir>

# Retrieves the image data without using ISIS, via just capturing the bits
# from the PDS3 .IMG files. This is faster, but has the potential downside
# that it may not handle all edge cases.
# 
# This should work for all three Rosetta cameras, but is intended primarily
# for NAVCAM, while other extractions (NAC and WAC) are better handled by
# pds_to_jpgs_parallel.py which uses ISIS.


import os, sys, subprocess, tempfile, concurrent.futures

# ---- CLI ---------------------------------------------------------------
if len(sys.argv) != 4 or sys.argv[1].upper() not in ("NAVCAM", "NAC", "WAC"):
    print("Usage: quick_pds_to_jpgs_parallel.py <NAVCAM|NAC|WAC> <fromDir> <toDir>")
    sys.exit(1)

CAMERA  = sys.argv[1].upper()
fromdir = os.path.abspath(sys.argv[2])
todir   = os.path.abspath(sys.argv[3])

# File selection per camera:
# - NAVCAM uses detached labels -> .LBL
# - NAC/WAC typically use attached/level IMG -> .IMG
NEEDED_EXT = ".LBL" if CAMERA == "NAVCAM" else ".IMG"

# External tools we invoke (must be in PATH)
PDS2PNG = "quick_pds_to_png.py"        #  PDS->PNG converter
CONVERT = os.environ.get("IM_CONVERT", "convert")  # ImageMagick 'convert' (or set IM_CONVERT)

# Optional env overrides
TMPDIR      = os.environ.get("PDS_TMPDIR")          # where to put temp PNGs (e.g., /mnt/ssd/tmp)
JPG_QUALITY = os.environ.get("JPG_QUALITY", "80")   # JPG quality (default 80)

# ---- Helpers -----------------------------------------------------------
def mirror_root(root: str) -> str:
    rel = os.path.relpath(root, fromdir)
    return os.path.join(todir, rel)

def default_workers():
    try:
        cpu = os.cpu_count() or 4
        return max(1, min(6, cpu - 2))  # modest default
    except Exception:
        return 4

def process_one(task):
    """
    Convert one file -> JPG via:
      quick_pds_to_png.y <in> <tmp.png>
      convert <tmp.png> [-flop if WAC or NAVCAM] -quality <q> -format jpg <out.jpg>
    Returns (ok: bool, message: str)
    """
    root, file = task
    src_file = os.path.join(root, file)
    out_root = mirror_root(root)
    os.makedirs(out_root, exist_ok=True)

    base, _ = os.path.splitext(file)
    jpg_file = os.path.join(out_root, base + ".jpg")

    # Make unique temp PNG (in system temp or PDS_TMPDIR if set)
    png_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".png", dir=TMPDIR)
    png_file = png_tmp.name
    png_tmp.close()

    try:
        # 1) PDS -> PNG (handles .LBL vs attached .IMG automatically)
        r = subprocess.run([PDS2PNG, src_file, png_file])
        if r.returncode != 0 or not os.path.exists(png_file):
            return (False, f"{PDS2PNG} failed: {src_file}")

        # 2) PNG -> JPG (quality N; flop for WAC)
        cmd = [CONVERT, png_file]
        if CAMERA == "WAC" or CAMERA == "NAVCAM":
            cmd += ["-flop"]  # mirror left↔right for WAC|NAVCAM
        cmd += ["-quality", JPG_QUALITY, "-format", "jpg", jpg_file]
        r = subprocess.run(cmd)
        if r.returncode != 0 or not os.path.exists(jpg_file):
            return (False, f"{CONVERT} failed: {jpg_file}")

        return (True, jpg_file)

    finally:
        # Always try to clean temp
        try:
            if os.path.exists(png_file):
                os.remove(png_file)
        except OSError:
            pass

# ---- Main --------------------------------------------------------------
def main():
    # Collect tasks
    tasks = []
    for root, dirs, files in os.walk(fromdir):
        os.makedirs(mirror_root(root), exist_ok=True)
        for f in files:
            if f.upper().endswith(NEEDED_EXT):
                tasks.append((root, f))

    if not tasks:
        print(f"No {NEEDED_EXT} files found under {fromdir}.")
        return

    workers = int(os.environ.get("PDS2JPGS_WORKERS", default_workers()))
    print(f"Camera={CAMERA} | Looking for *{NEEDED_EXT} | Workers={workers} | Tasks={len(tasks)} | "
          f"TMPDIR={TMPDIR or 'system temp'} | JPG_QUALITY={JPG_QUALITY}", flush=True)

    done = 0
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers) as ex:
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
