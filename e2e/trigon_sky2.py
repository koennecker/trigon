#!/usr/bin/env python3
"""E2E for the Sky tab's new features: transparent ground, free-floating
sphere view, and house/sign spokes projected into space."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, math, re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
from dtfill import fill_dt
from PIL import Image

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

# ---------------------------------------------------------------- astronomy
D2R = math.pi / 180
J2000 = 2451545.0
def norm360(d):
    d = d % 360.0
    return d + 360.0 if d < 0 else d
def mean_obliquity(jd):
    t = (jd - J2000) / 36525.0
    return 23.4392911 - (46.8150 * t + 0.00059 * t * t - 0.001813 * t**3) / 3600.0
def gmst(jd):
    t = (jd - J2000) / 36525.0
    return norm360(280.46061837 + 360.98564736629 * (jd - J2000) + 0.000387933 * t * t - t**3 / 38710000.0)
def ecl_to_eq(lon, lat, eps):
    lo, la, e = lon * D2R, lat * D2R, eps * D2R
    ra = norm360(math.atan2(math.sin(lo) * math.cos(e) - math.tan(la) * math.sin(e), math.cos(lo)) / D2R)
    dec = math.asin(max(-1, min(1, math.sin(la) * math.cos(e) + math.cos(la) * math.sin(e) * math.sin(lo)))) / D2R
    return ra, dec
def eq_to_horiz(ra, dec, lst, lat):
    ha = norm360(lst - ra) * D2R
    dc, la = dec * D2R, lat * D2R
    alt = math.asin(max(-1, min(1, math.sin(dc) * math.sin(la) + math.cos(dc) * math.cos(la) * math.cos(ha)))) / D2R
    az = norm360(math.atan2(math.sin(ha), math.cos(ha) * math.sin(la) - math.tan(dc) * math.cos(la)) / D2R + 180.0)
    return az, alt

def jd_of(dt):
    return dt.replace(tzinfo=timezone.utc).timestamp() / 86400.0 + 2440587.5
def readout_jd(page):
    t = page.text_content("#sky-readout")
    m = re.search(r"UTC (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})", t)
    return jd_of(datetime(*map(int, m.groups())))

def bright_below_horizon(path):
    """Bright-pixel count in the bottom-center-right band (below-horizon region).

    Starts at x=w//2 to exclude the readout pill (bottom-left UI chrome).
    Recalibrated 2026-10-01 for the side-drawer layout: the drawer replaced the
    old bottom panel, moving the canvas/readout geometry and raising the opaque
    baseline. The Moon's orbit overlay was verified (on/off pixel diff) not to
    contribute to this count.
    """
    im = Image.open(path).convert("RGB")
    w, h = im.size
    crop = im.crop((w // 2, int(h * 0.55), 3 * w // 4, h))
    px = crop.load()
    n = 0
    for y in range(0, crop.size[1], 2):
        for x in range(0, crop.size[0], 2):
            r, g, b = px[x, y]
            if max(r, g, b) > 40:
                n += 1
    return n

# ---------------------------------------------------------------- harness
httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8127", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
LAT, LON = 40.7128, -74.0060
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8127/", wait_until="networkidle")
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=5000)

        page.click("details#manual-loc summary")
        page.fill("#lat", str(LAT)); page.fill("#lon", str(LON))
        page.dispatch_event("#lon", "change")
        fill_dt(page, "dt", "2026-10-01T12:00")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.wait_for_timeout(600)

        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(1200)

        box = page.eval_on_selector("#sky-canvas",
            "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")
        cx, cy = box["w"] / 2, box["h"] / 2

        def hover_spiral(px, py, want, radius=26, step=6):
            page.eval_on_selector("#sky-canvas", "el => el.scrollIntoView({block: 'center'})")
            page.wait_for_timeout(250)
            bx = page.eval_on_selector("#sky-canvas",
                "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y}; }")
            for rad in range(0, radius + 1, step):
                pts = [(px, py)] if rad == 0 else [
                    (px + rad * math.cos(a), py + rad * math.sin(a))
                    for a in [i * math.pi / 8 for i in range(16)]]
                for (qx, qy) in pts:
                    page.mouse.move(bx["x"] + qx, bx["y"] + qy)
                    page.wait_for_timeout(120)
                    if page.is_visible("#sky-tip"):
                        t = page.text_content("#sky-tip")
                        if want in t:
                            page.mouse.move(4, 4); page.wait_for_timeout(150)
                            return t
            page.mouse.move(4, 4); page.wait_for_timeout(150)
            return None

        def canvas_drag(dx, dy):
            bx = page.eval_on_selector("#sky-canvas",
                "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y}; }")
            page.mouse.move(bx["x"] + cx, bx["y"] + cy)
            page.mouse.down()
            for i in range(1, 11):
                page.mouse.move(bx["x"] + cx + dx * i / 10, bx["y"] + cy + dy * i / 10)
                page.wait_for_timeout(30)
            page.mouse.up()
            page.wait_for_timeout(700)

        def view_on(v):
            return page.eval_on_selector(f'button[data-v="{v}"]', "b => b.classList.contains('on')")

        def set_details(open):
            page.eval_on_selector("details#sky-opts", f"d => d.open = {str(open).lower()}")
            page.wait_for_timeout(300)

        # --- view mode buttons exist
        nbtn = page.eval_on_selector_all(".sky-viewrow button", "els => els.length")
        check("view mode buttons present", nbtn == 2, f"{nbtn} buttons")
        check("observer is the default view", view_on("observer") and not view_on("sphere"))

        # --- 1. transparent ground: look toward the horizon, compare pixels
        canvas_drag(0, 260)  # pitch down toward the ground
        page.screenshot(path=f"{SHOT}/shot_sky2_ground_opaque.png")
        set_details(True)
        page.check('#sky-overlays label:has-text("Transparent ground") input')
        page.wait_for_timeout(900)
        tg = page.eval_on_selector('#sky-overlays label:has-text("Transparent ground") input',
                                  "e => e.checked")
        check("transparent ground checkbox toggles", tg)
        set_details(False)
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOT}/shot_sky2_ground_transparent.png")
        n_opaque = bright_below_horizon(f"{SHOT}/shot_sky2_ground_opaque.png")
        n_transp = bright_below_horizon(f"{SHOT}/shot_sky2_ground_transparent.png")
        check("transparent ground reveals below-horizon sky", n_transp > max(20, n_opaque * 1.5),
              f"bright px opaque={n_opaque} transparent={n_transp}")

        # --- 2. sphere view: Sun faced at centre, hover works, orbit works
        set_details(True)
        page.click('button[data-v="sphere"]')
        set_details(False)
        page.wait_for_timeout(1000)
        check("sphere view activates", view_on("sphere"))
        ro = page.text_content("#sky-readout")
        check("readout marks sphere view", "sphere view" in ro)
        tip = hover_spiral(cx, cy, "Sun", radius=40)
        check("Sun hovered at sphere centre (placement correct)", tip is not None, (tip or "")[:60])
        page.screenshot(path=f"{SHOT}/shot_sky2_sphere.png")
        canvas_drag(220, 0)  # orbit the sphere
        tip2 = hover_spiral(cx, cy, "Sun", radius=30)
        check("orbit drag moves the sky (Sun left centre)", tip2 is None)
        page.screenshot(path=f"{SHOT}/shot_sky2_sphere_orbit.png")

        # --- 3. house & sign spokes
        set_details(True)
        page.check('#sky-overlays label:has-text("House & sign spokes") input')
        page.wait_for_timeout(900)
        sp = page.eval_on_selector('#sky-overlays label:has-text("House & sign spokes") input',
                                  "e => e.checked")
        check("spokes checkbox toggles", sp)
        set_details(False)
        page.wait_for_timeout(600)
        page.screenshot(path=f"{SHOT}/shot_sky2_spokes.png")

        # --- back to observer: rendering intact
        set_details(True)
        page.click('button[data-v="observer"]')
        set_details(False)
        page.wait_for_timeout(1000)
        check("back to observer view", view_on("observer") and not view_on("sphere"))
        ro2 = page.text_content("#sky-readout")
        check("readout back to observer", "sphere view" not in ro2 and "UTC" in ro2)
        page.screenshot(path=f"{SHOT}/shot_sky2_back.png")

        check("zero console errors", len(cerr) == 0, "; ".join(cerr[:3]))
        check("zero page errors", len(perr) == 0, "; ".join(perr[:3]))
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
