# perf/ — performance measurement

Every deploy is followed by a performance run against the per-deployment
URL, recorded in `JOURNAL.md`. Regressions against the baselines below get
investigated before the release is considered finished. This directory holds the
sampler, the journal, and the raw per-second series behind every journal
row.

## perf_run.py

Drives the deployed app through functional scenarios with Playwright, polls
CDP `Performance.getMetrics` + `SystemInfo.getProcessInfo` once per second,
reads per-process CPU ticks and RSS from `/proc`, and writes a per-scenario
CSV plus a summary (optionally appended to `JOURNAL.md`).

Metrics sampled each second:

| Metric | Source | Meaning |
|---|---|---|
| task/script/layout/style % | CDP `Performance.getMetrics` deltas | main-thread busy fractions |
| layouts, style recalcs | CDP counts per second | layout pressure |
| heap MB | `JSHeapUsedSize` | JS heap |
| cpu per process type | `/proc` stat utime+stime deltas | browser / renderer / GPU / other, single-core equivalents (100% = one full core) |
| rss MB | summed resident set of the Chrome tree | total memory |
| raf/s | vsync callbacks observed in page | render work shows in the CPU columns, not here |
| errors | console/page errors during sampling | must be 0 |

The GPU figure is the GPU *process* CPU — headless environments expose no
true GPU-utilization counter. Exit code is always 0: this is a recorder,
not a gate; failures print loudly.

Usage:

```bash
python3 perf/perf_run.py \
    --url https://<deployment>.trigon.pages.dev \
    --label <label> \
    [--seconds 20] \
    [--scenarios table-clock,sky-clock,sky-static] \
    [--journal perf/JOURNAL.md]
```

`--cap` (default 300) bounds the until-complete scenarios. Always run
against the **per-deployment URL**, not the canonical
`https://trigon.pages.dev` — the canonical URL can lag the bundle.

## Scenarios

All start from a calculated Phoenix chart (1990-06-15, the standard
fixture).

| Scenario | What it stresses |
|---|---|
| `table-clock` | Table tab, live clock (1 s ticks) running |
| `sky-clock` | Sky (observer view) open, live clock running |
| `sky-static` | Sky open, no clock — the on-demand-rendering floor |
| `sky-drag` | Sky open, continuous circular drag — render stress |
| `aspect-wide` | Aspects: all bodies × all aspects, 1600–2400 (Moon forces the 5-day grid); samples until the search completes |
| `ingress-long` | Ingresses: all bodies, 1600–2400, until complete |
| `stations-century` | Stations + retrograde periods, Mercury–Pluto, 1900–2100, until complete |
| `retro-animate` | Mercury–Pluto periods in 2025, then the first period's ▶ animate (Sky sphere view, comet trail, ingress→egress playback), fixed window while it plays |

For until-complete scenarios the "Action s" column is the wall-clock
duration of the search itself; CPU columns are per-second means over the
run. Large action times with low task % mean the loop is pacing-bound
(timer yields), not compute-bound.

## JOURNAL.md

The append-only log. Columns: stamp, label, scenario, main-thread busy %
(TaskDuration deltas), renderer / GPU-process / total Chrome CPU %
(single-core equivalents), JS heap, total Chrome RSS, layouts/s, console
errors, action seconds (until-complete scenarios only).

**Baselines (2026-10-03)** — investigate any regression against these
before signing off on a deploy:

| Scenario | Baseline |
|---|---|
| table-clock | ~4.4% total Chrome CPU |
| sky-clock | ~7.2% |
| sky-static | ~2.7% |
| sky-drag | ~35% total Chrome CPU |
| aspect-wide | 331.3 s |
| ingress-long | 117.9 s |
| stations-century | 8.5 s |
| searches | below 5 layouts/s |

## runs/

Raw per-second CSV series, one per scenario run, named
`<stamp>-<label>-<scenario>.csv`. These are the evidence behind the
journal rows — keep them; they're small. The `*.png` files that
occasionally land here are unreferenced local screenshots (gitignored, not
tracked).

## Release workflow

1. Push `site/` changes (after `./build_source_zip.sh`).
2. Cloudflare auto-deploys; take the per-deployment URL.
3. Run `perf_run.py --url <deployment-url> --label <label> --journal
   perf/JOURNAL.md` (default scenario set, or the full set for
   search/sky changes).
4. Compare against the baselines above; investigate regressions.
5. Commit the journal + new CSVs.
