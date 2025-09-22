#!/usr/bin/env python3
# quick_pds_to_png.py - Quick and simple PDS -> PNG converter
#   which does not require ISIS.
# 
#!/usr/bin/env python3
# quick_pds_to_png.py — Quick PDS (Rosetta NAVCAM/OSIRIS) → PNG converter
#
# Usage:
#   python quick_pds_to_png.py INPUT.{LBL|IMG} OUTPUT.png [options]
#
# Required arguments:
#   INPUT   Path to input PDS3 label (.LBL) or attached-label .IMG file
#   OUTPUT  Path to output PNG file
#
# Options:
#   --stretch {percent|minmax}   Scaling mode (default: percent)
#   --pclip L,H                  Percentile clip for --stretch percent
#                                (default: "0.5,99.5")
#   --invalid {zero|min|max|255} Handling of invalid pixels
#                                zero=map to 0 (default)
#                                min =map to low end
#                                max =map to high end
#                                255 =force to 255
#   --isis-default               Preset: mimic isis2std default autostretch
#                                (equivalent to --stretch minmax --invalid zero).
#                                Overrides --stretch/--invalid if present.
#
# Example:
#   python quick_pds_to_png.py ROS_CAM1_20140801T000016C.LBL out.png \
#       --stretch percent --pclip 1,99 --invalid zero
#
# Notes:
# - Designed primarily for Rosetta NAVCAM images (but works for NAC/WAC).
# - Does not require ISIS; reads PDS3 label headers directly.
# - Input image data must be little-endian float32.

import sys, re, argparse
import numpy as np
from pathlib import Path
from PIL import Image

# ---- read label text (supports .LBL or attached-label .IMG) ----
def read_label_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf in (".lbl", ".lab"):
        return path.read_text(errors="ignore")
    # Attached label: read from start until we see a line "END"
    with open(path, "rb") as f:
        buf = b""
        chunk = 65536
        max_bytes = 4 * 1024 * 1024  # safety cap
        while True:
            data = f.read(chunk)
            if not data:
                break
            buf += data
            txt = buf.decode("latin-1", errors="ignore")
            if re.search(r"(?m)^\s*END\s*$", txt):
                return txt
            if len(buf) >= max_bytes:
                return txt  # best effort
    return ""

# ---- label parsing ----
def _get_int(txt, pat):
    m = re.search(pat, txt, flags=re.I|re.M)
    return int(m.group(1)) if m else None

def parse_label_and_paths(in_path: Path):
    txt = read_label_text(in_path)

    lines   = _get_int(txt, r'^\s*LINES\s*=\s*(\d+)')
    samples = _get_int(txt, r'^\s*LINE_SAMPLES\s*=\s*(\d+)')
    if not lines or not samples:
        raise RuntimeError("Could not parse LINES / LINE_SAMPLES from label.")

    rec_bytes = _get_int(txt, r'^\s*RECORD_BYTES\s*=\s*(\d+)') or 0
    img_ptr   = _get_int(txt, r'^\s*\^(?:PB_IMAGE|IMAGE)\s*=\s*(\d+)')
    if img_ptr and rec_bytes:
        offset = (img_ptr - 1) * rec_bytes
    else:
        lab_recs = _get_int(txt, r'^\s*LABEL_RECORDS\s*=\s*(\d+)') or 0
        offset = lab_recs * rec_bytes

    img_path = in_path if in_path.suffix.lower() not in (".lbl", ".lab") else in_path.with_suffix(".IMG")
    return lines, samples, offset, img_path

# ---- data read (little-endian float32) ----
def read_array_le(img_path: Path, offset: int, lines: int, samples: int):
    count = lines * samples
    with open(img_path, "rb") as f:
        f.seek(offset)
        arr = np.fromfile(f, dtype="<f4", count=count)
    if arr.size != count:
        raise RuntimeError("Unexpected data size; check offset/shape.")
    with np.errstate(invalid="ignore"):
        arr = arr.reshape((lines, samples)).astype(np.float64, copy=False)
    return arr

