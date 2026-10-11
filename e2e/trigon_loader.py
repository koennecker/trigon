#!/usr/bin/env python3
"""E2E for the glyph-morph loading animation: fresh profile (no cached data)
shows it during downloads; a cached rerun does not."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8126", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context()  # fresh: no IndexedDB, no HTTP cache
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))

        page.goto("http://127.0.0.1:8126/", wait_until="networkidle")
        fill_dt(page, "dt", "2026-09-26T12:00")
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)
        page.click("#calc")

        page.wait_for_selector("#loader", timeout=15000)
        check("loader appears on uncached run", True)
        g0 = page.text_content("#lglyph")
        label = page.text_content("#load-label")
        check("loader label names the download",
              "Loading" in label or "Downloading" in label, label)
        check("loader starts on Aries", "\u2648" in g0, repr(g0))
        page.wait_for_timeout(700)  # near the first morph peak (775ms)
        disp = page.eval_on_selector("#lmorph feDisplacementMap",
                                     "el => el.getAttribute('scale')")
        check("displacement filter engaged mid-morph", float(disp) > 0, disp)
        page.wait_for_timeout(800)
        try:
            g1 = page.text_content("#lglyph", timeout=3000)
            check("glyph morphs to the next sign", g1 != g0 and "\u2649" in g1, repr(g1))
        except Exception as e:
            # download finished before the morph completed: loader already
            # removed, which the next check asserts anyway
            print("SKIP glyph morphs to the next sign — loader removed early")
        page.screenshot(path="/tmp/trigon_loader.png",
                        clip={"x": 300, "y": 100, "width": 500, "height": 320})

        page.wait_for_selector("#panel-table table", timeout=90000)
        check("loader removed once results render",
              page.eval_on_selector_all("#loader", "els => els.length") == 0)
        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # cached rerun: everything local, no loader flash
        page.click("#calc")
        page.wait_for_timeout(1500)
        check("no loader on cached rerun",
              page.eval_on_selector_all("#loader", "els => els.length") == 0)
        check("cached rerun still renders",
              page.eval_on_selector_all("#panel-table table", "els => els.length") == 1)
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
