#!/usr/bin/env python3
"""
pds3_navcam_to_png.py  —  robust NAVCAM PDS3 → PNG

- Parses the .LBL (PDS3 PVL) and reads the paired .IMG
- Handles detached labels (^IMAGE pointer, RECORD_BYTES/LABEL_RECORDS)
- Treats floating products (PC_REAL) robustly:
    * tries BOTH big- and little-endian float32, picks the healthier one
    * masks NaN/Inf and huge sentinel fills (~±3.3e38)
    * respects optional label constants (MISSING_CONSTANT, NULL, VALID_MIN/MAX)
- Percentile contrast stretch (default 0.5–99.5%)
- Writes an 8-bit PNG

Usage:
  python pds3_navcam_to_png.py <FILE.LBL|FILE.IMG> [out.png] [--lo 0.5] [--hi 99.5]
"""

import argparse
import pathlib
import numpy as np
from PIL import Image
import pvl

def _byte_offset(meta, img_obj):
    # Start with whole-label size if present
    offset = int(meta.get('RECORD_BYTES', 0)) * int(meta.get('LABEL_RECORDS', 0))
    # Prefer ^IMAGE pointer if present (1-based records)
    if '^IMAGE' in img_obj:
        ptr = img_obj['^IMAGE']
        # can be integer records or (filename,records)
        if isinstance(ptr, (list, tuple)):
            ptr = ptr[-1]
        if isinstance(ptr, int) and meta.get('RECORD_BYTES', 0):
            offset = int(ptr - 1) * int(meta['RECORD_BYTES'])
        elif isinstance(ptr, int):
            # already bytes (rare), keep as-is
            offset = int(ptr)
    return offset

def _dtype_map(sample_type, sample_bits):
    st = str(sample_type).upper()
    sb = int(sample_bits)
    # Integer mappings
    m = {
        ('MSB_INTEGER', 8):  '>i1', ('LSB_INTEGER', 8):  '<i1',
        ('MSB_UNSIGNED_INTEGER', 8): '>u1', ('LSB_UNSIGNED_INTEGER', 8): '<u1',
        ('MSB_INTEGER', 16): '>i2', ('LSB_INTEGER', 16): '<i2',
        ('MSB_UNSIGNED_INTEGER', 16): '>u2', ('LSB_UNSIGNED_INTEGER', 16): '<u2',
        ('MSB_INTEGER', 32): '>i4', ('LSB_INTEGER', 32): '<i4',
        ('MSB_UNSIGNED_INTEGER', 32): '>u4', ('LSB_UNSIGNED_INTEGER', 32): '<u4',
        ('IEEE_REAL', 32):   '>f4', ('IEEE_REAL', 64):   '>f8',
    }
    if (st, sb) in m:
        return [m[(st, sb)]]
    if st == 'PC_REAL' and sb == 32:
        # Try BOTH endiannesses; pick the healthier one after masking
        return ['>f4', '<f4']
    # Add more types here if needed
    raise ValueError(f"Unsupported SAMPLE_TYPE/BITS: {sample_type}/{sample_bits}")

