#!/usr/bin/env python3

# json_from_pds4_hyb2_onc-w1_curated.py
# Usage:
#   python json_from_pds4_hyb2_onc-w1_curated.py <path> --mk <meta-kernel.tm>
#       [--out <output.json>] [--sidecar] [--target-frame <frame>]
#       [--min-px <pixels>]
#
# Builds Comet.Photos-style view JSON from Hayabusa2 ONC PDS4 labels.
# Uses SPICE to compute cv, up, su, sc vectors.
# Creates nm from filename and ti from PDS4 label.
#
# NOTE: By default we sample geometry and 'ti' at the START of the exposure.
#       For V-filter images (filename contains 'tvf') whose start time falls
#       within configured V_LIST_RANGES, and when exposure duration is
#       available, we instead sample at the END of the exposure.
#
# Also:
#   - Opens the corresponding FITS file.
#   - Skips non-square images.
#   - If square and resolution != 1024, adds "rz": resolution.
#   - Optionally skips images where Ryugu is smaller than --min-px pixels across.

from __future__ import annotations
import argparse
import datetime
import json
import os
import sys
import xml.etree.ElementTree as ET

try:
    import spiceypy as spice
except Exception:
    sys.stderr.write("ERROR: spiceypy is required. Install with: pip install spiceypy\n")
    raise

try:
    from astropy.io import fits
except Exception:
    sys.stderr.write("ERROR: astropy is required. Install with: pip install astropy\n")
    raise

import numpy as np


# PDS4 namespaces
PDS_NS = {"pds": "http://pds.nasa.gov/pds4/pds/v1"}
HYB2_NS = {"hyb2": "http://darts.isas.jaxa.jp/pds4/mission/hyb2/v1"}
IMG_NS = {"img": "http://pds.nasa.gov/pds4/img/v1"}  # for exposure_duration


# Mapping from simple instrument IDs to frame names.
CAMERA_FRAME_BY_ID = {
    "ONC-T":  "HAYABUSA2_ONC-T",
    "ONC-W1": "HAYABUSA2_ONC-W1",
    "ONC-W2": "HAYABUSA2_ONC-W2",
}


# ---------------------------------------------------------------------------
# Special time and exclusion lists
# ---------------------------------------------------------------------------

# V list: ranges (inclusive) where V-filter (tvf) images should sample ti
# and geometry at END of exposure instead of start.
# V list: ranges (inclusive) where V-filter (tvf) images should sample ti
# and geometry at END of exposure instead of start.
# For ONC-W1 we are not using any special V-list handling:
V_LIST_RANGES_UTC = [
]

# File exclusion list (basenames, no extension).
EXCLUDE_NM = {
    "hyb2_onc_20181003_020012_w1f_l2c",
    "hyb2_onc_20181003_020044_w1f_l2c",
    "hyb2_onc_20181003_020116_w1f_l2c",
    "hyb2_onc_20181003_020220_w1f_l2c",
    "hyb2_onc_20181003_020500_w1f_l2c",
    "hyb2_onc_20181003_020636_w1f_l2c",
    "hyb2_onc_20181003_020812_w1f_l2c",
    "hyb2_onc_20190916_161801_w1f_l2c",
    "hyb2_onc_20191006_125324_w1f_l2c",
}

# Date exclusion list (inclusive), based on start-of-exposure time.
EXCLUDE_DATE_RANGES_UTC = [
    ("2019-03-08T03:27:08.175Z", "2019-03-08T03:37:54.666Z"),
    ("2019-09-16T16:18:02.466Z", "2019-10-06T10:13:21.758Z"),
    ("2019-09-16T16:18:01.446Z", "2019-10-07T19:53:22.313Z")
]


def _parse_iso_utc(s: str) -> datetime.datetime:
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1]
    # datetime.fromisoformat handles fractional seconds if present
    return datetime.datetime.fromisoformat(s)


def _parse_range_list(range_list):
    parsed = []
    for start_str, end_str in range_list:
        start_dt = _parse_iso_utc(start_str)
        end_dt = _parse_iso_utc(end_str)
        # Normalize so start <= end (handles any accidental reversal)
        if start_dt > end_dt:
            start_dt, end_dt = end_dt, start_dt
        parsed.append((start_dt, end_dt))
    return parsed


V_LIST_RANGES = _parse_range_list(V_LIST_RANGES_UTC)
EXCLUDE_DATE_RANGES = _parse_range_list(EXCLUDE_DATE_RANGES_UTC)