# ---- scaling / stretch ----
def scale_to_png8(arr, stretch_mode="percent", pclip=(0.5, 99.5), invalid_map="zero"):
    """
    stretch_mode: 'percent' (default) or 'minmax'
    pclip: (low, high) percentiles used when stretch_mode='percent'
    invalid_map:
        'zero' : set invalid to 0 after scaling (default)
        'min'  : map invalid to low end before scaling (→ 0)
        'max'  : map invalid to high end before scaling (→ 255)
        '255'  : force invalid to 255 after scaling
    """
    invalid = ~np.isfinite(arr) | (np.abs(arr) > 1e30)
    valid = arr[~invalid]
    if valid.size == 0:
        raise RuntimeError("No valid pixels after masking.")

    if stretch_mode == "percent":
        lo, hi = np.percentile(valid, pclip)
        if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
            lo, hi = float(valid.min()), float(valid.max())
    elif stretch_mode == "minmax":
        lo, hi = float(valid.min()), float(valid.max())
    else:
        raise ValueError("stretch_mode must be 'percent' or 'minmax'")

    work = arr.copy()
    if invalid_map == "min":
        work[invalid] = lo
    elif invalid_map == "max":
        work[invalid] = hi

    out = (np.clip(work, lo, hi) - lo) * (255.0 / (hi - lo + 1e-12))
    out = np.clip(out, 0, 255)

    if invalid_map == "zero":
        out[invalid] = 0
    elif invalid_map == "255":
        out[invalid] = 255

    return out.astype(np.uint8)

# ---- main ----
def pds_to_png(infile, outfile, stretch_mode, pclip_low, pclip_high, invalid_map):
    in_path = Path(infile)
    lines, samples, offset, img_path = parse_label_and_paths(in_path)
    arr = read_array_le(img_path, offset, lines, samples)
    img8 = scale_to_png8(
        arr,
        stretch_mode=stretch_mode,
        pclip=(pclip_low, pclip_high),
        invalid_map=invalid_map,
    )
    Image.fromarray(img8, mode="L").save(outfile)
    print(
        f"wrote {outfile}  [{lines}x{samples} @ {offset} bytes]  "
        f"src={img_path.name}  stretch={stretch_mode} "
        f"pclip=({pclip_low},{pclip_high}) invalid={invalid_map} endian=<f4"
    )

def main():
    ap = argparse.ArgumentParser(description="Quick PDS (NAVCAM/OSIRIS) -> PNG converter")
    ap.add_argument("input", help="input .LBL or attached-label .IMG")
    ap.add_argument("output", help="output .png")

    # Stretch & invalid switches
    ap.add_argument("--stretch", choices=["percent", "minmax"], default="percent",
                    help="scaling mode (default: percent)")
    ap.add_argument("--pclip", type=str, default="0.5,99.5",
                    help="low,high percentiles for --stretch percent (default: 0.5,99.5)")
    ap.add_argument("--invalid", choices=["zero", "min", "max", "255"], default="zero",
                    help="how to map invalid/sentinel pixels (default: zero)")

    # Preset to mimic isis2std default autostretch
    ap.add_argument("--isis-default", action="store_true",
                    help="Preset: mimic isis2std default autostretch "
                         "(equivalent to --stretch minmax --invalid zero). "
                         "Overrides --stretch/--invalid if provided.")

    args = ap.parse_args()

    try:
        plow, phigh = (float(x) for x in args.pclip.split(","))
    except Exception:
        print("ERROR: --pclip must be two comma-separated numbers like 0.5,99.5", file=sys.stderr)
        sys.exit(2)

    # Apply preset if requested (overrides stretch/invalid)
    stretch_mode = "minmax" if args.isis_default else args.stretch
    invalid_map  = "zero"   if args.isis_default else args.invalid

    pds_to_png(args.input, args.output, stretch_mode, plow, phigh, invalid_map)

if __name__ == "__main__":
    main()