def read_pds3_array(lbl_path: pathlib.Path):
    meta = pvl.load(str(lbl_path))
    img_obj = meta['IMAGE']
    samples = int(img_obj['LINE_SAMPLES'])
    lines   = int(img_obj['LINES'])
    sample_bits = int(img_obj['SAMPLE_BITS'])
    sample_type = str(img_obj['SAMPLE_TYPE'])

    # Figure image file (detached vs embedded)
    if lbl_path.suffix.upper() == '.LBL':
        img_path = lbl_path.with_suffix('.IMG')
    else:
        img_path = lbl_path

    offset = _byte_offset(meta, img_obj)
    dtype_candidates = _dtype_map(sample_type, sample_bits)

    arr_best, score_best, dtype_chosen = None, -1.0, None
    with open(img_path, 'rb') as f:
        for dt in dtype_candidates:
            f.seek(offset)
            try:
                arr = np.fromfile(f, dtype=dt, count=samples*lines).reshape(lines, samples)
            except Exception:
                continue
            # Evaluate "health": fraction of finite values not huge
            finite = np.isfinite(arr)
            sane = finite & (np.abs(arr) < 1e30)
            score = sane.sum() / arr.size
            if score > score_best:
                arr_best, score_best, dtype_chosen = arr, score, dt

    if arr_best is None:
        raise RuntimeError("Failed to read image with any dtype candidate.")

    # Optional linear scale from label (common in calibrated products)
    scale  = float(meta['IMAGE'].get('SCALING_FACTOR', 1.0))
    offset_val = float(meta['IMAGE'].get('OFFSET', 0.0))
    if scale != 1.0 or offset_val != 0.0:
        arr_best = arr_best * scale + offset_val

    return arr_best, meta, dtype_chosen, score_best

def mask_and_stretch(arr, meta, p_lo=0.5, p_hi=99.5):
    # Clean NaN/Inf up-front for quiet math
    arr = np.where(np.isfinite(arr), arr, 0.0).astype(np.float64, copy=False)

    # Build mask of invalids/fills
    mask = ~np.isfinite(arr)
    mask |= (np.abs(arr) > 1e30)  # typical float fill ~±3.3e38

    img_obj = meta['IMAGE']
    # Common sentinel keys
    for key in ('MISSING_CONSTANT', 'NULL', 'LOW_REPR_SATURATION', 'HIGH_REPR_SATURATION'):
        if key in img_obj:
            try:
                val = float(img_obj[key]); mask |= (arr == val)
            except Exception:
                pass
    # Valid range
    if 'VALID_MIN' in img_obj:
        try:
            vmin = float(img_obj['VALID_MIN']); mask |= (arr < vmin)
        except Exception:
            pass
    if 'VALID_MAX' in img_obj:
        try:
            vmax = float(img_obj['VALID_MAX']); mask |= (arr > vmax)
        except Exception:
            pass

    valid = arr[~mask]
    if valid.size == 0:
        raise RuntimeError("No valid pixels after masking; check dtype or label interpretation.")

    lo, hi = np.percentile(valid, [p_lo, p_hi])
    if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
        lo, hi = np.nanmin(valid), np.nanmax(valid)
        if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
            raise RuntimeError("Could not determine stretch range.")

    out = np.zeros_like(arr, dtype=np.float64)
    out[~mask] = (arr[~mask] - lo) * (255.0 / (hi - lo + 1e-9))
    out = np.clip(out, 0, 255).astype(np.uint8)
    return out

def main():
    ap = argparse.ArgumentParser(description="PDS3 NAVCAM → PNG with robust float handling")
    ap.add_argument("infile", help="Path to .LBL or .IMG")
    ap.add_argument("outfile", nargs='?', help="Output PNG (default: same name .png)")
    ap.add_argument("--lo", type=float, default=0.5, help="low percentile (default 0.5)")
    ap.add_argument("--hi", type=float, default=99.5, help="high percentile (default 99.5)")
    args = ap.parse_args()

    in_path = pathlib.Path(args.infile)
    lbl_path = in_path if in_path.suffix.upper() == '.LBL' else in_path.with_suffix('.LBL')
    out_path = pathlib.Path(args.outfile) if args.outfile else lbl_path.with_suffix('.png')

    arr, meta, chosen, health = read_pds3_array(lbl_path)
    print(f"dtype chosen: {chosen} | health: {health:.3f} | shape: {arr.shape}")
    print(f"raw min/max: {np.nanmin(arr)}, {np.nanmax(arr)}")

    arr8 = mask_and_stretch(arr, meta, p_lo=args.lo, p_hi=args.hi)
    Image.fromarray(arr8).save(out_path)
    print("wrote", out_path)

if __name__ == "__main__":
    main()
