#!/usr/bin/env bash
# get_WACrI.2.sh — fast, robust OSIRIS WAC Level-4 INFLDSTR-V2.0 fetcher
# - Discover product folders directly from OSIWAC root
# - Validate DATA/IMG/ dirs (with retries)
# - Scrape .IMG links (with retries) using curl+grep
# - Download while preserving path from OSIWAC/… down
# - Supports wget (default) or aria2c (PARALLEL=aria2) for downloads

set -euo pipefail

ROOT="https://archives.esac.esa.int/psa/repo/ftp-public/INTERNATIONAL-ROSETTA-MISSION/OSIWAC/"
OUTDIR="${OUTDIR:-$PWD/osiris_wac_v2_fast}"
CUT_DIRS=4                          # keep from OSIWAC/… down
UA="osiris-scraper/1.0 (+non-FTP; contact: you@example.com)"
PARALLEL="${PARALLEL:-}"            # set to "aria2" to use aria2c

# Wget knobs (only in wget mode)
WGET_TRIES=10
WGET_WAITRETRY=2

ts(){ date +"%Y-%m-%d %H:%M:%S"; }
need(){ command -v "$1" >/dev/null 2>&1 || { echo "ERROR: need '$1'"; exit 1; }; }

need curl; need awk; need sort; need grep; need wget
if [ "$PARALLEL" = "aria2" ]; then need aria2c; fi

mkdir -p "$OUTDIR"
cd "$OUTDIR"

echo "[$(ts)] [1/6] Fetching OSIWAC root once and extracting INFLDSTR-V2.0 product folders…"
ROOT_HTML="osiwac_root.html"
curl -fsSL -A "$UA" "$ROOT" -o "$ROOT_HTML"
[ -s "$ROOT_HTML" ] || { echo "[$(ts)]   ERROR: Empty root HTML from $ROOT"; exit 1; }
echo "[$(ts)]   Root HTML saved ($ROOT_HTML, $(wc -c <"$ROOT_HTML") bytes)"

PRODUCTS_LOG="products_v2.log"
: > "$PRODUCTS_LOG"