def _in_ranges(dt: datetime.datetime, ranges) -> bool:
    for start_dt, end_dt in ranges:
        if start_dt <= dt <= end_dt:
            return True
    return False


def _is_v_filter(nm: str) -> bool:
    return "tvf" in nm.lower()


def sample_et_and_ti(record: dict):
    """
    Decide which time to sample for geometry and ti:

      - Default: start-of-exposure (record['ti'] from the label).
      - If this is a V-filter image (nm contains 'tvf') AND the start time
        falls within V_LIST_RANGES AND an exposure duration is available,
        use END of exposure (start + exp).

    Returns:
        (et, ti_iso, start_dt)
    """
    start_iso = record["ti"]
    start_et = spice.str2et(start_iso)
    start_dt = _parse_iso_utc(start_iso)

    use_end = False
    if _is_v_filter(record.get("nm", "")) and _in_ranges(start_dt, V_LIST_RANGES):
        exp = record.get("exp")
        if exp is not None:
            use_end = True

    if use_end:
        et = start_et + float(record["exp"])
        # ISO string with 'Z', 3 fractional digits
        ti_iso = spice.et2utc(et, "ISOC", 3)
    else:
        et = start_et
        ti_iso = start_iso

    return et, ti_iso, start_dt


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def text_or_none(root, path: str, ns):
    el = root.find(path, ns)
    return el.text.strip() if el is not None and el.text else None


def parse_pds4_for_view(xml_path: str) -> dict:
    """
    Parse a single Hayabusa2 ONC PDS4 label and return minimal info needed
    to build a Comet.Photos-style view entry.
    """
    root = ET.parse(xml_path).getroot()

    # Time (UTC, ISO string, e.g. 2019-07-11T00:22:04.774Z)
    t_utc = text_or_none(root, ".//pds:start_date_time", PDS_NS)
    if not t_utc:
        raise ValueError("No pds:start_date_time in label")

    # Target name: try target_name first, then Target_Identification/name
    target_name = text_or_none(root, ".//pds:target_name", PDS_NS)
    if target_name is None:
        target_name = text_or_none(
            root, ".//pds:Target_Identification/pds:name", PDS_NS
        )

    # Image filename from File_Area_Observational/file_name
    fits_name = text_or_none(
        root,
        ".//pds:File_Area_Observational/pds:File/pds:file_name",
        PDS_NS,
    )
    if not fits_name:
        # Fallback: base name of the XML file with .fit extension
        base = os.path.basename(xml_path)
        fits_name = os.path.splitext(base)[0] + ".fit"

    nm = os.path.splitext(fits_name)[0]  # strip .fit

    # Instrument / frame name from mission area:
    #   <hyb2:naif_instrument_name>HAYABUSA2_ONC-T</hyb2:naif_instrument_name>
    inst_frame_name = text_or_none(
        root,
        ".//hyb2:Observation_Information/hyb2:naif_instrument_name",
        HYB2_NS,
    )

    # Optional: generic instrument_id in PDS core
    instrument_id = text_or_none(root, ".//pds:instrument_id", PDS_NS)

    # Exposure duration (seconds), used for potential end-of-exposure sampling
    exp_str = text_or_none(
        root,
        ".//img:Exposure/img:exposure_duration",
        IMG_NS,
    )
    exp = float(exp_str) if exp_str is not None else None

    return {
        "xml_path": os.path.abspath(xml_path),
        "fits_name": fits_name,             # e.g. hyb2_onc_20190711_002204_tvf_l2c.fit
        "nm": nm,                           # e.g. hyb2_onc_20190711_002204_tvf_l2c
        "ti": t_utc,
        "target_name": target_name,
        "instrument_frame_name": inst_frame_name,
        "instrument_id": instrument_id,
        "exp": exp,                         # exposure duration in seconds (or None)
    }


# ---------------------------------------------------------------------------
# FITS resolution helpers
# ---------------------------------------------------------------------------

def get_square_resolution(fits_path: str):
    """
    Open FITS and determine if there's a square 2-D image.
    Returns:
        (N, (nx, ny)) if nx == ny == N
        (None, (nx, ny)) if not square
    Raises:
        FileNotFoundError if FITS is missing
        ValueError if no usable image data
    """
    if not os.path.exists(fits_path):
        raise FileNotFoundError(f"FITS not found: {fits_path}")

    with fits.open(fits_path, memmap=True) as hdul:
        img = None
        for hdu in hdul:
            data = getattr(hdu, "data", None)
            if data is not None:
                img = data
                break

        if img is None:
            raise ValueError("No image data HDU found")

        shape = img.shape
        if len(shape) < 2:
            raise ValueError(f"Image not 2D (shape={shape})")

        ny, nx = shape[-2], shape[-1]

    if nx != ny:
        return None, (nx, ny)
    return int(nx), (nx, ny)


