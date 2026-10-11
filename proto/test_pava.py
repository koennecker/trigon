"""Exercise the PAVA declutter on realistic cases; visualize; compare vs forward-only."""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pava import norm360, declutter, check, disp_stats, declutter_arc
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

R = 235.0  # label radius, px (matches chart.js)

# Measured via getBBox in headless Chrome (2021-02-11 chart):
#   planet labels 47-61px (avg ~55), angle labels 53-60px (avg ~56).
#
# The E2E overlap check insets 3px/side and flags intersection > 10% of the
# smaller box. For widths w1, w2 and center gap g (px), it flags iff
#   (w1+w2-12)/2 - g > 0.1 * (min(w1,w2)-6)
# i.e. requires g >= (w1+w2-12)/2 - 0.1*(min(w1,w2)-6).
# PAVA enforces exactly this threshold (in angular terms), so a PAVA-clean
# layout is guaranteed to pass the test, with no wasted space.
def need_px(w1, w2):
    return (w1 + w2 - 12) / 2 - 0.1 * (min(w1, w2) - 6)

def hw(px):
    """angular half-width (deg) s.t. hw(px1)+hw(px2) == need_px(px1,px2) in deg."""
    # need_px(w,w) = 0.9*(w-6); so hw(w) = 0.45*(w-6) px -> deg
    return (0.45 * (px - 6)) / R * 180 / math.pi


def mk(id_, angle, kind='planet'):
    px = {'planet': 55, 'angle': 56, 'node': 54}[kind]
    return {'id': id_, 'angle': norm360(angle), 'half_width': hw(px),
            'fixed': kind == 'angle'}


def case_ds_mercury():
    # user's complaint: Ds 206 deg, Mercury 217 deg (11 deg apart)
    pts = [mk('As', 26, 'angle'), mk('Ds', 206, 'angle'),
           mk('Mc', 319.6, 'angle'), mk('Ic', 139.6, 'angle'),
           mk('Me', 217.3), mk('Ve', 205.1), mk('Su', 184.2),
           mk('Mo', 96.5), mk('Ma', 301.4), mk('Ju', 262.8),
           mk('Sa', 274.9), mk('Ur', 24.7), mk('Ne', 332.9),
           mk('Pl', 235.5), mk('No', 77.7, 'node'), mk('So', 257.7, 'node')]
    return pts, "ds_mercury"


def case_stellium():
    # 2021-02-11 style: 6 planets within ~30 deg of Aquarius, Mc INSIDE
    # the cluster (as in the real E2E failure: Mercury 16 Aq, Mc 20 Aq).
    # Mc as a fixed anchor splits the cluster into feasible arcs.
    pts = [mk('As', 60, 'angle'), mk('Ds', 240, 'angle'),
           mk('Mc', 320, 'angle'), mk('Ic', 140, 'angle'),
           mk('Su', 322.9), mk('Mo', 305.4), mk('Me', 316.4),
           mk('Ve', 312.2), mk('Ju', 301.1), mk('Sa', 308.8),
           mk('Ma', 28.5), mk('Ur', 38.2), mk('Ne', 352.9),
           mk('Pl', 293.6), mk('No', 58.3, 'node'), mk('So', 238.3, 'node')]
    return pts, "stellium"


def case_pathological():
    # 7 planets crammed between two anchors 90 deg apart: physically
    # infeasible (needs ~99 deg of label span). Exercises the fallback:
    # must not crash, must preserve order; spill is logged, not asserted clean.
    pts = [mk('As', 60, 'angle'), mk('Ds', 240, 'angle'),
           mk('Mc', 150, 'angle'), mk('Ic', 330, 'angle')]
    for i, a in enumerate([293.6, 301.1, 305.4, 308.8, 312.2, 316.4, 322.9]):
        pts.append(mk(f'Q{i}', a))
    return pts, "pathological"


