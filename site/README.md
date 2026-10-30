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
| Table | `table.js`, `lots.js`, `dignities.js`, `bazi.js` | Positions, speeds, magnitudes, Hermetic + Hellenistic lots, dignities, stations, lunations, BaZi four pillars |
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
- `search-ui.js` — Aspects + Stations tab UI. The aspect-condition
  builders (`condFieldsHTML`, `condRowHTML`, `condGroupHTML`) are
  exported pure functions at module scope, rendered through by the
  factory; jsdom integration tests in `test/ui-conditions.test.js`
  render them and query by accessible name and selected value.
- `meta.js` — the results-head meta line as a pure builder
  (`buildMetaHTML({ metaStamp, inp, useSwiss })`), extracted from
  `app.js` so it executes in tests; jsdom tests in
  `test/ui-meta.test.js` render it and assert on the visible stamp,
  calendar, coordinates, and engine.
- `lots.js` — the 10 Hermetic lots (Paulus set, day/night by true Sun
  altitude) + `computeCatalogLots` for the Hellenistic selection, incl. the
  four opt-in tradition variants. (Type-checked.)
- `dignities.js` — decans (Chaldean/Indian toggle), Egyptian bounds,
  Dorothean triplicities, exaltations, D12/D9, whole-sign house lords, and
  the lordship deep dive. (Type-checked.)
- `bazi.js` — BaZi (Four Pillars) calendar arithmetic, pure: year and
  month are read from the chart's Sun longitude (out[0]) — year turns
  at 315 deg (Lichun), month advances one 30-deg Jie segment from
  there; day on the continuous 60-day count (JDN + 49) mod 60, hour on
  the double-hour, day advancing at 23:00. It recomputes no ephemeris:
  the Sun longitude is state the chart already computed, so a second
  ephemeris path cannot disagree with the chart. The Meeus
  low-precision function `trigSunLongitude` is a test mock only, for
  tests with no chart output (Lichun 2024–2026 within 0.01 deg of
  315 deg). Wall time as entered, no true solar time correction.
  `buildBaziHTML` renders the subtable (stem/branch +
  element/polarity/animal + hidden stems, Day Master note); `app.js`
  wires it into the table view from the chart output and the wall
  time reconstructed from the instant, with a live-tick guard so a
  clock crossing an hour boundary updates it. Verified first in
  `proto/bazi_proto.py`. (Type-checked.)
- `table.js` — pure builders for the results table (positions, angles,
  lots, stations, lunations) + `pointTooltip`, the per-point tooltip data
  mirroring a positions-table row.
- `chart.js` — whole-sign wheel geometry + SVG rendering; label declutter
  per `proto/pava.py`. Every point renders inside a `.chart-point` group
  stamped with its `data-point` key (plus `data-wheel` on outer wheels)
  and a transparent hit disc — the app's hover/focus tooltip keys off it.
- `skip.js` — pure core of time stepping (used by clock/animation).
- `share.js` — pure share-link state packing.

