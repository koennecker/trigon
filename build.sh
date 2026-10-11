#!/bin/bash
# Build the Swiss Ephemeris C library to WebAssembly with Emscripten.
# Run after: source ~/emsdk/emsdk_env.sh
set -e
cd "$(dirname "$0")"
SRC=src_repo
OUT=site
mkdir -p "$OUT"

SRCS="$SRC/sweph.c $SRC/swejpl.c $SRC/swemmoon.c $SRC/swedate.c \
      $SRC/swehouse.c $SRC/swecl.c $SRC/swephlib.c $SRC/swemplan.c swe_wrap.c"

emcc -O3 -DNO_SWE_GLP \
  $SRCS \
  -I$SRC \
  -o $OUT/swe.js \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=SweModule \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s STACK_SIZE=1048576 \
  -s EXPORTED_FUNCTIONS='["_chart_compute","_search_compute","_eclipse_at_syzygy","_swe_set_ephe_path","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","FS","HEAPF64","HEAPU8","UTF8ToString"]'

ls -la "$OUT/swe.js" "$OUT/swe.wasm"
