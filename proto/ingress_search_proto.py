#!/usr/bin/env python3
"""Prototype: sign-ingress search.

Algorithm under test (to be transferred to site/search.js):
  * Sample each body on a step sized so it moves <= ~15 deg per step
    (half a sign), using conservative max daily motions.
  * Unwrap longitude sample-to-sample; a change in floor(U/30) brackets
    exactly one sign boundary B (a multiple of 30 deg, unwrapped).
  * Refine the crossing of wrap180(lon(t) - B mod 360) by bisection.
  * Direction comes from the speed sign at the root: direct motion enters
    sign floor(B/30); retrograde motion leaves it for the previous sign.

Validated here against a fine brute-force scan on synthetic ephemerides:
a linear body, a Moon-speed body, and a retrograding sine body whose
longitude oscillates across two sign boundaries.
"""
import math

MAX_DAILY_MOTION = {
    'linear': 1.0,
    'moonlike': 13.2,
    'looper': 1.6,  # 25 deg amplitude, 100 d period -> max ~1.571 deg/day
}


def wrap180(x):
    return ((x + 180.0) % 360.0) - 180.0


def wrap360(x):
    return x % 360.0


def step_for(body):
    return min(120.0, max(0.25, 15.0 / MAX_DAILY_MOTION[body]))


def lon(body, t):
    if body == 'linear':
        return wrap360(10.0 + 1.0 * t)
    if body == 'moonlike':
        return wrap360(350.0 + 13.2 * t)
    if body == 'looper':
        return wrap360(200.0 + 25.0 * math.sin(2 * math.pi * t / 100.0))
    raise KeyError(body)


def spd(body, t):
    if body == 'linear':
        return 1.0
    if body == 'moonlike':
        return 13.2
    if body == 'looper':
        return 25.0 * (2 * math.pi / 100.0) * math.cos(2 * math.pi * t / 100.0)
    raise KeyError(body)


def bisect_root(body, boundary_mod, a, b):
    g = lambda t: wrap180(lon(body, t) - boundary_mod)
    ga, gb = g(a), g(b)
    if ga == 0:
        return a
    if gb == 0:
        return b
    lo, hi, glo = a, b, ga
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        gm = g(mid)
        if gm == 0 or hi - lo < 1e-7:
            return mid
        if (gm > 0) == (glo > 0):
            lo, glo = mid, gm
        else:
            hi = mid
    return 0.5 * (lo + hi)


def ingresses(body, t0, t1):
    step = step_for(body)
    n = math.ceil((t1 - t0) / step)
    out = []
    prev_t = t0
    prev_raw = lon(body, t0)
    unwrapped = prev_raw
    prev_floor = math.floor(unwrapped / 30.0)
    for k in range(1, n + 1):
        t = t1 if k == n else t0 + k * step
        raw = lon(body, t)
        unwrapped += wrap180(raw - prev_raw)
        fl = math.floor(unwrapped / 30.0)
        if fl != prev_floor:
            assert abs(fl - prev_floor) == 1, (body, k, prev_floor, fl)
            boundary = fl * 30.0 if fl > prev_floor else prev_floor * 30.0
            root = bisect_root(body, boundary % 360.0, prev_t, t)
            direct = spd(body, root) >= 0
            to_sign = int(boundary // 30) % 12 if direct else (int(boundary // 30) - 1) % 12
            from_sign = (to_sign - 1) % 12 if direct else int(boundary // 30) % 12
            out.append((root, from_sign, to_sign, 'D' if direct else 'R'))
        prev_t, prev_raw, prev_floor = t, raw, fl
    return out


def brute(body, t0, t1, h=0.002):
    out = []
    steps = int((t1 - t0) / h)
    prev_sign = math.floor(wrap360(lon(body, t0)) / 30.0)
    for i in range(1, steps + 1):
        t = t0 + i * h
        s = math.floor(wrap360(lon(body, t)) / 30.0)
        if s != prev_sign:
            out.append((t, prev_sign, s))
            prev_sign = s
    return out


def main():
    # (body, t0, t1, expected count or None)
    cases = [
        ('linear', 0.0, 365.0, 12),      # 1 deg/day -> a boundary every 30 d
        ('moonlike', 0.0, 60.0, None),   # ~13.2 deg/day: a sign every ~2.27 d
        ('looper', 0.0, 300.0, None),    # oscillates 175..225: crosses 180/210
    ]
    for body, t0, t1, expected in cases:
        got = ingresses(body, t0, t1)
        ref = brute(body, t0, t1)
        assert len(got) == len(ref), (body, len(got), len(ref))
        if expected is not None:
            assert len(got) == expected, (body, len(got), expected)
        for (root, fs, ts, dr), (bt, bfs, bts) in zip(got, ref):
            assert abs(root - bt) < 0.01, (body, root, bt)
            assert (fs, ts) == (bfs, bts), (body, root, (fs, ts), (bfs, bts))
        dirs = ''.join(d for *_, d in got)
        print(f"{body:9s} step={step_for(body):7.3f} d  ingresses={len(got):3d}  "
              f"signs match brute force; directions: {dirs[:40]}")
    # Retrograde entries must exist for the looper (it re-enters signs).
    loop = ingresses('looper', 0.0, 300.0)
    assert any(d == 'R' for *_, d in loop) and any(d == 'D' for *_, d in loop)
    print('looper has both direct and retrograde ingresses: OK')
    print('PROTO OK')


if __name__ == '__main__':
    main()
