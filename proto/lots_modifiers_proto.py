#!/usr/bin/env python3
"""Prototype the conditional lot modifiers (from the primary-source
verification, 2026-10-02):
  - Valens Moon-set proviso (Anthology III.11.4): at night, Fortune is
    reversed only while the Moon is above the horizon; after moonset the
    day formula applies. Fortune only; day charts unconditional.
  - Ptolemy (Tetrabiblos III.10): Fortune never reversed.
  - Valens Basis (Anthology II): shortest arc Fortune<->Spirit from Asc.
  - Valens/Dorotheus Eros & Necessity (Anthology IV.25): arcs taken from
    Fortune/Spirit instead of Venus/Mercury.
Picks test charts from real WASM positions (proto/dump_scan.mjs), checks
the proviso's fire/no-fire branches and the Basis below-horizon
invariant, and prints the values the JS tests must reproduce."""
import json, math, subprocess

raw = subprocess.run(['node', '../proto/dump_scan.mjs'],
                     capture_output=True, text=True, cwd='../site').stdout
recs = json.loads(raw)

def altitude(lonlat, utcMs, lat, lonEast):
    jd = utcMs / 86400000.0 + 2440587.5
    T = (jd - 2451545.0) / 36525.0
    eps = 23.4392911 - (46.8150 * T + 0.00059 * T**2 - 0.001813 * T**3) / 3600.0
    lon, blat = (math.radians(x) for x in lonlat)
    e = math.radians(eps)
    ra = math.degrees(math.atan2(math.cos(e) * math.sin(lon) - math.sin(e) * math.tan(blat),
                                 math.cos(lon))) % 360
    dec = math.degrees(math.asin(math.sin(blat) * math.cos(e) +
                                 math.cos(blat) * math.sin(e) * math.sin(lon)))
    gmst = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360
    H = math.radians((gmst + lonEast - ra + 540) % 360 - 180)
    phi, d = math.radians(lat), math.radians(dec)
    return math.degrees(math.asin(math.sin(phi) * math.sin(d) +
                                  math.cos(phi) * math.cos(d) * math.cos(H)))

for r in recs:
    r['sunAlt'] = altitude(r['sun'], r['utcMs'], r['lat'], r['lon'])
    r['moonAlt'] = altitude(r['moon'], r['utcMs'], r['lat'], r['lon'])

night_down = next(r for r in recs if r['sunAlt'] < -10 and r['moonAlt'] < -5)
night_up = next(r for r in recs if r['sunAlt'] < -10 and r['moonAlt'] > 10)
day = next(r for r in recs if r['sunAlt'] > 30)
for tag, r in [('day', day), ('night Moon up', night_up), ('night Moon down', night_down)]:
    from datetime import datetime, timezone
    print(f"{tag:17s} {datetime.fromtimestamp(r['utcMs']/1000, timezone.utc)} "
          f"sunAlt {r['sunAlt']:+.2f} moonAlt {r['moonAlt']:+.2f}")

PAULUS = {
 'Fortune':   {'day': ('Asc','Moon','Sun'),       'night': ('Asc','Sun','Moon')},
 'Spirit':    {'day': ('Asc','Sun','Moon'),       'night': ('Asc','Moon','Sun')},
 'Exaltation':{'day': ('Asc',19.0,'Sun'),         'night': ('Asc',33.0,'Moon')},
 'Necessity': {'day': ('Asc','@Fortune','Mercury'), 'night': ('Asc','Mercury','@Fortune')},
 'Eros':      {'day': ('Asc','Venus','@Spirit'),  'night': ('Asc','@Spirit','Venus')},
 'Courage':   {'day': ('Asc','@Fortune','Mars'),  'night': ('Asc','Mars','@Fortune')},
 'Victory':   {'day': ('Asc','Jupiter','@Spirit'), 'night': ('Asc','@Spirit','Jupiter')},
 'Nemesis':   {'day': ('Asc','@Fortune','Saturn'), 'night': ('Asc','Saturn','@Fortune')},
 'Basis':     {'day': ('Asc','@Fortune','@Spirit'), 'night': ('Asc','@Spirit','@Fortune')},
 'Illness/Accusation': {'day': ('Asc','Mars','Saturn'), 'night': ('Asc','Saturn','Mars')},
}
VALENS_EROS_NEC = {
 'Eros':      {'day': ('Asc','@Fortune','@Spirit'), 'night': ('Asc','@Spirit','@Fortune')},
 'Necessity': {'day': ('Asc','@Spirit','@Fortune'), 'night': ('Asc','@Fortune','@Spirit')},
}
ORDER = list(PAULUS)

