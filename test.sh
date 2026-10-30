#!/bin/bash
# Trigon testing workflow: node unit tests + tsc typecheck.
# Run from the repo root: ./test.sh
set -euo pipefail
cd "$(dirname "$0")/site"

echo "== node unit tests =="
# jsdom (for the DOM view tests) is pinned in ../package.json alongside
# TypeScript; bootstrap both if either is missing, for the same
# persistence reason as tsc below.
if [ ! -x ../node_modules/.bin/tsc ] || [ ! -d ../node_modules/jsdom ]; then
  (cd .. && npm install --no-audit --no-fund)
fi
node --test test/*.test.js

echo "== tsc --noEmit --checkJs =="
# TypeScript is pinned in ../package.json and installed project-locally:
# the VM image outside ~ is ephemeral, so global installs vanish. Prefer the
# local copy, bootstrap it if missing, fall back to a global tsc.
if [ ! -x ../node_modules/.bin/tsc ] && ! command -v tsc >/dev/null; then
  (cd .. && npm install --no-audit --no-fund)
fi
if [ -x ../node_modules/.bin/tsc ]; then TSC=../node_modules/.bin/tsc; else TSC=tsc; fi
"$TSC" -p jsconfig.json

echo "ALL GREEN"
