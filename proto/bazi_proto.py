"""BaZi (Four Pillars) proof of concept — Python-first verification.

Transferred to site/bazi.js. State management, not ephemeris: the
chart already computed the Sun's ecliptic longitude, so bazi() takes
that longitude as an input and recomputes nothing. Year and month are
read straight off it: the year turns when the Sun reaches 315 deg
(Lichun), and the month branch advances one step every 30 deg from
there, through the twelve Jie terms. No term-instant search.

The only astronomical function here, sun_longitude(), is the test
mock: tests that have no chart output use it to synthesize a Sun
longitude for a test instant. It is not the live path.

Rules, in one place:

- Heavenly Stems (10, in order): Jia, Yi, Bing, Ding, Wu, Ji, Geng,
  Xin, Ren, Gui. Earthly Branches (12, in order): Zi, Chou, Yin, Mao,
  Chen, Si, Wu, Wei, Shen, You, Xu, Hai. A pillar is one stem over one
  branch; the 60-cycle pairs them in order, so cycle index n has
  stem n % 10 and branch n % 12.
- Year pillar: stem = (pillarYear - 4) % 10, branch =
  (pillarYear - 4) % 12, with 1984 = Jia Zi as the anchor.
  pillarYear is the calendar year, except in January/February before
  the Sun reaches 315 deg, where it is the previous year.
- Month pillar: segment = floor(((sunLon - 315) mod 360) / 30),
  branch = (Yin + segment) mod 12, term = the Jie name for that
  segment; the stem follows the Five Tigers rule, i.e.
  stem = (firstStem + segment) % 10.
- Day pillar: a continuous 60-day count. With JDN the Julian Day
  Number of the (effective) calendar date, index = (JDN + 49) % 60.
  Anchors checked in test_bazi_proto.py: 1900-01-01 = Jia Xu,
  1949-10-01 = Jia Zi, 2000-01-01 = Wu Wu.
- Hour pillar: a double-hour. Branch = ((hour + 1) // 2) % 12, so
  23:00-01:00 is Zi. The stem follows the Five Rats rule from the
  (effective) day stem: stem = (2 * dayStem + hourBranch) % 10.
- Day boundary (one school, stated so it can be challenged): the day
  advances at 23:00, the start of the Zi hour, not at midnight. A
  23:30 birth therefore belongs to the next day's pillar, and its
  hour stem is taken from that next day's stem. The midnight school
  differs for 23:00-24:00 births only.
- Time model: the input is wall time (Trigon's tz select; for BCE,
  local mean time). No true solar time correction: a birth near a
  double-hour boundary can shift by one hour pillar under a
  longitude correction, and that is a stated limitation, not a
  silent choice.
- Mock accuracy: sun_longitude() is Meeus' low-precision formula
  (~0.01 deg). At the published Lichun instants for 2024-2026 it
  lands within 0.01 deg of 315 deg; it degrades with distance from
  J2000, which is one reason it is a mock, not the live path.

Run: python3 proto/bazi_proto.py  (prints the three published examples)
Test: python3 -m unittest proto.test_bazi_proto -v  (from the repo root)
"""

import math

STEMS = [
    ("Jia", "\u7532", "Wood", "Yang"),
    ("Yi", "\u4e59", "Wood", "Yin"),
    ("Bing", "\u4e19", "Fire", "Yang"),
    ("Ding", "\u4e01", "Fire", "Yin"),
    ("Wu", "\u620a", "Earth", "Yang"),
    ("Ji", "\u5df1", "Earth", "Yin"),
    ("Geng", "\u5e9a", "Metal", "Yang"),
    ("Xin", "\u8f9b", "Metal", "Yin"),
    ("Ren", "\u58ec", "Water", "Yang"),
    ("Gui", "\u7678", "Water", "Yin"),
]

