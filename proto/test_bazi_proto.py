"""Tests for proto/bazi_proto.py — the Python-first BaZi verification.

Sun longitude is an input, not computed by bazi(): live code passes
the chart's Sun longitude. These tests have no chart output, so they
use the trig function as the mock Sun provider — mock_sun() below
converts a wall datetime plus offset to the UTC instant and reads
the mock Sun longitude there. Published examples (checked against
their sources, not against the implementation): 1990-06-15 10:00
Hong Kong and 1988-04-12 10:00 Taipei from the BaZi calculation
guides, 2000-06-15 from the Geng Chen / Ren Wu / Jia Chen day chart,
and the three day-cycle anchors 1900-01-01 = Jia Xu, 1949-10-01 =
Jia Zi, 2000-01-01 = Wu Wu.

Run from the repo root: python3 -m unittest proto.test_bazi_proto -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bazi_proto import (  # noqa: E402
    bazi, mock_sun, sun_longitude, jd_from_cal,
)


def make(y, mo, d, hh, mi=0, offset_min=0):
    return bazi(y, mo, d, hh, mock_sun(y, mo, d, hh, mi, offset_min), mi)


def names(r):
    return [r["pillars"][k]["name"] for k in ("year", "month", "day", "hour")]


class TestPublishedExamples(unittest.TestCase):
    def test_hong_kong_1990(self):
        # Recorded local clock time, no true-solar correction.
        self.assertEqual(
            names(make(1990, 6, 15, 10, 0, 480)),
            ["Geng Wu", "Ren Wu", "Xin Hai", "Gui Si"])

    def test_taipei_1988(self):
        self.assertEqual(
            names(make(1988, 4, 12, 10, 0, 480)),
            ["Wu Chen", "Bing Chen", "Ding You", "Yi Si"])

    def test_2000_day_chart(self):
        r = make(2000, 6, 15, 12, 0, 0)
        self.assertEqual(names(r)[:3], ["Geng Chen", "Ren Wu", "Jia Chen"])
        self.assertEqual(r["day_master"]["name"], "Jia")


class TestDayCycleAnchors(unittest.TestCase):
    def test_anchors(self):
        self.assertEqual(make(1900, 1, 1, 12)["pillars"]["day"]["name"], "Jia Xu")
        self.assertEqual(make(1949, 10, 1, 12)["pillars"]["day"]["name"], "Jia Zi")
        self.assertEqual(make(2000, 1, 1, 12)["pillars"]["day"]["name"], "Wu Wu")

    def test_pre_lichun_year_and_month(self):
        # 2000-01-01 is before Lichun: previous year, Zi month of it.
        r = make(2000, 1, 1, 12)
        self.assertEqual(r["pillars"]["year"]["name"], "Ji Mao")
        self.assertEqual(r["pillars"]["month"]["name"], "Bing Zi")


class TestBoundaries(unittest.TestCase):
    def test_lichun_boundary_2025(self):
        # Lichun 2025 was Feb 3 ~22:10 Beijing time. Three hours either
        # side is safely outside the mock's ~6-minute error, so these
        # pin the boundary logic, not the mock's minute accuracy.
        before = make(2025, 2, 3, 19, 0, 480)
        self.assertEqual(names(before)[:2], ["Jia Chen", "Ding Chou"])
        after = make(2025, 2, 4, 2, 0, 480)
        self.assertEqual(names(after)[:2], ["Yi Si", "Wu Yin"])

    def test_mangzhong_boundary_1990(self):
        # Mangzhong (Grain in Ear) 1990 was Jun 6 Hong Kong time:
        # Jun 5 is still Si month, Jun 7 is Wu month.
        self.assertEqual(make(1990, 6, 5, 12, 0, 480)["pillars"]["month"]["name"], "Xin Si")
        self.assertEqual(make(1990, 6, 7, 12, 0, 480)["pillars"]["month"]["name"], "Ren Wu")

    def test_month_segment_boundaries(self):
        # Exact Sun-longitude cuts, no mock involved. Same longitude
        # in February before Lichun belongs to the previous year;
        # in June it does not.
        at = lambda sun, mo: bazi(2025, mo, 15, 12, sun)
        self.assertEqual(
            [at(314.9, 2)["pillars"]["year"]["name"], at(314.9, 2)["pillars"]["month"]["name"]],
            ["Jia Chen", "Ding Chou"])
        self.assertEqual(
            [at(314.9, 6)["pillars"]["year"]["name"], at(314.9, 6)["pillars"]["month"]["name"]],
            ["Yi Si", "Ji Chou"])
        self.assertEqual(at(315.0, 2)["pillars"]["month"]["name"], "Wu Yin")
        self.assertEqual(at(344.9, 6)["pillars"]["month"]["name"], "Wu Yin")
        self.assertEqual(at(345.0, 6)["pillars"]["month"]["name"], "Ji Mao")
        self.assertEqual(at(14.9, 6)["pillars"]["month"]["name"], "Ji Mao")
        self.assertEqual(at(15.0, 6)["pillars"]["month"]["name"], "Geng Chen")
        self.assertEqual(at(284.9, 12)["pillars"]["month"]["name"], "Wu Zi")
        self.assertEqual(at(285.0, 12)["pillars"]["month"]["name"], "Ji Chou")

    def test_day_advances_at_2300(self):
        # 1990-06-15 is Xin Hai. 22:00 is still that day's Hai hour;
        # 23:00 belongs to the next day (Ren Zi), Zi hour from its stem.
        self.assertEqual(make(1990, 6, 15, 22, 0, 480)["pillars"]["day"]["name"], "Xin Hai")
        self.assertEqual(make(1990, 6, 15, 22, 0, 480)["pillars"]["hour"]["name"], "Ji Hai")
        late = make(1990, 6, 15, 23, 0, 480)
        self.assertEqual(late["pillars"]["day"]["name"], "Ren Zi")
        self.assertEqual(late["pillars"]["hour"]["name"], "Geng Zi")
        # 00:30 the next morning is the same Zi hour of the same day.
        early = make(1990, 6, 16, 0, 30, 480)
        self.assertEqual(early["pillars"]["day"]["name"], "Ren Zi")
        self.assertEqual(early["pillars"]["hour"]["name"], "Geng Zi")
        self.assertEqual(make(1990, 6, 16, 1, 0, 480)["pillars"]["hour"]["name"], "Xin Chou")

    def test_invalid_hour(self):
        with self.assertRaises(ValueError):
            bazi(1990, 6, 15, 24, 0)


class TestMock(unittest.TestCase):
    def test_mock_sun_at_published_lichun_instants(self):
        # Known Beijing-time Lichun instants, as UTC Julian days.
        # 2024 Feb 4 16:27 CST, 2025 Feb 3 22:10 CST, 2026 Feb 4 04:02 CST.
        known = {
            2024: jd_from_cal(2024, 2, 4, 8 + 27 / 60),
            2025: jd_from_cal(2025, 2, 3, 14 + 10 / 60),
            2026: jd_from_cal(2026, 2, 3, 20 + 2 / 60),
        }
        for year, jd in known.items():
            lon = sun_longitude(jd)
            err = abs((lon - 315 + 180) % 360 - 180)
            self.assertLess(err, 0.01, f"Lichun {year} mock error {err} deg")


class TestChartData(unittest.TestCase):
    def test_day_master_and_hidden_stems(self):
        r = make(1990, 6, 15, 10, 0, 480)
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
