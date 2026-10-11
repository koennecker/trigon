#!/usr/bin/env python3
"""Live smoke test of the deployed bundle: goto buttons + sky lock picker."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt


URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()
results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(URL, wait_until="networkidle")

        # location first: the sky readout needs a computed chart
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=10000)
        page.wait_for_timeout(400)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128"); page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        fill_dt(page, "dt", "2026-10-01T12:00")
        page.locator("#calc").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        box = page.locator("#calc").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")

        page.click('#views .tabs button[data-tab="aspects"]')
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2025-02-01T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")
        page.click("#asp-bnone"); page.check("#asp-b0"); page.check("#asp-b1")
        page.click("#asp-go")
        page.wait_for_selector("#asp-results button.goto-dt", timeout=180000)
        check("live: aspect goto buttons present",
              page.eval_on_selector_all("#asp-results button.goto-dt", "els => els.length") >= 1)

        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=60000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.click("#sky-opts summary")
        page.wait_for_selector("#sky-locksel", timeout=10000)
        check("live: sky lock picker present",
              page.eval_on_selector_all("#sky-locksel option", "els => els.length") == 13)
        page.select_option("#sky-locksel", "5")
        page.wait_for_selector("#sky-lockbtn:visible", timeout=5000)
        check("live: lock chip tracks Jupiter", "Jupiter" in page.inner_text("#sky-lockbtn"))

        check("live: zero console errors", not cerr, cerr[:2])
        check("live: zero page errors", not perr, perr[:2])
        browser.close()
finally:
    harness.stop_relay(relay)
fails = [r for r in results if not r[1]]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
