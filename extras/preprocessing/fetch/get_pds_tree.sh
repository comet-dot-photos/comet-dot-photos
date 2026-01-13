#!/usr/bin/env bash
# get_pds_tree.sh — Generic PDS3/PDS4 HTTP tree downloader (parallel)
#
# Features:
#   * Crawls an HTTP directory tree starting at BASEURL (limited depth)
#   * Finds and downloads:
#       - PDS4: .fits .fit .xml (any case)
#       - PDS3: .img .lbl       (any case)
#   * Preserves directory structure under OUTDIR
#   * Uses aria2c (preferred) or wget (fallback)
#
# Env vars:
#   BASEURL   = root URL to crawl (no trailing slash)
#               default: Hayabusa2 ONC calibrated:
#               https://sbnarchive.psi.edu/pds4/hayabusa2/hyb2_onc/data_calibrated
#               examples to override:
#               - OCAMS L2:
#                 https://sbnarchive.psi.edu/pds4/orex/orex.ocams/data_calibrated
#   OUTDIR    = target directory (default: ./pds_download)
#   PARALLEL  = aria2 | wget   (default: aria2 if available, else wget)
#   MAX_DEPTH = max recursion depth from BASEURL (default: 6)
#   UA        = User-Agent string (default: pds-tree-downloader/1.0)
#   J         = aria2c concurrent downloads (default: 8)
#   X,S       = aria2c per-file connections/splits (defaults: 1/1)
#   IPV6_OFF  = 1 to disable IPv6 in aria2c
#   PATTERN   = bash regex to filter filenames (default: ".*", i.e., all)
#               applied to the FILENAME ONLY, not the whole path
#
# Examples:
#   # Hayabusa2 ONC, all calibrated data
#   OUTDIR=/mnt/z/HYB2_L2 ./get_pds_tree.sh
#
#   # OCAMS L2
#   BASEURL="https://sbnarchive.psi.edu/pds4/orex/orex.ocams/data_calibrated" \
#   OUTDIR=/mnt/g/OCAMS_L2 ./get_pds_tree.sh
#
#   # Rosetta PDS3 IMG+LBL, NAC only
#   BASEURL="https://pdssbn.astro.umd.edu/holdings/ro-c-osinac-3-esc1-67pdist-v1.0/data" \
#   OUTDIR=/mnt/g/ROS_OSINAC_ESC1 PATTERN="nac_" ./get_pds_tree.sh

set -euo pipefail

# ---- Config / constants ------------------------------------------------------

BASEURL="${BASEURL:-https://sbnarchive.psi.edu/pds4/hayabusa2/hyb2_onc/data_calibrated}"
OUTDIR="${OUTDIR:-$PWD/pds_download}"
PARALLEL="${PARALLEL:-aria2}"
MAX_DEPTH="${MAX_DEPTH:-6}"
UA="${UA:-pds-tree-downloader/1.0}"
J="${J:-8}"
X="${X:-1}"
S="${S:-1}"
PATTERN="${PATTERN:-.*}"

# Acceptable PDS3/PDS4 extensions (case-insensitive)
is_interesting_ext() {
  local name="$1"
  local ext="${name##*.}"
  case "$ext" in
    fits|fit|FITS|FIT|img|IMG|lbl|LBL|xml|XML) return 0 ;;
    *) return 1 ;;
  esac
}

need(){ command -v "$1" >/dev/null 2>&1 || { echo "ERROR: need '$1'"; exit 1; }; }
ts(){ date +"%Y-%m-%d %H:%M:%S"; }

need curl
need awk
need sed
need grep
need sort

if [ "$PARALLEL" = "aria2" ]; then
  if command -v aria2c >/dev/null 2>&1; then
    :
  else
    echo "WARN: aria2c not found; falling back to wget"
    PARALLEL="wget"
  fi
fi

if [ "$PARALLEL" != "aria2" ]; then
  need wget
fi

mkdir -p "$OUTDIR"
cd "$OUTDIR"

BASEURL="${BASEURL%/}"  # strip trailing slash if present

