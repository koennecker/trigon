#!/usr/bin/env python3
"""Prototype + verification for Trigon table dignities: decan lords
(Chaldean modulo order and Indian triplicity-domicile sequence), Egyptian
bounds (Egyptian bounds table), Dorothean triplicity lords, exaltation lords,
Dodecatemoria (D12) and Novenaria (D9) sub-lords, whole-sign house lords,
and the prev/next station + syzygy bracketing logic.

Body indices: 0 Sun, 1 Moon, 2 Mercury, 3 Venus, 4 Mars, 5 Jupiter,
6 Saturn, 7 Uranus, 8 Neptune, 9 Pluto.
Run: python3 proto/dignities_proto.py
"""
import math

NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn',
         'Uranus', 'Neptune', 'Pluto']
# Aries..Pisces -> domicile lord (traditional)
SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5]
# Chaldean order, slowest to fastest: Saturn Jupiter Mars Sun Venus Mercury Moon
CHALDEAN = [6, 5, 4, 0, 3, 2, 1]

# Egyptian bounds: per sign, (upper degree limit, lord index) — ported
# 1:1 from the reference implementation (names mapped to indices).
_B = {
    'Jupiter': 5, 'Venus': 3, 'Mercury': 2, 'Mars': 4, 'Saturn': 6,
}
BOUNDS = [
    [(6, 'Jupiter'), (12, 'Venus'), (20, 'Mercury'), (25, 'Mars'), (30, 'Saturn')],
    [(8, 'Venus'), (14, 'Mercury'), (22, 'Jupiter'), (27, 'Saturn'), (30, 'Mars')],
    [(6, 'Mercury'), (12, 'Jupiter'), (17, 'Venus'), (24, 'Mars'), (30, 'Saturn')],
    [(7, 'Mars'), (13, 'Venus'), (19, 'Mercury'), (26, 'Jupiter'), (30, 'Saturn')],
    [(6, 'Jupiter'), (11, 'Venus'), (18, 'Saturn'), (24, 'Mercury'), (30, 'Mars')],
    [(7, 'Mercury'), (17, 'Venus'), (21, 'Jupiter'), (28, 'Mars'), (30, 'Saturn')],
    [(6, 'Saturn'), (14, 'Mercury'), (21, 'Jupiter'), (28, 'Venus'), (30, 'Mars')],
    [(7, 'Mars'), (11, 'Venus'), (19, 'Mercury'), (24, 'Jupiter'), (30, 'Saturn')],
    [(12, 'Jupiter'), (17, 'Venus'), (21, 'Mercury'), (26, 'Saturn'), (30, 'Mars')],
    [(7, 'Mercury'), (14, 'Jupiter'), (22, 'Venus'), (26, 'Saturn'), (30, 'Mars')],
    [(7, 'Mercury'), (13, 'Venus'), (20, 'Jupiter'), (25, 'Mars'), (30, 'Saturn')],
    [(12, 'Venus'), (16, 'Jupiter'), (19, 'Mercury'), (28, 'Mars'), (30, 'Saturn')],
]
BOUNDS = [[(u, _B[n]) for u, n in sign] for sign in BOUNDS]

# Dorothean triplicities by element (sign % 4): (day lord, night lord,
# participating/tertiary lord). Fire: Sun/Jupiter/Saturn; Earth:
# Venus/Moon/Mars; Air: Saturn/Mercury/Jupiter; Water: Venus/Mars/Moon.
TRIPLICITY = [(0, 5, 6), (3, 1, 4), (6, 2, 5), (3, 4, 1)]

# Exaltation lord by sign index (None where no classical exaltation).
EXALTATION = [0, 1, None, 5, None, 2, 6, None, None, 4, None, 3]


