# Trigon E2E

Playwright suites that drive headless Chromium against the app. The local
suites serve `site/` on localhost; the `*_live.py` scripts verify the
deployed site instead.

## Quickstart

```bash
pip install -r requirements.txt
playwright install chromium   # or: export E2E_CHROME_PATH=/path/to/chromium
source ../env.sh              # centralized env loader (run.sh does this for you)
./run.sh                      # all local suites, sequentially
./run.sh trigon_drawer.py     # one suite
E2E_LIVE_URL=https://<deploy>.trigon.pages.dev python3 live_check.py
```

Every suite exits 0 on pass, 1 on failure, and prints `PASS`/`FAIL` lines.
Screenshots land next to the suite that took them.

## Layout

- `harness.py` — shared environment shims (see below); every suite imports it.
- `relay.py` — local proxy relay. Only used when `E2E_RELAY=1`: it injects
  `Proxy-Authorization` up front for egress proxies whose 407 handshake
  Chromium can't complete itself. Never needed on a normal machine.
- `dtfill.py` — shared helpers for the date/time input widgets.
- `trigon_*.py`, `*_e2e.py` — local suites (serve `site/` on localhost).
- `*_live.py`, `live_*.py` — deployed-site checks (default
  `https://trigon.pages.dev`, overridable per run).

One-off debug/probe scripts were deliberately left out.

## Environment

| Variable           | Default                              | Purpose                              |
|--------------------|--------------------------------------|--------------------------------------|
| `E2E_SITE_DIR`     | `<repo>/site`                        | app directory the local suites serve |
| `E2E_LIVE_URL`     | `https://trigon.pages.dev`           | deployed URL for the `*_live.py` set |
| `E2E_CHROME_PATH`  | Playwright's bundled Chromium        | Chromium executable                  |
| `E2E_RELAY`        | `0`                                  | `1` = proxy egress through `relay.py`|
| `E2E_PROXY`        | `http://127.0.0.1:8899`              | proxy URL when the relay is on       |
| `E2E_PROXY_BYPASS` | `127.0.0.1,localhost`                | proxy bypass list                    |
| `E2E_CHROME_ARGS`  | `""`                                 | extra Chromium args, space-separated |
| `E2E_NO_SANDBOX`   | auto when running as root            | `1` adds `--no-sandbox`              |

When the relay is on, `--ignore-certificate-errors` is added automatically
(egress goes through a MITM proxy). On a sandboxed machine with no direct
egress, for example:

```bash
E2E_RELAY=1 \
E2E_CHROME_PATH=/opt/chrome-linux64/chrome \
E2E_CHROME_ARGS="--disable-dev-shm-usage" \
./run.sh
```
