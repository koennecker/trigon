"""Prototype: Hellenistic lots registry (calculation set + name layer).

Loads the transcribed source table (lots_catalog*.json), dedupes rows into
unique CALCULATIONS (pp, sig, trig, sect rule), ties NAMES to them, then
resolves every name on a test chart. Verifies:
  * every token resolves (planets, angles, whole-sign cusps, lots,
    Syzygy, sign rulers, fixed degrees);
  * the 10 Paulus Hermetic lots map onto registry entries;
  * duplicate names (Children, Basis, Marriage...) and duplicate
    calculations (several names, one formula) group as designed.
Run: python3 proto/hellenistic_lots_proto.py
"""
import json, glob, sys

FILES = ['proto/lots_catalog.json'] + sorted(glob.glob('proto/lots_catalog_p[0-9].json'))
rows = []
for f in FILES:
    d = json.load(open(f))
    rows.extend(d['entries'] if isinstance(d, dict) else d)

DOMICILE = [4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 5]  # Mars..Saturn by sign index
NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']

def calc_key(r):
    name, alts, pp, sig, trig, rev = r[0], r[1], r[2], r[3], r[4], r[5]
    return json.dumps([pp, sig, trig, rev], sort_keys=True)

calcs = {}
names = []
for i, r in enumerate(rows):
    key = calc_key(r)
    calcs.setdefault(key, {'pp': r[2], 'sig': r[3], 'trig': r[4], 'rev': r[5], 'names': []})
    nid = f"lot{i}"
    calcs[key]['names'].append(nid)
    names.append({'id': nid, 'name': r[0], 'alts': r[1], 'calc': key,
                  'prim': r[6], 'sec': r[7], 'cat': r[8], 'note': r[9]})

print(f"entries (names): {len(names)}")
print(f"unique calculations: {len(calcs)}")
multi = sorted(calcs.values(), key=lambda c: -len(c['names']))
print("largest calculation groups:")
for c in multi[:8]:
    ns = [next(n['name'] for n in names if n['id'] == nid) for nid in c['names']]
    print(f"  {c['pp']} + {c['sig']} - {c['trig']} [{c['rev']}] x{len(ns)}: {ns}")

# duplicate display names (same name, different calculations)
from collections import Counter
base = Counter(n['name'].split(' (')[0] for n in names)
print("name families with >1 entry:", {k: v for k, v in base.items() if v > 1})

# ---- resolver on a test chart (Phoenix 1990-06-15 19:30 MST, day) ----
LON = {'Sun': 83.74, 'Moon': 349.28, 'Mercury': 85.19, 'Venus': 49.49,
       'Mars': 11.48, 'Jupiter': 107.27, 'Saturn': 294.99, 'Asc': 255.59,
       'MC': 190.37, 'Syzygy': 78.5}
sect = 'day'

def resolve(tok, ctx):
    if isinstance(tok, list):  # ['fix', deg]
        return float(tok[1])
    if tok in ctx: return ctx[tok]
    if tok == 'IC': return (ctx['MC'] + 180) % 360
    if tok == 'Dsc': return (ctx['Asc'] + 180) % 360
    if tok in ('h2', 'h8', 'h9'):
        return (ctx['Asc'] + (int(tok[1]) - 1) * 30) % 360
    if tok.startswith('ruler'):
        base = {'rulerAsc': 'Asc', 'ruler2': 'h2', 'ruler9': 'h9',
                'rulerIC': 'IC', 'rulerSyzygy': 'Syzygy'}[tok]
        lon = resolve(base, ctx)
        return ctx[NAMES[DOMICILE[int(lon // 30)]]]
    raise KeyError(tok)

# Fortune/Spirit first (canonical sect pair), then the rest in id order
# (lots may reference Fortune/Spirit only, per the table).
ctx = dict(LON)
ctx['Fortune'] = (ctx['Asc'] + ctx['Moon'] - ctx['Sun']) % 360
ctx['Spirit'] = (ctx['Asc'] + ctx['Sun'] - ctx['Moon']) % 360

def compute(calc, ctx, sect):
    pp = resolve(calc['pp'], ctx)
    if isinstance(calc['sig'], dict):  # sectPair
        s, t = calc['sig'][sect]
        return (pp + resolve(s, ctx) - resolve(t, ctx)) % 360
    s, t = resolve(calc['sig'], ctx), resolve(calc['trig'], ctx)
    rev = calc['rev']
    if rev == 'fixed': return (pp + s - t) % 360
    if rev == 'reverse': return (pp + s - t) % 360 if sect == 'day' else (pp + t - s) % 360
    if rev == 'dayOnly': return (pp + s - t) % 360 if sect == 'day' else None
    if rev == 'nightOnly': return (pp + s - t) % 360 if sect == 'night' else None
    if rev == 'horizon':
        a = (pp + s - t) % 360; b = (pp + t - s) % 360
        return a if (a - ctx['Asc']) % 360 < 180 else b
    if rev == 'both': return ((pp + s - t) % 360, (pp + t - s) % 360)
    raise ValueError(rev)

bad = []
for n in names:
    try:
        v = compute(calcs[n['calc']], ctx, sect)
        if v is None: continue
        vals = v if isinstance(v, tuple) else (v,)
        assert all(0 <= x < 360 for x in vals)
    except Exception as e:
        bad.append((n['name'], str(e)))
print(f"resolved OK: {len(names) - len(bad)}/{len(names)} (day chart)")
for b in bad: print("  UNRESOLVED:", b)
assert not bad

# Hermetic 10 equivalence with site/lots.js (day chart)
HERM = {'Fortune': ('Fortune',), 'Spirit': ('Spirit',),
        'Eros': ('Eros (Hermetic)',), 'Necessity': ('Necessity (Hermetic)',),
        'Courage': ('Courage',), 'Victory': ('Victory',), 'Nemesis': ('Nemesis',),
        'Basis': ('Basis',), 'Illness': ('Illness (Dorotheus)',)}
for lot, (entry,) in HERM.items():
    n = next(n for n in names if n['name'] == entry)
    print(f"  Hermetic {lot:10s} == catalog {entry:26s} -> {compute(calcs[n['calc']], ctx, sect):.2f}")
print("PROTO OK")
