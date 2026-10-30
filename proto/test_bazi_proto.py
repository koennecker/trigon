"""Tests for proto/bazi_proto.py — the Python-first BaZi verification.

Published examples (checked against their sources, not against the
implementation): 1990-06-15 10:00 Hong Kong and 1988-04-12 10:00
Taipei from the BaZi calculation guides, 2000-06-15 from the
Geng Chen / Ren Wu / Jia Chen day chart, and the three day-cycle
anchors 1900-01-01 = Jia Xu, 1949-10-01 = Jia Zi, 2000-01-01 = Wu Wu.
Lichun instants are the Hong Kong Observatory / Beijing times for
2024-2026, converted to UTC.

Run from the repo root: python3 -m unittest proto.test_bazi_proto -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bazi_proto import (  # noqa: E402
    bazi, solar_term_jd, jd_from_cal, sun_longitude, JIE_TERMS,
)


def names(r):
    return [r["pillars"][k]["name"] for k in ("year", "month", "day", "hour")]


class TestPublishedExamples(unittest.TestCase):
    def test_hong_kong_1990(self):
        # Recorded local clock time, no true-solar correction.
        self.assertEqual(
            names(bazi(1990, 6, 15, 10, 0, 480)),
            ["Geng Wu", "Ren Wu", "Xin Hai", "Gui Si"])

    def test_taipei_1988(self):
        self.assertEqual(
            names(bazi(1988, 4, 12, 10, 0, 480)),
            ["Wu Chen", "Bing Chen", "Ding You", "Yi Si"])

    def test_2000_day_chart(self):
        r = bazi(2000, 6, 15, 12, 0, 0)
        self.assertEqual(names(r)[:3], ["Geng Chen", "Ren Wu", "Jia Chen"])
        self.assertEqual(r["day_master"]["name"], "Jia")


class TestDayCycleAnchors(unittest.TestCase):
    def test_anchors(self):
        self.assertEqual(bazi(1900, 1, 1, 12, 0, 0)["pillars"]["day"]["name"], "Jia Xu")
        self.assertEqual(bazi(1949, 10, 1, 12, 0, 0)["pillars"]["day"]["name"], "Jia Zi")
        self.assertEqual(bazi(2000, 1, 1, 12, 0, 0)["pillars"]["day"]["name"], "Wu Wu")

    def test_pre_lichun_year_and_month(self):
        # 2000-01-01 is before Lichun: previous year, Zi month of it.
        r = bazi(2000, 1, 1, 12, 0, 0)
        self.assertEqual(r["pillars"]["year"]["name"], "Ji Mao")
        self.assertEqual(r["pillars"]["month"]["name"], "Bing Zi")


class TestBoundaries(unittest.TestCase):
    def test_lichun_boundary_2025(self):
        # Lichun 2025 was Feb 3 ~22:10 Beijing time. Three hours either
        # side is safely outside the solver's ~6-minute error, so these
        # pin the boundary logic, not the solver's minute accuracy.
        before = bazi(2025, 2, 3, 19, 0, 480)
        self.assertEqual(names(before)[:2], ["Jia Chen", "Ding Chou"])
        after = bazi(2025, 2, 4, 2, 0, 480)
        self.assertEqual(names(after)[:2], ["Yi Si", "Wu Yin"])

    def test_mangzhong_boundary_1990(self):
        # Mangzhong (Grain in Ear) 1990 was Jun 6 Hong Kong time:
        # Jun 5 is still Si month, Jun 7 is Wu month.
        self.assertEqual(bazi(1990, 6, 5, 12, 0, 480)["pillars"]["month"]["name"], "Xin Si")
        self.assertEqual(bazi(1990, 6, 7, 12, 0, 480)["pillars"]["month"]["name"], "Ren Wu")

    def test_day_advances_at_2300(self):
        # 1990-06-15 is Xin Hai. 22:00 is still that day's Hai hour;
        # 23:00 belongs to the next day (Ren Zi), Zi hour from its stem.
        self.assertEqual(bazi(1990, 6, 15, 22, 0, 480)["pillars"]["day"]["name"], "Xin Hai")
        self.assertEqual(bazi(1990, 6, 15, 22, 0, 480)["pillars"]["hour"]["name"], "Ji Hai")
        late = bazi(1990, 6, 15, 23, 0, 480)
        self.assertEqual(late["pillars"]["day"]["name"], "Ren Zi")
        self.assertEqual(late["pillars"]["hour"]["name"], "Geng Zi")
        # 00:30 the next morning is the same Zi hour of the same day.
        early = bazi(1990, 6, 16, 0, 30, 480)
        self.assertEqual(early["pillars"]["day"]["name"], "Ren Zi")
        self.assertEqual(early["pillars"]["hour"]["name"], "Geng Zi")
        self.assertEqual(bazi(1990, 6, 16, 1, 0, 480)["pillars"]["hour"]["name"], "Xin Chou")

    def test_invalid_hour(self):
        with self.assertRaises(ValueError):
            bazi(1990, 6, 15, 24, 0, 480)


class TestSolarTerms(unittest.TestCase):
    def test_lichun_against_known_instants(self):
        # Known Beijing-time Lichun instants, as UTC Julian days.
        # 2024 Feb 4 16:27 CST, 2025 Feb 3 22:10 CST, 2026 Feb 4 04:02 CST.
        known = {
            2024: jd_from_cal(2024, 2, 4, 8 + 27 / 60),
            2025: jd_from_cal(2025, 2, 3, 14 + 10 / 60),
            2026: jd_from_cal(2026, 2, 3, 20 + 2 / 60),
        }
        for year, want in known.items():
            got = solar_term_jd(315, jd_from_cal(year, 2, 4, 12))
            self.assertLess(abs(got - want) * 1440, 15,
                            f"Lichun {year} off by {abs(got - want) * 1440:.1f} min")

    def test_all_jie_terms_converge_2025(self):
        for (name, lon, am, ad, br) in JIE_TERMS:
            approx_y = 2026 if am == 1 else 2025
            jd = solar_term_jd(lon, jd_from_cal(approx_y, am, ad, 12))
            err = abs((lon - sun_longitude(jd) + 180) % 360 - 180)
            self.assertLess(err, 0.01, f"{name} solver error {err} deg")


class TestChartData(unittest.TestCase):
    def test_day_master_and_hidden_stems(self):
        r = bazi(1990, 6, 15, 10, 0, 480)
        self.assertEqual(r["day_master"], {"name": "Xin", "char": "\u8f9b",
                                           "element": "Metal", "polarity": "Yin"})
        self.assertEqual(r["pillars"]["year"]["hidden"], ["Ding", "Ji"])
        self.assertEqual(r["pillars"]["month"]["hidden"], ["Ding", "Ji"])
        self.assertEqual(r["pillars"]["day"]["hidden"], ["Ren", "Jia"])
        self.assertEqual(r["pillars"]["hour"]["hidden"], ["Bing", "Geng", "Wu"])
        self.assertEqual(r["pillars"]["year"]["animal"], "Horse")
        self.assertEqual(r["pillars"]["day"]["branch_element"], "Water")


if __name__ == "__main__":
    unittest.main()
