#!/usr/bin/env python3
"""
ocams_fov.py

Query the OCAMS FOV half-angles directly from the SPICE IK
and report full X and Y FOV (in degrees) for:

  - PolyCam  (ID -64360)
  - MapCam   (ID -64361)
  - SamCam   (ID -64362)

This assumes the metakernel furnshes orx_ocams_v0*.ti.
"""

import sys
import spiceypy as spice

DEFAULT_METAKERNEL = "/mnt/z/orex_spice/orex_all_years.tm"

INSTRUMENTS = {
    "PolyCam": -64360,
    "MapCam":  -64361,
    "SamCam":  -64362,
}


def fov_from_angles(inst_id):
    """
    Read INS[ID]_FOV_REF_ANGLE and INS[ID]_FOV_CROSS_ANGLE from the kernel pool.

    Returns:
      (half_x_deg, half_y_deg, full_x_deg, full_y_deg, units)
    """
    key_base = f"INS{inst_id}_FOV_"

    # Half-angles (usually symmetric, but don't assume)
    half_x = spice.gdpool(key_base + "REF_ANGLE",  0, 1)[0]
    half_y = spice.gdpool(key_base + "CROSS_ANGLE", 0, 1)[0]

    # Units
    units = spice.gcpool(key_base + "ANGLE_UNITS", 0, 1, 32)[0]

    full_x = 2.0 * half_x
    full_y = 2.0 * half_y

    return half_x, half_y, full_x, full_y, units


def main():
    # Optional CLI override of metakernel
    mk = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_METAKERNEL
    print(f"Using metakernel: {mk}")

    spice.furnsh(mk)

    try:
        for name, inst_id in INSTRUMENTS.items():
            half_x, half_y, full_x, full_y, units = fov_from_angles(inst_id)

            print(f"\n{name} (ID {inst_id})")
            print(f"  Half-angle X: {half_x:.6f} {units}")
            print(f"  Half-angle Y: {half_y:.6f} {units}")
            print(f"  Full  FOV X : {full_x:.6f} {units}")
            print(f"  Full  FOV Y : {full_y:.6f} {units}")
    finally:
        spice.kclear()


if __name__ == "__main__":
    main()