BRANCHES = [
    ("Zi", "\u5b50", "Water", "Rat"),
    ("Chou", "\u4e11", "Earth", "Ox"),
    ("Yin", "\u5bc5", "Wood", "Tiger"),
    ("Mao", "\u536f", "Wood", "Rabbit"),
    ("Chen", "\u8fb0", "Earth", "Dragon"),
    ("Si", "\u5df3", "Fire", "Snake"),
    ("Wu", "\u5348", "Fire", "Horse"),
    ("Wei", "\u672a", "Earth", "Goat"),
    ("Shen", "\u7533", "Metal", "Monkey"),
    ("You", "\u9149", "Metal", "Rooster"),
    ("Xu", "\u620c", "Earth", "Dog"),
    ("Hai", "\u4ea5", "Water", "Pig"),
]

# Branch -> hidden stems, main first, then middle, then residual.
HIDDEN_STEMS = {
    "Zi": ["Gui"],
    "Chou": ["Ji", "Gui", "Xin"],
    "Yin": ["Jia", "Bing", "Wu"],
    "Mao": ["Yi"],
    "Chen": ["Wu", "Yi", "Gui"],
    "Si": ["Bing", "Geng", "Wu"],
    "Wu": ["Ding", "Ji"],
    "Wei": ["Ji", "Ding", "Yi"],
    "Shen": ["Geng", "Ren", "Wu"],
    "You": ["Xin"],
    "Xu": ["Wu", "Xin", "Ding"],
    "Hai": ["Ren", "Jia"],
}

JIE_NAMES = [
    "Lichun", "Jingzhe", "Qingming", "Lixia", "Mangzhong", "Xiaoshu",
    "Liqiu", "Bailu", "Hanlu", "Lidong", "Daxue", "Xiaohan",
]


def stem(i):
    return STEMS[i % 10]


def branch(i):
    return BRANCHES[i % 12]


def pillar(stem_idx, branch_idx):
    s = stem(stem_idx)
    b = branch(branch_idx)
    return {
        "stem": s[0], "stem_char": s[1], "stem_element": s[2],
        "stem_polarity": s[3],
        "branch": b[0], "branch_char": b[1], "branch_element": b[2],
        "animal": b[3], "hidden": list(HIDDEN_STEMS[b[0]]),
        "text": s[1] + b[1],
        "name": s[0] + " " + b[0],
    }


# --- Calendar: jdFromCal ported from site/search.js (swe_julday) --------

def jd_from_cal(y, mo, d, hour):
    greg = 1 if (y > 1582 or (y == 1582 and (mo > 10 or (mo == 10 and d >= 15)))) else 0
    u = y
    if mo < 3:
        u -= 1
    u0 = u + 4712.0
    u1 = mo + 1.0
    if u1 < 4:
        u1 += 12.0
    jd = math.floor(u0 * 365.25) + math.floor(30.6 * u1 + 0.000001) + d + hour / 24.0 - 63.5
    if greg:
        u2 = abs(u) // 100 - abs(u) // 400
        if u < 0:
            u2 = -u2
        jd = jd - u2 + 2
        if u < 0 and u / 100 == math.floor(u / 100) and u / 400 != math.floor(u / 400):
            jd -= 1
    return jd


def jdn(y, mo, d):
    """Julian Day Number of a calendar date (the day starting at noon
    in JD terms is not the civil day; the +0.5 below is the civil-day
    correction, verified against the 1900/1949/2000 anchors)."""
    return math.floor(jd_from_cal(y, mo, d, 0) + 0.5)


def next_day(y, mo, d):
    """Next calendar date, Gregorian leap rule for >=1582, Julian before
    (matching site/dateapi.js isLeapYear); the Oct 1582 gap is skipped."""
    mdays = [31, 29 if (y % 4 == 0 and (y < 1582 or y % 100 != 0 or y % 400 == 0)) else 28,
             31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    d += 1
    if d > mdays[mo - 1]:
        d = 1
        mo += 1
        if mo > 12:
            mo = 1
            y += 1
    if y == 1582 and mo == 10 and 5 <= d <= 14:
        d = 15
    return y, mo, d


# --- Test mock: Sun longitude (Meeus low precision) -----------------------

def _norm360(x):
    return x % 360.0


def sun_longitude(jd):
    """Test mock only — apparent ecliptic longitude of the Sun,
    degrees, Meeus low precision (~0.01 deg). Live code uses the
    chart's Sun longitude instead."""
    t = (jd - 2451545.0) / 36525.0
    l0 = _norm360(280.46646 + t * (36000.76983 + t * 0.0003032))
    m = _norm360(357.52911 + t * (35999.05029 - t * 0.0001537))
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + t * 0.000014))
         + math.sin(2 * mr) * (0.019993 - t * 0.000101)
         + math.sin(3 * mr) * 0.000289)
    true_lon = l0 + c
    omega = 125.04 - 1934.136 * t
    return _norm360(true_lon - 0.00569 - 0.00478 * math.sin(math.radians(omega)))


