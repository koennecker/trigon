# Trigon

The Swiss Ephemeris C library running locally in your browser via WebAssembly.
No server, no API calls for computation — `.se1` ephemeris files and the city
gazetteer are fetched on demand and cached in IndexedDB.

**Live:** https://trigon.pages.dev

## License

AGPL-3.0 — see [LICENSE](LICENSE). The Swiss Ephemeris is used under its AGPL
option; `swe.wasm` counts as object code, so every release ships its
Corresponding Source as `site/source/trigon-source.zip` (rebuilt by
`build_source_zip.sh`, linked in the site footer).

City data © GeoNames (CC-BY 4.0).

## Environment quirks

Dependencies are pinned project-locally rather than installed globally, so
a fresh clone works without touching the rest of your system:

- **TypeScript is project-local.** Pinned in `package.json`, installed with
  `npm install` into `./node_modules`. `test.sh` bootstraps it if missing.
- **Python packages go to `~/.local`.** `pip3 install --user -r requirements.txt`
  (notably `blake3`, needed by the deploy tooling).
- **Emscripten** (for rebuilding `swe.wasm`): `source ~/emsdk/emsdk_env.sh`,
  then `./build.sh` (tested with `emcc -O3`).

## Test

```bash
./test.sh   # node unit tests (190+) + tsc --noEmit --checkJs
```

Math goes through `proto/` first: sanity-check in Python, prototype, then
port to JavaScript. The node suite exists because the pure logic
(`search.js`, `format.js`, `dateapi.js`, chart geometry) is separated from UI.

End-to-end: `e2e/` holds 61 Playwright suites that drive headless Chromium
against `site/` served on localhost (plus 16 scripts verifying the deployed
site). See `e2e/README.md`; run `./e2e/run.sh` after `pip install -r
e2e/requirements.txt` and `playwright install chromium` (or set
`E2E_CHROME_PATH`). `run.sh` sources `env.sh` for you; see
[Environment variables](#environment-variables).

## Environment variables

All tooling env vars, with defaults. `.env.sample` (checked in) documents
them with dummy values; `env.sh` (repo root) is the centralized loader.

```bash
cp .env.sample .env   # first time: create your own (gitignored)
source ./env.sh       # load .env, then export every variable below with its default
```

`e2e/run.sh` sources `env.sh` automatically; for direct Python runs
(`ref.py`, `e2e/*.py`, `perf/perf_run.py`), source it first. Precedence:
existing environment > `.env` > defaults. The `.env` parser only accepts
`KEY=VALUE` lines for `TRIGON_*` / `E2E_*` keys — it never executes the
file.

| Variable           | Default                           | Used by            |
|--------------------|-----------------------------------|--------------------|
| `TRIGON_EPHE_DIR`  | `<repo>/ephe`                     | `ref.py` — Swiss `.se1` dir for the pyswisseph cross-check |
| `E2E_SITE_DIR`     | `<repo>/site`                     | `e2e/` — app dir the local suites serve |
| `E2E_LIVE_URL`     | `https://trigon.pages.dev`        | `e2e/` — deployed URL for the `*_live.py` scripts |
| `E2E_CHROME_PATH`  | Playwright's bundled Chromium     | `e2e/` — Chromium executable |
| `E2E_RELAY`        | `0`                               | `e2e/` — `1` proxies egress through `e2e/relay.py` (sandboxed VMs) |
| `E2E_PROXY`        | `http://127.0.0.1:8899`           | `e2e/` — proxy URL when the relay is on |
| `E2E_PROXY_BYPASS` | `127.0.0.1,localhost`             | `e2e/` — proxy bypass list |
| `E2E_CHROME_ARGS`  | `""`                              | `e2e/` — extra Chromium args, space-separated |
| `E2E_NO_SANDBOX`   | auto when running as root         | `e2e/` — `1` adds `--no-sandbox` |

## Deploy

Push to `main` — the repo is connected to Cloudflare Pages, which auto-deploys
with build output directory `site/`. No build step; `site/` is served verbatim.

Before pushing changes under `site/`, rebuild the AGPL source bundle:

```bash
./build_source_zip.sh   # regenerates site/source/trigon-source.zip
```

After a deploy, record a performance run against the deployment URL:

```bash
python3 perf/perf_run.py --url <deployment-url> \
    --label <label> --journal perf/JOURNAL.md
```

## Layout

```
site/               The app — this is what gets deployed, verbatim.
  index.html app.js        UI shell + main table
  chart.js                 Chart wheel (SVG)
  sky.js                   Three.js sky viewer (lazy-loaded)
  ephe.js                  WASM boundary (swe.wasm via Emscripten)
  search.js / search-ui.js Aspect / ingress / station search engines
  lots.js lots-catalog.js  10 Hermetic + 181 Hellenistic lots
  dignities.js             Decans, bounds, triplicities, D12/D9
  format.js dateapi.js     Formatting; hand-rolled BCE-safe dates
  data/cities.json         64k-city gazetteer (built from data/)
  source/trigon-source.zip AGPL Corresponding Source bundle
  test/                    Node unit tests
env.sh              Centralized env loader (sources .env, exports defaults).
.env.sample         Documented env vars with dummy values (copy to .env).
swe_wrap.c            Thin C bridge exposing chart_compute() to JS.
src_repo/             Vendored upstream Swiss Ephemeris C sources
                      (build input for swe.wasm; see build.sh).
data/                 Gazetteer source: build_cities.py + README.
                      Raw GeoNames dumps are re-fetchable (see data/README.md)
                      and not tracked.
proto/                Python/JS prototypes — math is verified here first.
perf/                 perf_run.py + JOURNAL.md (per-deploy measurements).
e2e/                  61 Playwright E2E suites + harness.py (env shims),
                      relay.py, run.sh. See e2e/README.md.
ephe/                 Local .se1 cache for builds/tests (gitignored).
```

Every directory above with its own purpose carries an exhaustive `README.md`
(what it is, why it exists, per-file reference, conventions) — documentation
ships alongside the code, on top of testing.

## Notes

- BCE dates use Local Mean Time and require Swiss `.se1` files (no Moshier
  fallback); coverage floor is 12999 BCE.
- Sky tab star data (`sefstars.txt`) is fetched at runtime and cached.
