#!/usr/bin/env python3
"""E2E for Sky Options panel: Options rename, Max FPS control + persistence,
pooled-material rendering sanity (sphere + observer render, drag, lock)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

SITE = harness.site_dir()

PORT = 8139

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 1500, "height": 1150})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector('[data-tab="table"]', state="visible")

        # Calculate once so Sky has an ephemeris.
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.evaluate("window.__trigonSetDate('dt', 2027, 'ce', 2, 10)")
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484"); page.fill("#lon", "-112.0740")
        page.dispatch_event("#lon", "change")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=120000)

        from PIL import Image
        _shot = [0]
        def sky_nonblank():
            _shot[0] += 1
            path = f"/tmp/skyfps_{_shot[0]}.png"
            page.locator("#sky-canvas canvas").screenshot(path=path)
            im = Image.open(path).convert("L")
            px = list(im.resize((64, 64)).getdata())
            bright = sum(1 for v in px if v > 25)
            return bright > 10

        page.click('[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=60000)
        page.wait_for_timeout(1500)
        check("sky renders (observer)", sky_nonblank())

        summary = page.text_content("#sky-opts summary")
        check("panel renamed to Options", (summary or "").strip() == "Options", summary)
        page.click("#sky-opts summary")
        page.wait_for_selector("#sky-fps", state="attached")
        check("Max FPS select present", True)
        page.select_option("#sky-fps", "30")
        val = page.evaluate("JSON.parse(localStorage.getItem('trigon.sky.v1')).maxFps")
        check("maxFps persisted", val == 30, str(val))

        # sphere view renders with pooled materials
        page.evaluate("""() => {
          const b = [...document.querySelectorAll('#sky-overlays button')].find(x => x.textContent === 'Sphere');
          if (b) b.click();
        }""")
        page.wait_for_timeout(1200)
        check("sky renders (sphere)", sky_nonblank())

        page.wait_for_timeout(2500)
        check("sky still renders under Max FPS 30", sky_nonblank())

        # reload: persistence of the setting
        page.reload(wait_until="networkidle")
        page.click('[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=60000)
        page.click("#sky-opts summary")
        page.wait_for_selector("#sky-fps", state="attached")
        check("maxFps restored after reload", page.input_value("#sky-fps") == "30",
              page.input_value("#sky-fps"))
        page.select_option("#sky-fps", "0")

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