# ---------------------------------------------------------------------------
# SPICE helpers
# ---------------------------------------------------------------------------

def load_meta_kernels(meta_kernel_args):
    """
    Load one or more meta-kernels.

    Supports:
      --mk mk1.tm --mk mk2.tm
      --mk mk1.tm,mk2.tm
    """
    spice.kclear()

    # Normalize to a list
    if isinstance(meta_kernel_args, str):
        meta_kernel_list = [meta_kernel_args]
    else:
        meta_kernel_list = list(meta_kernel_args)

    paths = []
    for arg in meta_kernel_list:
        # Allow comma-separated lists in a single --mk
        for part in arg.split(","):
            p = part.strip()
            if p:
                paths.append(p)

    if not paths:
        raise ValueError("No meta-kernel paths provided")

    for mk in paths:
        spice.furnsh(mk)


def camera_frame_and_id(record: dict):
    """
    Prefer the NAIF instrument/frame name from hyb2:naif_instrument_name,
    e.g. HAYABUSA2_ONC-T, which is defined in hyb2_v*.tf.

    Fallback: use a string instrument_id (ONC-T/W1/W2) mapped to a frame name.
    """
    # 1) Best: explicit frame name from mission area
    frame_name = record.get("instrument_frame_name")
    if frame_name:
        frame_name = frame_name.strip()
        code = spice.bods2c(frame_name)  # e.g. HAYABUSA2_ONC-T
        return frame_name, code

    # 2) Fallback: instrument_id (ONC-T/W1/W2) -> frame name
    instr_id = record.get("instrument_id")
    if instr_id:
        instr_id = instr_id.strip().upper()
        frame = CAMERA_FRAME_BY_ID.get(instr_id)
        if not frame:
            raise ValueError(
                f"Unknown instrument_id '{instr_id}'. "
                f"Expected one of {list(CAMERA_FRAME_BY_ID)}."
            )
        code = spice.bods2c(frame)
        return frame, code

    raise ValueError("No instrument frame information found in label.")


def fov_info(inst_code: int):
    """
    Returns boresight and boundary vectors in the instrument frame
    using SPICE GETFOV.
    """
    shape, frame, bsight, n, bounds = spice.getfov(int(inst_code), 10)
    return {
        "shape": shape.strip(),
        "frame": frame.strip(),
        "boresight_if": list(bsight),
        "bounds_if": [list(b) for b in bounds[:n]],
    }


# ---------------------------------------------------------------------------
# Apparent-size estimation
# ---------------------------------------------------------------------------

def estimate_ryugu_pixels_across(record: dict, target_frame: str, res: int):
    """
    Estimate how many pixels across Ryugu appears in the image.

    res: image size in pixels (assumed square res x res).

    Returns:
        float (approx pixel diameter) or None if it cannot be estimated.
    """
    # Use the same sampling rule as for compute_view (start vs end).
    et, _, _ = sample_et_and_ti(record)

    cam_frame, inst_code = camera_frame_and_id(record)
    fov = fov_info(inst_code)

    # Normalize boresight
    bs = np.array(fov["boresight_if"], dtype=float)
    bs /= np.linalg.norm(bs)

    # Find max angle between boresight and FOV corners (half diagonal)
    thetas = []
    for b in fov["bounds_if"]:
        v = np.array(b, dtype=float)
        v /= np.linalg.norm(v)
        cosang = np.clip(np.dot(bs, v), -1.0, 1.0)
        thetas.append(np.arccos(cosang))

    if not thetas:
        return None

    theta_diag_half = max(thetas)
    fov_diag = 2.0 * theta_diag_half  # full diagonal angle

    # Approximate rectangular width from diagonal for a square FOV:
    # width ≈ diagonal / sqrt(2)
    fov_width = fov_diag / np.sqrt(2.0)
    pixel_scale = fov_width / float(res)  # rad / pixel

    # Spacecraft range from Ryugu in target_frame
    sc_pos, _ = spice.spkpos("HAYABUSA2", et, target_frame, "NONE", "RYUGU")
    r = np.linalg.norm(sc_pos)

    # Mean radius of Ryugu from RADII
    _, radii = spice.bodvrd("RYUGU", "RADII", 3)
    R = float(sum(radii) / 3.0)

    if r <= R:
        return None

    arg = np.clip(R / r, 0.0, 1.0)
    ang_radius = np.arcsin(arg)
    ang_diam = 2.0 * ang_radius

    px_diameter = ang_diam / pixel_scale
    return float(px_diameter)


