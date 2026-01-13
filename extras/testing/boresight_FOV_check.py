#!/usr/bin/env python3
"""
boresight_FOV_check.py

Report rectangular FOV (xFOV, yFOV) for Rosetta cameras using SPICE getfov():
- OSIRIS NAC (-226113)
- OSIRIS WAC (-226112)
- NAVCAM-A  (-226170)

Notes:
- For getfov(), the instrument kernel (IK) is sufficient; CK/SPK aren’t required.
- We infer xFOV and yFOV by examining the boundary vectors in the instrument frame:
  x_half ≈ max(atan2(|bx|, |bz|)), y_half ≈ max(atan2(|by|, |bz|)), over normalized corners.

  This works for all three Rosetta framing cameras, which use axis-aligned rectangular FOVs.
"""

import os
import argparse
import math
from typing import Tuple

import numpy as np
import spiceypy as spice

# --------- Constants ----------------------------------------------------------

# OSIRIS IK (CLI-overridable)
IK_DEFAULT = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_OSIRIS_V17.TI"

# Hard-coded NAVCAM IK (per your request)
NAV_IK = "/home/djk/anaconda3/envs/asp/data/rosetta_updated/kernels/ik/ROS_NAVCAM_V03.TI"

# Instrument IDs (NAIF)
NAC_ID_DEFAULT = -226113
WAC_ID_DEFAULT = -226112
NAV_A_ID_DEFAULT = -226170  # NAVCAM-A (CAM1)

# --------- Helpers ------------------------------------------------------------

def deg(rad: float) -> float:
    return rad * 180.0 / math.pi

def normalize_rows(v: np.ndarray) -> np.ndarray:
    """Normalize each row vector to unit length (safe for zero-length)."""
    norms = np.linalg.norm(v, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return v / norms

def polygon_hv_fov(bounds: np.ndarray) -> Tuple[float, float]:
    """
    Derive xFOV and yFOV (degrees) from rectangular FOV boundary vectors.
    Approach:
      - Normalize boundary vectors.
      - Treat instrument +Z as boresight; approximate half-angles as
        atan2(|bx|, |bz|) and atan2(|by|, |bz|), then double them.
      - Works for axis-aligned rectangular FOV definitions used in IKs.
    """
    b = normalize_rows(bounds.astype(np.float64))
    bx, by, bz = b[:, 0], b[:, 1], np.abs(b[:, 2])  # use |bz| for robustness
    x_half = np.max(np.arctan2(np.abs(bx), bz))
    y_half = np.max(np.arctan2(np.abs(by), bz))
    return 2.0 * deg(x_half), 2.0 * deg(y_half)

def report_fov(inst_id: int, label: str) -> None:
    """Query SPICE for FOV and print a concise summary with x/y FOV."""
    shape, frame, boresight, n, bounds = spice.getfov(inst_id, 16)
    bounds = np.array(bounds)
    xFOV, yFOV = polygon_hv_fov(bounds)

    print(f"\n[{label}] Instrument ID: {inst_id}")
    print(f"  Shape     : {shape}")
    print(f"  Frame     : {frame}")
    print(f"  Boresight : [{boresight[0]: .6f}, {boresight[1]: .6f}, {boresight[2]: .6f}]")
    print(f"  Corners   : {n} vectors")
    for i, v in enumerate(bounds):
        print(f"    v{i+1}: [{v[0]: .6f}, {v[1]: .6f}, {v[2]: .6f}]")
    print(f"  xFOV ≈ {xFOV:.3f}°   yFOV ≈ {yFOV:.3f}°")

# --------- Main ---------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Check OSIRIS NAC/WAC and NAVCAM-A FOV via SPICE getfov()."
    )
    ap.add_argument(
        "--ik",
        default=IK_DEFAULT,
        help="Path to ROS_OSIRIS_Vxx.TI (OSIRIS IK). Default: %(default)s",
    )
    ap.add_argument(
        "--nac-id", dest="nac_id", type=int, default=NAC_ID_DEFAULT,
        help=f"NAC instrument ID (default {NAC_ID_DEFAULT})"
    )
    ap.add_argument(
        "--wac-id", dest="wac_id", type=int, default=WAC_ID_DEFAULT,
        help=f"WAC instrument ID (default {WAC_ID_DEFAULT})"
    )
    ap.add_argument(
        "--nav-a-id", dest="nav_a_id", type=int, default=NAV_A_ID_DEFAULT,
        help=f"NAVCAM-A (CAM1) instrument ID (default {NAV_A_ID_DEFAULT})"
    )
    args = ap.parse_args()

    spice.kclear()
    try:
        # Furnish OSIRIS IK
        if not os.path.exists(args.ik):
            print(f"[ERROR] OSIRIS IK not found: {args.ik}")
            return
        spice.furnsh(args.ik)

        # Furnish NAVCAM IK (hard-coded path)
        if not os.path.exists(NAV_IK):
            print(f"[ERROR] NAVCAM IK not found: {NAV_IK}")
            return
        spice.furnsh(NAV_IK)

        # Normalize IDs to negative (SPICE convention)
        nac_id = -abs(args.nac_id)
        wac_id = -abs(args.wac_id)
        nav_a_id = -abs(args.nav_a_id)

        # Report all three
        for inst_id, label in [
            (nac_id, "OSIRIS NAC"),
            (wac_id, "OSIRIS WAC"),
            (nav_a_id, "NAVCAM-A (CAM1)"),
        ]:
            try:
                report_fov(inst_id, label)
            except Exception as e:
                print(f"[ERROR] getfov failed for {label} (id {inst_id}): {e}")

    finally:
        spice.kclear()

if __name__ == "__main__":
    main()
