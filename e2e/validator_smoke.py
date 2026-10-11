#!/usr/bin/env python3
"""Smoke: validator wiring in app.js — page loads, Calculate runs the
validateEphOut tripwire, table renders, zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time, http.server, threading, functools

SITE = harness.site_dir()


passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

# relay for egress (rotating proxy creds: read fresh, never hardcode)
relay = harness.start_relay()
time.sleep(2)

# local file server for site/
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8901), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright
cerr, perr = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        pg = browser.new_page(viewport={"width": 1280, "height": 800})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8901/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        check("page loads, calc enabled", True)
        # open drawer, set Phoenix, calculate
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.select_option("#tz", "UTC-07:00")
        pg.wait_for_timeout(600)
        pg.evaluate("window.__trigonSetDate('dt', 2026, 'ce', 10, 1)")
        pg.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        pg.locator("#calc").scroll_into_view_if_needed(timeout=15000)
        pg.wait_for_timeout(150)
        pg.locator("#calc").click(timeout=15000, force=False)
        pg.wait_for_selector("#panel-table table", state="attached", timeout=120000)
        check("calculate renders table (validator passed)", True)
        # validator is wired: corrupt the path is unit-tested; here confirm no error UI
        err_txt = pg.locator("#error").inner_text(timeout=5000)
        check("no error banner", err_txt.strip() == "", repr(err_txt[:80]))
        browser.close()
finally:
    srv.shutdown()
    harness.stop_relay(relay)

check("zero console errors", not cerr, "; ".join(cerr[:3]))
check("zero page errors", not perr, "; ".join(perr[:3]))
print(f"\n{len(passed)}/{len(passed)+len(failed)} passed")
sys.exit(1 if failed else 0)
