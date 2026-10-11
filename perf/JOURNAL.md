# Trigon Performance Journal

Recorded by `perf/perf_run.py` (Playwright + CDP `Performance.getMetrics`
+ `SystemInfo.getProcessInfo`, per-process CPU/RSS from `/proc`), run
against the per-deployment URL after each deploy. Raw per-second series:
`perf/runs/<stamp>-<label>-<scenario>.csv`.

Scenarios (all start from a calculated Phoenix chart):
- **table-clock** — Table tab, live clock (1 s ticks) running.
- **sky-clock** — Sky (observer) open, live clock running.
- **sky-static** — Sky open, no clock (the on-demand-rendering floor).
- **sky-drag** — Sky open, continuous circular drag (render stress).
- **aspect-wide** — Aspects: all bodies × all aspects, 1600–2400 (the Moon
  forces the 5-day grid; samples until the search completes).
- **ingress-long** — Ingresses: all bodies, 1600–2400, until complete.
- **stations-century** — Stations/retrograde periods, Mercury–Pluto,
  1900–2100, until complete.
- **retro-animate** — Retrograde: Mercury–Pluto periods in 2025, then the
  first period's ▶ animate (Sky sphere view, comet trail, ingress→egress
  playback), fixed window while it plays.

For until-complete scenarios the "Action s" column is the wall-clock
duration of the search itself; CPU columns are per-second means over the
run. Large action times with low task % mean the loop is pacing-bound
(timer yields), not compute-bound.

Columns: main-thread busy % (TaskDuration deltas), Chrome process CPU %
split renderer / GPU-process / total (single-core equivalents; 100% =
one full core), JS heap, total Chrome RSS, layouts per second, console
errors during sampling. GPU figure is the GPU *process* CPU — headless
environments expose no true GPU-utilization counter.