# Extract href targets (single/double quotes), absolutize, strip ?#, keep -4-…INFLDSTR-V2.0 directories
awk -v base="$ROOT" -f - "$ROOT_HTML" <<'AWK' \
| awk '/\/OSIWAC\/.*-4-.*INFLDSTR-V2\.0\/?$/ {print}' \
| sort -u > "$PRODUCTS_LOG"
BEGIN { IGNORECASE=1 }
function emit_abs(h,  url) {
  gsub(/[ \t\r\n]+/, "", h)
  if (h ~ /^https?:\/\//) url = h
  else if (h ~ /^\//)     url = "https://archives.esac.esa.int" h
  else                    url = base h
  sub(/[?#].*$/, "", url)
  print url
}
{
  s = $0
  while (match(s, /href[[:space:]]*=[[:space:]]*(["\047]([^"\047]+)["\047])/)) {
    m = substr(s, RSTART, RLENGTH)
    sub(/^href[[:space:]]*=[[:space:]]*["\047]/, "", m)
    sub(/["\047]$/, "", m)
    emit_abs(m)
    s = substr(s, RSTART + RLENGTH)
  }
}
AWK

PROD_COUNT=$(wc -l < "$PRODUCTS_LOG" || echo 0)
echo "[$(ts)]   Found $PROD_COUNT product folders with INFLDSTR-V2.0."
[ "$PROD_COUNT" -gt 0 ] || { echo "[$(ts)]   ERROR: No matching product folders."; exit 1; }

echo "[$(ts)] [2/6] Building and validating DATA/IMG/ directories for each product (with retries)…"
DIRS_FILE="img_dirs_v2.txt"
: > "$DIRS_FILE"
i=0
while IFS= read -r product; do
  i=$((i+1))
  case "$product" in */) ;; *) product="${product}/";; esac
  imgdir="${product}DATA/IMG/"
  if curl -fsI -A "$UA" --retry 3 --retry-delay 2 --retry-connrefused "$imgdir" >/dev/null; then
    echo "$imgdir" >> "$DIRS_FILE"
    phase=$(echo "$product" | awk 'match($0,/RO-C-OSIWAC-4-([A-Za-z0-9]+)-/,a){print a[1]}')
    [ -n "${phase:-}" ] || phase="UNKNOWN"
    echo "[$(ts)]   [$i/$PROD_COUNT] ok: $phase -> $imgdir"
  else
    echo "[$(ts)]   [$i/$PROD_COUNT] skip (no DATA/IMG or transient error): $product"
  fi
done < "$PRODUCTS_LOG"

DIR_COUNT=$(wc -l < "$DIRS_FILE" || echo 0)
echo "[$(ts)]   Valid DATA/IMG/ dirs: $DIR_COUNT"
[ "$DIR_COUNT" -gt 0 ] || { echo "[$(ts)]   ERROR: No DATA/IMG dirs validated."; exit 1; }

echo "[$(ts)] [3/6] Scraping .IMG filenames from each DATA/IMG/ directory (with retries)…"
URLS_FILE="img_urls_v2.txt"
: > "$URLS_FILE"
j=0
while IFS= read -r dir; do
  j=$((j+1))
  echo "[$(ts)]   [$j/$DIR_COUNT] scrape: $dir" >&2

  # Fetch directory listing (retries) and extract href="...IMG" (case-insensitive)
  html="$(curl -fsSL -A "$UA" --retry 3 --retry-delay 2 --retry-connrefused "$dir" 2>/dev/null || true)"

  # Pull hrefs and absolutize
  while IFS= read -r m; do
    href="${m#href=\"}"; href="${href%\"}"
    case "$href" in
      http*://*) url="$href" ;;
      /*)        url="https://archives.esac.esa.int$href" ;;
      *)         url="${dir}${href}" ;;
    esac
    url="${url%\#*}"; url="${url%\?*}"
    printf '%s\n' "$url"
  done < <(printf '%s' "$html" | grep -Eoi 'href="[^"]+\.img"')

done < "$DIRS_FILE" | sort -u > "$URLS_FILE"

URL_COUNT=$(wc -l < "$URLS_FILE" || echo 0)
echo "[$(ts)]   Total .IMG files discovered: $URL_COUNT"
[ "$URL_COUNT" -gt 0 ] || { echo "[$(ts)]   ERROR: No .IMG links found."; exit 1; }

echo "[$(ts)] [4/6] Sample .IMG URLs:"
head -n 5 "$URLS_FILE" || true
echo "          (full list in $URLS_FILE)"

if [ "$PARALLEL" = "aria2" ]; then
  echo "[$(ts)] [5/6] Preparing aria2c input to PRESERVE OSIWAC/… structure…"
  ARIA_LIST="aria2_list.txt"
  : > "$ARIA_LIST"
  awk -v cut="$CUT_DIRS" '
    function strip_domain(u,   p){ p=u; sub(/^https?:\/\/[^\/]+\//,"",p); return p }
    {
      u=$0
      p=strip_domain(u)
      n=split(p, seg, "/")
      out=""
      for (i=cut+1; i<=n; i++) {
        out = out (out==""?"":"/") seg[i]
      }
      print u
      print "  dir=."
      print "  out=" out
    }
  ' "$URLS_FILE" > "$ARIA_LIST"

  echo "[$(ts)] [6/6] Downloading via aria2c (x6 connections, resumable)…"
  aria2c -i "$ARIA_LIST" -x6 -s6 --continue=true --auto-file-renaming=false -U "$UA"

else
  echo "[$(ts)] [5/6] Downloading via wget (sequential, resumable)…"
  wget -i "$URLS_FILE" -c --timestamping \
    --tries="$WGET_TRIES" --waitretry="$WGET_WAITRETRY" \
    --no-host-directories -x --cut-dirs="$CUT_DIRS" \
    -U "$UA"
  echo "[$(ts)] [6/6] Download completed with wget."
fi

echo "[$(ts)] Done. Output under: $OUTDIR"
echo "          Artifacts:"
echo "            - $ROOT_HTML"
echo "            - $PRODUCTS_LOG"
echo "            - $DIRS_FILE"
echo "            - $URLS_FILE"
echo "            - ${ARIA_LIST:-<none>}"
