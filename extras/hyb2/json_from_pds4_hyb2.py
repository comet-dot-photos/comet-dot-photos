#!/usr/bin/env python3

# json_from_pds4_hyb2.py
# Usage:
#   python json_from_pds4_hyb2.py <path> --mk <meta-kernel.tm>
#       [--out <output.json>] [--sidecar] [--target-frame <frame>]
#       [--no-target]
#
# Builds Comet.Photos-style view JSON from Hayabusa2 ONC PDS4 labels.
# Uses SPICE to compute cv, up, su, sc vectors.
# Creates nm from filename and ti from PDS4 label.
#
#
# Also:
#   - Opens the corresponding FITS file.
#   - Skips non-square images.
#   - If square and resolution != 1024, adds "rz": resolution.

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

    # Exposure duration (seconds), used to sample geometry at end of exposure
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
# Geometry / per-view calculation
# ---------------------------------------------------------------------------

def compute_view(record: dict, target_frame: str = "RYUGU_FIXED") -> dict:
    """
    Compute Comet.Photos-style view fields:
      nm, ti, cv, up, su, sc

    All vectors are in target_frame (default RYUGU_FIXED).
    """
    # Sample geometry at END of exposure if exposure_duration is available
    start_et = spice.str2et(record["ti"])
    exp = record.get("exp")
    if exp is not None:
        et = start_et + float(exp)
    else:
        et = start_et

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
        "ti": record["ti"],
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
            "resolution != 1024 get an 'rz' field."
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
        "--no-target",
        action="store_true",
        help="Disable target_name filtering (include all PDS4 targets).",
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

            # Target-name filtering (can be disabled with --no-target)
            tname = rec.get("target_name")
            if not tname:
                print(f"[SKIP] {rec['nm']}   no target_name in label")
                continue
            tname_upper = tname.strip().upper()
            if not args.no_target and "RYUGU" not in tname_upper:
                print(f"[SKIP] {rec['nm']}   target={tname!r} (not Ryugu)")
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
