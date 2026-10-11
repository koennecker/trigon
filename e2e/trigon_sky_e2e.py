#!/usr/bin/env python3
"""E2E for Sky tab: South Node, Moon's orbit overlay, sphere screenshots.

Egress-gated: a pre-flight HEAD through the relay must succeed before the
browser launches, so a dead proxy burst fails fast instead of burning a run.
Calculate uses fast-fail detection (immediate proxy errors) with waits
between attempts.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os
import subprocess
import sys
import time
import urllib.request


from dtfill import fill_dt

SE1 = "https://raw.githubusercontent.com/aloistr/swisseph/refs/heads/master/ephe/sepl_18.se1"
SHOT = os.path.dirname(os.path.abspath(__file__)) + "/"
fails = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {extra}" if extra and not cond else ""),
          flush=True)
    if not cond:
        fails.append(name)


def norm360(d):
    return d % 360


def preflight_ok():
    """HEAD the .se1 through the relay; wait out proxy bursts."""
    req = urllib.request.Request(SE1, method="HEAD")
    for i in range(8):
        try:
            r = urllib.request.urlopen(req, timeout=25)
            if r.status in (200, 206):
                print(f"pre-flight egress OK (attempt {i})", flush=True)
                return True
        except Exception as e:
            print(f"pre-flight attempt {i}: {type(e).__name__} {str(e)[:90]}", flush=True)
        time.sleep(15)
    return False


def calc_with_retry(page):
    """Real-mouse Calculate; fast-fail on immediate proxy errors, wait, retry."""
    for attempt in range(6):
        box = page.locator("#calc").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        fast_fail = False
        for _ in range(12):  # up to 60s of download time
            page.wait_for_timeout(5000)
            if page.locator("#panel-table table").count():
                return True
            log = page.evaluate("document.getElementById('log').textContent")
            if "error: Failed to fetch" in log:
                fast_fail = True
                break
        if not fast_fail:
            print(f"  calc attempt {attempt}: no fast-fail, re-clicking", flush=True)
            continue
        print(f"  calc attempt {attempt}: fast fetch failure, waiting out burst", flush=True)
        page.wait_for_timeout(20000)
    return page.locator("#panel-table table").count() > 0


MOON_LBL = """[...document.querySelectorAll('#sky-overlays label')]
    .find(l => l.textContent.includes("Moon's orbit"))"""


def run_desktop(pw, browser):
    cerr, perr = [], []
    ctx = browser.new_context(viewport={"width": 1600, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: cerr.append(m.text[:160]) if m.type == "error" else None)
    page.on("pageerror", lambda e: perr.append(str(e)[:160]))
    page.goto("http://127.0.0.1:8133/", wait_until="networkidle")

    page.click("#input-fab")
    page.wait_for_selector("#input-card.open")
    page.click("details#manual-loc summary")
    page.fill("#lat", "40.7128")
    page.fill("#lon", "-74.0060")
    fill_dt(page, "dt", "2026-10-01T12:00")
    check("real-mouse Calculate renders table", calc_with_retry(page))
    page.keyboard.press("Escape")

    page.click('button[data-tab="sky"]')
    page.wait_for_selector("#sky-canvas canvas", timeout=45000)
    page.wait_for_function("window.__skyBodyState && window.__skyBodyState().length === 12",
                           timeout=45000)
    page.wait_for_timeout(1500)
    st = page.evaluate("window.__skyBodyState()")
    check("12 sky bodies incl. South Node", len(st) == 12,
          ",".join(s["name"] for s in st))
    names = [s["name"] for s in st]
    check("South Node present", "South Node" in names)
    nn = next(s for s in st if s["name"] == "True Node")
    sn = next(s for s in st if s["name"] == "South Node")
    check("South Node opposite North Node",
          abs(norm360(nn["lon"] + 180) - sn["lon"]) < 1e-6 and abs(sn["lat"]) < 1e-12,
          f"NN {nn['lon']:.4f} SN {sn['lon']:.4f}")
    n_bodies = page.evaluate("import('/sky-data.js').then(m => m.SKY_BODIES.length)")
    check("served SKY_BODIES has 12 entries", n_bodies == 12, str(n_bodies))

    has_cb = page.evaluate(MOON_LBL + ".querySelector('input') !== null")
    check("Moon's orbit overlay checkbox present", has_cb)
    if has_cb:
        checked = page.evaluate(MOON_LBL + ".querySelector('input').checked")
        check("Moon's orbit on by default", checked)

    page.click("details#sky-opts summary")
    page.wait_for_selector('#sky-overlays button[data-v="sphere"]', state="visible")
    page.click('#sky-overlays button[data-v="sphere"]')
    page.wait_for_timeout(1500)
    page.screenshot(path=SHOT + "shot_sky_nodes.png")
    print("  saved shot_sky_nodes.png", flush=True)

    if has_cb:
        page.evaluate(MOON_LBL + ".querySelector('input').click()")
        page.wait_for_timeout(400)
        page.evaluate(MOON_LBL + ".querySelector('input').click()")
        page.wait_for_timeout(400)
        check("Moon's orbit toggle off/on clean",
              page.evaluate("window.__skyBodyState().length") == 12)

    check("zero console errors (desktop)", not cerr, "; ".join(cerr[:3]))
    check("zero page errors (desktop)", not perr, "; ".join(perr[:3]))
    ctx.close()


def run_mobile(pw, browser):
    cerr, perr = [], []
    ctx = browser.new_context(viewport={"width": 390, "height": 844},
                              is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("console", lambda m: cerr.append(m.text[:160]) if m.type == "error" else None)
    page.on("pageerror", lambda e: perr.append(str(e)[:160]))
    page.goto("http://127.0.0.1:8133/", wait_until="networkidle")

    page.click("#input-fab")
    page.wait_for_selector("#input-card.open")
    page.wait_for_timeout(600)
    overflow = page.evaluate("document.documentElement.scrollWidth")
    check("no horizontal overflow with drawer open (390px)", overflow <= 390, str(overflow))
    page.screenshot(path=SHOT + "shot_drawer_mobile.png")
    print("  saved shot_drawer_mobile.png", flush=True)

    page.click("details#manual-loc summary")
    page.fill("#lat", "40.7128")
    page.fill("#lon", "-74.0060")
    fill_dt(page, "dt", "2026-10-01T12:00")
    check("real-mouse Calculate renders table (mobile)", calc_with_retry(page))
    page.keyboard.press("Escape")
    page.click('button[data-tab="sky"]')
    page.wait_for_selector("#sky-canvas canvas", timeout=45000)
    page.wait_for_function("window.__skyBodyState && window.__skyBodyState().length === 12",
                           timeout=45000)
    page.wait_for_timeout(1500)
    page.click("details#sky-opts summary")
    page.wait_for_selector('#sky-overlays button[data-v="sphere"]', state="visible")
    page.click('#sky-overlays button[data-v="sphere"]')
    page.wait_for_timeout(1500)
    page.screenshot(path=SHOT + "shot_sky_mobile.png")
    print("  saved shot_sky_mobile.png", flush=True)

    check("zero console errors (mobile)", not cerr, "; ".join(cerr[:3]))
    check("zero page errors (mobile)", not perr, "; ".join(perr[:3]))
    ctx.close()


def main():
    from playwright.sync_api import sync_playwright
    httpd = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8133", "--bind", "127.0.0.1"],
        cwd=harness.site_dir(),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    relay = harness.start_relay()
    time.sleep(1.5)
    # From here the harness talks to the relay; the relay keeps the real env.
    os.environ["https_proxy"] = "http://127.0.0.1:8899"
    os.environ["HTTPS_PROXY"] = "http://127.0.0.1:8899"
    try:
        if not preflight_ok():
            print("ABORT: egress proxy unusable after 8 attempts — environment, not app",
                  flush=True)
            sys.exit(2)
        with sync_playwright() as p:
            browser = harness.launch(p)
            try:
                run_desktop(p, browser)
            except Exception as e:
                check("desktop section completed", False, f"{type(e).__name__} {str(e)[:120]}")
            try:
                run_mobile(p, browser)
            except Exception as e:
                check("mobile section completed", False, f"{type(e).__name__} {str(e)[:120]}")
            browser.close()
    finally:
        harness.stop_relay(relay)
        httpd.terminate()
    print(f"\n{len(fails)} FAILURES: {fails}" if fails else "\nALL GREEN", flush=True)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
