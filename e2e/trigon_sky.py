#!/usr/bin/env python3
"""E2E for the Sky tab: lazy three.js/star loading, IndexedDB caching of
sefstars.txt, overlay toggles, hover lore for stars and bodies, clock/skip
driving the 3D view, desktop + mobile screenshots, zero console errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, math, re
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

# ---------------------------------------------------------------- astronomy
# Mirrors site/sky-data.js (already node-tested against the Python prototype).
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
def precess(ra, dec, jd_from, jd_to):
    # Meeus rotation-matrix form, verified against the direct formula.
    def mat(jd):
        t = (jd - J2000) / 36525.0
        z = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t**3) / 3600.0 * D2R
        th = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t**3) / 3600.0 * D2R
        zp = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t**3) / 3600.0 * D2R
        cz, sz, ct, st, czp, szp = math.cos(z), math.sin(z), math.cos(th), math.sin(th), math.cos(zp), math.sin(zp)
        return [[cz*ct*czp - sz*szp, -cz*ct*szp - sz*czp, -cz*st],
                [sz*ct*czp + cz*szp, -sz*ct*szp + cz*czp, -sz*st],
                [st*czp, -st*szp, ct]]
    def xpose(m): return [[m[j][i] for j in range(3)] for i in range(3)]
    def mmul(a, b): return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    p = mmul(mat(jd_to), xpose(mat(jd_from)))
    r, d = ra * D2R, dec * D2R
    v = [math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d)]
    w = [sum(p[i][k] * v[k] for k in range(3)) for i in range(3)]
    return (norm360(math.atan2(w[1], w[0]) / D2R), math.asin(max(-1, min(1, w[2]))) / D2R)
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
def horiz_to_vec(az, alt, r=400.0):
    a, h = az * D2R, alt * D2R
    return (r * math.cos(h) * math.sin(a), r * math.sin(h), -r * math.cos(h) * math.cos(a))

SPICA = dict(name="Spica", ra=201.29824, dec=-11.16132, pmra=-42.35, pmdec=-30.67,
             lore_hint="Chitra")
def star_apparent(st, jd):
    yrs = (jd - J2000) / 365.25
    ra = st["ra"] + (st["pmra"] / 3600000.0) * yrs / math.cos(st["dec"] * D2R)
    dec = st["dec"] + (st["pmdec"] / 3600000.0) * yrs
    return precess(ra % 360, dec, J2000, jd)

def sun_horiz(jd):
    """Low-precision Sun alt/az (~0.01 deg lon) for the first-show camera aim."""
    n = jd - 2451545.0
    L = norm360(280.460 + 0.9856474 * n)
    g = norm360(357.528 + 0.9856003 * n) * D2R
    lam = norm360(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = mean_obliquity(jd); lst = norm360(gmst(jd) + LON)
    ra, dec = ecl_to_eq(lam, 0.0, eps)
    return eq_to_horiz(ra, dec, lst, LAT)

# Camera model mirrors sky.js initial view: eye=(0,2.5,0), yaw=PI, pitch=0.42, fov=62.
def project(az, alt, w, h, yaw=math.pi, pitch=0.42, fov=62.0):
    x, y, z = horiz_to_vec(az, alt)
    ex, ey, ez = 0.0, 2.5, 0.0
    sp, cp = math.sin(pitch), math.cos(pitch)
    sy, cy = math.sin(yaw), math.cos(yaw)
    fx, fy, fz = sy * cp, sp, -cy * cp
    zx, zy, zz = -fx, -fy, -fz
    xx, xy, xz = zz, 0.0, -zx
    n = math.hypot(xx, xy, xz); xx /= n; xy /= n; xz /= n
    yx = zy * xz - zz * xy; yy = zz * xx - zx * xz; yz = zx * xy - zy * xx
    vx, vy, vz = x - ex, y - ey, z - ez
    vxx = vx * xx + vy * xy + vz * xz
    vyy = vx * yx + vy * yy + vz * yz
    depth = vx * fx + vy * fy + vz * fz
    if depth <= 0: return None
    t = math.tan(fov / 2 * D2R); aspect = w / h
    nx, ny = vxx / (depth * t * aspect), vyy / (depth * t)
    return ((nx + 1) / 2 * w, (1 - ny) / 2 * h)

def jd_of(dt):
    return dt.replace(tzinfo=timezone.utc).timestamp() / 86400.0 + 2440587.5

def readout_jd(page):
    """Actual UTC instant shown by the sky readout (dt input is local wall time)."""
    t = page.text_content("#sky-readout")
    m = re.search(r"UTC (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})", t)
    return jd_of(datetime(*map(int, m.groups())))

def sky_body_lonlat(page, name):
    """Ecliptic lon/lat of a sky body from the app's own E2E hook.

    The #panel-table body rows are deliberately NOT re-patched while the Sky
    tab is visible (updateLiveResults gates tick DOM work on the table panel
    being visible), so parsing the table after a skip/clock change reads stale
    values. The hook reflects the glyphs actually rendered."""
    bs = page.evaluate("() => window.__skyBodyState()")
    b = next(x for x in bs if x["name"] == name)
    return b["lon"], b["lat"]

def open_drawer(pg):
    """Open the side drawer and wait out its slide-in transition."""
    pg.click("#input-fab")
    pg.wait_for_selector("#input-card.open", timeout=5000)
    pg.wait_for_timeout(400)

def real_click(pg, selector):
    """Real-mouse click: scroll into view inside the drawer, settle, then click
    the bounding-box centre (stable hit-test, no synthetic events)."""
    pg.locator(selector).scroll_into_view_if_needed(timeout=5000)
    pg.wait_for_timeout(150)
    box = pg.locator(selector).bounding_box(timeout=5000)
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)

def real_click_calc(pg):
    """Real-mouse click on Calculate (see real_click)."""
    real_click(pg, "#calc")

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
        cerr, perr, reqs = [], [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.on("request", lambda r: reqs.append(r.url))
        page.goto("http://127.0.0.1:8127/", wait_until="networkidle")
        open_drawer(page)

        # --- setup: NYC, fixed date
        page.click("details#manual-loc summary")
        page.fill("#lat", str(LAT)); page.fill("#lon", str(LON))
        page.dispatch_event("#lon", "change")
        fill_dt(page, "dt", "2026-10-01T12:00")
        real_click_calc(page)
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.wait_for_timeout(600)

        def saw(pat): return any(pat in u for u in reqs)
        check("three.js not fetched before Sky tab", not saw("three.module.min.js"))
        check("sefstars.txt not fetched before Sky tab", not saw("sefstars.txt"))

        # --- open Sky tab
        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(1200)
        check("three.js fetched lazily on tab open", saw("three.module.min.js"))
        check("sefstars.txt downloaded on first open", saw("sefstars.txt"))
        page.screenshot(path=f"{SHOT}/shot_sky_day.png")
        check("sky canvas rendered", page.is_visible("#sky-canvas canvas"))

        box = page.eval_on_selector("#sky-canvas", "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")

        def hover_spiral(px, py, want, label, radius=26, step=6):
            """Spiral mouse search for a hover target; returns tooltip text or None."""
            page.eval_on_selector("#sky-canvas",
                "el => el.scrollIntoView({block: 'center', inline: 'center'})")
            page.wait_for_timeout(250)
            bx = page.eval_on_selector("#sky-canvas", "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y}; }")
            el = page.evaluate(f"() => (document.elementFromPoint({bx['x']+px}, {bx['y']+py}) || {{}}).id || 'none'")
            if "after skip" in label: print("    elementFromPoint at Sun:", el, "| url:", page.url)
            for rad in range(0, radius + 1, step):
                pts = [(px, py)] if rad == 0 else [
                    (px + rad * math.cos(a), py + rad * math.sin(a))
                    for a in [i * math.pi / 8 for i in range(16)]]
                for (qx, qy) in pts:
                    page.mouse.move(bx["x"] + qx, bx["y"] + qy)
                    page.wait_for_timeout(120)
                    if page.is_visible("#sky-tip"):
                        t = page.text_content("#sky-tip")
                        if want in t: return t
            page.mouse.move(4, 4); page.wait_for_timeout(150)
            return None

        # --- star hover: Spica rides the ecliptic near the meridian at this
        # instant; use the real UTC instant from the readout (dt is local)
        jd = readout_jd(page); eps = mean_obliquity(jd); lst = norm360(gmst(jd) + LON)
        # first-show camera aim: at the Sun (Sun is up in this geometry)
        saz0, salt0 = sun_horiz(jd)
        yaw0, pitch0 = saz0 * D2R, max(0.12, salt0 * D2R)
        ra, dec = star_apparent(SPICA, jd)
        az, alt = eq_to_horiz(ra, dec, lst, LAT)
        sp = project(az, alt, box["w"], box["h"], yaw=yaw0, pitch=pitch0)
        check("Spica above horizon in test geometry", alt > 5 and sp is not None, f"alt={alt:.1f}")
        tip = hover_spiral(*sp, "Spica", "spica hover")
        check("star hover tooltip shows Spica", tip is not None, (tip or "")[:60])
        check("tooltip carries tradition lore", tip is not None and "Chitra" in tip,
              (tip or "")[:100])
        if tip: print("    tip:", tip.replace("\n", " | ")[:200])

        # --- overlay toggles: nakshatras + xiu
        page.click("#sky-opts summary")
        page.check('#sky-overlays input >> nth=5')   # nakshatra
        page.check('#sky-overlays input >> nth=6')   # xiu
        page.wait_for_timeout(900)
        n_labels = page.eval_on_selector_all("#sky-overlays input",
            "els => els.filter(e => e.checked).length")
        check("overlay checkboxes toggle", n_labels >= 7, f"{n_labels} on")
        page.screenshot(path=f"{SHOT}/shot_sky_rings.png")

        # --- more overlays: galactic + graticule + poles
        page.check('#sky-overlays input >> nth=12')  # galactic
        page.check('#sky-overlays input >> nth=13')  # graticule
        page.check('#sky-overlays input >> nth=14')  # poles
        page.click("#sky-opts summary")
        page.wait_for_timeout(900)
        page.screenshot(path=f"{SHOT}/shot_sky_circles.png")

        # --- celestial equator overlay (fixed construction: was fed xyz as az/alt)
        page.click("#sky-opts summary")
        page.check('#sky-overlays input >> nth=8')   # equator
        page.click("#sky-opts summary")
        page.wait_for_timeout(900)
        page.screenshot(path=f"{SHOT}/shot_sky_equator.png")

        # --- Sun hover near local noon: 12:56 local wall time = 16:56 UTC
        # (the readout stamps whole seconds, one less than the wall time)
        prev_ro = page.text_content("#sky-readout")
        open_drawer(page)
        fill_dt(page, "dt", "2026-10-01T12:56")
        real_click_calc(page)
        page.wait_for_function(
            f"document.getElementById('sky-readout').textContent !== '{prev_ro}'", timeout=60000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.wait_for_timeout(400)
        slon, slat = sky_body_lonlat(page, "Sun")
        check("Sun lon/lat read from sky hook", slon is not None, f"lon={slon:.2f}")
        jd2 = readout_jd(page); eps2 = mean_obliquity(jd2); lst2 = norm360(gmst(jd2) + LON)
        sra, sdec = ecl_to_eq(slon, slat, eps2)
        saz, salt = eq_to_horiz(sra, sdec, lst2, LAT)
        sun_px = project(saz, salt, box["w"], box["h"], yaw=yaw0, pitch=pitch0)
        check("Sun in initial view at local noon", salt > 5 and sun_px is not None,
              f"alt={salt:.1f} az={saz:.1f}")
        stip = hover_spiral(*sun_px, "Sun", "sun hover")
        check("body hover tooltip shows Sun", stip is not None, (stip or "")[:60])
        if stip: print("    tip:", stip.replace("\n", " | ")[:160])
        page.screenshot(path=f"{SHOT}/shot_sky_noon.png")

        # --- time skip moves the sky: +7 days
        open_drawer(page)
        page.fill("#skip-n", "7")
        prev = page.text_content("#meta-stamp")
        real_click(page, "#skip-plus")
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.wait_for_function(
            f"document.getElementById('meta-stamp').textContent !== '{prev}'", timeout=60000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('2026-10-08')", timeout=60000)
        page.wait_for_timeout(800)
        check("sky readout follows skip", "2026-10-08" in page.text_content("#sky-readout"),
              page.text_content("#sky-readout")[:60])
        slon3, slat3 = sky_body_lonlat(page, "Sun")
        check("post-skip Sun lon moved ~7 deg", abs(slon3 - slon) > 5, f"{slon:.2f} -> {slon3:.2f}")
        jd3 = readout_jd(page); eps3 = mean_obliquity(jd3); lst3 = norm360(gmst(jd3) + LON)
        sra3, sdec3 = ecl_to_eq(slon3, slat3, eps3)
        saz3, salt3 = eq_to_horiz(sra3, sdec3, lst3, LAT)
        sun_px3 = project(saz3, salt3, box["w"], box["h"], yaw=yaw0, pitch=pitch0)
        moved = math.hypot(sun_px3[0] - sun_px[0], sun_px3[1] - sun_px[1])
        check("Sun glyph moves after 7-day skip", moved > 15, f"moved {moved:.0f}px")
        stip3 = hover_spiral(*sun_px3, "Sun", "sun hover after skip")
        check("Sun tooltip still works after skip", stip3 is not None)
        print("    url at skip7 screenshot:", page.url)
        page.screenshot(path=f"{SHOT}/shot_sky_skip7.png")

        # --- drag pans the view smoothly (yaw unit regression: a small drag
        # must not collapse the view). Drag right 60px -> yaw -= 15 deg.
        page.eval_on_selector("#sky-canvas", "el => el.scrollIntoView({block: 'center', inline: 'center'})")
        page.wait_for_timeout(250)
        bx = page.eval_on_selector("#sky-canvas", "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")
        cx, cy = bx["x"] + bx["w"] / 2, bx["y"] + bx["h"] / 2
        page.mouse.move(cx, cy); page.wait_for_timeout(200)
        page.mouse.down(); page.wait_for_timeout(100)
        page.mouse.move(cx + 60, cy, steps=6); page.wait_for_timeout(200)
        page.mouse.up(); page.wait_for_timeout(400)
        yaw1 = yaw0 - 60 * 0.25 * D2R
        drag_px = project(saz3, salt3, box["w"], box["h"], yaw=yaw1, pitch=pitch0)
        ddrag = math.hypot(drag_px[0] - sun_px3[0], drag_px[1] - sun_px3[1])
        check("drag pans view by a sane amount", drag_px is not None and 60 < ddrag < 500,
              f"sun moved {ddrag:.0f}px for 60px drag")
        dtip = hover_spiral(*drag_px, "Sun", "sun hover after drag", radius=40)
        check("Sun tooltip works after drag", dtip is not None)

        # --- IndexedDB persistence
        idb = page.evaluate("""async () => {
            const db = await new Promise((res, rej) => {
              const q = indexedDB.open('swisseph-ephe', 1);
              q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            const v = await new Promise((res, rej) => {
              const q = db.transaction('files', 'readonly').objectStore('files').get('sefstars.txt');
              q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
            return v ? v.byteLength : 0; }""")
        check("sefstars.txt cached in IndexedDB", idb > 100000, f"{idb} bytes")

        # --- reload: catalogue must come from cache, no network fetch
        reqs.clear()
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.click('button[data-tab="sky"]')
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(800)
        check("cached reload: no sefstars.txt network fetch", not saw("sefstars.txt"))
        check("cached reload: canvas renders", page.is_visible("#sky-canvas canvas"))
        page.screenshot(path=f"{SHOT}/shot_sky_cached.png")

        # --- mobile layout (fresh context, like a real device)
        mctx = browser.new_context(viewport={"width": 390, "height": 844})
        m = mctx.new_page()
        m.on("console", lambda e: cerr.append(e.text) if e.type == "error" else None)
        m.on("pageerror", lambda e: perr.append(str(e)))
        m.goto("http://127.0.0.1:8127/", wait_until="networkidle")
        open_drawer(m)
        m.click("details#manual-loc summary")
        m.fill("#lat", str(LAT)); m.fill("#lon", str(LON))
        m.dispatch_event("#lon", "change")
        fill_dt(m, "dt", "2026-10-01T12:00")
        real_click_calc(m)
        m.wait_for_selector("#panel-table .planet-cards .planet-card", timeout=90000)
        m.keyboard.press("Escape")
        m.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        m.wait_for_timeout(400)
        m.click('button[data-tab="sky"]')
        m.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        m.wait_for_timeout(1000)
        m.screenshot(path=f"{SHOT}/shot_sky_mobile.png")
        check("mobile: sky renders at 390px", m.is_visible("#sky-canvas canvas"))
        mctx.close()

        check("zero console errors", len(cerr) == 0, "; ".join(cerr[:3]))
        check("zero page errors", len(perr) == 0, "; ".join(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
