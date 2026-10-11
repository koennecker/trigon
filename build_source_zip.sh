#!/usr/bin/env bash
# Rebuild site/source/trigon-source.zip -- the AGPL Corresponding Source for
# the Trigon web app -- from the current tree. site-src/ is copied verbatim
# from the served site files, so the archive always matches production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SITE="$ROOT/site"
OUT="$SITE/source/trigon-source.zip"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PKG="$TMP/pkg"

mkdir -p "$PKG/site-src" "$PKG/test" "$PKG/vendor" "$PKG/data"
cp "$ROOT/LICENSE-AGPL-3.0.txt" "$PKG/LICENSE-AGPL-3.0.txt"
cp "$ROOT/SOURCE_README.txt" "$PKG/README.txt"
cp -r "$ROOT/src_repo" "$PKG/src_repo"
rm -rf "$PKG/src_repo/.git" # never ship VCS internals
cp "$ROOT/swe_wrap.c" "$PKG/swe_wrap.c"
cp "$ROOT/build.sh" "$PKG/build.sh"
# First-party site modules. swe.js is Emscripten build output (regenerable via
# build.sh from src_repo + swe_wrap.c), so it is deliberately excluded like
# swe.wasm. The guard below fails the build if a new site/*.js module is not
# listed here, so modules cannot silently fall out of the archive.
SITE_LIST="app.js chart.js search.js dateapi.js datepicker.js datetime.js cities.js ephe-store.js format.js share.js table.js ephe.js search-ui.js location.js clock.js skip.js sky.js sky-data.js animation.js speed-stats.js lots.js lots-catalog.js dignities.js mag-stats.js search-worker.js"
for f in $SITE_LIST index.html logo.svg; do
  cp "$SITE/$f" "$PKG/site-src/$f"
done
for m in "$SITE"/*.js; do
  b="$(basename "$m")"
  case "$b" in swe.js) continue;; esac
  case " $SITE_LIST " in *" $b "*) ;; *)
    echo "NOT IN SOURCE ZIP: site/$b (add it to SITE_LIST)" >&2; exit 1;;
  esac
done
# Tests for the shipped modules, plus the fixture README. The .se1 fixtures
# themselves (test/data/*.se1) are downloaded Swiss Ephemeris data, not source,
# and are excluded.
for t in "$SITE"/test/*.test.js "$SITE/test/data/README"; do
  cp "$t" "$PKG/test/$(basename "$t")"
done
cp "$SITE/vendor/tz.min.js" "$PKG/vendor/tz.min.js"
cp "$SITE/vendor/three.module.min.js" "$PKG/vendor/three.module.min.js"
cp "$ROOT/data/build_cities.py" "$ROOT/data/README.md" "$PKG/data/"

# Sanity: every site-src file must be byte-identical to the served file.
for f in "$PKG"/site-src/*; do
  b="$(basename "$f")"
  cmp -s "$f" "$SITE/$b" || { echo "MISMATCH: site-src/$b != site/$b" >&2; exit 1; }
done
for t in "$PKG"/test/*; do
  b="$(basename "$t")"
  if [ -f "$SITE/test/$b" ]; then
    cmp -s "$t" "$SITE/test/$b" || { echo "MISMATCH: test/$b" >&2; exit 1; }
  else
    cmp -s "$t" "$SITE/test/data/$b" || { echo "MISMATCH: test/data/$b" >&2; exit 1; }
  fi
done

mkdir -p "$SITE/source"
rm -f "$OUT"
(cd "$PKG" && zip -q -X -r "$OUT" .)
echo "wrote $OUT ($(stat -c%s "$OUT") bytes)"
unzip -l "$OUT" | tail -2
