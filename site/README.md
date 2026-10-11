# site/ — the Trigon app (deployed verbatim)

This directory **is** the application. Cloudflare Pages serves it verbatim
(build output directory `site/`, no build step), so everything here runs in
the visitor's browser: the Swiss Ephemeris C library compiled to
WebAssembly, vanilla JS, no framework, no server. `.se1` ephemeris files
and the city gazetteer are fetched on demand and cached in IndexedDB.

Live: https://trigon.pages.dev

## Architecture

```
input (drawer) → ephe.js → swe.wasm ─┬─→ table.js   → positions / lots / dignities
                                     ├─→ chart.js   → SVG whole-sign wheel
                                     ├─→ search.js  → aspects / ingresses / stations
                                     └─→ sky-data.js → sky.js → Three.js sky
```

Three layers, kept separate on purpose:

1. **WASM boundary** (`ephe.js`) — the only module that talks to
   `swe.wasm`. Three entry points from `swe_wrap.c` (built at repo root by
   `build.sh`): `_chart_compute` (full chart: positions, speeds, houses,
   angles), `_search_compute` (longitude + speed for a body bitmask — the
   search engines' fast path), `_eclipse_at_syzygy`. The JS↔WASM boundary is
   already optimal (measured: JS search-loop overhead is ~2% of
   wall time; all heavy numerics stay in C). `validateEphOut` is the
   84-double output tripwire — it runs on every calculation and throws into
   the `#error` catch path on corruption.
2. **Pure logic** — `search.js`, `format.js`, `dateapi.js`, `table.js`,
   `chart.js` (geometry), `sky-data.js`, `share.js`, `skip.js`. No DOM, no
   WASM imports; the ephemeris is injected. This is why the 190+ node tests
   in `test/` exist.
3. **UI** (`app.js` + `*-ui` companions) — the orchestrator, the drawer, the
   six tabs, and the live patcher that updates table cells on clock ticks
   without re-rendering.

Ephemeris sourcing: Swiss `.se1` files when available (fetched from
`raw.githubusercontent.com` for CORS, cached in IndexedDB by
`ephe-store.js`), Moshier fallback otherwise — except BCE, which *requires*
`.se1` files. Coverage floor is **12999 BCE** (`seplm132.se1` starts 13000
BCE Aug 10 *Ephemeris Time*, and sweph range-checks in ET).

## Tabs (`index.html`, `#views .tabs`)

| Tab | Module | What it does |
|---|---|---|
| Table | `table.js`, `lots.js`, `dignities.js` | Positions, speeds, magnitudes, Hermetic + Hellenistic lots, dignities, stations, lunations |
| Chart | `chart.js` | Whole-sign SVG wheel: 1st-house cusp at 9 o'clock, longitude increasing counter-clockwise (`θ = 180° + (λ − ref)`) |
| Aspects | `search.js`, `search-ui.js` | Aspect search with optional AND-of-OR condition groups |
| Ingresses | `search.js` | Sign ingresses with direction (incl. retrograde re-entries) |
| Stations | `search.js` | Station list + extended retrograde periods (shadow spans) |
| Sky | `sky.js`, `sky-data.js` | Three.js sky viewer (Observer + Sphere views) |

Standing UI policy: **every datetime shown in any table is clickable and
generates the chart for that instant** — `gotoButtonHTML(jd, label)` in
`format.js`, delegated `[data-goto-jd]` handlers calling
`gotoSearchInstant` in `app.js`. If you add a new table, wire its datetimes
up the same way.

## Module reference

**Ephemeris & data**
- `ephe.js` — WASM boundary: loads `swe.wasm`/`swe.js`, exposes
  `computeChart` / `searchCompute` / eclipse wrappers, runs
  `validateEphOut` on every calculation.
- `swe.wasm`, `swe.js`, `swe.mjs` — the compiled library
  (Emscripten-generated; `swe.js` excluded from type-checking). Rebuilt via
  repo-root `build.sh` from `src_repo/`.
- `ephe-store.js` — IndexedDB persistence for `.se1` files
  (`swisseph-ephe` database). Replaced the earlier Cache API store.
- `sky-data.js` — pure astronomy math + lore for the Sky tab: equatorial
  placement (`eqToViewV`/`horToViewV`), tropical signs, 27 nakshatras,
  28 xiu (star-to-star boundaries), multi-tradition star lore, great
  circles. (Type-checked.)
- `speed-stats.js` — long-term |speed| stats per body (mean/std/101
  quantiles, 1800–2300); drives the red→yellow→green speed percentile dot.
  Built from `proto/speed_samples.json`.
- `mag-stats.js` — long-term magnitude stats per body; drives the
  magnitude glow (only when brighter than the body's own median).
  Built from `proto/mag_samples.json`.
- `cities.js` — GeoNames composite gazetteer search (64k cities,
  pop-ranked, exonym-aware) over `data/cities.json`, lazy-loaded.
- `lots-catalog.js` — the Hellenistic lots registry (**generated** — edit
  `proto/lots_catalog*.json` and re-run `proto/gen_lots_catalog.py`).

**Engines (pure)**
- `search.js` — aspect + station search engines. Adaptive grid
  `aspectGridStep` = 45°/max pair relative speed, clamped [5,120]d
  (Moon-involved stays 5d); bracket sign changes, refine with safeguarded
  secant → bisection. Also `ingressRoots`, `stationsAround` (±850-day
  window, sized to Mars's ~710-day station cycle), `syzygiesAround`,
  `shadowBounds`/`boundaryCrossingBefore`/`After`, and the aspect-condition
  engine (`evaluateConditions`, `validateConditions`,
  `normalizeConditionGroups`).
- `search-worker.js` — parallel search worker (long searches run off the
  main thread).
- `search-ui.js` — Aspects + Stations tab UI.
- `lots.js` — the 10 Hermetic lots (Paulus set, day/night by true Sun
  altitude) + `computeCatalogLots` for the Hellenistic selection, incl. the
  four opt-in tradition variants. (Type-checked.)
- `dignities.js` — decans (Chaldean/Indian toggle), Egyptian bounds,
  Dorothean triplicities, exaltations, D12/D9, whole-sign house lords, and
  the lordship deep dive. (Type-checked.)
- `table.js` — pure builders for the results table (positions, angles,
  lots, stations, lunations).
- `chart.js` — whole-sign wheel geometry + SVG rendering; label declutter
  per `proto/pava.py`.
- `skip.js` — pure core of time stepping (used by clock/animation).
- `share.js` — pure share-link state packing.

**Input & time**
- `app.js` — the orchestrator (~1400 lines): drawer, tabs, calculation
  pipeline, live patcher, CSV downloads, delegated event handlers.
- `datetime.js` — one unified date+time input with native-picker-like
  segments.
- `datepicker.js` — calendar popup with BCE support.
- `dateapi.js` — hand-rolled calendar API for BCE/CE dates. BCE wall time
  is Local Mean Time.
- `clock.js` — the astrological clock (live recompute every second).
- `animation.js` — time-lapse animation of the ephemeris over a date range.
- `location.js` — city search, geolocation, manual coordinates, timezone
  derivation.

**Display**
- `format.js` — pure display formatting: angles (`dms`/`compact`/`dec`
  via `effFmt()`), `fmtSpeedDR` (D/R suffix), `fmtLon`, `fmtDec`,
  `gotoButtonHTML`, `rowsToCSV`, planet/sign colors
  (`PLANET_COLORS`, element-colored signs).
- `sky.js` — Three.js sky viewer (lazy-loaded `vendor/three.module.min.js`;
  never construct THREE objects at module scope — it loads lazily).
  On-demand rendering (dirty flag, no 60fps repaint for a static sky),
  overlay rebuilds gated by a 0.02° LST/node quantum, pooled materials.

**Persistence & misc**
- Input drawer open/closed, glyphs toggle (`trigon.glyphs.v1`), angle mode
  (`trigon.angle-mode.v1`), dignity toggles, sky options (`trigon.sky.v1`),
  aspect conditions (`trigon.aspconds.v1`), lots selection
  (`trigon.lots.selection.v1`) — all in localStorage.
- `logo.svg` — site logo.

**Subdirectories**
- `data/` — `cities.json` (gazetteer; built from repo-root `data/`).
- `source/` — `trigon-source.zip`, the AGPL Corresponding Source bundle
  (rebuilt by repo-root `build_source_zip.sh` before every `site/` push).
- `test/` — the node suite (`chart`, `dateapi`, `datetime`, `dignities`,
  `eclipse`, `ephe`, `format`, `location`, `lots`, `magstats`, `search`,
  `search-ui`, `share`, `skip`, `sky-data`, `speed-stats`, `table`,
  `wasm-search`), plus `test/data/` (`.se1` fixtures) and `bce-mobile.png`
  (reference screenshot regenerated by `e2e/trigon_bce.py`).
- `vendor/` — third-party, untyped, excluded from type-checking:
  `three.module.min.js` (r170), `tz.min.js`.

## Conventions

- **Type-checking rolls out incrementally.** `jsconfig.json` (`tsc --noEmit
  --checkJs`, `allowJs`) lists only JSDoc-complete files in `include`
  (currently `sky-data.js`, `lots.js`, `dignities.js`); `vendor/` and
  `swe.js` are excluded. To adopt a file: annotate until tsc reports zero
  errors with it added, then add it to `include`. Run via repo-root
  `./test.sh`.
- **The live patcher patches, never rebuilds.** On clock ticks, cells are
  updated in place (`setSpeedCell` etc.). Never `textContent` a cell that
  contains sub-spans (you'll wipe out the speed dot); patch the
  trailing text node and refresh the dot, or re-render cached innerHTML.
- **Every output table has a CSV download** (spreadsheet icon; pure
  `rowsToCSV` in `format.js`; files named `trigon-<table>.csv`). The
  positions CSV expands the speed dot into "Speed percentile" / "Speed
  sigma (z)" columns.
- **Sky rendering is on-demand.** The rAF loop renders only when the dirty
  flag is set; a static sky costs ~zero between ephemeris ticks. See the
  `sky.js` header for the rebuild quantum and material pooling rules.
- **Screenshots decide visual behavior; green nonvisual tests never certify
  pixels.**
- `node_modules` must never live inside `site/` (it would deploy).
