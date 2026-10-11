#!/usr/bin/env python3
"""Live daylight smoke for the deployed Trigon build: day/night/toggle/sphere."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import sys, time
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()

SHOT = "/tmp/daylight_live"

passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def real_click(pg, selector, timeout=15000):
    pg.locator(selector).scroll_into_view_if_needed(timeout=timeout)
    pg.wait_for_timeout(150)
    pg.locator(selector).click(timeout=timeout, force=False)

def open_drawer(pg):
    if pg.locator("#input-card.open").count() == 0:
        real_click(pg, "#input-fab")
        pg.wait_for_selector("#input-card.open", timeout=8000)

def calculate(pg, dt):
    open_drawer(pg)
    pg.evaluate(f"window.__trigonSetDate('dt', 2026, 'ce', {int(dt[5:7])}, {int(dt[8:10])})")
    pg.evaluate(f"window.__trigonSetTime('dt', {int(dt[11:13])}, 0, 0)")
    real_click(pg, "#calc")
    pg.wait_for_selector("#panel-table table", state="attached", timeout=120000)
    pg.wait_for_timeout(1200)

def open_sky(pg):
    real_click(pg, '#views .tabs button[data-tab="sky"]')
    pg.wait_for_selector("#sky-wrap canvas", timeout=90000)
    pg.wait_for_function("document.getElementById('sky-readout').textContent.includes('Sun')",
                         timeout=60000)
    pg.wait_for_timeout(1500)

def read_sun_alt(pg):
    txt = pg.locator("#sky-readout").inner_text(timeout=15000)
    import re
    m = re.search(r"Sun ([+-]?\d+\.?\d*)", txt)
    return float(m.group(1)) if m else None

def canvas_stats(pg, shot_path):
    import subprocess
    subprocess.run(["mkdir", "-p", SHOT], check=True)
    pg.screenshot(path=shot_path)
    box = pg.locator("#sky-wrap canvas").bounding_box(timeout=8000)
    from PIL import Image
    im = Image.open(shot_path).convert("RGB")
    x0, y0 = int(box["x"]), int(box["y"])
    w, h = int(box["width"]), int(box["height"] // 3)  # upper third: zenith region
    crop = im.crop((x0, y0, x0 + w, y0 + h))
    px = list(crop.getdata())
    n = len(px)
    r = sum(p[0] for p in px) / n; g = sum(p[1] for p in px) / n; b = sum(p[2] for p in px) / n
    return (r + g + b) / 3, r, g, b

def open_sky_opts(pg):
    if pg.locator("#sky-opts[open]").count() == 0:
        real_click(pg, "#sky-opts summary")
        pg.wait_for_timeout(400)

cerr, perr = [], []
with sync_playwright() as p:
    browser = harness.launch(p)
    pg = browser.new_page(viewport={"width": 1280, "height": 800})
    pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: perr.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=90000)
    pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
    pg.wait_for_timeout(1000)

    open_drawer(pg)
    pg.click("details#manual-loc summary")
    pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
    pg.dispatch_event("#lon", "change")
    pg.select_option("#tz", "UTC-07:00")
    pg.wait_for_timeout(600)

    try:  # noon -> bright day sky
        calculate(pg, "2026-10-01T12:00")
        open_sky(pg)
        alt = read_sun_alt(pg)
        check("live noon sun alt", alt is not None and abs(alt - 52.9) < 1.0, f"{alt}°")
        mean, r, g, b = canvas_stats(pg, f"{SHOT}/live_day.png")
        check("live noon bright sky", mean > 90 and b > r, f"mean {mean:.0f}")
    except Exception as e:
        check("live noon scenario", False, f"{type(e).__name__}: {e}")

    try:  # midnight -> dark night sky
        calculate(pg, "2026-10-01T00:00")
        open_sky(pg)
        alt = read_sun_alt(pg)
        check("live midnight sun alt", alt is not None and abs(alt + 59.5) < 1.0, f"{alt}°")
        mean, r, g, b = canvas_stats(pg, f"{SHOT}/live_night.png")
        check("live midnight dark sky", mean < 60, f"mean {mean:.0f}")
    except Exception as e:
        check("live midnight scenario", False, f"{type(e).__name__}: {e}")

    try:  # toggle round-trip at noon
        calculate(pg, "2026-10-01T12:00")
        open_sky(pg)
        open_sky_opts(pg)
        real_click(pg, "label:has-text('Realistic daylight')")
        pg.wait_for_timeout(1200)
        real_click(pg, "#sky-opts summary"); pg.wait_for_timeout(600)
        mean, r, g, b = canvas_stats(pg, f"{SHOT}/live_toggle_off.png")
        check("live toggle off dark", mean < 60, f"mean {mean:.0f}")
        open_sky_opts(pg)
        real_click(pg, "label:has-text('Realistic daylight')")
        pg.wait_for_timeout(1200)
        real_click(pg, "#sky-opts summary"); pg.wait_for_timeout(600)
        mean, r, g, b = canvas_stats(pg, f"{SHOT}/live_toggle_on.png")
        check("live toggle on bright", mean > 90, f"mean {mean:.0f}")
    except Exception as e:
        check("live toggle", False, f"{type(e).__name__}: {e}")

    try:  # sphere stays dark at noon
        open_sky_opts(pg)
        real_click(pg, 'button[data-v="sphere"]')
        pg.wait_for_timeout(1500)
        real_click(pg, "#sky-opts summary"); pg.wait_for_timeout(600)
        mean, r, g, b = canvas_stats(pg, f"{SHOT}/live_sphere.png")
        check("live sphere dark", mean < 60, f"mean {mean:.0f}")
    except Exception as e:
        check("live sphere", False, f"{type(e).__name__}: {e}")

    check("zero console errors", len(cerr) == 0, "; ".join(cerr[:3]))
    check("zero page errors", len(perr) == 0, "; ".join(perr[:3]))
    browser.close()

print(f"\n{len(passed)}/{len(passed)+len(failed)} passed")
sys.exit(1 if failed else 0)