echo "[$(ts)] BASEURL  = $BASEURL"
echo "[$(ts)] OUTDIR   = $OUTDIR"
echo "[$(ts)] PARALLEL = $PARALLEL"
echo "[$(ts)] MAX_DEPTH= $MAX_DEPTH"
echo "[$(ts)] PATTERN  = $PATTERN"

URLS="urls.tsv"
: > "$URLS"

# ---- Recursive crawler -------------------------------------------------------
# crawl <relative_path> <depth>
#   relative_path: "" for BASEURL, or "sub/dir"
crawl() {
  local rel="$1"
  local depth="$2"

  if [ "$depth" -gt "$MAX_DEPTH" ]; then
    return
  fi

  local url="$BASEURL"
  if [ -n "$rel" ]; then
    url="$url/$rel"
  fi

  echo "[$(ts)]   Crawling $url (depth=$depth)"

  while IFS= read -r href; do
    # href is something like: approach/   or  onct/  or  file.fits  or  /pds4/...
    # Strip query string if present
    href="${href%%\?*}"

    # Skip empties, anchors, parent/relative dirs
    case "$href" in
      ""|"#"*|"/")        continue ;;
      "../"*|"./"*)       continue ;;
      /*)                 continue ;;  # skip absolute /pds4/... links
    esac

    if [[ "$href" == */ ]]; then
      # Subdirectory
      local child="${href%/}"
      local child_rel
      if [ -z "$rel" ]; then
        child_rel="$child"
      else
        child_rel="$rel/$child"
      fi
      crawl "$child_rel" "$((depth+1))"
    else
      # File
      local fname="$href"
      if ! is_interesting_ext "$fname"; then
        continue
      fi
      if [[ ! "$fname" =~ $PATTERN ]]; then
        continue
      fi

      local relpath
      if [ -z "$rel" ]; then
        relpath="$fname"
      else
        relpath="$rel/$fname"
      fi

      local full_url="$url/$fname"
      printf '%s\t%s\n' "$relpath" "$full_url" >> "$URLS"
    fi
  done < <(
    curl -fsSL -A "$UA" "$url/" \
      | grep -Eo 'href="[^"]*"' \
      | sed -E 's/^href="([^"]*)"/\1/'
  )
}

echo "[$(ts)] Starting crawl..."
crawl "" 0

if [ ! -s "$URLS" ]; then
  echo "[$(ts)] No matching files found. Check BASEURL / PATTERN / MAX_DEPTH."
  exit 1
fi

sort -u "$URLS" -o "$URLS"
UCOUNT=$(wc -l < "$URLS" || echo 0)
echo "[$(ts)] Found $UCOUNT files to download."

# ---- Download in parallel ----------------------------------------------------

echo "[$(ts)] Downloading with $PARALLEL..."

if [ "$PARALLEL" = "aria2" ]; then
  ARIA="aria2_list.txt"
  : > "$ARIA"

  # aria2 input: url + per-file dir/out
  awk -F'\t' '
    {
      rel=$1; url=$2;
      n=split(rel, seg, "/");
      if (n > 1) {
        d=seg[1];
        for (i=2; i<n; i++) d=d"/"seg[i];
      } else {
        d="."
      }
      f=seg[n];
      print url;
      print "  dir=" d;
      print "  out=" f;
    }
  ' "$URLS" > "$ARIA"

  AOPTS=(
    -i "$ARIA"
    -j"$J"
    -x"$X"
    -s"$S"
    --continue=true
    --auto-file-renaming=false
    --file-allocation=none
    -U "$UA"
  )
  if [ "${IPV6_OFF:-}" = "1" ]; then
    AOPTS+=( --disable-ipv6=true )
  fi

  aria2c "${AOPTS[@]}"

else
  # wget fallback: sequential but simple and robust
  while IFS=$'\t' read -r rel url; do
    dir="${rel%/*}"
    if [ "$dir" != "$rel" ]; then
      mkdir -p "$dir"
    else
      dir="."
    fi
    echo "[$(ts)]   wget $url -> $rel"
    wget -c -nv -U "$UA" -O "$rel" "$url"
  done < "$URLS"
fi

echo "[$(ts)] Done. Files downloaded under: $OUTDIR"
