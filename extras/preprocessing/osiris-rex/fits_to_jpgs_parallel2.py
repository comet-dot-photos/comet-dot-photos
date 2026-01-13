#!/usr/bin/env python3
# fits_to_jpgs_parallel2.py
#
# Usage:
#   fits_to_jpgs_parallel2.py <fromDir> <toDir>
#
# Recursively convert all .fits/.fit files under <fromDir> to .jpg under <toDir>,
# preserving directory structure. Uses Astropy to read FITS (HDU 1 preferred)
# and Pillow to write 8-bit grayscale JPEGs.
#
# Environment variables:
#   FITS2JPGS_WORKERS  - number of parallel workers
#                        (default: CPUs-2, clamped 1..6)
#   JPG_QUALITY        - JPEG "quality" (default: 80)
#   STRETCH_LOW        - low percentile for scaling (default: 0.1)
#   STRETCH_HIGH       - high percentile for scaling (default: 99.9)

import os
import sys
import concurrent.futures

import numpy as np
from astropy.io import fits
from PIL import Image

# ---- CLI ---------------------------------------------------------------

if len(sys.argv) != 3:
    print("Usage: fits_to_jpgs_parallel2.py <fromDir> <toDir>")
    sys.exit(1)

fromdir = os.path.abspath(sys.argv[1])
todir   = os.path.abspath(sys.argv[2])

# ---- Config / Env ------------------------------------------------------

def _workers_default():
    try:
        cpu = os.cpu_count() or 4
        return max(1, min(6, cpu - 2))
    except Exception:
        return 4

WORKERS = int(os.environ.get("FITS2JPGS_WORKERS", _workers_default()))
JPG_QUALITY = int(os.environ.get("JPG_QUALITY", "80"))

STRETCH_LOW = float(os.environ.get("STRETCH_LOW", "0.1"))
STRETCH_HIGH = float(os.environ.get("STRETCH_HIGH", "99.9"))

# Accept both .fits and .fit (case-insensitive)
NEEDED_EXTS = (".fits", ".fit")


# ---- Helpers -----------------------------------------------------------

def mirror_root(root):
    """Map a source directory to its mirror under todir."""
    rel = os.path.relpath(root, fromdir)
    return os.path.join(todir, rel)

def is_fits(fname):
    lower = fname.lower()
    return any(lower.endswith(ext) for ext in NEEDED_EXTS)

def fits_to_jpeg(src_file, dst_file):
    """
    Read a FITS file with Astropy, extract image data from HDU 1 if available
    (e.g., ONC-LEVEL2c), otherwise HDU 0. Scale via percentiles and write a
    grayscale JPEG using Pillow.
    """
    with fits.open(src_file, memmap=True) as hdul:
        # Prefer HDU 1 if it has image data (typical for ONC L2c)
        if len(hdul) > 1 and getattr(hdul[1], "data", None) is not None:
            data = hdul[1].data
        else:
            data = hdul[0].data

        if data is None:
            raise RuntimeError("No image data found in FITS HDUs")

        # Collapse extra dimensions if needed, keep a 2D image
        data = np.asarray(data)
        if data.ndim > 2:
            data = data[0, ...]
        if data.ndim != 2:
            raise RuntimeError("Unexpected data ndim=%d" % data.ndim)

        data = data.astype("float32")
        data = np.nan_to_num(data, nan=0.0)

        # Percentile-based scaling
        lo, hi = np.percentile(data, [STRETCH_LOW, STRETCH_HIGH])
        if (not np.isfinite(lo)) or (not np.isfinite(hi)) or hi <= lo:
            lo, hi = float(np.min(data)), float(np.max(data))

        if hi == lo:
            # Completely flat image -> mid-gray
            img = np.full_like(data, 0.5, dtype="float32")
        else:
            img = (np.clip(data, lo, hi) - lo) / (hi - lo)

        img8 = (img * 255.0).astype("uint8")

        im = Image.fromarray(img8, mode="L")
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
        # optimize=True -> smaller files, same visual quality
        im.save(dst_file, quality=JPG_QUALITY, optimize=True)


def process_one(task):
    """
    Convert one FITS file -> JPG using Astropy + Pillow.
    Returns (ok: bool, message: str).
    """
    root, file = task
    src_file = os.path.join(root, file)
    out_root = mirror_root(root)
    base, _ = os.path.splitext(file)
    jpg_file = os.path.join(out_root, base + ".jpg")

    try:
        fits_to_jpeg(src_file, jpg_file)
        return (True, jpg_file)
    except Exception as e:
        return (False, f"{src_file} -> {e}")


# ---- Main --------------------------------------------------------------

def main():
    tasks = []
    for root, dirs, files in os.walk(fromdir):
        for f in files:
            if is_fits(f):
                tasks.append((root, f))

    if not tasks:
        exts_str = ", ".join(NEEDED_EXTS)
        print(f"No {exts_str} files found under {fromdir}.")
        return

    total = len(tasks)
    print(
        f"FITS->JPG (Astropy/Pillow) | Workers={WORKERS} | Tasks={total} | "
        f"JPG_QUALITY={JPG_QUALITY} | STRETCH={STRETCH_LOW}–{STRETCH_HIGH}",
        flush=True,
    )

    done = 0
    try:
        with concurrent.futures.ProcessPoolExecutor(max_workers=WORKERS) as ex:
            for ok, msg in ex.map(process_one, tasks, chunksize=1):
                if ok:
                    done += 1
                    print(f"[OK {done}/{total}] {msg}", flush=True)
                else:
                    print(f"[ERR] {msg}", flush=True)
    except KeyboardInterrupt:
        print("\nInterrupted by user. Partial results kept.", flush=True)

    print(f"All done. Successful JPGs: {done}/{total}")


if __name__ == "__main__":
    main()
