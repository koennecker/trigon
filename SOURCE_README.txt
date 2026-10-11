Trigon — complete corresponding source (AGPL-3.0)
=====================================================

This archive contains everything needed to rebuild the Trigon web app
as served, including the planetary engine compiled to WebAssembly.

Contents
--------
src_repo/        Swiss Ephemeris C sources and headers (upstream:
                 https://github.com/aloistr/swisseph), (c) 1997-2021
                 Astrodienst AG, used under the GNU Affero General
                 Public License v3 (see LICENSE-AGPL-3.0.txt).
swe_wrap.c       Thin C bridge exposing chart_compute() to JavaScript.
build.sh         Emscripten build script producing site/swe.js + swe.wasm.
                 Requires the Emscripten SDK (emsdk); run after
                 `source ~/emsdk/emsdk_env.sh`. Tested with emcc -O3.
site-src/        The app's own sources (also served verbatim on the site):
                 index.html, app.js, chart.js, cities.js, ephe-store.js,
                 logo.svg.
vendor/tz.min.js Vendored third-party coordinate->timezone lookup,
                 loaded as-is by index.html.
data/            build_cities.py + README.md: generator for the GeoNames
                 city gazetteer (data/cities.json). The gazetteer itself
                 is a build artifact; the upstream data is GeoNames
                 (https://www.geonames.org, CC-BY).
LICENSE-AGPL-3.0.txt  License text.

Rebuilding the WASM module
--------------------------
source ~/emsdk/emsdk_env.sh
./build.sh        # writes site/swe.js and site/swe.wasm

The site is static: serve the site/ directory over HTTP(S). Ephemeris
.se1 files and the city gazetteer are fetched on demand at runtime and
cached in the browser; no server component is required.

License
-------
The Swiss Ephemeris engine is (c) Astrodienst AG, used under AGPL-3.0
(dual-licensed; the Professional License option is not exercised here).
Trigon's own code (swe_wrap.c, site-src/) is likewise licensed under
the GNU Affero General Public License v3.
