#!/usr/bin/env bash
# get_navcam_l3_data.sh
# Download NAVCAM Level-3 DATA folders only (skips EXTRAS/ → skips FITS).
# Patterns included:
#   - RO-C-NAVCAM-3-*-V1.0/   (PRL, ESC1–4, EXT1–3)
#   - RO-X-NAVCAM-3-PRL-COM-V1.0/
#
# By default, fetches *all* files under DATA/IMG/ (C.* and Q.* LBL/IMG).
# Set ONLY_C=1 to restrict to *C.IMG and *C.LBL only.
#
# Two usages:
# To download DATA/ (C + Q pairs), skip EXTRAS → no FITS:
# OUTDIR=/mnt/g/NAVCAM_L3_DATA PARALLEL=aria2 ./get_navcam_l3_data.sh

# To download only want calibrated images/labels (C.*, no Q.*):
# OUTDIR=/mnt/g/NAVCAM_L3_C_ONLY PARALLEL=aria2 ONLY_C=1 ./get_navcam_l3_data.sh

set -euo pipefail

ROOT="https://archives.esac.esa.int/psa/ftp/INTERNATIONAL-ROSETTA-MISSION/NAVCAM/"
OUTDIR="${OUTDIR:-$PWD/navcam_l3_data}"
PARALLEL="${PARALLEL:-aria2}"   # aria2 or wget
CUT_DIRS=3                      # keep from NAVCAM/... down
UA="navcam-downloader/1.1 (+contact: you@example.com)"
ONLY_C="${ONLY_C:-1}"           # 1 = only *C.IMG/*C.LBL; 0 = all *.IMG/*.LBL

need(){ command -v "$1" >/dev/null 2>&1 || { echo "ERROR: need '$1'"; exit 1; }; }
need curl; need awk; need sed; need grep; need sort
[ "$PARALLEL" = "aria2" ] && need aria2c || need wget

mkdir -p "$OUTDIR"; cd "$OUTDIR"
ts(){ date +"%Y-%m-%d %H:%M:%S"; }

echo "[$(ts)] [1/5] Fetching NAVCAM root…"
ROOT_HTML="navcam_root.html"
curl -fsSL -A "$UA" "$ROOT" -o "$ROOT_HTML"

echo "[$(ts)] [2/5] Finding Level-3 product folders…"
PRODUCTS_LOG="products_l3.log"; : > "$PRODUCTS_LOG"

# Keep RO-C-NAVCAM-3-*-V1.0/ and RO-X-NAVCAM-3-PRL-COM-V1.0/ (no HK)
awk -v base="$ROOT" '
  BEGIN{IGNORECASE=1}
  function abs(h,u){gsub(/[ \t\r\n]+/,"",h);
    if (h ~ /^https?:\/\//) u=h;
    else if (h ~ /^\//) u="https://archives.esac.esa.int" h;
    else u=base h;
    sub(/[?#].*$/,"",u); print u;
  }
  {
    s=$0;
    while (match(s,/href[[:space:]]*=[[:space:]]*(["'\''"]([^"'\''"]+)["'\''"])/)){
      m=substr(s,RSTART,RLENGTH);
      sub(/^href[[:space:]]*=[[:space:]]*["'\''"]/,"",m);
      sub(/["'\''"]$/,"",m);
      abs(m); s=substr(s,RSTART+RLENGTH);
    }
  }
' "$ROOT_HTML" \
| awk '
  /\/NAVCAM\/RO-C-NAVCAM-3-.*-V1\.0\/?$/ ||
  /\/NAVCAM\/RO-X-NAVCAM-3-PRL-COM-V1\.0\/?$/
' | awk '!/\/HK-3-/' | sort -u > "$PRODUCTS_LOG"

PCOUNT=$(wc -l < "$PRODUCTS_LOG" || echo 0)
[ "$PCOUNT" -gt 0 ] || { echo "No L3 product folders found."; exit 1; }
echo "[$(ts)]   Found $PCOUNT product folders."

echo "[$(ts)] [3/5] Building list of DATA/(CAM1|CAM2|IMG) files…"
URLS="navcam_l3_data_urls.txt"; : > "$URLS"
i=0
while IFS= read -r product; do
  i=$((i+1))
  [[ "$product" =~ /$ ]] || product="${product}/"

  # Try CAM1, CAM2, then fallback to IMG (some legacy sets)
  for sub in DATA/CAM1/ DATA/CAM2/ DATA/IMG/; do
    dir="${product}${sub}"
    if curl -fsI -A "$UA" --retry 3 --retry-delay 2 --retry-connrefused "$dir" >/dev/null; then
      html="$(curl -fsSL -A "$UA" --retry 3 --retry-delay 2 --retry-connrefused "$dir")"
      if [ "$ONLY_C" = "1" ]; then
        pat='href="[^"]*C\.(IMG|LBL)"'
      else
        pat='href="[^"]*\.(IMG|LBL)"'
      fi
      printf '%s' "$html" \
      | grep -Eoi "$pat" \
      | sed -E 's/^href="(.*)"/\1/i' \
      | while read -r h; do
          case "$h" in
            http*://*) u="$h" ;;
            /*)        u="https://archives.esac.esa.int$h" ;;
            *)         u="${dir}${h}" ;;
          esac
          u="${u%\#*}"; u="${u%\?*}"
          echo "$u"
        done >> "$URLS"
      echo "[$(ts)]   [$i/$PCOUNT] +${sub} from $(basename "${product%/}")"
    fi
  done
done < "$PRODUCTS_LOG"

sort -u -o "$URLS" "$URLS"
UCOUNT=$(wc -l < "$URLS" || echo 0)
[ "$UCOUNT" -gt 0 ] || { echo "No files found under DATA/CAM1|CAM2|IMG."; exit 1; }
echo "[$(ts)]   Files to fetch: $UCOUNT"
echo "[$(ts)]   Sample:"; head -n 6 "$URLS" || true

echo "[$(ts)] [4/5] Preparing fetch list (preserve NAVCAM/... paths)…"
ARIA="aria2_list.txt"; : > "$ARIA"
awk -v cut="$CUT_DIRS" '
  function strip(u){sub(/^https?:\/\/[^\/]+\//,"",u); return u}
  {
    u=$0; p=strip(u); n=split(p,seg,"/"); out=""
    for(i=cut+1;i<=n;i++){ out=(out==""?seg[i]:out"/"seg[i]) }
    print u; print "  dir=."; print "  out=" out
  }
' "$URLS" > "$ARIA"

echo "[$(ts)] [5/5] Downloading ($PARALLEL)…"
if [ "$PARALLEL" = "aria2" ]; then
  aria2c -i "$ARIA" -j8 -x6 -s6 --continue=true --auto-file-renaming=false -U "$UA"
else
  wget -i "$URLS" -c --timestamping \
    --no-host-directories -x --cut-dirs="$CUT_DIRS" \
    -U "$UA"
fi

echo "[$(ts)] Done. Output under: $OUTDIR"