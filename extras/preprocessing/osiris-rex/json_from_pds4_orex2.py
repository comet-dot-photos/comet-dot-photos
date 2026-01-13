#!/usr/bin/env python3

# json_from_pds4_orex.py
# Usage: python json_from_pds4_orex.py <path> --mk <meta-kernel.tm> [--out <output.json>] [--sidecar] [--target-frame <frame>]
#
# Builds Comet.Photos-style view JSON from OSIRIS-REx OCAMS PDS4 labels.
# Uses SPICE to compute cv, up, su, sc vectors.
# Creates nm from filename and ti from PDS4 label.
#
# Also:
#   - Opens the corresponding image file (from File_Area_Observational/file_name).
#   - Skips non-square images.
#   - If square and resolution != 1024, adds "rz": resolution.

from __future__ import annotations
import argparse, json, os, sys, datetime
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
OREX_NS = {"orex": "http://pds.nasa.gov/pds4/mission/orex/v1"}

# Fallback mapping if we ever need instrument_id instead of orex:secondary_ik_num
CAMERA_FRAME_BY_ID = {
    "POLYCAM": "ORX_OCAMS_POLYCAM",
    "MAPCAM":  "ORX_OCAMS_MAPCAM",
    "SAMCAM":  "ORX_OCAMS_SAMCAM",
}

# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def text_or_none(root, path: str, ns):
    el = root.find(path, ns)
    return el.text.strip() if el is not None and el.text else None


def parse_pds4_for_view(xml_path: str) -> dict:
    """
    Parse a single OCAMS PDS4 label and return minimal info needed
    to build a Comet.Photos-style view entry.
    """
    root = ET.parse(xml_path).getroot()

    # Time (UTC, ISO string, e.g. 2021-04-07T03:31:40.463Z)
    t_utc = text_or_none(root, ".//pds:start_date_time", PDS_NS)
    if not t_utc:
        raise ValueError("No pds:start_date_time in label")

    # Target name: try target_name first, then Target_Identification/name
    target_name = text_or_none(root, ".//pds:target_name", PDS_NS)
    if target_name is None:
        target_name = text_or_none(
            root, ".//pds:Target_Identification/pds:name", PDS_NS
        )

    # Image filename (e.g. FITS); use basename WITHOUT extension as 'nm'
    fname = text_or_none(
        root,
        ".//pds:File_Area_Observational/pds:File/pds:file_name",
        PDS_NS,
    )

    if fname:
        image_name = fname
        nm = os.path.splitext(fname)[0]
    else:
        # Fallback: base name of the XML file and assume a .fits image
        base = os.path.basename(xml_path)
        nm = os.path.splitext(base)[0]
        image_name = nm + ".fits"

    # Optional instrument_id (PDS core)
    instrument_id = text_or_none(root, ".//pds:instrument_id", PDS_NS)

    # Preferred: orex:secondary_ik_num = NAIF instrument ID for this observation
    sec_ik_str = text_or_none(root, ".//orex:secondary_ik_num", OREX_NS)
    inst_naif = None
    if sec_ik_str is not None:
        try:
            inst_naif = int(sec_ik_str)
        except ValueError:
            pass

    # camera_id fallback (0 = MAPCAM, 1 = SAMCAM, 2 = POLYCAM)
    # Only needed when instrument_id is missing, for maximal backward compatibility.
    camera_id = None
    if instrument_id is None:
        cam_id_str = text_or_none(
            root, ".//orex:OCAMS_Instrument_Attributes/orex:camera_id", OREX_NS
        )
        if cam_id_str is not None:
            try:
                camera_id = int(cam_id_str)
            except ValueError:
                camera_id = None

    return {
        "xml_path": os.path.abspath(xml_path),
        "image_name": image_name,   # actual image filename from label (or fallback)
        "nm": nm,                   # image name (no extension)
        "ti": t_utc,                # UTC time string
        "target_name": target_name,
        "instrument_id": instrument_id,
        "instrument_naif_id": inst_naif,
        "camera_id": camera_id,
    }

# ---------------------------------------------------------------------------
# Image resolution helpers
# ---------------------------------------------------------------------------

