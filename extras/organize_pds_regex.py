#!/usr/bin/env python3

# organize_pds_regex.py
#
# Recursively scans <fromDir> and creates a YYYYMM-organized directory tree
# in <toDir>. Files are only included if their basenames match --regexp.
#
# The YYYYMM date is extracted from the filename starting at --offset
# characters from the beginning of the basename. Matching files are hard-linked
# into the appropriate <toDir>/YYYYMM/ directory.

import os
import sys
import re
import argparse


def parse_args():
    parser = argparse.ArgumentParser(
        description="Organize PDS files into a YYYYMM directory tree using a regex filter and a fixed date offset."
    )
    parser.add_argument("fromDir", help="Source directory to scan recursively.")
    parser.add_argument("toDir", help="Destination directory where YYYYMM folders will be created.")
    parser.add_argument(
        "--regexp",
        required=True,
        help="Regular expression that the basename must match to be included.",
    )
    parser.add_argument(
        "--offset",
        type=int,
        required=True,
        help="Character offset in the basename where the YYYYMM date begins.",
    )
    return parser.parse_args()


def extract_yyyymm(filename: str, offset: int) -> str | None:
    """
    Extract YYYYMM beginning at the specified character offset in the filename.
    Returns None if extraction fails.
    """
    if len(filename) < offset + 6:
        return None

    date_str = filename[offset : offset + 6]

    if not date_str.isdigit():
        return None

    return date_str


def main():
    args = parse_args()

    fromDir = os.path.abspath(args.fromDir)
    toDir = os.path.abspath(args.toDir)
    pattern = re.compile(args.regexp)
    offset = args.offset

    print("Starting directory walk...", flush=True)
    print(f"  fromDir = {fromDir}", flush=True)
    print(f"  toDir   = {toDir}", flush=True)
    print(f"  regexp  = {pattern.pattern}", flush=True)
    print(f"  offset  = {offset}", flush=True)

    filesDone = 0

    for root, dirs, files in os.walk(fromDir):
        for file in files:
            # Only process files matching the regex (basename only)
            if not pattern.search(file):
                continue

            # Extract YYYYMM using --offset
            dateStr = extract_yyyymm(file, offset)
            if dateStr is None:
                print(f"Skipping file (no valid YYYYMM at offset {offset}): {file}", flush=True)
                continue

            # Build destination path: <toDir>/YYYYMM/
            toPath = os.path.join(toDir, dateStr)

            if not os.path.exists(toPath):
                os.makedirs(toPath)
                print(f"Created directory: {toPath}", flush=True)

            src_file = os.path.join(root, file)
            dst_file = os.path.join(toPath, file)

            # Create hard link in the YYYYMM tree
            os.link(src_file, dst_file)

            filesDone += 1

    print(f"Finished processing {filesDone} files.", flush=True)


if __name__ == "__main__":
    main()
