#!/usr/bin/env bash
# get_ocams2_l2.sh — FAST OCAMS Level-2 downloader (FITS + XML), no per-file API calls
#
# What it does:
#   1) Fetches OCAMS L2 collection CSV from SBN
#   2) Extracts desired filenames (camera + iof/rad) in lowercase (keys)
#   3) Scrapes each mission-phase index ONCE, builds a map: lower(name) -> original name + phase
#   4) Emits case-correct URLs and downloads in parallel
#   5) Preserves phase/ directory structure under OUTDIR
#
# Usage (examples):
#   OUTDIR=/mnt/g/OCAMS_L2 ./get_ocams2_l2.sh
#   OUTDIR=/mnt/g/REx2/POLY_L2 CAMERA=poly TYPES=iof ./get_ocams2_l2.sh
#   OUTDIR=/mnt/g/OCAMS_L2 CAMERA=map TYPES=both PARALLEL=wget ./get_ocams2_l2.sh
#
# Env vars:
#   OUTDIR    = target directory (default: ./ocams_l2)
#   PARALLEL  = aria2 | wget  (default: aria2)
#   CAMERA    = poly | map | sam | all  (default: all)
#   TYPES     = iof | rad | both        (default: both)
#   J         = aria2c concurrent downloads (default: 8)
#   X,S       = aria2c per-file connections/splits (defaults: 1/1 recommended for SBN)
#   UA        = User-Agent string (default: ocams-l2-fast/1.2)
#   IPV6_OFF  = 1 to disable IPv6 in aria2c (default: unset)

set -euo pipefail

# ---- Config / constants ------------------------------------------------------
BASE="https://sbnarchive.psi.edu/pds4/orex/orex.ocams"
CAL="$BASE/data_calibrated"
CSV_URL="$CAL/collection_inventory_ocams_data_calibrated.csv"

OUTDIR="${OUTDIR:-$PWD/ocams_l2}"
PARALLEL="${PARALLEL:-aria2}"
CAMERA="${CAMERA:-all}"         # poly | map | sam | all
TYPES="${TYPES:-both}"          # iof | rad | both
UA="${UA:-ocams-l2-fast/1.2}"
J="${J:-8}"
X="${X:-1}"                      # keep per-file connections conservative for SBN
S="${S:-1}"                      # keep per-file splits conservative for SBN

# Known OCAMS L2 phase folders
PHASES=(approach cruise_1 cruise_2 detailed_survey ega orbit_a orbit_b orbit_c orbit_r preliminary_survey recon recon_b recon_c sample_collection)

# ---- Helpers -----------------------------------------------------------------
need(){ command -v "$1" >/dev/null 2>&1 || { echo "ERROR: need '$1'"; exit 1; }; }
ts(){ date +"%Y-%m-%d %H:%M:%S"; }

need curl; need awk; need sed; need grep; need sort
if [ "$PARALLEL" = "aria2" ]; then need aria2c; else need wget; fi

mkdir -p "$OUTDIR"
cd "$OUTDIR"

# Map CAMERA -> filename token
case "$CAMERA" in
  poly) CAM='pol' ;;
  map)  CAM='map' ;;
  sam)  CAM='sam' ;;
  all)  CAM='(pol|map|sam)' ;;   # regex group for grep/awk
  *) echo "Unknown CAMERA '$CAMERA'"; exit 1;;
esac

# Map TYPES -> token (iofl2 / radl2)
case "$TYPES" in
  iof)  TYP='iof' ;;
  rad)  TYP='rad' ;;
  both) TYP='(iof|rad)' ;;       # regex group
  *) echo "Unknown TYPES '$TYPES'"; exit 1;;
esac

# ---- Step 1: Fetch CSV -------------------------------------------------------
echo "[$(ts)] Fetching OCAMS L2 inventory CSV…"
curl -fsSL -A "$UA" "$CSV_URL" -o collection_inventory_ocams_data_calibrated.csv
sed -i 's/\r$//' collection_inventory_ocams_data_calibrated.csv

# ---- Step 2: Build wanted filename list (lowercased keys) --------------------
# CSV col 2 is LIDVID: urn:nasa:pds:orex.ocams:data_calibrated:<phase>/<file>.(fits|xml)::1.0
echo "[$(ts)] Extracting target filenames (camera=$CAMERA, types=$TYPES)…"
awk -F, 'NF>=2{print $2}' collection_inventory_ocams_data_calibrated.csv \
| awk '{print tolower($0)}' \
| grep -E ':orex\.ocams:data_calibrated:' \
| grep -E "_${CAM}_" \
| grep -E "${TYP}l2" \
| grep -E '\.(fits|xml)::' \
| sed -E 's#^urn:nasa:pds:orex\.ocams:data_calibrated:##; s#::[0-9.]+$##' \
| awk -F/ '{print $NF}' \
| sort -u > want_filenames.txt

WCOUNT=$(wc -l < want_filenames.txt || echo 0)
echo "[$(ts)]   Unique filenames needed: $WCOUNT"
[ "$WCOUNT" -gt 0 ] || { echo "No matches for your filters."; exit 1; }