def compute(r, opts):
    sect = 'day' if r['sunAlt'] > 0 else 'night'
    lon_of = {'Asc': r['asc'], 'Sun': r['sun'][0], 'Moon': r['moon'][0],
              'Mercury': r['mercury'], 'Venus': r['venus'], 'Mars': r['mars'],
              'Jupiter': r['jupiter'], 'Saturn': r['saturn']}
    defs = {k: dict(v) for k, v in PAULUS.items()}
    if opts.get('valensErosNec'):
        defs.update(VALENS_EROS_NEC)
    # Fortune sect override: Ptolemy subsumes; Valens proviso next.
    fsect = sect
    if opts.get('ptolemyFortune'):
        fsect = 'day'
    elif opts.get('valensMoon') and sect == 'night' and r['moonAlt'] < 0:
        fsect = 'day'
    memo = {}
    def lot(name):
        if name not in memo:
            s = fsect if name == 'Fortune' else sect
            a, b, c = defs[name][s]
            val = lambda op: (lon_of[op] if isinstance(op, str) and not op.startswith('@')
                              else op if isinstance(op, float)
                              else lot(op[1:]))
            memo[name] = (val(a) + val(b) - val(c)) % 360
        return memo[name]
    out = {name: lot(name) for name in ORDER}
    if opts.get('valensBasis'):
        # The two projections Asc +/- arc(Fortune<->Spirit) are mirror
        # images across the Asc-Desc axis (they sum to 2*Asc), so exactly
        # one is below the horizon; Valens takes that one.
        p1 = (r['asc'] + out['Fortune'] - out['Spirit']) % 360
        p2 = (r['asc'] + out['Spirit'] - out['Fortune']) % 360
        p1_above = ((p1 - r['asc']) % 360) > 180
        out['Basis'] = p2 if p1_above else p1
    return out

print('\n== proviso branches (Fortune) ==')
for tag, r in [('night Moon up', night_up), ('night Moon down', night_down)]:
    base = compute(r, {})['Fortune']
    prov = compute(r, {'valensMoon': True})['Fortune']
    ptol = compute(r, {'ptolemyFortune': True})['Fortune']
    fired = abs(prov - base) > 1e-9
    print(f'{tag:17s} standard {base:9.4f}  proviso {prov:9.4f} (fires: {fired})  ptolemy {ptol:9.4f}')
    assert fired == (r['moonAlt'] < 0)
    assert abs(ptol - compute(r, {'valensMoon': True, 'ptolemyFortune': True})['Fortune']) < 1e-9

print('\n== Valens Basis below-horizon invariant (all 25 sampled instants) ==')
worst = -999.0
for r in recs:
    v = compute(r, {'valensBasis': True})
    alt = altitude((v['Basis'], 0.0), r['utcMs'], r['lat'], r['lon'])
    worst = max(worst, alt)
    assert alt <= 0.01, (r['utcMs'], alt)
print(f'worst (highest) Basis altitude across samples: {worst:+.2f} deg — invariant holds')

print('\n== values for JS tests ==')
for tag, r in [('night_down', night_down), ('night_up', night_up)]:
    print(f'-- {tag}: utcMs {r["utcMs"]} sunAlt {r["sunAlt"]:.4f} moonAlt {r["moonAlt"]:.4f}')
    for optname, opts in [('standard', {}), ('proviso', {'valensMoon': True}),
                          ('ptolemy', {'ptolemyFortune': True}),
                          ('valensBasis', {'valensBasis': True}),
                          ('valensErosNec', {'valensErosNec': True})]:
        vals = compute(r, opts)
        print(f'  {optname:14s} ' + '  '.join(f'{k}={vals[k]:.4f}' for k in
              ['Fortune', 'Spirit', 'Eros', 'Necessity', 'Basis']))
print('\nPROTO OK')
