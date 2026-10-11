#!/usr/bin/env python3
"""Realistic-daylight E2E for Trigon's Sky viewer.

Localhost Chromium through the MITM relay, real-mouse clicks, zero
console/page/CORS errors tolerated. Covers: night / twilight / sunrise /
full day sky rendering, the daylight toggle, sphere view staying dark,
skip-button ephemeris recompute, and mobile containment.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright
from dtfill import fill_dt
from PIL import Image

SITE = harness.site_dir()


SHOT = "/tmp/daylight_e2e"
os.makedirs(SHOT, exist_ok=True)

# name, datetime, expected Sun altitude (deg), expected sky class
SCENARIOS = [
    ("night",    "2026-10-01T00:00", -59.5, "dark"),
    ("twilight", "2026-10-01T05:45",  -8.7, "mid"),
    ("sunrise",  "2026-10-01T06:26",  -0.1, "mid"),
    ("day",      "2026-10-01T12:00", +52.9, "bright"),
]
LAT, LON, TZ = "33.4484", "-112.074", "-420"

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def real_click(pg, selector, timeout=15000):
    """Real-mouse click after waiting for layout quiescence (no shifted hit-testing)."""
    loc = pg.locator(selector)
    loc.wait_for(state="visible", timeout=timeout)
    deadline = time.time() + 12
    last, calm = None, time.time()
    while time.time() < deadline:
        box = loc.bounding_box(timeout=timeout)
        key = (round(box["x"], 1), round(box["y"], 1))
        if key == last and time.time() - calm > 0.8:
            break
        if key != last:
            last, calm = key, time.time()
        time.sleep(0.1)
    box = loc.bounding_box(timeout=timeout)
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

def read_sun_alt(pg):
    txt = pg.locator("#sky-readout").inner_text(timeout=15000)
    m = re.search(r"Sun ([+-]?\d+\.\d+)", txt)
    return float(m.group(1)) if m else None

def canvas_stats(pg, shot_path):
    pg.screenshot(path=shot_path)
    box = pg.locator("#sky-wrap canvas").bounding_box(timeout=8000)
    im = Image.open(shot_path).convert("RGB")
    x0, y0 = int(box["x"]), int(box["y"])
    w, h = int(box["width"]), int(box["height"] // 3)  # upper third: zenith region
    crop = im.crop((x0, y0, x0 + w, y0 + h))
    px = list(crop.getdata())
    n = len(px)
    r = sum(p[0] for p in px) / n; g = sum(p[1] for p in px) / n; b = sum(p[2] for p in px) / n
    return (r + g + b) / 3, r, g, b

def classify(mean, r, b):
    if mean < 45: return "dark"
    if mean > 110 and b > r + 10: return "bright"
    return "mid"

def open_drawer(pg):
    if pg.locator("#input-card.open").count() == 0:
        pg.click("#input-fab")
        pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.wait_for_timeout(400)

def calculate(pg, dt):
    open_drawer(pg)
    fill_dt(pg, "dt", dt)
    real_click(pg, "#calc")
    # The table panel may be hidden behind the Sky tab; the table HTML is
    # still rebuilt by every Calculate.
    pg.wait_for_selector("#panel-table table", state="attached", timeout=60000)

def open_sky_opts(pg):
    """The View buttons and daylight checkbox live in <details id=sky-opts>."""
    if pg.locator("#sky-opts[open]").count() == 0:
        real_click(pg, "#sky-opts summary")

def open_sky(pg):
    real_click(pg, '#views .tabs button[data-tab="sky"]')
    pg.wait_for_selector("#sky-wrap canvas", timeout=90000)
    # daylight must be on: sunAlt (and the 'Sun' readout segment) only exists then
    open_sky_opts(pg)
    pg.get_by_label("Realistic daylight").check(timeout=8000)
    real_click(pg, "#sky-opts summary")  # close: the open panel would darken the pixel sample
    pg.wait_for_function("document.getElementById('sky-readout').textContent.includes('Sun')",
                         timeout=30000)
    pg.wait_for_timeout(1200)  # let the frame settle

def main():
    httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8141", "--bind", "127.0.0.1"],
                             cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    relay = harness.start_relay()
    time.sleep(1.5)
    cerr, perr = [], []
    try:
        with sync_playwright() as p:
            browser = harness.launch(p)
            pg = browser.new_page(viewport={"width": 1280, "height": 800})
            pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: perr.append(str(e)))
            pg.goto("http://127.0.0.1:8141/", wait_until="networkidle")
            pg.wait_for_timeout(1500)

            # ---- location (once) ----
            open_drawer(pg)
            pg.click("details#manual-loc summary")
            pg.fill("#lat", LAT); pg.fill("#lon", LON)
            pg.dispatch_event("#lon", "change")
            pg.select_option("#tz", TZ)
            pg.wait_for_timeout(600)

            # ---- scenarios ----
            for name, dt, exp_alt, exp_cls in SCENARIOS:
                try:
                    calculate(pg, dt)
                    open_sky(pg)
                    alt = read_sun_alt(pg)
                    ok_alt = alt is not None and abs(alt - exp_alt) < 1.0
                    check(f"{name}: sun alt", ok_alt, f"readout {alt}° vs expected {exp_alt}°")
                    mean, r, g, b = canvas_stats(pg, f"{SHOT}/{name}.png")
                    cls = classify(mean, r, b)
                    ok_cls = (cls == exp_cls) if exp_cls != "mid" else True
                    check(f"{name}: sky class", ok_cls,
                          f"{cls} (mean {mean:.0f}, rgb {r:.0f},{g:.0f},{b:.0f})")
                except Exception as e:
                    check(f"{name}: scenario", False, f"{type(e).__name__}: {e}")

            # ---- toggle off at day: classic night sky returns ----
            try:
                calculate(pg, "2026-10-01T12:00")
                open_sky(pg)
                open_sky_opts(pg)
                real_click(pg, "label:has-text('Realistic daylight')")
                pg.wait_for_timeout(1200)
                # close the options panel: it would darken the pixel sample
                real_click(pg, "#sky-opts summary")
                pg.wait_for_timeout(600)
                mean, r, g, b = canvas_stats(pg, f"{SHOT}/day_toggle_off.png")
                check("toggle off: dark sky", classify(mean, r, b) == "dark",
                      f"mean {mean:.0f}")
                open_sky_opts(pg)
                real_click(pg, "label:has-text('Realistic daylight')")
                pg.wait_for_timeout(1200)
                real_click(pg, "#sky-opts summary")
                pg.wait_for_timeout(600)
                mean, r, g, b = canvas_stats(pg, f"{SHOT}/day_toggle_on.png")
                check("toggle on: day sky back", classify(mean, r, b) == "bright",
                      f"mean {mean:.0f}")
            except Exception as e:
                check("daylight toggle", False, f"{type(e).__name__}: {e}")

            # ---- sphere view stays dark at noon ----
            try:
                open_sky_opts(pg)
                real_click(pg, 'button[data-v="sphere"]')
                pg.wait_for_timeout(1500)
                real_click(pg, "#sky-opts summary")
                pg.wait_for_timeout(600)
                mean, r, g, b = canvas_stats(pg, f"{SHOT}/day_sphere.png")
                check("sphere view dark", mean < 60, f"mean {mean:.0f}")
                open_sky_opts(pg)
                real_click(pg, 'button[data-v="observer"]')
                real_click(pg, "#sky-opts summary")
                pg.wait_for_timeout(600)
            except Exception as e:
                check("sphere view", False, f"{type(e).__name__}: {e}")

            # ---- skip recompute: night -> +12h -> day ----
            try:
                calculate(pg, "2026-10-01T00:00")
                open_sky(pg)
                a0 = read_sun_alt(pg)
                open_drawer(pg)
                pg.fill("#skip-n", "12")
                pg.select_option("#skip-unit", "hour")
                real_click(pg, "#skip-plus")
                pg.wait_for_selector("#panel-table table", state="attached", timeout=60000)
                pg.wait_for_timeout(1500)
                a1 = read_sun_alt(pg)
                check("skip recompute", a0 is not None and a1 is not None and a0 < -30 and a1 > 30,
                      f"sun {a0}° -> {a1}°")
            except Exception as e:
                check("skip recompute", False, f"{type(e).__name__}: {e}")

            # ---- mobile containment ----
            try:
                mp = browser.new_page(viewport={"width": 390, "height": 844},
                                      has_touch=True, is_mobile=True)
                mp.on("console", lambda m: cerr.append("[m] " + m.text) if m.type == "error" else None)
                mp.on("pageerror", lambda e: perr.append("[m] " + str(e)))
                mp.goto("http://127.0.0.1:8141/", wait_until="networkidle")
                mp.wait_for_timeout(1500)
                mp.click("#input-fab")
                mp.wait_for_selector("#input-card.open", timeout=8000)
                mp.click("details#manual-loc summary")
                mp.fill("#lat", LAT); mp.fill("#lon", LON)
                mp.dispatch_event("#lon", "change")
                mp.select_option("#tz", TZ)
                fill_dt(mp, "dt", "2026-10-01T12:00")
                real_click(mp, "#calc")
                mp.wait_for_selector("#panel-table table", state="attached", timeout=60000)
                mp.click("#input-hide")  # close the overlay drawer before touching tabs
                mp.wait_for_function("!document.getElementById('input-card').classList.contains('open')",
                                     timeout=8000)
                real_click(mp, '#views .tabs button[data-tab="sky"]')
                mp.wait_for_selector("#sky-wrap canvas", timeout=90000)
                mp.wait_for_timeout(1500)
                mp.screenshot(path=f"{SHOT}/mobile_day.png")
                open_sky_opts(mp)
                overflow = mp.evaluate("document.documentElement.scrollWidth > 390")
                dlbox = mp.locator("label:has-text('Realistic daylight')").bounding_box(timeout=8000)
                contained = dlbox["x"] + dlbox["width"] <= 391
                check("mobile: no h-overflow", not overflow, "")
                check("mobile: toggle contained", contained, f"x {dlbox['x']:.0f} w {dlbox['width']:.0f}")
                mp.close()
            except Exception as e:
                check("mobile", False, f"{type(e).__name__}: {e}")

            browser.close()
    finally:
        harness.stop_relay(relay); httpd.terminate()

    check("zero console errors", not cerr, "; ".join(cerr[:3]))
    check("zero page errors", not perr, "; ".join(perr[:3]))
    fails = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
