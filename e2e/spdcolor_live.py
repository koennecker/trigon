"""Live check: deployed speedColor ramp is flipped (0 red, 100 green)."""
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
        for base in ["https://c5274ecc.trigon.pages.dev", "https://trigon.pages.dev"]:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            cerr = []
            page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: cerr.append(str(e)))
            page.goto(base + "/", wait_until="networkidle")
            cols = page.evaluate("""async () => {
              const m = await import('/speed-stats.js');
              return [m.speedColor(0), m.speedColor(50), m.speedColor(100)];
            }""")
            check(f"{base}: flipped ramp live",
                  cols == ["rgb(248,81,73)", "rgb(210,153,34)", "rgb(63,185,80)"], str(cols))
            check(f"{base}: zero console errors", not cerr, str(cerr[:2]))
            page.close()
        browser.close()
finally:
    harness.stop_relay(relay)
print("LIVE OK" if all(results) else "LIVE FAIL")
sys.exit(0 if all(results) else 1)
