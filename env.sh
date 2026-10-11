#!/bin/bash
# Centralized environment loader for Trigon tooling.
#
# Usage:
#   source ./env.sh            # from the repo root, or
#   source /path/to/env.sh     # from anywhere
#
# Loads `.env` (next to this script) if present, then exports every known
# Trigon variable, filling in defaults for anything still unset.
# Precedence: existing environment > .env file > built-in defaults.
# Safe: the .env parser only accepts KEY=VALUE lines (TRIGON_*/E2E_* keys);
# it never executes the file's contents.

_TRIGON_ENV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

# 1. Load .env — KEY=VALUE lines only, no code execution.
if [ -f "$_TRIGON_ENV_ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line#"${line%%[![:space:]]*}"}"   # ltrim
    line="${line%"${line##*[![:space:]]}"}"   # rtrim
    case "$line" in ""|\#*) continue ;; esac
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"      # rtrim key
    case "$key" in TRIGON_*|E2E_*) ;; *) continue ;; esac
    val="${line#*=}"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    [ -z "${!key+x}" ] && export "$key=$val"  # real env wins over .env
  done < "$_TRIGON_ENV_ROOT/.env"
fi

# 2. Defaults for anything still unset.
: "${TRIGON_EPHE_DIR:=$_TRIGON_ENV_ROOT/ephe}"
: "${E2E_SITE_DIR:=$_TRIGON_ENV_ROOT/site}"
: "${E2E_LIVE_URL:=https://trigon.pages.dev}"
: "${E2E_CHROME_PATH:=}"
: "${E2E_RELAY:=0}"
: "${E2E_PROXY:=http://127.0.0.1:8899}"
: "${E2E_PROXY_BYPASS:=127.0.0.1,localhost}"
: "${E2E_CHROME_ARGS:=}"
: "${E2E_NO_SANDBOX:=}"
export TRIGON_EPHE_DIR E2E_SITE_DIR E2E_LIVE_URL E2E_CHROME_PATH E2E_RELAY \
       E2E_PROXY E2E_PROXY_BYPASS E2E_CHROME_ARGS E2E_NO_SANDBOX

unset _TRIGON_ENV_ROOT
