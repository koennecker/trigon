#!/bin/bash
# Run the local E2E suites sequentially. Each suite serves site/ on its own
# localhost port and drives headless Chromium at it, so they must not run
# in parallel. The *_live.py scripts are excluded here (they verify the
# deployed site); run those individually with E2E_LIVE_URL set.
# Pass filenames to run a subset: ./run.sh trigon_drawer.py
set -u
cd "$(dirname "$0")"

# Centralized env: repo-root env.sh loads .env and exports defaults.
# shellcheck disable=SC1091
[ -f ../env.sh ] && source ../env.sh

if [ $# -gt 0 ]; then
  suites=("$@")
else
  suites=()
  for t in trigon_*.py validator_smoke.py nav_drawer.py mobile_css.py \
           sky_view_opts.py retro_periods.py daylight_gradient.py *_e2e.py; do
    case "$t" in
      *_live.py) continue ;;
      *) suites+=("$t") ;;
    esac
  done
fi

pass=0; fail=0; failed=()
for t in "${suites[@]}"; do
  echo "=== $t ==="
  if python3 "$t"; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1)); failed+=("$t")
  fi
done

echo
echo "suites: $pass passed, $fail failed"
if [ ${#failed[@]} -gt 0 ]; then
  printf 'failed: %s\n' "${failed[@]}"
  exit 1
fi
