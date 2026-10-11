"""Spot check the flipped speed-color ramp in the real app: module endpoints
and DOM dots colored per the new mapping (high percentile -> green)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
SITE = harness.site_dir()

PORT = 8135
results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))
httpd = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        cerr = []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: cerr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        cols = page.evaluate("""async () => {
          const m = await import('/speed-stats.js');
          return [m.speedColor(0), m.speedColor(50), m.speedColor(100)];
        }""")
        check("module ramp: 0=red, 50=yellow, 100=green",
              cols == ["rgb(248,81,73)", "rgb(210,153,34)", "rgb(63,185,80)"], str(cols))
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.click("#views .tabs button[data-tab=table]")
        page.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484"); page.fill("#lon", "-112.0740")
        page.dispatch_event("#lon", "change")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)
        # Every dot's inline background must equal speedColor(its percentile).
        ok = page.evaluate("""async () => {
          const m = await import('/speed-stats.js');
          const chan = s => s.match(/\d+/g).map(Number);
          const dots = [...document.querySelectorAll('#panel-table tbody .spdind')];
          return dots.length === 10 && dots.every(d => {
            const a = chan(d.style.background), b = chan(m.speedColor(parseFloat(d.dataset.pct)));
            return a.every((v, i) => Math.abs(v - b[i]) <= 2);
          });
        }""")
        check("DOM dots match flipped ramp", bool(ok))
        check("no console/page errors", not cerr, str(cerr[:2]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)
print("OK" if all(results) else "FAIL"); sys.exit(0 if all(results) else 1)
