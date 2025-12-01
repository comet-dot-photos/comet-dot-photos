#!/usr/bin/env python3
"""
organize_pds4_regex.py

Recursively scans <fromDir> and creates a YYYYMM-organized directory tree in
<toDir>. Files are only included if their basenames match --regexp.

Two ways to determine YYYYMM:

1) Default (no --use-xml-mid-utc):
   - Extract YYYYMM from the basename starting at --offset characters.
   - Here, --offset is REQUIRED.

2) --use-xml-mid-utc:
   - Look for an associated XML label (same basename, .xml).
   - Parse its <mid_utc> field.
   - Derive YYYYMM from that mid_utc timestamp.
   - STRICT: if anything goes wrong (no XML, bad mid_utc, etc.), the file is
     skipped and an ERROR is printed.
   - In this mode, --offset is OPTIONAL and ignored.

Partner files (for use-xml mode):

- For a .fit/.fits primary, the partner is <basename>.xml.
- For a .xml primary, partners are <basename>.fit and/or <basename>.fits.

--strict-partner:

- If set, and the primary is .fit/.fits/.xml:
    - Require partner files to exist on disk.
    - If partners are missing, skip the primary file and print an error.

Normal operation is silent; only unexpected conditions are printed, plus a final
summary count of linked primary files.
"""

import os
import sys
import re
import argparse
import xml.etree.ElementTree as ET


def parse_args():
    parser = argparse.ArgumentParser(
        description=(
            "Organize PDS files into YYYYMM folders using regex matching. "
            "Optionally derive YYYYMM from XML mid_utc, and optionally "
            "require associated partner files."
        )
    )
    parser.add_argument("fromDir", help="Source directory to scan recursively.")
    parser.add_argument("toDir", help="Destination directory for YYYYMM folders.")
    parser.add_argument("--regexp", required=True, help="Regex that basenames must match.")

    # offset is optional here; enforced at runtime when XML mode is NOT used
    parser.add_argument(
        "--offset",
        type=int,
        required=False,
        help=(
            "Character offset in the basename where YYYYMM starts. "
            "Required if --use-xml-mid-utc is NOT specified. "
            "Ignored when --use-xml-mid-utc is used."
        ),
    )
    parser.add_argument(
        "--use-xml-mid-utc",
        action="store_true",
        help=(
            "Extract YYYYMM from associated XML's <mid_utc>. "
            "STRICT: no fallback; files are skipped on any XML/mid_utc error. "
            "In this mode, --offset is not required and is ignored."
        ),
    )
    parser.add_argument(
        "--strict-partner",
        action="store_true",
        help=(
            "Require that partner files exist (.fit/.fits <-> .xml). "
            "If partners are missing, skip the primary file and print an error."
        ),
    )

    return parser.parse_args()


def extract_yyyymm_from_xml_strict(src_file: str) -> str | None:
    """
    Strict mode:
      - Must find an XML label (same basename, .xml) or the file itself is .xml.
      - Must parse XML.
      - Must find a <mid_utc> element with a valid timestamp.
      - Must extract a valid YYYYMM (e.g., 202504 from 2025-04-16T...).

    On ANY failure:
      - Print an ERROR and return None.
      - Caller is expected to SKIP the file entirely.
    """
    base, ext = os.path.splitext(src_file)
    if ext.lower() == ".xml":
        xml_path = src_file
    else:
        xml_path = base + ".xml"

    if not os.path.exists(xml_path):
        print(f"ERROR: XML not found for '{src_file}' – skipping file.", file=sys.stderr, flush=True)
        return None

    try:
        tree = ET.parse(xml_path)
        root = tree.getroot()
    except Exception as e:
        print(f"ERROR: Cannot parse XML '{xml_path}' – {e} – skipping.", file=sys.stderr, flush=True)
        return None

    mid_utc = None
    for elem in root.iter():
        if elem.tag.endswith("mid_utc") and elem.text:
            mid_utc = elem.text.strip()
            break

    if not mid_utc:
        print(f"ERROR: No <mid_utc> found in XML '{xml_path}' – skipping.", file=sys.stderr, flush=True)
        return None

    # Expect something like 2025-04-16T18:47:25.518Z
    if len(mid_utc) < 7:
        print(f"ERROR: mid_utc '{mid_utc}' is malformed – skipping.", file=sys.stderr, flush=True)
        return None

    yyyymm = mid_utc[:7].replace("-", "")
    if len(yyyymm) != 6 or not yyyymm.isdigit():
        print(
            f"ERROR: mid_utc '{mid_utc}' does not contain valid YYYYMM – skipping.",
            file=sys.stderr,
            flush=True,
        )
        return None

    return yyyymm


def extract_yyyymm_from_offset(filename: str, offset: int) -> str | None:
    """
    Fallback method used when --use-xml-mid-utc is NOT specified:
    Extract YYYYMM from filename[offset:offset+6].
    """
    if len(filename) < offset + 6:
        return None
    date_str = filename[offset:offset + 6]
    return date_str if date_str.isdigit() else None