# ---- Step 2B: Add one XML companion for every FITS we want ------------------
# (These will match against synthetic XML entries added in Step 3b)
awk '
  { print }                                           # keep original FITS lines
  tolower($0) ~ /[.]fits$/ {
    u=$0
    sub(/[.][Ff][Ii][Tt][Ss]$/, ".xml", u); print u   # add .xml companion
  }
' want_filenames.txt | sort -u > want_filenames.with_xml.txt
mv -f want_filenames.with_xml.txt want_filenames.txt

# ---- Step 3: Scrape phase indexes → map(lower -> original, phase) -----------
echo "[$(ts)] Building filename→phase map from SBN indexes…"
: > phase_map.tsv
for ph in "${PHASES[@]}"; do
  idx_url="$CAL/$ph/"
  echo "[$(ts)]   indexing $ph …"
  curl -fsSL -A "$UA" "$idx_url" \
  | grep -Eoi 'href="[^"]+\.(fits|xml)(\?[^"]*)?"' \
  | sed -E 's/^href="([^"]+)".*$/\1/' \
  | sed -E 's#^\./##' \
  | awk -v PH="$ph" '{ orig=$0; low=tolower($0); print low "\t" orig "\t" PH }' >> phase_map.tsv
done
PMCOUNT=$(wc -l < phase_map.tsv || echo 0)
echo "[$(ts)]   Indexed entries: $PMCOUNT"
[ "$PMCOUNT" -gt 0 ] || { echo "Failed to index phase listings."; exit 1; }

# ---- Step 3b: Synthesize XML entries for any FITS that were indexed ----------
# Many SBN index pages omit the XML label links; create parallel XML rows.
awk '
  BEGIN{ OFS="\t" }
  {
    low=$1; orig=$2; ph=$3;
    print low, orig, ph;                        # keep original row
    o = orig
    if (o ~ /[.][Ff][Ii][Tt][Ss]$/) {
      xml_orig = orig
      sub(/[.][Ff][Ii][Tt][Ss]$/, ".xml", xml_orig)
      xml_low  = tolower(xml_orig)
      print xml_low, xml_orig, ph              # synthetic XML row (.xml)
      # (optional) also add .XML variant in case server uses uppercase
      xml_origU = orig
      sub(/[.][Ff][Ii][Tt][Ss]$/, ".XML", xml_origU)
      xml_lowU  = tolower(xml_origU)
      print xml_lowU, xml_origU, ph            # synthetic XML row (.XML)
    }
  }
' phase_map.tsv | sort -u > phase_map.with_xml.tsv
mv -f phase_map.with_xml.tsv phase_map.tsv

# ---- Step 4: Join wanted -> URLs (preserve ORIGINAL CASE in URLs) -----------
echo "[$(ts)] Resolving filenames to URLs…"
awk -v BASE="$CAL" '
  NR==FNR { low=$1; orig[low]=$2; ph[low]=$3; next }
  { k=$0; if (k in orig) print BASE "/" ph[k] "/" orig[k]; }
' phase_map.tsv want_filenames.txt > urls.txt

UCOUNT=$(wc -l < urls.txt || echo 0)
echo "[$(ts)]   URLs resolved: $UCOUNT"
[ "$UCOUNT" -gt 0 ] || { echo "No filenames matched any phase directory."; exit 1; }

# Optional: show a few
# head urls.txt

# ---- Step 5: Download in parallel, preserving phase/ directories ------------
echo "[$(ts)] Downloading with $PARALLEL…"

if [ "$PARALLEL" = "aria2" ]; then
  # Build aria2 input with separate dir/out (no slashes in 'out=')
  ARIA="aria2_list.txt"; : > "$ARIA"
  awk '
    function strip(u){sub(/^https?:\/\/[^\/]+\//,"",u); return u}
    function dirname(p,   i){ i=length(p); while(i>0 && substr(p,i,1)!="/") i--; return (i>0)?substr(p,1,i-1):"." }
    function basename(p,  i){ i=length(p); while(i>0 && substr(p,i,1)!="/") i--; return substr(p,i+1) }
    {
      url=$0
      p=strip(url)                             # pds4/orex/orex.ocams/data_calibrated/phase/.../file
      n=split(p,seg,"/")
      rel=""
      for(i=5;i<=n;i++){ rel=(rel==""?seg[i]:rel"/"seg[i]) }  # phase/.../file
      d=dirname(rel); f=basename(rel)
      print url
      print "  dir=" d
      print "  out=" f
    }
  ' urls.txt > "$ARIA"

  AOPTS=( -i "$ARIA" -j"$J" -x"$X" -s"$S" --continue=true --auto-file-renaming=false
          --file-allocation=none -U "$UA" )
  if [ "${IPV6_OFF:-}" = "1" ]; then AOPTS+=( --disable-ipv6=true ); fi
  aria2c "${AOPTS[@]}"

else
  # wget fallback: simple, robust, preserves tree under OUTDIR
  xargs -n1 -P6 -I{} bash -lc '
    u="{}"
    rel="${u#*data_calibrated/}"        # phase/.../file (original case)
    d="${rel%/*}"
    mkdir -p "$d"
    wget -c -nv -U "'"$UA"'" -O "$rel" "$u"
  ' < urls.txt
fi

echo "[$(ts)] Done. Files under: $OUTDIR"