def get_square_resolution(image_path: str):
    """
    Open the image (assumed FITS-like) and determine if there's a square 2-D image.
    Returns:
        (N, (nx, ny)) if nx == ny == N
        (None, (nx, ny)) if not square
    Raises:
        FileNotFoundError if image is missing
        ValueError if no usable image data
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    with fits.open(image_path, memmap=True) as hdul:
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

def load_meta_kernel(meta_kernel: str):
    spice.kclear()
    spice.furnsh(meta_kernel)

def camera_frame_and_id(record: dict):
    """
    Prefer the NAIF instrument ID from orex:secondary_ik_num.
    Second: use instrument_id string mapped to a frame name.
    Fallback: use orex:camera_id (0=MAPCAM,1=SAMCAM,2=POLYCAM) when instrument_id is missing.
    """
    # 1) Best: explicit NAIF instrument code from secondary_ik_num
    inst_code = record.get("instrument_naif_id")
    if inst_code is not None:
        inst_code = int(inst_code)
        try:
            cam_name = spice.bodc2n(inst_code)  # e.g. ORX_OCAMS_MAPCAM
        except Exception:
            cam_name = ""
        return cam_name, inst_code

    # 2) Next: instrument_id string (if present)
    instr_id = record.get("instrument_id")
    if instr_id:
        instr_id = instr_id.upper()
        frame = CAMERA_FRAME_BY_ID.get(instr_id)
        if not frame:
            raise ValueError(
                f"Unknown instrument_id '{instr_id}'. "
                f"Expected one of {list(CAMERA_FRAME_BY_ID)}."
            )
        code = spice.bods2c(frame)
        return frame, code

    # 3) Fallback: camera_id (only used when instrument_id is missing)
    cam_id = record.get("camera_id")
    if cam_id is not None:
        cam_id = int(cam_id)
        if cam_id == 0:
            frame = "ORX_OCAMS_MAPCAM"
        elif cam_id == 1:
            frame = "ORX_OCAMS_SAMCAM"
        elif cam_id == 2:
            frame = "ORX_OCAMS_POLYCAM"
        else:
            raise ValueError(f"Unknown camera_id {cam_id}")
        code = spice.bods2c(frame)
        return frame, code

    # If we get here, there is truly no usable instrument identification
    raise ValueError("instrument id not found in label or record.")

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

def compute_view(record: dict, target_frame: str = "IAU_BENNU") -> dict:
    """
    Compute Comet.Photos-style view fields:
      nm, ti, cv, up, su, sc
    All vectors are in target_frame (default IAU_BENNU).
    """
    et = spice.str2et(record["ti"])

    # Instrument / camera frame
    cam_frame, inst_code = camera_frame_and_id(record)

    # FOV and boresight in instrument frame
    fov = fov_info(inst_code)

    # Rotation from instrument frame to target (Bennu-fixed) at this time
    r_inst_to_tf = spice.pxform(fov["frame"], target_frame, et)

    # Sight vector (cv): boresight transformed to Bennu-fixed, normalized
    cv_vec = np.array(spice.mxv(r_inst_to_tf, fov["boresight_if"]), dtype=float)
    cv = cv_vec / np.linalg.norm(cv_vec)

    # Up vector (up): start from +X in instrument frame, transform, then
    # Gram–Schmidt to make it orthogonal to cv, and normalize.
    up_cam = [1.0, 0.0, 0.0]
    up_vec_tf = np.array(spice.mxv(r_inst_to_tf, up_cam), dtype=float)
    proj = np.dot(up_vec_tf, cv) * cv
    up_vec_tf = up_vec_tf - proj
    up = up_vec_tf / np.linalg.norm(up_vec_tf)

    # Positions: SUN and ORX in Bennu-fixed, no aberration corrections
    sun_pos, _ = spice.spkpos("SUN", et, target_frame, "NONE", "BENNU")
    sc_pos, _ = spice.spkpos("ORX", et, target_frame, "NONE", "BENNU")

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
    Option A: each sidecar is a single dict, not an array.
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
            "Build OSIRIS-REx OCAMS view JSON from PDS4 labels "
            "(nm, ti, cv, up, su, sc), checking image resolution. "
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
        dest="meta_kernel",
        required=True,
        help="Path to OSIRIS-REx SPICE meta-kernel (.tm)",
    )
    ap.add_argument(
        "--out",
        default="imageMetadata_orex.json",
        help="Output JSON file (default: imageMetadata_orex.json)",
    )
    ap.add_argument(
        "--target-frame",
        default="IAU_BENNU",
        help="Target-fixed frame name (default: IAU_BENNU)",
    )
    ap.add_argument(
        "--sidecar",
        action="store_true",
        help="Also write per-image sidecar JSONs next to each .xml "
             "with a single {nm,ti,cv,up,su,sc[,rz]} dict.",
    )
    args = ap.parse_args()

    load_meta_kernel(args.meta_kernel)

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

            # Determine the image resolution and ensure it's square
            img_dir = os.path.dirname(rec["xml_path"])
            img_path = os.path.join(img_dir, rec["image_name"])

            try:
                res, (nx, ny) = get_square_resolution(img_path)
            except FileNotFoundError as e:
                sys.stderr.write(
                    f"[WARN] {rec['nm']}: missing image file '{rec['image_name']}' "
                    f"({e})\n"
                )
                continue
            except Exception as e:
                sys.stderr.write(
                    f"[WARN] {rec['nm']}: cannot read image '{rec['image_name']}': {e}\n"
                )
                continue

            if res is None:
                # Not square; skip it
                print(f"[SKIP] {rec['nm']}   non-square image {nx}x{ny}")
                continue

            # Skip non-Bennu targets (allow things like "(101955) Bennu")
            tname = rec.get("target_name")
            if not tname:
                print(f"[SKIP] {rec['nm']}   target={tname!r}")
                continue
            tname_upper = tname.strip().upper()
            if "BENNU" not in tname_upper:
                print(f"[SKIP] {rec['nm']}   target={tname!r}")
                continue

            view = compute_view(rec, target_frame=args.target_frame)

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

    # Sort final JSON array ascending by .ti, like the Rosetta version
    def sort_key(v):
        ti = v["ti"]
        # Try to parse timestamps similar to Rosetta behavior (strip trailing Z)
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
