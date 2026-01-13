# hyb2_fov.py - Query the HYB2 ONC-T, ONC-W1, and ONC-W2 FOV half-angles from SPICE IK and returns the full FOV in degrees.

import sys
import spiceypy as spice

DEFAULT_MK = "/mnt/g/hyb2/HYB2_SPICE/spice_kernels/mk/hyb2_onc_spc_v02_local.tm"

FRAMES = {
    "ONC-T":  "HAYABUSA2_ONC-T",
    "ONC-W1": "HAYABUSA2_ONC-W1",
    "ONC-W2": "HAYABUSA2_ONC-W2",
}

def fov_from_ik(inst_id):
    base = f"INS{inst_id}_FOV_"
    half_x = spice.gdpool(base + "REF_ANGLE",    0, 1)[0]
    half_y = spice.gdpool(base + "CROSS_ANGLE",  0, 1)[0]
    units  = spice.gcpool(base + "ANGLE_UNITS",  0, 1, 32)[0]
    return half_x, half_y, 2*half_x, 2*half_y, units

mk = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MK
spice.furnsh(mk)
try:
    print(f"Using metakernel: {mk}")
    for label, frame in FRAMES.items():
        inst_id = spice.bods2c(frame)
        half_x, half_y, full_x, full_y, units = fov_from_ik(inst_id)
        print(f"\n{label} ({frame}, ID {inst_id})")
        print(f"  Half-angle X: {half_x:.6f} {units}")
        print(f"  Half-angle Y: {half_y:.6f} {units}")
        print(f"  Full  FOV X : {full_x:.6f} {units}")
        print(f"  Full  FOV Y : {full_y:.6f} {units}")
finally:
    spice.kclear()
