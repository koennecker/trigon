#!/bin/bash
# Fetch the GeoNames source dumps needed by build_cities.py.
# These files are gitignored (see ../.gitignore); run once per fresh clone,
# then:  python3 build_cities.py
set -euo pipefail
cd "$(dirname "$0")"

BASE="https://download.geonames.org/export/dump"

echo "-> cities5000.zip"
curl -fSL -o cities5000.zip "$BASE/cities5000.zip"
echo "-> countryInfo.txt"
curl -fSL -o countryInfo.txt "$BASE/countryInfo.txt"

echo "-> extracting cities5000.txt"
unzip -o -q cities5000.zip cities5000.txt
rm cities5000.zip

echo "done: $(wc -l < cities5000.txt) cities, $(wc -l < countryInfo.txt) countries"