def forward_only(points):
    """Naive forward-push greedy (the unimproved 'queued offset'), for comparison."""
    pts = sorted([p for p in points if not p['fixed']], key=lambda p: p['angle'])
    fixed = sorted([p for p in points if p['fixed']], key=lambda p: p['angle'])
    # linearize each arc like declutter() does, then single forward pass
    out = {}
    allp = sorted(points, key=lambda p: p['angle'])
    n = len(allp)
    fidx = [i for i, p in enumerate(allp) if p['fixed']]
    for f in range(len(fidx)):
        A, B = allp[fidx[f]], allp[fidx[(f + 1) % len(fidx)]]
        mov, i = [], (fidx[f] + 1) % n
        while i != fidx[(f + 1) % len(fidx)]:
            mov.append(allp[i]); i = (i + 1) % n
        base = A['angle']
        lin = lambda a: base + norm360(a - base)
        xs = []
        prev = None
        lo = base + A['half_width']
        for m in mov:
            x = lin(m['angle'])
            x = max(x, lo + m['half_width'])
            if prev is not None:
                x = max(x, prev[0] + prev[1] + m['half_width'])
            xs.append(x); prev = (x, m['half_width'])
        for m, x in zip(mov, xs):
            out[m['id']] = norm360(x)
        out[A['id']] = norm360(A['angle'])
    return out


def draw(points, placed, title, path):
    fig = plt.figure(figsize=(9, 9))
    ax = fig.add_subplot(111, polar=True)
    ax.set_theta_zero_location('E')
    ax.set_theta_direction(1)
    # wheel circles
    for r in (100, 168, 262, 294):
        ax.plot(np.linspace(0, 2 * np.pi, 361), [r] * 361, color='#8b949e', lw=0.8)
    for p in points:
        t = math.radians(p['angle'])
        ax.plot([t, t], [262, 294], color='#484f58', lw=1)
        ax.plot(t, 294, 'o', color='#e6edf3', ms=3)  # true position tick
    for p in points:
        t0, t1 = math.radians(p['angle']), math.radians(placed[p['id']])
        col = '#e3b341' if p['fixed'] else '#79c0ff'
        d = abs(norm360(placed[p['id']] - p['angle'] + 180) - 180)
        if d > 2 and not p['fixed']:
            ax.plot([t0, t1], [R, R], color='#484f58', lw=1)  # leader along ring
            ax.plot([t0, t0], [R - 12, R + 12], color='#484f58', lw=1)  # true tick
        ax.text(t1, R, p['id'], color=col, fontsize=9, ha='center', va='center',
                bbox=dict(boxstyle='round,pad=0.2', fc='#0d1117', ec='#30363d', alpha=0.9))
    ax.set_ylim(0, 320)
    ax.set_title(title, color='white', pad=20)
    fig.patch.set_facecolor('#0d1117'); ax.set_facecolor('#0d1117')
    fig.savefig(path, dpi=90, facecolor='#0d1117')
    plt.close(fig)


for case in (case_ds_mercury, case_stellium):
    pts, name = case()
    placed = declutter(pts)
    worst = check(pts, placed)
    tot, mx, cnt = disp_stats(pts, placed)
    # compare vs forward-only greedy
    fwd = forward_only(pts)
    ftot, fmx, _ = disp_stats(pts, fwd)
    print(f"[{name}] PAVA: total_disp={tot:.1f}deg max={mx:.1f}deg | "
          f"forward-only: total={ftot:.1f}deg max={fmx:.1f}deg | "
          f"worst slack={worst:.2f}deg (negative=overlap)")
    draw(pts, placed, f"PAVA declutter — {name}", f"/tmp/pava_{name}.png")

# pathological: assert order preserved + no crash (spill allowed, logged)
pts, name = case_pathological()
placed = declutter(pts)
true_order = [p['id'] for p in sorted(pts, key=lambda p: p['angle'])]
placed_order = [p['id'] for p in sorted(pts, key=lambda p: placed[p['id']])]
ok = any(placed_order == true_order[i:] + true_order[:i] for i in range(len(pts)))
print(f"[{name}] order preserved: {ok}; infeasible arcs so far: "
      f"{__import__('pava').stats}")

# randomized stress
random.seed(7)
fails = 0
tr, fr = 0.0, 0.0
for trial in range(300):
    pts = [mk('As', 26, 'angle'), mk('Ds', 206, 'angle'),
           mk('Mc', 319.6, 'angle'), mk('Ic', 139.6, 'angle')]
    for i in range(12):
        pts.append(mk(f'P{i}', random.uniform(0, 360)))
    try:
        placed = declutter(pts)
        check(pts, placed)
        t, _, _ = disp_stats(pts, placed)
        f = forward_only(pts); ft, _, _ = disp_stats(pts, f)
        tr += t; fr += ft
    except AssertionError as e:
        fails += 1
        print("FAIL", trial, e)
print(f"stress: {300 - fails}/300 clean; avg total disp PAVA={tr/300:.1f} vs forward-only={fr/300:.1f}")
