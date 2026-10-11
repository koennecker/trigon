#!/usr/bin/env python3
"""E2E for mobile CSS fixes: fluid input panel + sky viewer chrome, and the
iOS pseudo-fullscreen fallback. Zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8130", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)

UA_IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")

def launch(p, width, height, no_fs_api=False, ua=None):
    browser = harness.launch(p)
    ctx = browser.new_context(viewport={"width": width, "height": height},
                              user_agent=ua, is_mobile=width <= 500, has_touch=width <= 500)
    if no_fs_api:
        ctx.add_init_script("delete Element.prototype.requestFullscreen;")
    page = ctx.new_page()
    cerr, perr = [], []
    page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: perr.append(str(e)))
    page.goto("http://127.0.0.1:8130/", wait_until="networkidle")
    return browser, page, cerr, perr

def setup_chart(page):
    was_open = page.evaluate("document.getElementById('input-card').classList.contains('open')")
    if was_open:  # the open drawer (z-60) covers the Inputs fab (z-55)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
    page.click("#input-fab")
    page.wait_for_selector("#input-card.open", timeout=5000)
    page.wait_for_timeout(400)
    page.click("details#manual-loc summary")
    page.fill("#lat", "40.7128"); page.fill("#lon", "-74.0060")
    page.dispatch_event("#lon", "change")
    fill_dt(page, "dt", "2026-10-01T12:00")
    page.locator("#calc").scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    box = page.locator("#calc").bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    # desktop renders a <table>, mobile renders .planet-card (table is CSS-hidden)
    is_mobile = page.evaluate("window.innerWidth <= 640")
    page.wait_for_selector("#panel-table .planet-card" if is_mobile else "#panel-table table",
                           timeout=90000)
    page.keyboard.press("Escape")
    page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")

def within(inner, outer, tol=1):
    return (inner["x"] >= outer["x"] - tol and inner["y"] >= outer["y"] - tol and
            inner["x"] + inner["w"] <= outer["x"] + outer["w"] + tol and
            inner["y"] + inner["h"] <= outer["y"] + outer["h"] + tol)

try:
    with sync_playwright() as p:
        # ---------------- mobile 390x844 ----------------
        browser, page, cerr, perr = launch(p, 390, 844, ua=UA_IPHONE)
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=5000)
        page.wait_for_timeout(500)
        ov = page.evaluate("""() => {
          const els = [...document.querySelectorAll('#input-card .anim-row, #input-card .skip-row, #input-card .dt-row, #input-card')];
          return els.map(e => ({sel: e.id || e.className, over: e.scrollWidth - e.clientWidth}));
        }""")
        bad = [e for e in ov if e["over"] > 1]
        check("mobile drawer: no horizontal overflow in input rows", not bad, str(bad))
        cols = page.evaluate("getComputedStyle(document.getElementById('anim-absolute')).gridTemplateColumns")
        check("mobile anim range stacks vertically", cols.count("px") == 1, cols)
        page.locator("#anim-field").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOT, "m_drawer_anim.png"))

        setup_chart(page)
        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function("document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(1200)

        page.click("#sky-opts summary")
        page.wait_for_timeout(400)
        geo = page.evaluate("""() => {
          const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
                           return {x: b.x, y: b.y, w: b.width, h: b.height}; };
          return {wrap: r('#sky-wrap'), opts: r('#sky-opts'), readout: r('#sky-readout'),
                  fsbtn: r('#sky-fsbtn'), ov: r('#sky-overlays')};
        }""")
        check("mobile: open opts panel inside sky wrap", within(geo["opts"], geo["wrap"]),
              f"opts w={geo['opts']['w']:.0f} wrap w={geo['wrap']['w']:.0f}")
        check("mobile: readout inside sky wrap", within(geo["readout"], geo["wrap"]))
        # fsbtn bottom-right, no overlap with readout
        fb, ro = geo["fsbtn"], geo["readout"]
        overlap = not (fb["x"] + fb["w"] <= ro["x"] or ro["x"] + ro["w"] <= fb["x"] or
                       fb["y"] + fb["h"] <= ro["y"] or ro["y"] + ro["h"] <= fb["y"])
        check("mobile: fsbtn clear of readout", not overlap)
        check("mobile: fsbtn bottom-right", fb["y"] + fb["h"] > geo["wrap"]["y"] + geo["wrap"]["h"] - 60,
              f"relY={fb['y']-geo['wrap']['y']:.0f}")
        page.screenshot(path=os.path.join(SHOT, "m_sky_opts.png"))

        # native fullscreen still works in Chromium
        page.click("#sky-opts summary")  # close panel
        page.wait_for_timeout(300)
        page.click("#sky-fsbtn")
        page.wait_for_timeout(600)
        fs = page.evaluate("({el: !!document.fullscreenElement, glyph: document.getElementById('sky-fsbtn').textContent})")
        check("mobile: native fullscreen engages", fs["el"] and fs["glyph"] == "✕", str(fs))
        page.screenshot(path=os.path.join(SHOT, "m_sky_fullscreen.png"))
        page.click("#sky-fsbtn")
        page.wait_for_timeout(600)
        check("mobile: native fullscreen exits", not page.evaluate("!!document.fullscreenElement"))
        check("mobile: zero console errors", not cerr, cerr[:2])
        check("mobile: zero page errors", not perr, perr[:2])
        browser.close()

        # ---------------- pseudo-fullscreen (no Fullscreen API) ----------------
        browser, page, cerr, perr = launch(p, 390, 844, no_fs_api=True, ua=UA_IPHONE)
        check("pseudo: requestFullscreen absent (iOS-like)", page.evaluate(
            "typeof document.getElementById('sky-wrap').requestFullscreen !== 'function'"))
        setup_chart(page)
        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function("document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(800)
        page.click("#sky-fsbtn")
        page.wait_for_timeout(600)
        pf = page.evaluate("""() => { const w = document.getElementById('sky-wrap');
          const b = w.getBoundingClientRect();
          return {cls: w.classList.contains('sky-pseudofull'), w: b.width, h: b.height,
                  x: b.x, y: b.y, glyph: document.getElementById('sky-fsbtn').textContent}; }""")
        check("pseudo: fallback class applied, wrap covers viewport",
              pf["cls"] and abs(pf["w"] - 390) < 2 and abs(pf["h"] - 844) < 2 and pf["glyph"] == "✕", str(pf))
        page.screenshot(path=os.path.join(SHOT, "m_sky_pseudofull.png"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("pseudo: Escape exits", not page.evaluate(
            "document.getElementById('sky-wrap').classList.contains('sky-pseudofull')"))
        page.click("#sky-fsbtn")  # re-enter, then exit via button
        page.wait_for_timeout(400)
        page.click("#sky-fsbtn")
        page.wait_for_timeout(400)
        check("pseudo: button toggles off", not page.evaluate(
            "document.getElementById('sky-wrap').classList.contains('sky-pseudofull')"))
        check("pseudo: zero console errors", not cerr, cerr[:2])
        check("pseudo: zero page errors", not perr, perr[:2])
        browser.close()

        # ---------------- desktop 1280x900 regression ----------------
        browser, page, cerr, perr = launch(p, 1280, 900)
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=5000)
        page.wait_for_timeout(400)
        cols = page.evaluate("getComputedStyle(document.getElementById('anim-absolute')).gridTemplateColumns")
        check("desktop: anim range side-by-side", cols.count("px") == 3, cols)
        ov = page.evaluate("""() => {
          const els = [...document.querySelectorAll('#input-card .anim-row, #input-card')];
          return els.map(e => ({sel: e.id || e.className, over: e.scrollWidth - e.clientWidth}));
        }""")
        check("desktop drawer: no overflow", all(e["over"] <= 1 for e in ov), str(ov))
        setup_chart(page)
        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function("document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(800)
        page.click("#sky-opts summary")
        page.wait_for_timeout(400)
        geo = page.evaluate("""() => {
          const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
                           return {x: b.x, y: b.y, w: b.width, h: b.height}; };
          return {wrap: r('#sky-wrap'), opts: r('#sky-opts'), fsbtn: r('#sky-fsbtn')};
        }""")
        check("desktop: open opts panel inside wrap", within(geo["opts"], geo["wrap"]),
              f"opts w={geo['opts']['w']:.0f}")
        z = page.evaluate("""() => ({opts: getComputedStyle(document.getElementById('sky-opts')).zIndex,
          fs: getComputedStyle(document.getElementById('sky-fsbtn')).zIndex})""")
        check("desktop: opts paints above fsbtn", int(z["opts"]) > int(z["fs"]), str(z))
        check("desktop: zero console errors", not cerr, cerr[:2])
        check("desktop: zero page errors", not perr, perr[:2])
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

n = sum(1 for _, ok, _ in results if ok)
print(f"\n{n}/{len(results)} passed")
sys.exit(0 if n == len(results) else 1)
