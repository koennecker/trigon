import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(str(e)))
        for url in ["https://452095d8.trigon.pages.dev/", "https://trigon.pages.dev/"]:
            page.goto(url, wait_until="networkidle")
            out = page.evaluate("""async () => {
              const [a, l] = await Promise.all([fetch('app.js').then(r => r.text()), fetch('lots-catalog.js').then(r => r.text())]);
              return { app: a.includes('computeCatalogLots'), cat: l.includes('CATALOG_LOTS') && l.includes('Eros (Valens)') };
            }""")
            print(("PASS " if out["app"] and out["cat"] and not errs else "FAIL ") + url, out, errs[:2])
        browser.close()
finally:
    harness.stop_relay(relay)