# ---------------------------------------------------------------------------
# Geometry / per-view calculation
# ---------------------------------------------------------------------------

def compute_view(record: dict, target_frame: str = "RYUGU_FIXED") -> dict:
    """
    Compute Comet.Photos-style view fields:
      nm, ti, cv, up, su, sc

    All vectors are in target_frame (default RYUGU_FIXED).

    Uses the shared sampling rule for start vs end of exposure:
      - Default: start-of-exposure.
      - V-filter in V_LIST_RANGES: end-of-exposure (if exp present).
    """
    et, ti_iso, _ = sample_et_and_ti(record)

    # Instrument / camera frame
    cam_frame, inst_code = camera_frame_and_id(record)

    # FOV and boresight in instrument frame
    fov = fov_info(inst_code)

    # Rotation from instrument frame to target (Ryugu-fixed) at this time
    r_inst_to_tf = spice.pxform(fov["frame"], target_frame, et)

    # Sight vector (cv): boresight transformed to Ryugu-fixed, normalized
    cv_vec = np.array(spice.mxv(r_inst_to_tf, fov["boresight_if"]), dtype=float)
    cv = cv_vec / np.linalg.norm(cv_vec)

    # Up vector (up): start from +X in instrument frame, transform, then
    # Gram–Schmidt to make it orthogonal to cv, and normalize.
    up_cam = [1.0, 0.0, 0.0]
    up_vec_tf = np.array(spice.mxv(r_inst_to_tf, up_cam), dtype=float)
    proj = np.dot(up_vec_tf, cv) * cv
    up_vec_tf = up_vec_tf - proj
    up = up_vec_tf / np.linalg.norm(up_vec_tf)

    # Positions: SUN and HAYABUSA2 in Ryugu-fixed, no aberration corrections.
    sun_pos, _ = spice.spkpos("SUN", et, target_frame, "NONE", "RYUGU")
    sc_pos, _ = spice.spkpos("HAYABUSA2", et, target_frame, "NONE", "RYUGU")

    return {
        "nm": record["nm"],
        "ti": ti_iso,
        "cv": cv.tolist(),
        "up": up.tolist(),
        "su": sun_pos.tolist(),
        "sc": sc_pos.tolist(),
    }


# ---------------------------------------------------------------------------
# File walking / sidecars
# ---------------------------------------------------------------------------

def find_xmls(root_dir: str):
    for d, _, files in os.walk(root_dir):
        for f in files:
            if f.lower().endswith(".xml"):
                yield os.path.join(d, f)


