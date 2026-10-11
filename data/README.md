# City gazetteer

`cities.json` — composite city database for the city-search feature.

- **Source**: GeoNames `cities5000` (CC-BY 4.0, https://www.geonames.org),
  enriched with country names from `countryInfo.txt`.
- **Fetch**: `./fetch_geonames.sh` downloads `cities5000.txt` +
  `countryInfo.txt` from https://download.geonames.org/export/dump/
  (gitignored; re-run per fresh clone).
- **Build**: `python3 build_cities.py` (needs the two files above).
- **Contents**: 64,213 cities. Each row:
  `[name, asciiname, country, population, lat, lng, [alternate exonyms...]]`,
  sorted by population descending.
- **Filtering**: dropped feature codes PPLX/PPLL (subdivisions, hamlets),
  digit-containing names (arrondissements, census tracts), non-Latin and
  vowel-less alternates (transliteration fragments, airport codes).
- **Size**: ~7.3 MB raw, ~2.95 MB gzipped. Fetch once, cache in Cache API.
- **Attribution (required in app)**: "City data © GeoNames (CC-BY)".

## Search spec (verified in Python, port to JS)

1. Normalize: lowercase + strip diacritics (NFD), for query and all keys.
   Precompute normalized forms once at load.
2. Buckets: A = name/asciiname prefix match; B = exact alternate match;
   C = alternate prefix match.
3. Order: B before A only if top-B population > 10 × top-A population;
   otherwise A before B. Then C. Population descending within each group.
4. Debounce input (~150 ms), show top 8. Selecting fills lat/lng.