**Input & time**
- `app.js` — the composition root (~1250 lines): drawer, tabs,
  calculation pipeline, live patcher, CSV downloads, and wiring for the
  extracted factories below. Chart session state and preferences live
  in `store.js`; see [State-to-DOM sync protocol](#state-to-dom-sync-protocol).
- `store.js` — the chart session (`S`) and persisted preferences: the
  single write path (`update()` with dirty keys and synchronous
  subscribers; `initPrefs()`/`setPref()` for preferences). (Type-checked.)
- `dom-patch.js` — guarded DOM writes for the live patcher: `setText`,
  `setHTML`, and `createSwapGuard` (string-change guards for section
  swaps). All patch caches live inside these helpers. (Type-checked.)
- `datetime-groups.js` — the date/time field groups behind every input:
  hidden y/era/mo/d/h/mi/s fields, the unified text inputs' get/set,
  commit sanitizing (incl. the 1582 cutover gap snap), forward-only
  range pairs, and picker bounds.
- `datetime.js` — one unified date+time input with native-picker-like
  segments.
- `datepicker.js` — calendar popup with BCE support.
- `dateapi.js` — hand-rolled calendar API for BCE/CE dates. BCE wall time
  is Local Mean Time.
- `clock.js` — the astrological clock (live recompute every second).
- `animation.js` — time-lapse animation of the ephemeris over a date range.
- `location.js` — city search, geolocation, manual coordinates, timezone
  derivation.
- `outer-wheels.js` — outer wheel (biwheel/triwheel) panels: wheel list,
  per-wheel UTC datetime + label editing, and the animation target
  (root or one wheel) consumed by clock/animation.

**Display**
- `loader.js` — the download loading animation (zodiac glyph morph),
  shown only while uncached data downloads; owns its armed flag, which
  the run path sets per calculation (live ticks never arm it).
- `chart-style.js` — the chart style controls and their persisted
  overrides (`astroweb-chart-style` in localStorage), generated from
  the `chart.js` style descriptors. The controls render in the Chart
  section of the settings modal (gear button in the input drawer head;
  the modal's Table section holds the angle format/size, glyphs,
  station times, decan and lot options, its Sky section the sky overlay controls),
  which `app.js` builds and wires at startup.
- `chart-tooltip.js` — chart point hover/focus tooltips: delegated
  panel events, element lifecycle, edge-aware positioning. The data
  comes from `table.js` `pointTooltip`, assembled by `app.js` (station
  values read back from the table cells at hover time, so the tooltip
  follows the station-time mode without its own setting).
- `glyphs.js` — vector glyphs for the 12 signs and 12 points (planets
  + nodes): standard-form outlines on a 0..100 grid, rendered as SVG
  fills with an optional same-color outline. Consumed by `chart.js`
  (sign band, spoke labels, outer wheels, mobile wheel); styled by the
  Glyphs section of `CHART_STYLE_SECTIONS` plus the per-context weight
  params, which add outline width. The path data block is generated —
  rebuild with `data/build_glyphs.py`, never hand-edit it. Aspect
  glyphs and the table/sky views still use font text.
- `format.js` — pure display formatting: angles (`dms`/`compact`/`dec`
  via `effFmt()`), `fmtSpeedDR` (D/R suffix), `fmtLon`, `fmtDec`,
  `gotoButtonHTML`, `fmtRelativeInstant` (station distance from the
  chart instant: "in 42d 6h" / "42d 6h ago"), `rowsToCSV`, planet/sign colors
  (`PLANET_COLORS`, element-colored signs).
- `sky.js` — Three.js sky viewer (lazy-loaded `vendor/three.module.min.js`;
  never construct THREE objects at module scope — it loads lazily).
  On-demand rendering (dirty flag, no 60fps repaint for a static sky),
  overlay rebuilds gated by a 0.02° LST/node quantum, pooled materials.
  The tip/readout builders (`bodyTipHTML`, `starTipHTML`,
  `skyReadoutHTML`, `lockButtonHTML`) are exported pure functions at
  module scope, rendered through by the factory; jsdom integration
  tests in `test/ui-sky.test.js` render them and assert on visible
  names, coordinates, and button text.

**Persistence & misc**
- Preferences live in `store.js` (`initPrefs`/`setPref`); keys in localStorage:
  input drawer open/closed, glyphs toggle (`trigon.glyphs.v1`), angle mode
  (`trigon.angle-mode.v1`), station times (`trigon.station-time.v1`),
  dignity toggles, sky options (`trigon.sky.v1`),
  aspect conditions (`trigon.aspconds.v1`), lots selection
  (`trigon.lots.selection.v1`).
- `logo.svg` — site logo.

**Subdirectories**
- `data/` — `cities.json` (gazetteer; built from repo-root `data/`).
- `source/` — `trigon-source.zip`, the AGPL Corresponding Source bundle
  (rebuilt by repo-root `build_source_zip.sh` before every `site/` push).
- `test/` — the node suite (`chart`, `dateapi`, `datetime`, `dignities`,
  `dom-patch`, `eclipse`, `ephe`, `format`, `listener-rule`, `location`,
  `lots`, `magstats`, `meta-as-data`, `patch-contracts`, `search`,
  `search-ui`, `section-registry`, `share`, `skip`, `sky-data`,
  `speed-stats`, `store`, `table`, `wasm-search`), plus jsdom
  integration tests (`ui-builders`, `ui-conditions`, `ui-meta`,
  `ui-sky`, `bazi-dom`) that render builder output into a document
  and query by accessible name and visible text, not by string
  matching, plus `test/data/` (`.se1` fixtures) and `bce-mobile.png`
  (reference screenshot regenerated by `e2e/trigon_bce.py`).
- `vendor/` — third-party, untyped, excluded from type-checking:
  `three.module.min.js` (r170), `tz.min.js`.

## State-to-DOM sync protocol

One write path, two render modes, one guard module, one section
registry, one listener rule. Everything else is a consequence.

- **Single write path (`store.js`).** Chart session state lives in one
  object, `S` (last computation, inputs, outer wheels, engine handle,
  syzygy longitude). All writes go through `update(patch)`, which
  merges, records the keys that actually changed, and synchronously
  notifies subscribers of those keys. Rendering stays explicit: `run()`
  renders once at the end, never per write, so a half-written session
  is never rendered. Preferences (angle format/size, glyphs,
  station-time mode, lot options, catalog selection, decan method) are
  exported live bindings, loaded once by `initPrefs(storage)` and
  written only by `setPref()`, which writes the binding and persists it
  together.
- **Two render modes.** Full: `renderResults` replaces panel HTML
  wholesale from the builders. Patch: `updateLiveResults` updates table
  cells in place on clock ticks — tab-visibility gated (never patch
  hidden tabs), change-guarded, the speed cell patched part by part so
  the percentile dot survives, the chart SVG swapped only when its
  markup changed, lots/catalog sections swapped only when their HTML
  changed, the lordship section rebuilt only on a sect flip, extras
  re-run throttled to ~0.02 day drift plus the `extrasToken` staleness
  guard. The full path keeps its `runToken` supersede guards, the
  `patchReuse` path for skip steps, and loader arming (loader only on
  uncached downloads, never on quiet live ticks).
- **Guard helpers (`dom-patch.js`).** `setText`, `setHTML`, and
  `createSwapGuard` are the only change-guards. Per-element caches live
  in a `WeakMap` inside `setHTML`; one-string guards cover `outerHTML`
  swaps, which destroy the element and cannot cache on it. Call sites
  never invent a cache.
- **Section registry (`tableSections` in `app.js`).** One entry per
  derived table section — lots, catalog, lords, syzygy — with its DOM
  anchor, the session keys it depends on, its builder, and its swap
  mode. Targeted rebuilds go through `refreshSection(s)`; the syzygy
  subscription refreshes exactly the sections declaring the changed
  key, so the extras scan never calls a section refresh imperatively.
  Preference-driven refreshes call the registry explicitly, because
  preferences are not store keys. The catalog browser DOM is
  deliberately not a section: rebuilding it would lose scroll and
  focus. The live tick does not go through the registry — its guards
  stay exact.
- **Listener rule.** Listeners attach exactly once at init; rebuilt DOM
  is wired by delegation on a static ancestor, static DOM directly.
  Render functions never attach listeners (ratchet-tested in
  `test/listener-rule.test.js`). Exception: the datepicker popup wires
  its buttons per render — it is destroyed on close, so nothing
  accumulates, and its many button kinds deserve their own pass.
- **Derived, not stored.** The meta line is data, not markup: `S`
  holds the stamp text (`metaStamp`); `buildMetaHTML()` renders it in
  `renderResults` from the stamp, the chart input, and the engine. The
  tick patches only the visible `#meta-stamp` span; no markup is ever
  patched by regex. The same rule covers every derived value: compute
  it in render, never cache it by hand at a call site.
- **Factory state stays in its factory.** Search tabs, outer wheels,
  chart style, datetime groups, location, clock, animation, and loader
  each own their state and expose a read/write API; `app.js` composes
  them through callbacks.
- **Sky boundary.** `sky.js` keeps its own render loop and reads the
  session only through the `getEphemeris` callback; it writes nothing
  to the store. The sync protocol stops at that boundary by design:
  a 60 fps 3D loop is not a section refresh.

## Conventions

- **Type-checking rolls out incrementally.** `jsconfig.json` (`tsc --noEmit
  --checkJs`, `allowJs`) lists only JSDoc-complete files in `include`
  (currently `sky-data.js`, `lots.js`, `dignities.js`, `dom-patch.js`,
  `store.js`, `bazi.js`); `vendor/` and `swe.js` are excluded. To adopt a file: annotate until tsc reports zero
  errors with it added, then add it to `include`. Run via repo-root
  `./test.sh`.
- **The live patcher patches, never rebuilds.** On clock ticks, cells are
  updated in place (`setSpeedCell` etc., guards in `dom-patch.js`). Never `textContent` a cell that
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
