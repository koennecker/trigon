"""Live check: OR-group UI + CSV buttons on deployed Trigon."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        for base in ["https://978db66c.trigon.pages.dev", "https://trigon.pages.dev"]:
            page = browser.new_page(viewport={"width": 1400, "height": 900}, accept_downloads=True)
            cerr = []
            page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: cerr.append(str(e)))
            page.goto(base + "/", wait_until="networkidle")
            page.click("#views .tabs button[data-tab=aspects]")
            page.click("#asp-cond-add")
            page.wait_for_selector(".cond-group")
            page.click(".cond-group .cond-add-or")
            rows = page.locator(".cond-group .cond-row")
            check(f"{base}: group with 2 OR sub-rows renders",
                  rows.count() == 2 and "any of (OR)" in page.inner_text(".cond-group-head"))
            check(f"{base}: CSV button ships in bundle",
                  page.evaluate("fetch('format.js').then(r=>r.text()).then(t=>t.includes('csvDownloadButton'))")
                  and page.evaluate("fetch('search-ui.js').then(r=>r.text()).then(t=>t.includes('normalizeConditionGroups'))"))
            check(f"{base}: zero console errors", not cerr, str(cerr[:2]))
            page.close()
        browser.close()
finally:
    harness.stop_relay(relay)
print("LIVE OK" if all(results) else "LIVE FAIL")
sys.exit(0 if all(results) else 1)