def mock_sun(y, mo, d, hh, mi=0, offset_min=0):
    """Mock Sun longitude for a wall datetime: wall time plus offset
    -> UTC instant -> mock Sun longitude there."""
    return sun_longitude(jd_from_cal(y, mo, d, hh + mi / 60.0 - offset_min / 60.0))


def bazi(y, mo, d, hh, sun_lon, mi=0):
    """Four pillars for a wall datetime and the Sun's ecliptic
    longitude at that instant (the chart's Sun longitude).

    y, mo, d: calendar date as in site/dateapi.js (astronomical year
    numbering, y < 1 is BCE). hh, mi: wall time 0-23 / 0-59.
    sun_lon: Sun's ecliptic longitude in degrees.
    Returns pillars plus the Day Master and the term used.
    """
    if not (0 <= hh <= 23):
        raise ValueError("hour must be 0-23")
    sun_lon = sun_lon % 360.0
    pillar_year = y - 1 if (mo <= 2 and sun_lon < 315) else y
    year_stem = (pillar_year - 4) % 10
    year_branch = (pillar_year - 4) % 12
    segment = int(((sun_lon - 315) % 360.0) // 30)
    month_branch = (2 + segment) % 12
    month_name = JIE_NAMES[segment]
    first_stem = (2 * year_stem + 2) % 10
    month_stem = (first_stem + segment) % 10
    # Day pillar: the day advances at 23:00, so 23:00-24:00 belongs
    # to the next calendar day.
    eff_y, eff_mo, eff_d = (y, mo, d)
    if hh >= 23:
        eff_y, eff_mo, eff_d = next_day(y, mo, d)
    day_idx = (jdn(eff_y, eff_mo, eff_d) + 49) % 60
    day_stem, day_branch = day_idx % 10, day_idx % 12
    # Hour pillar: double-hour branch from the wall hour, stem from
    # the (effective) day stem.
    hour_branch = ((hh + 1) // 2) % 12
    hour_stem = (2 * day_stem + hour_branch) % 10
    pillars = {
        "year": pillar(year_stem, year_branch),
        "month": pillar(month_stem, month_branch),
        "day": pillar(day_stem, day_branch),
        "hour": pillar(hour_stem, hour_branch),
    }
    day_master = STEMS[day_stem]
    return {
        "pillars": pillars,
        "day_master": {"name": day_master[0], "char": day_master[1],
                       "element": day_master[2], "polarity": day_master[3]},
        "pillar_year": pillar_year,
        "month_term": month_name,
        "effective_day": (eff_y, eff_mo, eff_d),
        "text": " ".join(p["text"] for p in pillars.values()),
        "names": " ".join(p["name"] for p in pillars.values()),
    }


if __name__ == "__main__":
    for label, args in [
        ("1990-06-15 10:00 Hong Kong (+8)", (1990, 6, 15, 10, 480)),
        ("1988-04-12 10:00 Taipei (+8)", (1988, 4, 12, 10, 480)),
        ("2000-06-15 12:00 UTC", (2000, 6, 15, 12, 0)),
    ]:
        y, mo, d, hh, off = args
        r = bazi(y, mo, d, hh, mock_sun(y, mo, d, hh, 0, off))
        print(label, "->", r["names"], "|", r["text"],
              "| Day Master:", r["day_master"]["name"], r["day_master"]["element"])