def write_sidecar(view: dict, xml_path: str):
    """
    Each sidecar is a single dict, not an array.
    <image>.xml -> <image>.json
    """
    base = os.path.splitext(xml_path)[0]
    out = base + ".json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(view, f, separators=(",", ":"))
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description=(
            "Build Hayabusa2 ONC view JSON from PDS4 labels "
            "(nm, ti, cv, up, su, sc), checking FITS resolution. "
            "Non-square images are skipped; square images with "
            "resolution != 1024 get an 'rz' field. Optionally "
            "skip images where Ryugu is smaller than --min-px pixels."
        )
    )
    ap.add_argument(
        "path",
        help="Root directory (recursively scanned) or a single .xml label file",
    )
    ap.add_argument(
        "--mk",
        "--meta-kernel",
        dest="meta_kernels",
        action="append",
        required=True,
        help=(
            "Path to Hayabusa2 SPICE meta-kernel (.tm), e.g. hyb2_onc_spc_v02.tm. "
            "May be specified multiple times and/or as a comma-separated list."
        ),
    )
    ap.add_argument(
        "--out",
        default="imageMetadata_hyb2.json",
        help="Output JSON file (default: imageMetadata_hyb2.json)",
    )
    ap.add_argument(
        "--target-frame",
        default="RYUGU_FIXED",
        help="Target-fixed frame name (default: RYUGU_FIXED)",
    )
    ap.add_argument(
        "--sidecar",
        action="store_true",
        help=(
            "Also write per-image sidecar JSONs next to each .xml "
            "with a single {nm,ti,cv,up,su,sc[,rz]} dict."
        ),
    )
    ap.add_argument(
        "--min-px",
        type=float,
        default=0.0,
        help=(
            "Minimum apparent Ryugu diameter in pixels. "
            "Images where Ryugu is estimated to be smaller than this "
            "are skipped (default: 0, no filtering)."
        ),
    )
    args = ap.parse_args()

    load_meta_kernels(args.meta_kernels)

    # Collect XML paths
    if os.path.isdir(args.path):
        paths = list(find_xmls(args.path))
    elif args.path.lower().endswith(".xml"):
        paths = [args.path]
    else:
        sys.stderr.write(
            "ERROR: path must be a directory or a .xml label file\n"
        )
        sys.exit(2)

    views = []
    count = 0
    for xml_path in sorted(paths):
        try:
            rec = parse_pds4_for_view(xml_path)

            # File-based exclusion (by basename)
            if rec["nm"] in EXCLUDE_NM:
                print(f"[SKIP] {rec['nm']}   in file exclusion list")
                continue

            # Date-based exclusion (start-of-exposure)
            start_dt = _parse_iso_utc(rec["ti"])
            if _in_ranges(start_dt, EXCLUDE_DATE_RANGES):
                print(f"[SKIP] {rec['nm']}   in date exclusion list")
                continue

            # Check the FITS resolution
            fits_dir = os.path.dirname(rec["xml_path"])
            fits_path = os.path.join(fits_dir, rec["fits_name"])

            try:
                res, (nx, ny) = get_square_resolution(fits_path)
            except FileNotFoundError as e:
                sys.stderr.write(
                    f"[WARN] {rec['nm']}: missing FITS file '{rec['fits_name']}' "
                    f"({e})\n"
                )
                continue
            except Exception as e:
                sys.stderr.write(
                    f"[WARN] {rec['nm']}: cannot read FITS '{rec['fits_name']}': {e}\n"
                )
                continue

            if res is None:
                # Not square; skip it
                print(f"[SKIP] {rec['nm']}   non-square image {nx}x{ny}")
                continue

            # Skip non-Ryugu targets (allow strings containing 'RYUGU')
            tname = rec.get("target_name")
            if not tname:
                print(f"[SKIP] {rec['nm']}   no target_name in label")
                continue
            tname_upper = tname.strip().upper()
            if "RYUGU" not in tname_upper:
                print(f"[SKIP] {rec['nm']}   target={tname!r} (not Ryugu)")
                continue

            # Optional: minimum apparent size in pixels
            if args.min_px > 0.0:
                try:
                    px_diam = estimate_ryugu_pixels_across(
                        rec, target_frame=args.target_frame, res=res
                    )
                except Exception as e:
                    sys.stderr.write(
                        f"[WARN] {rec['nm']}: cannot estimate apparent size: {e}\n"
                    )
                    # If we can't estimate, be conservative and keep it.
                    px_diam = None

                if px_diam is not None and px_diam < args.min_px:
                    print(
                        f"[SKIP] {rec['nm']}   Ryugu ~{px_diam:.1f}px across "
                        f"(< {args.min_px:g} px threshold)"
                    )
                    continue

            # Compute full view geometry
            try:
                view = compute_view(rec, target_frame=args.target_frame)
            except Exception as e:
                msg = str(e)
                if "SPICE(" in msg or "SPICEERR" in msg.upper():
                    print(
                        f"[SKIP] {rec['nm']}   SPICE error (likely no coverage): {msg}"
                    )
                    continue
                else:
                    raise

            # Only add rz if square and resolution != 1024
            if res != 1024:
                view["rz"] = int(res)

            views.append(view)
            count += 1
            desc = f"{res}x{res}"
            print(f"[OK {count}] {view['nm']}   {view['ti']}   {desc}")

            if args.sidecar:
                write_sidecar(view, xml_path)

        except Exception as e:
            sys.stderr.write(f"[WARN] {xml_path}: {e}\n")

    # Sort final JSON array ascending by .ti
    def sort_key(v):
        ti = v["ti"]
        t = ti[:-1] if ti.endswith("Z") else ti
        try:
            return datetime.datetime.strptime(t, "%Y-%m-%dT%H:%M:%S.%f")
        except Exception:
            return ti  # fallback: lexicographic

    views.sort(key=sort_key)

    # Combined metadata file
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(views, f, separators=(",", ":"))

    spice.kclear()


if __name__ == "__main__":
    main()