| Stamp | Label | Scenario | Task % | Renderer CPU % | GPU CPU % | Chrome CPU % | Heap MB | RSS MB | Layouts/s | Errors | Action s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261003-121954 | 38be57ec | table-clock | 1.8 | 3.1 | 1.1 | 4.4 | 4.7 | 944 | 1.0 | 0 | — | |
| 20261003-121954 | 38be57ec | sky-clock | 3.9 | 3.1 | 4.0 | 7.2 | 7.7 | 1072 | 1.0 | 0 | — | |
| 20261003-121954 | 38be57ec | sky-static | 0.9 | 1.8 | 0.7 | 2.7 | 9.0 | 1069 | 0.0 | 0 | — | |
| 20261003-123426 | 38be57ec | aspect-wide | 60.8 | 56.7 | 1.5 | 58.8 | 130.4 | 764 | 47.2 | 0 | 508.6 |
| 20261003-124334 | 38be57ec | ingress-long | 19.2 | 23.8 | 2.2 | 26.9 | 88.6 | 893 | 98.8 | 0 | 192.8 |
| 20261003-124334 | 38be57ec | stations-century | 36.3 | 39.5 | 2.0 | 42.2 | 9.6 | 752 | 48.2 | 0 | 11.1 |
| 20261003-124334 | 38be57ec | sky-drag | 18.8 | 6.8 | 26.4 | 35.1 | 8.5 | 901 | 0.8 | 0 | 20.0 |
| 20261003-133342 | f2d76e40 | table-clock | 1.8 | 3.0 | 1.1 | 4.2 | 4.7 | 945 | 1.0 | 0 | 20.0 |
| 20261003-133342 | f2d76e40 | sky-clock | 3.5 | 3.0 | 3.8 | 7.0 | 8.2 | 1082 | 1.0 | 0 | 20.0 |
| 20261003-133342 | f2d76e40 | sky-static | 0.8 | 2.1 | 0.7 | 3.0 | 9.4 | 1082 | 0.0 | 0 | 20.0 |
| 20261003-133504 | f2d76e40 | aspect-wide | 1.1 | 142.7 | 0.4 | 143.3 | 109.5 | 1133 | 0.5 | 0 | 331.3 |
| 20261003-133504 | f2d76e40 | ingress-long | 29.5 | 118.3 | 0.7 | 119.4 | 87.2 | 1066 | 4.6 | 0 | 117.9 |
| 20261003-133504 | f2d76e40 | stations-century | 69.9 | 97.8 | 1.4 | 99.7 | 10.1 | 1042 | 18.5 | 0 | 8.5 |
| 20261003-133504 | f2d76e40 | sky-drag | 19.0 | 6.9 | 26.9 | 35.6 | 8.5 | 1022 | 0.7 | 0 | 20.0 |
| 20261003-140923 | 72f05229 | table-clock | 2.0 | 3.2 | 1.2 | 4.6 | 4.7 | 947 | 1.0 | 0 | 20.0 |
| 20261003-140923 | 72f05229 | sky-clock | 4.4 | 3.0 | 4.0 | 7.2 | 8.3 | 1085 | 1.0 | 0 | 20.0 |
| 20261003-140923 | 72f05229 | sky-static | 1.0 | 2.0 | 0.8 | 3.0 | 9.9 | 1088 | 0.0 | 0 | 20.0 |
| 20261003-141046 | 72f05229 | retro-animate | 101.1 | 17.9 | 91.5 | 110.3 | 19.5 | 1370 | 4.3 | 0 | 20.4 |
| 20261003-141046 | 72f05229 | aspect-wide | 19.4 | 98.9 | 0.8 | 99.9 | 95.5 | 871 | 0.4 | 0 | 485.1 |
| 20261003-141046 | 72f05229 | ingress-long | 29.6 | 115.5 | 0.7 | 116.6 | 93.4 | 871 | 4.3 | 0 | 79.3 |
| 20261003-141046 | 72f05229 | stations-century | 72.0 | 97.1 | 0.9 | 98.6 | 14.1 | 866 | 18.2 | 0 | 8.1 |
| 20261003-141046 | 72f05229 | sky-drag | 34.2 | 8.3 | 51.3 | 61.3 | 8.4 | 940 | 1.6 | 0 | 20.3 |
| 20261003-150601 | 63c4ab8e | table-clock | 1.7 | 3.0 | 1.1 | 4.3 | 5.1 | 946 | 1.0 | 0 | 20.0 |
| 20261003-150601 | 63c4ab8e | sky-clock | 2.9 | 2.8 | 3.0 | 6.0 | 7.8 | 1078 | 1.0 | 0 | 20.0 |
| 20261003-150601 | 63c4ab8e | sky-static | 0.9 | 1.8 | 0.7 | 2.8 | 7.4 | 1070 | 0.0 | 0 | 20.0 |
| 20261003-151343 | 63c4ab8e | sky-drag | 19.2 | 7.2 | 26.8 | 35.8 | 9.0 | 931 | 0.9 | 0 | 20.0 |
| 20261003-151343 | 63c4ab8e | retro-animate | 101.6 | 21.6 | 85.2 | 107.9 | 14.8 | 1290 | 5.0 | 0 | 20.3 |
| 20261003-151343 | 63c4ab8e | stations-century | 67.9 | 95.5 | 1.4 | 97.6 | 13.0 | 857 | 18.2 | 0 | 8.9 |
| 20261003-151510 | 63c4ab8e | ingress-long | 34.4 | 88.6 | 0.7 | 89.8 | 94.2 | 1006 | 4.1 | 0 | 64.3 |
| 20261003-152342 | 63c4ab8e | aspect-wide | 3.2 | 96.9 | 0.6 | 97.8 | 48.8 | 604 | 0.4 | 0 | 300.1 |
| 20261003-154153 | b1b3704b | table-clock | 1.8 | 3.0 | 1.1 | 4.4 | 5.1 | 942 | 1.0 | 0 | 20.0 |
| 20261003-154153 | b1b3704b | sky-clock | 3.3 | 3.0 | 3.3 | 6.4 | 7.7 | 1073 | 1.0 | 0 | 20.0 |
| 20261003-154153 | b1b3704b | sky-static | 1.0 | 1.9 | 0.8 | 3.0 | 7.6 | 1003 | 0.0 | 0 | 20.0 |
| 20261003-154316 | b1b3704b | sky-drag | 18.4 | 7.2 | 26.5 | 35.5 | 8.3 | 1079 | 0.8 | 0 | 20.0 |
| 20261003-154316 | b1b3704b | retro-animate | 101.0 | 22.3 | 95.3 | 118.6 | 19.2 | 1605 | 5.6 | 0 | 20.1 |
| 20261003-154316 | b1b3704b | stations-century | 66.9 | 93.2 | 1.1 | 95.0 | 14.1 | 1070 | 20.5 | 0 | 8.6 |
| 20261003-154316 | b1b3704b | ingress-long | 29.0 | 114.9 | 0.6 | 116.0 | 87.3 | 1104 | 4.5 | 0 | 119.2 |
| 20261003-154935 | b1b3704b | aspect-wide | 2.1 | 98.7 | 0.6 | 99.6 | 48.8 | 617 | 0.5 | 0 | 300.1 |
| 20261008-103325 | d94a15c2 | table-clock | 2.3 | 3.7 | 1.5 | 5.5 | 4.6 | 944 | 1.0 | 0 | 20.0 |
| 20261008-103325 | d94a15c2 | sky-clock | 3.4 | 3.7 | 3.7 | 7.7 | 7.7 | 1075 | 1.0 | 0 | 20.0 |
| 20261008-103325 | d94a15c2 | sky-static | 1.3 | 3.0 | 1.1 | 4.3 | 7.5 | 1074 | 0.0 | 0 | 20.0 |
| 20261008-104441 | 188b374b | table-clock | 2.3 | 4.0 | 1.6 | 5.9 | 4.6 | 946 | 1.0 | 0 | 20.0 |
| 20261008-104441 | 188b374b | sky-clock | 3.4 | 4.4 | 3.8 | 8.4 | 7.6 | 1086 | 1.0 | 0 | 20.0 |
| 20261008-104441 | 188b374b | sky-static | 1.2 | 2.7 | 1.1 | 4.1 | 7.4 | 1082 | 0.0 | 0 | 20.0 |
| 20261008-104610 | 188b374b | sky-drag | 20.3 | 7.9 | 29.6 | 39.9 | 10.2 | 1082 | 0.8 | 0 | 20.1 |
| 20261008-104610 | 188b374b | retro-animate | 99.5 | 23.7 | 86.3 | 111.4 | 17.7 | 1515 | 4.7 | 0 | 20.3 |
| 20261008-104610 | 188b374b | stations-century | 87.0 | 96.4 | 1.6 | 98.7 | 13.5 | 888 | 20.8 | 0 | 4.5 |
| 20261008-104610 | 188b374b | ingress-long | 28.2 | 114.5 | 1.0 | 116.0 | 97.1 | 954 | 3.6 | 0 | 151.5 |
| 20261008-104610 | 188b374b | aspect-wide | 1.9 | 128.2 | 0.8 | 129.4 | 4.0 | 889 | 0.6 | 0 | 300.2 |
| 20261008-105521 | 3d8d81f5 | table-clock | 2.0 | 3.8 | 1.6 | 5.5 | 4.7 | 945 | 1.0 | 0 | 20.0 |
| 20261008-105521 | 3d8d81f5 | sky-clock | 3.3 | 4.2 | 3.8 | 8.2 | 7.6 | 1087 | 1.0 | 0 | 20.0 |
| 20261008-105521 | 3d8d81f5 | sky-static | 1.5 | 3.0 | 1.2 | 4.4 | 7.8 | 1084 | 0.0 | 0 | 20.0 |
| 20261008-105649 | 3d8d81f5 | sky-drag | 24.1 | 8.1 | 29.4 | 40.0 | 7.7 | 1085 | 0.5 | 0 | 20.4 |
| 20261008-105649 | 3d8d81f5 | retro-animate | 101.1 | 24.3 | 86.8 | 112.2 | 21.2 | 1566 | 4.7 | 0 | 20.3 |
| 20261008-105649 | 3d8d81f5 | stations-century | 77.8 | 96.2 | 1.6 | 99.2 | 12.9 | 990 | 18.4 | 0 | 10.3 |
| 20261008-105649 | 3d8d81f5 | ingress-long | 28.4 | 116.7 | 1.0 | 118.2 | 86.7 | 1003 | 3.5 | 0 | 98.7 |
| 20261008-105649 | 3d8d81f5 | aspect-wide | 2.1 | 141.4 | 0.8 | 142.5 | 4.1 | 1000 | 0.6 | 0 | 300.1 |
| 20261010-163420 | f74b738b | table-clock | 1.9 | 3.0 | 1.0 | 4.2 | 4.7 | 941 | 1.0 | 0 | 20.0 |
| 20261010-163420 | f74b738b | sky-clock | 4.0 | 3.3 | 3.2 | 6.8 | 7.7 | 1044 | 1.0 | 0 | 20.0 |
| 20261010-163420 | f74b738b | sky-static | 0.9 | 1.9 | 0.7 | 2.8 | 7.4 | 969 | 0.0 | 0 | 20.0 |
