#!/usr/bin/env python3
"""Prototype: conditional modifiers for aspect search.

Semantics under test (to be transferred to site/search.js):
  Conditions are plain dicts, ANDed, evaluated on an ephemeris snapshot
  {lon[11], spd[11]} at a perfecting instant for base pair (ia, ib).
  'a'/'b' in a condition refer to the pair's first/second body.

  sign:    who in (a, b, body); mode sign|ruler|element|quad|same
  aspect:  from/to any bodies; deg; mode orb (<= orb deg) | signbased
           (whole-sign aspect, no orb)
  motion:  body direct (spd >= 0) | retrograde (spd < 0)
  speed:   body percentile of |spd| within [min, max] (either optional)
  phase:   signed elongation E = wrap180(lon - lon_sun):
           |E| <= 8.5 combust; 8.5 < |E| <= 15 under the beams;
           E < -15 morning (oriental, west of Sun); E > 15 evening.

Verified on synthetic snapshots plus the real 15 May 578 BCE longitudes
(from the Trigon WASM, Moshier): Uranus 34.62, Neptune 39.16, Pluto 39.15
(all Taurus) — Neptune conjunct Pluto with Uranus co-present must pass.
"""
import math

BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn',
          'Uranus', 'Neptune', 'Pluto', 'North Node']
# Traditional rulers of Aries..Pisces (body indices).
RULERS = [4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5]
COMBUST, BEAMS = 8.5, 15.0


def wrap180(x):
    return ((x + 180.0) % 360.0) - 180.0


def sign_of(lon):
    return math.floor((lon % 360.0) / 30.0)


def resolve(ref, ia, ib):
    return ia if ref == 'a' else ib if ref == 'b' else ref


def phase_of(lon, sun_lon):
    e = wrap180(lon - sun_lon)
    if abs(e) <= COMBUST:
        return 'combust'
    if abs(e) <= BEAMS:
        return 'beams'
    return 'morning' if e < 0 else 'evening'


def evaluate(c, snap, ia, ib, pct):
    t = c['type']
    if t == 'sign':
        s = sign_of(snap['lon'][resolve(c['who'], ia, ib)])
        if c['mode'] == 'sign':
            return s == c['value']
        if c['mode'] == 'ruler':
            return RULERS[s] == c['value']
        if c['mode'] == 'element':
            return s % 4 == c['value']
        if c['mode'] == 'quad':
            return s % 3 == c['value']
        if c['mode'] == 'same':
            return s == sign_of(snap['lon'][resolve(c['value'], ia, ib)])
    if t == 'aspect':
        l1 = snap['lon'][resolve(c['from'], ia, ib)]
        l2 = snap['lon'][resolve(c['to'], ia, ib)]
        if c['mode'] == 'orb':
            return abs(abs(wrap180(l1 - l2)) - c['deg']) <= c['orb']
        d = (sign_of(l2) - sign_of(l1)) % 12
        return min(d, 12 - d) * 30 == c['deg']
    if t == 'motion':
        v = snap['spd'][c['body']]
        return v < 0 if c['dir'] == 'retrograde' else v >= 0
    if t == 'speed':
        p = pct(c['body'], abs(snap['spd'][c['body']]))
        return (c.get('min') is None or p >= c['min']) and \
               (c.get('max') is None or p <= c['max'])
    if t == 'phase':
        return phase_of(snap['lon'][c['body']], snap['lon'][0]) == c['phase']
    raise KeyError(t)


def run(conds, snap, ia, ib, pct):
    return all(evaluate(c, snap, ia, ib, pct) for c in conds)


def run_groups(groups, snap, ia, ib, pct):
    """Top level: AND of groups. Within a group: OR of subconditions.
    A legacy flat condition dict is treated as a one-condition group."""
    norm = [[g] if isinstance(g, dict) else g for g in groups]
    return all(any(evaluate(c, snap, ia, ib, pct) for c in g) for g in norm)


