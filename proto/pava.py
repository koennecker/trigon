"""PAVA-based circular label declutter prototype (radial longitude offsets).

Formalization of the queued-offset intuition:
  min  sum (x_i - theta_i)^2
  s.t. x_{i+1} - x_i >= h_i + h_{i+1}   (no overlap, circular order preserved)
       fixed anchors (As/Ds/Mc/Ic) split the circle into independent linear arcs.

Per arc this is isotonic regression after the change of variables
  y_i = x_i - S_i,  S_i = prefix sums of separations,
solved exactly by Pool Adjacent Violators Algorithm (PAVA).
The "chain reaction" = PAVA block merging; the block centroid = the missing
backward half of a naive forward-only push.
"""
import math

INF = float('inf')

# diagnostic counter: how many arcs hit the infeasible fallback
stats = {'infeasible_arcs': 0, 'total_arcs': 0}


def norm360(d):
    return d % 360.0


def pava_isotonic(vals, wts):
    """Minimize sum w_i (y_i - vals_i)^2 subject to y nondecreasing.

    vals, wts: parallel lists. wts[i] = INF pins that position (sentinel).
    Returns y list.
    """
    n = len(vals)
    stack = []  # each block: [value, weight, lo, hi]
    for i in range(n):
        v, w, lo, hi = vals[i], wts[i], i, i
        while stack and stack[-1][0] > v:
            pv, pw, plo, _ = stack.pop()
            if pw == INF or w == INF:
                v = pv if pw == INF else v
                w = INF
            else:
                v = (pv * pw + v * w) / (pw + w)
                w = pw + w
            lo = plo
        stack.append([v, w, lo, hi])
    y = [0.0] * n
    for (v, w, lo, hi) in stack:
        for j in range(lo, hi + 1):
            y[j] = v
    return y


def declutter_arc(thetas, half_widths, lo_anchor, hi_anchor):
    """Solve one linear arc. thetas strictly increasing, inside (lo, hi).

    lo_anchor/hi_anchor: (angle, half_width) of fixed bounding anchors.
    Returns placed x_i (same linearized frame as thetas).
    """
    k = len(thetas)
    if k == 0:
        return []
    # separations between consecutive labels
    S = [0.0]
    for i in range(k - 1):
        S.append(S[-1] + half_widths[i] + half_widths[i + 1])
    phi = [thetas[i] - S[i] for i in range(k)]
    L = lo_anchor[0] + lo_anchor[1] + half_widths[0]
    U = hi_anchor[0] - hi_anchor[1] - half_widths[-1] - S[-1]
    # Feasibility in y-space: tight packing <=> all y equal, so need L <= U.
    stats['total_arcs'] += 1
    if L <= U:
        # feasible: pin with infinite-weight sentinels
        vals = [L] + phi + [U]
        wts = [INF] + [1.0] * k + [INF]
        y = pava_isotonic(vals, wts)
        return [y[i + 1] + S[i] for i in range(k)]
    else:
        # overcrowded arc: relax bounds, keep order + separation (spill allowed)
        stats['infeasible_arcs'] += 1
        y = pava_isotonic(phi, [1.0] * k)
        return [y[i] + S[i] for i in range(k)]


def declutter(points):
    """points: list of dicts {id, angle, half_width, fixed}.
    Returns dict id -> placed angle in [0, 360)."""
    pts = sorted(points, key=lambda p: p['angle'])
    n = len(pts)
    fixed_idx = [i for i, p in enumerate(pts) if p['fixed']]
    assert fixed_idx, "need at least one fixed anchor"
    result = {}
    nf = len(fixed_idx)
    for f in range(nf):
        i0 = fixed_idx[f]
        i1 = fixed_idx[(f + 1) % nf]
        A, B = pts[i0], pts[i1]
        mov = []
        i = (i0 + 1) % n
        while i != i1:
            mov.append(pts[i])
            i = (i + 1) % n
        base = A['angle']
        lin = lambda a: base + norm360(a - base)
        b_lin = base + norm360(B['angle'] - base)
        thetas = [lin(m['angle']) for m in mov]
        assert all(base < t < b_lin for t in thetas), "movable outside its arc"
        hws = [m['half_width'] for m in mov]
        xs = declutter_arc(thetas, hws, (base, A['half_width']),
                           (b_lin, B['half_width']))
        for m, x in zip(mov, xs):
            result[m['id']] = norm360(x)
        result[A['id']] = norm360(A['angle'])
    return result


def check(points, placed):
    """Verify: no overlaps (adjacent in circular order), order preserved."""
    pts = sorted(points, key=lambda p: placed[p['id']])
    n = len(pts)
    worst = 0.0
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        gap = norm360(placed[b['id']] - placed[a['id']])
        need = a['half_width'] + b['half_width']
        worst = max(worst, need - gap)
        assert gap + 1e-9 >= need, f"OVERLAP {a['id']}-{b['id']}: gap={gap:.2f} need={need:.2f}"
    # order preserved vs true order (circular): compare rank sequences
    true_order = [p['id'] for p in sorted(points, key=lambda p: p['angle'])]
    placed_order = [p['id'] for p in pts]
    # rotations of the same circular order are fine
    ok = any(placed_order == true_order[i:] + true_order[:i] for i in range(n))
    assert ok, f"ORDER CHANGED\ntrue={true_order}\nplaced={placed_order}"
    return worst


def disp_stats(points, placed):
    ds = [abs(norm360(placed[p['id']] - p['angle'] + 180) - 180) for p in points
          if not p['fixed']]
    return sum(ds), max(ds), len(ds)