def get_partner_candidates(src_file: str) -> list[str]:
    """
    Return a list of partner-file candidates for the given src_file.
    For:
      - .fit/.fits: partner is .xml
      - .xml: partners are .fit and .fits
      - others: no partners defined
    """
    base, ext = os.path.splitext(src_file)
    ext_l = ext.lower()
    candidates: list[str] = []

    if ext_l in (".fit", ".fits"):
        candidates.append(base + ".xml")
    elif ext_l == ".xml":
        candidates.append(base + ".fit")
        candidates.append(base + ".fits")

    return candidates


def check_partners_strict(src_file: str, strict_partner: bool) -> bool:
    """
    If strict_partner is False:
      - Always returns True.

    If strict_partner is True:
      - For .fit/.fits: require <basename>.xml to exist.
      - For .xml: require at least one of <basename>.fit or <basename>.fits to exist.
      - If the required partner(s) do NOT exist, print an ERROR and return False
        (caller should skip the primary file).
    """
    if not strict_partner:
        return True

    base, ext = os.path.splitext(src_file)
    ext_l = ext.lower()

    if ext_l in (".fit", ".fits"):
        xml_path = base + ".xml"
        if not os.path.exists(xml_path):
            print(
                f"ERROR: strict-partner: XML partner '{xml_path}' not found for '{src_file}' – skipping.",
                file=sys.stderr,
                flush=True,
            )
            return False
        return True

    if ext_l == ".xml":
        fit_exists = os.path.exists(base + ".fit")
        fits_exists = os.path.exists(base + ".fits")
        if not (fit_exists or fits_exists):
            print(
                f"ERROR: strict-partner: No FIT/FITS partner found for XML '{src_file}' – skipping.",
                file=sys.stderr,
                flush=True,
            )
            return False
        return True

    # For other extensions, no partner requirement.
    return True


def link_partner_files(src_file: str, to_dir: str, strict_partner: bool) -> None:
    """
    Link partner files into the same YYYYMM directory.

    - No messages for successful linking.
    - Only warn if a partner unexpectedly disappears or linking fails.
    """
    candidates = get_partner_candidates(src_file)

    for cand in candidates:
        if not os.path.exists(cand):
            if strict_partner:
                # This shouldn't happen if check_partners_strict did its job, but be noisy if it does.
                print(
                    f"WARNING: strict-partner: partner file '{cand}' disappeared before linking.",
                    file=sys.stderr,
                    flush=True,
                )
            continue

        dst = os.path.join(to_dir, os.path.basename(cand))
        if os.path.exists(dst):
            # Destination already has a file; that's fine.
            continue

        try:
            os.link(cand, dst)
        except FileExistsError:
            # Already present; ignore.
            pass
        except OSError as e:
            print(
                f"WARNING: failed to link partner '{cand}' -> '{dst}': {e}",
                file=sys.stderr,
                flush=True,
            )


def main():
    args = parse_args()

    fromDir = os.path.abspath(args.fromDir)
    toDir = os.path.abspath(args.toDir)
    pattern = re.compile(args.regexp)

    # Enforce that --offset is provided when NOT in XML mode
    if not args.use_xml_mid_utc and args.offset is None:
        print(
            "ERROR: --offset is required when --use-xml-mid-utc is NOT specified.",
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)

    filesDone = 0

    for root, dirs, files in os.walk(fromDir):
        for file in files:
            # Only process files matching the regex (basename only)
            if not pattern.search(file):
                continue

            src_file = os.path.join(root, file)

            # 1) Derive YYYYMM
            if args.use_xml_mid_utc:
                dateStr = extract_yyyymm_from_xml_strict(src_file)
                if dateStr is None:
                    # Error already printed; skip this file.
                    continue
            else:
                # args.offset is guaranteed non-None here due to the check above
                dateStr = extract_yyyymm_from_offset(file, args.offset)
                if dateStr is None:
                    print(
                        f"ERROR: Skipping '{src_file}' (cannot extract YYYYMM from offset {args.offset})",
                        file=sys.stderr,
                        flush=True,
                    )
                    continue

            # 2) If strict-partner, verify required partners BEFORE linking
            if not check_partners_strict(src_file, args.strict_partner):
                # Error printed in check_partners_strict; skip this file.
                continue

            # 3) Ensure YYYYMM directory exists (no message on success)
            outdir = os.path.join(toDir, dateStr)
            try:
                os.makedirs(outdir, exist_ok=True)
            except OSError as e:
                print(
                    f"ERROR: Could not create directory '{outdir}': {e} – skipping '{src_file}'.",
                    file=sys.stderr,
                    flush=True,
                )
                continue

            # 4) Link the primary file
            dst_file = os.path.join(outdir, file)
            try:
                os.link(src_file, dst_file)
            except FileExistsError:
                # Already linked; fine.
                pass
            except OSError as e:
                print(
                    f"WARNING: failed to link '{src_file}' -> '{dst_file}': {e}",
                    file=sys.stderr,
                    flush=True,
                )
                # If we can't even link the primary, no point linking partners.
                continue

            filesDone += 1

            # 5) Link partner files (if any) when using XML-mid-UTC mode
            if args.use_xml_mid_utc:
                link_partner_files(src_file, outdir, args.strict_partner)

    # Final summary only
    print(f"Finished processing. Linked {filesDone} primary files.", flush=True)


if __name__ == "__main__":
    main()