def main():
    zero_pct = lambda b, v: 50.0
    # --- 578 BCE: Neptune (8) conjunct Pluto (9), Uranus (7) co-present.
    lon = [0.0] * 11
    lon[7], lon[8], lon[9] = 34.62, 39.16, 39.15  # Taurus
    snap = {'lon': lon, 'spd': [0.01] * 11}
    assert run([{'type': 'sign', 'who': 7, 'mode': 'same', 'value': 'a'}], snap, 8, 9, zero_pct)
    assert run([{'type': 'sign', 'who': 'a', 'mode': 'sign', 'value': 1}], snap, 8, 9, zero_pct)  # Taurus
    assert run([{'type': 'sign', 'who': 'a', 'mode': 'element', 'value': 1}], snap, 8, 9, zero_pct)  # Earth
    assert run([{'type': 'sign', 'who': 'a', 'mode': 'quad', 'value': 1}], snap, 8, 9, zero_pct)  # Fixed
    assert run([{'type': 'sign', 'who': 'a', 'mode': 'ruler', 'value': 3}], snap, 8, 9, zero_pct)  # Venus rules Taurus
    assert not run([{'type': 'sign', 'who': 7, 'mode': 'same', 'value': 'b'},
                    {'type': 'sign', 'who': 'a', 'mode': 'sign', 'value': 2}], snap, 8, 9, zero_pct)

    # --- Sign taxonomy spot checks.
    assert RULERS[sign_of(0)] == 4 and RULERS[sign_of(95)] == 1  # Aries Mars, Cancer Moon
    assert sign_of(200) % 4 == 2 and sign_of(200) % 3 == 0      # Libra: Air, Cardinal

    # --- Aspect conditions: orb and whole-sign.
    lon2 = [0.0] * 11
    lon2[4], lon2[5] = 10.0, 128.0   # Mars Aries, Jupiter Leo: 118 deg apart
    snap2 = {'lon': lon2, 'spd': [0.01] * 11}
    assert run([{'type': 'aspect', 'from': 4, 'to': 5, 'deg': 120, 'mode': 'orb', 'orb': 3}], snap2, 0, 1, zero_pct)
    assert not run([{'type': 'aspect', 'from': 4, 'to': 5, 'deg': 120, 'mode': 'orb', 'orb': 1}], snap2, 0, 1, zero_pct)
    assert run([{'type': 'aspect', 'from': 4, 'to': 5, 'deg': 120, 'mode': 'signbased'}], snap2, 0, 1, zero_pct)
    lon2[5] = 100.0  # Jupiter Cancer: 90 deg by degree, square by sign too
    assert run([{'type': 'aspect', 'from': 4, 'to': 5, 'deg': 90, 'mode': 'signbased'}], snap2, 0, 1, zero_pct)
    assert not run([{'type': 'aspect', 'from': 4, 'to': 5, 'deg': 120, 'mode': 'signbased'}], snap2, 0, 1, zero_pct)

    # --- Motion and speed.
    snap3 = {'lon': [0.0] * 11, 'spd': [0.0] * 11}
    snap3['spd'][2] = -0.5
    assert run([{'type': 'motion', 'body': 2, 'dir': 'retrograde'}], snap3, 0, 1, zero_pct)
    assert not run([{'type': 'motion', 'body': 2, 'dir': 'direct'}], snap3, 0, 1, zero_pct)
    assert run([{'type': 'speed', 'body': 2, 'min': 10, 'max': 90}], snap3, 0, 1, zero_pct)
    assert not run([{'type': 'speed', 'body': 2, 'min': 60}], snap3, 0, 1, zero_pct)

    # --- Heliacal phase by signed elongation.
    sun = 100.0
    assert phase_of(sun + 5, sun) == 'combust'
    assert phase_of(sun + 12, sun) == 'beams'
    assert phase_of(sun - 40, sun) == 'morning'   # west of Sun: rises first
    assert phase_of(sun + 40, sun) == 'evening'
    assert phase_of(sun + 190, sun) == 'morning'  # wraps to -170

    # --- OR groups under AND (eclipse-companion style): body X (7) must be
    # co-present with B (9) OR in sign-based opposition to B.
    grp = [[{'type': 'sign', 'who': 7, 'mode': 'same', 'value': 'b'},
            {'type': 'aspect', 'from': 7, 'to': 'b', 'deg': 180, 'mode': 'signbased'}]]
    # X in Taurus with B in Taurus: co-present branch true.
    assert run_groups(grp, snap, 8, 9, zero_pct)
    # Move X to Scorpio (opposite Taurus): sign-based opposition branch true.
    lon3 = [0.0] * 11
    lon3[7], lon3[9] = 220.0, 39.15
    snap4 = {'lon': lon3, 'spd': [0.01] * 11}
    assert run_groups(grp, snap4, 8, 9, zero_pct)
    # Move X to Leo: neither branch.
    lon3[7] = 130.0
    assert not run_groups(grp, snap4, 8, 9, zero_pct)
    # AND across groups still applies: add a failing second group.
    assert not run_groups(grp + [[{'type': 'sign', 'who': 'a', 'mode': 'sign', 'value': 2}]],
                          snap, 8, 9, zero_pct)
    # Legacy flat dicts normalize to singleton groups.
    assert run_groups([{'type': 'sign', 'who': 'a', 'mode': 'sign', 'value': 1}], snap, 8, 9, zero_pct)

    print('PROTO OK')


if __name__ == '__main__':
    main()
