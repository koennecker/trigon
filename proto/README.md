# proto/ — prototypes and verification scripts

The working rule of this directory: **sanity-check all math in Python and
build a proof of concept first, then transfer to JavaScript.** Every
non-trivial algorithm in `site/` was verified here before it was ported;
the prototypes are kept as the historical record of *why* the transferred
code does what it does.

Two flavors:

- **`*.py`** — pure-math verification, no WebAssembly needed (lots,
  dignities, aspect conditions, label declutter).
- **`*.mjs`** — node scripts that use the real `site/swe.wasm` (Moshier
  fallback engine, so no `.se1` files needed) or import `site/` modules
  directly. Run these from `site/` — they use `../site/...` relative
  imports:
  ```bash
  cd site && node ../proto/sample_speeds.mjs
  ```

## Conventions

- Prototypes are **read-only history**: fix bugs in `site/`, not here. If a
  prototype disagrees with the transferred code, the prototype documents the
  original reasoning — update the code, then note the divergence.
- When a prototype's output feeds `site/` (the `*.json` samples, the lots
  catalog), the generator script is the documented path — never hand-edit
  the generated file.

## Search engines

- `ingress_search_proto.py` — sign-ingress search. Algorithm under test:
  per-body scan step derived from motion bounds (keeps movement under
  ~15°/step), longitude unwrapped sample-to-sample, `floor(U/30)` changes
  bracket sign boundaries, direction (including retrograde re-entries) from
  the speed sign at the root, safeguarded secant falling back to bisection.
  Transferred to `site/search.js` (`ingressRoots`).
- `retro_shadow_proto.mjs` — extended retrograde periods (the *shadow span*,
  not station-to-station). Two-rule bounds: Mercury/Venus/Mars use the
  **sign span** (first ingress into the loop's first sign → last egress from
  its last sign); Jupiter and beyond use the **degree span** (first crossing
  of the direct-station degree → last crossing of the retrograde-station
  degree — the sign rule degenerates for slow planets). Verified against
  known periods using the real `swe.wasm`. Transferred to `site/search.js`
  (`shadowBounds`, `boundaryCrossingBefore`/`boundaryCrossingAfter`).
- `aspect_conditions_proto.py` — conditional aspect modifiers with
  AND-of-OR group semantics: every group must hold, and within a group any
  subcondition suffices (e.g. "co-present with B OR sign-based opposition to
  B"). Covers sign/ruler/element/quadruplicity/co-presence conditions, extra
  aspects by orb or whole-sign, direct/retrograde, speed percentiles, and
  heliacal phase by signed solar elongation. Transferred to `site/search.js`
  (`evaluateConditions`, `validateConditions`, `normalizeConditionGroups`).
- `adaptive_step.mjs` — compared three grid-step schemes for aspect search:
  (A) fixed 5-day validated baseline, (B) 45°/max-pair-relative-speed,
  (C) naive d/|v_rel| per pair. (B) won and became `aspectGridStep` in
  `site/search.js` (clamped [5,120] days; Moon-involved pairs stay at 5d).
- `count_events.mjs` — counted aspect brackets + station brackets over a
  century on a 1-day shared grid (Moon pairs need ≤ ~1.4d for the 45° bound);
  sizing evidence for the search windows.

## Lots

- `lots_modifiers_proto.py` — the four opt-in tradition variants, each
  verified against primary sources: the Valens moonset proviso (night
  + Moon set → Fortune uses the day formula), Ptolemy never-reversed
  Fortune, Valens shortest-arc Basis, Valens/Dorotheus Eros & Necessity from
  Fortune/Spirit. Transferred to `site/lots.js`.
- `hellenistic_lots_proto.py` — the Hellenistic lots registry: dedupes the
  transcribed source rows into 86 *calculations* (personal point +
  significator − trigger + sect rule), then layers 181 *names* on top.
  Transferred via `gen_lots_catalog.py` → `site/lots-catalog.js`.
- `lots_catalog.json`, `lots_catalog_p2.json`, `lots_catalog_p3.json`,
  `lots_catalog_p4.json` — the transcribed source table. This is
  the **single source of truth** for the catalog. Do not edit the generated
  `site/lots-catalog.js` by hand; edit these and re-run:
  ```bash
  python3 proto/gen_lots_catalog.py   # regenerates site/lots-catalog.js
  ```
- `gen_lots_catalog.py` — the generator: reads the four JSON parts,
  emits `site/lots-catalog.js`.
- `dump_positions.mjs` — one-off: dumped chart positions (Moshier) for the
  Hermetic-lots proof of concept. Run from `site/`.
- `dump_scan.mjs` — one-off: hourly position dumps around 1990-06-15
  (Phoenix) so the modifier prototype could pick night charts with the Moon
  up and down. Run from `site/`.

## Dignities and long-term statistics

- `dignities_proto.py` — table dignities for the 7 classical planets: decan
  lords in both the Chaldean modulo order (Mars repeating across the
  Pisces→Aries wrap) and the Indian drekkana sequence, Egyptian bounds,
  Dorothean triplicities by sect, exaltation lords, D12/D9
  sub-lords (D9 via arcminutes — float division undershoots exact 3°20′
  boundaries). Transferred to `site/dignities.js`.
- `sample_speeds.mjs` → `speed_samples.json` — |speed| (deg/day) for bodies
  0–9 (Sun..Pluto), 1800-01-01..2300-12-31 in 10-day steps via the real
  `swe.wasm` (`_search_compute`, Moshier — 18,299 epochs). Distilled to
  `site/speed-stats.js` (mean/std + 101 quantiles per body), which drives
  the red→yellow→green speed percentile dot in the positions table.
- `sample_magnitudes.mjs` → `mag_samples.json` — apparent magnitudes over
  the same 1800–2300 frame via `_chart_compute` (magnitude is output slot
  6i+5). Distilled to `site/mag-stats.js`, which drives the magnitude glow
  (text-shadow ∝ brightness percentile above the body's own median).

## Chart label declutter

- `pava.py` — PAVA-based circular label declutter for the chart wheel
  (radial longitude offsets). Formalizes the queued-offset
  intuition: treat overlapping labels as a circular isotonic-regression
  problem and solve with the Pool Adjacent Violators Algorithm.
- `test_pava.py` — exercises the declutter on realistic cases, visualizes,
  and compares against the forward-only baseline.

## One-offs

- `occult_jupiter_20261006.mjs` — verified the 2026-10-06 Moon-occults-Jupiter
  event for Phoenix (cross-checked the article's Eastern/Mountain times via
  New York), scanned for the next North-America-visible lunar occultation of
  Jupiter, and checked Draconids/new-Moon context for Oct 8–9.