def sign_of(lon):
    return int((lon % 360.0) // 30)


def decan_chaldean(lon):
    """36 decans in zodiac order cycle the Chaldean order continuously,
    starting with Mars for the first decan of Aries."""
    k = int((lon % 360.0) // 10)
    return CHALDEAN[(2 + k) % 7]  # Mars sits at index 2 of CHALDEAN


def decan_indian(lon):
    """Drekkana: decan lords are the domicile lords of the sign itself,
    the 5th sign, and the 9th sign (the triplicity in domicile sequence)."""
    s = sign_of(lon)
    d = int((lon % 30.0) // 10)
    return SIGN_RULERS[(s + 4 * d) % 12]


def bound_lord(lon):
    lon = lon % 360.0
    s = int(lon // 30)
    deg = lon % 30.0
    for upper, lord in BOUNDS[s]:
        if deg < upper:
            return lord
    return BOUNDS[s][-1][1]


def triplicity_lords(lon, is_day):
    """(primary, secondary, tertiary): primary is the sect ruler,
    secondary the other sect ruler, tertiary the participating lord."""
    day, night, part = TRIPLICITY[sign_of(lon) % 4]
    return (day, night, part) if is_day else (night, day, part)


def exaltation_lord(lon):
    return EXALTATION[sign_of(lon)]


def d12_lord(lon):
    """Dodecatemoria: 12 sub-signs of 2.5 deg counting forward from the
    sign itself; lord is the sub-sign's domicile lord."""
    s = sign_of(lon)
    part = int((lon % 30.0) // 2.5)
    return SIGN_RULERS[(s + part) % 12]


def d9_lord(lon):
    """Novenaria: 9 sub-signs of 3 deg 20 min. Cardinal signs count from
    themselves, fixed from the 9th sign, mutable from the 5th."""
    s = sign_of(lon)
    # 200 arcminutes per part; going through minutes avoids the float
    # undershoot of deg / (10/3) at exact part boundaries (6 deg 40 min...).
    part = int((lon % 30.0) * 60.0 // 200.0)
    start = (s, (s + 8) % 12, (s + 4) % 12)[s % 3]
    return SIGN_RULERS[(start + part) % 12]


def house_lord(house, asc_sign):
    """Whole-sign house lord: house h is the (h-1)th sign from the Asc."""
    return SIGN_RULERS[(asc_sign + house - 1) % 12]


def bracket(sorted_jds, jd):
    """(prev, next) elements of a sorted list bracketing jd."""
    prev = None
    for x in sorted_jds:
        if x <= jd:
            prev = x
        else:
            return prev, x
    return prev, None


def main():
    N = NAMES
    # --- Chaldean decans: standard table, spot-checked across the zodiac.
    assert [N[decan_chaldean(d)] for d in (5, 15, 25)] == ['Mars', 'Sun', 'Venus']      # Aries
    assert [N[decan_chaldean(d)] for d in (35, 45, 55)] == ['Mercury', 'Moon', 'Saturn']  # Taurus
    assert [N[decan_chaldean(d)] for d in (335, 345, 355)] == ['Saturn', 'Jupiter', 'Mars']  # Pisces
    # Continuity: consecutive decans step one place in Chaldean order
    # (except across the Pisces->Aries wrap, where Mars repeats: the
    # traditional table restarts at Mars for Aries).
    for k in range(35):
        a, b = decan_chaldean(k * 10 + 5), decan_chaldean((k + 1) * 10 + 5)
        assert CHALDEAN.index(b) == (CHALDEAN.index(a) + 1) % 7
    # --- Indian decans (drekkana).
    assert [N[decan_indian(d)] for d in (5, 15, 25)] == ['Mars', 'Sun', 'Jupiter']       # Aries
    assert [N[decan_indian(d)] for d in (35, 45, 55)] == ['Venus', 'Mercury', 'Saturn']  # Taurus
    assert [N[decan_indian(d)] for d in (305, 315, 325)] == ['Saturn', 'Mercury', 'Venus']  # Aquarius: Aq, Gemini, Libra lords
    # --- Egyptian bounds (boundary semantics deg < upper).
    assert N[bound_lord(5.999)] == 'Jupiter' and N[bound_lord(6.0)] == 'Venus'
    assert N[bound_lord(29.999)] == 'Saturn'
    assert N[bound_lord(120 + 17.999)] == 'Saturn' and N[bound_lord(120 + 18.0)] == 'Mercury'  # Leo
    assert N[bound_lord(330 + 27.999)] == 'Mars' and N[bound_lord(330 + 28.0)] == 'Saturn'     # Pisces
    assert N[bound_lord(-0.001)] == 'Saturn'   # wraps to Pisces' last bound
    # Every sign's bounds tile 0..30 with five segments.
    for s, segs in enumerate(BOUNDS):
        assert segs[-1][0] == 30 and all(segs[i][0] < segs[i + 1][0] for i in range(4))
    # --- Dorothean triplicities.
    assert [N[x] for x in triplicity_lords(15, True)] == ['Sun', 'Jupiter', 'Saturn']     # Aries day
    assert [N[x] for x in triplicity_lords(15, False)] == ['Jupiter', 'Sun', 'Saturn']    # Aries night
    assert [N[x] for x in triplicity_lords(225, True)] == ['Venus', 'Mars', 'Moon']        # Scorpio day
    assert [N[x] for x in triplicity_lords(225, False)] == ['Mars', 'Venus', 'Moon']       # Scorpio night
    assert [N[x] for x in triplicity_lords(100, True)] == ['Venus', 'Mars', 'Moon']        # Cancer (water) day
    # --- Exaltations.
    assert N[exaltation_lord(15)] == 'Sun' and N[exaltation_lord(160)] == 'Mercury'
    assert exaltation_lord(75) is None and exaltation_lord(255) is None
    # --- D12.
    assert N[d12_lord(15)] == 'Venus'    # Aries 15 -> 7th sub-sign Libra
    assert N[d12_lord(32)] == 'Venus'    # Taurus 2 -> Taurus
    assert N[d12_lord(119)] == 'Mercury'  # Cancer 29 -> 12th sub-sign Gemini
    # --- D9.
    assert N[d9_lord(15)] == 'Sun'       # Aries 15 -> 5th navamsha Leo
    assert N[d9_lord(30)] == 'Saturn'    # Taurus 0 -> starts Capricorn
    assert N[d9_lord(60)] == 'Venus'     # Gemini 0 -> starts Libra
    assert N[d9_lord(130)] == 'Moon'     # Leo 10 -> 4th from Aries = Cancer
    assert N[d9_lord(359.9)] == 'Jupiter'  # Pisces 29.9: mutable start Cancer, 9th part = Pisces
    # --- House lords: Asc Aries -> house 10 Capricorn ruled by Saturn.
    assert N[house_lord(10, 0)] == 'Saturn' and N[house_lord(1, 0)] == 'Mars'
    # --- Bracketing (stations/syzygies share this shape).
    roots = [10.0, 20.0, 35.0, 50.0]
    assert bracket(roots, 22.0) == (20.0, 35.0)
    assert bracket(roots, 5.0) == (None, 10.0)
    assert bracket(roots, 55.0) == (50.0, None)
    assert bracket(roots, 20.0) == (20.0, 35.0)  # exact hit counts as prev
    print('PROTO OK')


if __name__ == '__main__':
    main()
