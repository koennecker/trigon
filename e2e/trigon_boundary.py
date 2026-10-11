#!/usr/bin/env python3
"""E2E for the chart's effective-vs-actual longitude split: glyphs at late
degrees of a sign are nudged back inside their sign (effective longitude) so
they don't sit on the radial sign-divider lines, while labels and aspect orbs
keep the actual longitude. Drives renderChartSVG directly with synthetic data.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import math, re, subprocess, sys, time, os
from playwright.sync_api import sync_playwright

SITE = harness.site_dir()

SHOT = "/tmp/trigon_boundary.png"

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def make_out(mars_lon, asc=0.0, mc=90.0, node=180.0, planets=None):
    out = [0.0] * 84
    lons = list(planets) if planets else [100, 140, 180, 220, mars_lon, 15.0, 260, 300, 320, 340]
    lons[4] = mars_lon  # Mars is planet index 4
    for i, lo in enumerate(lons):
        out[i * 6] = lo
    out[60] = node    # true node
    out[72] = asc     # -> ref = floor(asc/30)*30, sign boundaries at ref+k*30
    out[73] = mc
    return out

def glyph_xy(svg, char):
    # Glyphs live in radial labels. Horizontal: <text x=".." y="..">..♂..</text>.
    # Radial: <tspan x=".." y="..">♂</tspan> inside a text without x/y.
    # Prefer the tspan position (exact token location).
    for m in re.finditer(r'<tspan x="([0-9.]+)" y="([0-9.]+)"[^>]*>([^<]*?)</tspan>', svg):
        if char in m.group(3):
            return float(m.group(1)), float(m.group(2))
    for m in re.finditer(r'<text x="([0-9.]+)" y="([0-9.]+)"[^>]*>(.*?)</text>', svg, re.DOTALL):
        if char in m.group(3):
            return float(m.group(1)), float(m.group(2))
    assert False, f"glyph {char!r} not found"

def lon_of(x, y, ref=0.0):
    t = math.degrees(math.atan2(-(y - 350.0), x - 350.0))  # chart is 700x700, center 350
    return (ref + t - 180.0) % 360.0

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8125", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8125/", wait_until="networkidle")

        def render(mars_lon, **kw):
            js = ("import('/chart.js').then(m => m.renderChartSVG("
                  + str(make_out(mars_lon, **kw)) + ", {angleFmt:'dms'}))")
            return page.evaluate(js)

        MARS, JUP = "♂", "♃"
        svg = render(29.9)
        eff_mars = lon_of(*glyph_xy(svg, MARS))
        check("late-degree glyph nudged inside its sign",
              abs(eff_mars - 27.405) < 0.3, f"eff={eff_mars:.2f} (actual 29.9)")
        check("clearance from divider >= 2 deg",
              30.0 - (eff_mars % 30) >= 2.0, f"{30.0 - (eff_mars % 30):.2f} deg")
        check("label still shows actual degree",
              re.search(r'<text[^>]*>.*?29°', svg) is not None,
              "degree text shows 29° (actual), not the nudged 27°")

        eff_jup = lon_of(*glyph_xy(svg, JUP))
        check("mid-sign glyph not nudged", abs(eff_jup - 15.0) < 0.15,
              f"eff={eff_jup:.2f} (actual 15.0)")

        e_hi = lon_of(*glyph_xy(render(26.1), MARS))
        e_lo = lon_of(*glyph_xy(render(25.9), MARS))
        check("no jump at nudge-zone edge", abs(e_hi - e_lo) < 0.6,
              f"eff(26.1)={e_hi:.2f} eff(25.9)={e_lo:.2f}")

        e1 = lon_of(*glyph_xy(render(29.9), MARS))
        e2 = lon_of(*glyph_xy(render(28.0), MARS))
        check("nudge monotonic (order preserved)", e1 > e2,
              f"eff(29.9)={e1:.2f} > eff(28.0)={e2:.2f}")

        # --- early degrees: mirrored nudge forward ---
        svg2 = render(90.1, asc=45.0, mc=180.0, node=260.0,
                      planets=[110, 140, 200, 250, 90.1, 15.0, 300, 320, 340, 0.0])
        eff_e = lon_of(*glyph_xy(svg2, MARS), ref=30.0)
        check("early-degree glyph nudged inside its sign",
              abs(eff_e - 92.595) < 0.3, f"eff={eff_e:.2f} (actual 90.1)")
        check("clearance from lower divider >= 2 deg",
              (eff_e % 30) >= 2.0, f"{eff_e % 30:.2f} deg")
        check("early label still shows actual degree",
              re.search(r'<text[^>]*>.*?0°', svg2) is not None,
              "label shows 0° (actual), not the nudged 2°")
        e3 = lon_of(*glyph_xy(render(90.0, asc=45.0, mc=180.0, node=260.0,
                                     planets=[110, 140, 200, 250, 0.0, 15.0, 300, 320, 340, 0.0]), MARS), ref=30.0)
        check("early nudge monotonic", eff_e > e3,
              f"eff(90.1)={eff_e:.2f} > eff(90.0)={e3:.2f}")

        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # visual: drop the nudged wheel into the page and screenshot it
        page.evaluate("(svg) => { document.querySelector('main').innerHTML = svg; }",
                      render(29.9))
        page.wait_for_timeout(300)
        page.screenshot(path=SHOT)
        print("screenshot:", SHOT)

        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

n = sum(1 for _, ok, _ in results if ok)
print(f"\n{n}/{len(results)} passed")
sys.exit(0 if n == len(results) else 1)
