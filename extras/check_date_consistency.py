#!/usr/bin/env python3

# check_date_consistency.py
# checks for consistency between 'nm' and 'ti' fields in a JSON array of dictionaries (Comet.Photos metadata files)
# with no options, assumes 'nm' has UTC string with 'T' and extracts YYYYMM from there
# with --offset <int>, extracts YYYYMM from nm starting at that character offset instead of searching for 'T'

import json
import sys
import argparse


def extract_ym_from_nm(nm: str, offset: int | None):
    """
    Extract YYYYMM from the 'nm' field.

    If offset is None:
        Find first 'T', use 6 chars before day (8 chars before T to 2 chars before T).
    If offset is an integer:
        Extract nm[offset:offset+6].
    """
    if offset is not None:
        # Direct substring starting at offset
        if offset < 0 or offset + 6 > len(nm):
            return None
        ym = nm[offset : offset + 6]
        return ym if ym.isdigit() else None

    # Original logic: find 'T'
    t_idx = nm.find('T')
    if t_idx == -1 or t_idx < 8:
        return None

    ym = nm[t_idx - 8 : t_idx - 2]  # 6 chars YYYYMM
    return ym if ym.isdigit() else None


def extract_ym_from_ti(ti: str):
    """
    Extract YYYYMM from ti ('YYYY-MM-ddTHH:MM:SS').
    """
    if len(ti) < 7:
        return None
    yyyy = ti[0:4]
    mm = ti[5:7]
    if ti[4] != '-' or not yyyy.isdigit() or not mm.isdigit():
        return None
    return yyyy + mm


def main():
    parser = argparse.ArgumentParser(description="Check nm–ti date consistency.")
    parser.add_argument("jsonfile", help="Path to JSON file with array of dicts")
    parser.add_argument("--offset", type=int, default=None,
                        help="If provided, extract YYYYMM starting at nm[offset] instead of using 'T'")
    args = parser.parse_args()

    with open(args.jsonfile, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("JSON root is not an array.")
        sys.exit(1)

    mismatches = []
    parse_errors = []

    for idx, entry in enumerate(data):
        if not isinstance(entry, dict):
            parse_errors.append((idx, "entry is not a dictionary"))
            continue

        nm = entry.get("nm")
        ti = entry.get("ti")

        if nm is None or ti is None:
            parse_errors.append((idx, f"missing nm or ti (nm={nm!r}, ti={ti!r})"))
            continue

        nm_ym = extract_ym_from_nm(nm, args.offset)
        ti_ym = extract_ym_from_ti(ti)

        if nm_ym is None:
            parse_errors.append((idx, f"could not parse YYYYMM from nm='{nm}'"))
            continue
        if ti_ym is None:
            parse_errors.append((idx, f"could not parse YYYYMM from ti='{ti}'"))
            continue

        if nm_ym != ti_ym:
            mismatches.append((idx, nm, ti, nm_ym, ti_ym))

    # Reports
    if parse_errors:
        print("Entries with parse issues:")
        for idx, msg in parse_errors:
            print(f"  Index {idx}: {msg}")
        print()

    if mismatches:
        print("Found year-month mismatches between nm and ti:")
        for idx, nm, ti, nm_ym, ti_ym in mismatches:
            print(
                f"  Index {idx}: nm='{nm}' (YYYYMM={nm_ym}) "
                f"vs ti='{ti}' (YYYYMM={ti_ym})"
            )
    else:
        print("No year-month mismatches found.")


if __name__ == "__main__":
    main()
