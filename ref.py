#!/usr/bin/env python3
"""Reference values from pyswisseph (same C library v2.10.03, same .se1 files).
Used to cross-check the WebAssembly build bit-for-bit.

Environment:
  TRIGON_EPHE_DIR  Swiss .se1 directory (default: <repo>/ephe)
Output is written to <repo>/ref.json.
"""
import json
import os
import swisseph as swe

REPO = os.path.dirname(os.path.abspath(__file__))
EPHE_DIR = os.environ.get("TRIGON_EPHE_DIR", os.path.join(REPO, "ephe"))

swe.set_ephe_path(EPHE_DIR)

BODIES = [swe.SUN, swe.MOON, swe.MERCURY, swe.VENUS, swe.MARS,
          swe.JUPITER, swe.SATURN, swe.URANUS, swe.NEPTUNE, swe.PLUTO,
          swe.TRUE_NODE, swe.MEAN_NODE]

CASES = [
    # (year, month, day, hour_ut, lat, lon, gregorian)
    (2026, 9, 26, 9 + 51/60, 33.4486, -112.0740, True),   # now-ish, Phoenix
    (2000, 1, 1, 12.0, 51.5, 0.0, True),                  # J2000, Greenwich
    (1500, 6, 1, 12.0, 41.9, 12.5, False),                # needs _12 files, Rome (Julian cal.)
    (-500, 3, 15, 12.0, 37.98, 23.73, False),             # needs seplm06/semom06, Athens
]

out = []
for (y, mo, d, h, lat, lon, greg) in CASES:
    tjd = swe.julday(y, mo, d, h, swe.GREG_CAL if greg else swe.JUL_CAL)
    rec = {'date': [y, mo, d, h], 'lat': lat, 'lon': lon, 'tjd': tjd, 'bodies': []}
    for ipl in BODIES:
        xx, _ = swe.calc_ut(tjd, ipl, swe.FLG_SWIEPH | swe.FLG_SPEED)
        xe, _ = swe.calc_ut(tjd, ipl, swe.FLG_SWIEPH | swe.FLG_SPEED | swe.FLG_EQUATORIAL)
        if ipl not in (swe.TRUE_NODE, swe.MEAN_NODE):
            attr = swe.pheno_ut(tjd, ipl, swe.FLG_SWIEPH)
            mag = attr[4]
        else:
            mag = None
        rec['bodies'].append({
            'lon': xx[0], 'lat': xx[1], 'dist': xx[2], 'speed': xx[3],
            'decl': xe[1], 'mag': mag,
        })
    cusps, ascmc = swe.houses_ex(tjd, lat, lon, b'W', swe.FLG_SWIEPH | swe.FLG_SPEED)
    rec['asc'] = ascmc[0]
    rec['mc'] = ascmc[1]
    asc_sign = int(ascmc[0] / 30)
    rec['houses'] = [((int(rec['bodies'][i]['lon'] / 30) - asc_sign) % 12) + 1 for i in range(10)]
    out.append(rec)

with open(os.path.join(REPO, 'ref.json'), 'w') as f:
    json.dump(out, f)
print('wrote ref.json with', len(out), 'cases')
for r in out:
    b = r['bodies'][0]
    print(r['date'], 'Sun lon=%.6f speed=%.6f mag=%.4f' % (b['lon'], b['speed'], b['mag']),
          'ASC=%.4f MC=%.4f' % (r['asc'], r['mc']))
