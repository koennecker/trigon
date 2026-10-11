import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt
URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()
relay = harness.start_relay()
time.sleep(1)
results = []
def check(name, ok, detail=""):
    results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))
try:
    with sync_playwright() as p:
        b = harness.launch(p)
        pg = b.new_context().new_page()
        cerr, perr = [], []
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(URL, wait_until="networkidle")
        fill_dt(pg, "dt", "0044-03-15T12:00:00", era="bce")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change"); pg.wait_for_timeout(400)
        check("live BCE tz disabled", pg.is_disabled("#tz"))
        pg.click("#calc")
        pg.wait_for_selector("#panel-table table", timeout=120000)
        meta = pg.text_content("#views-head .meta")
        check("live BCE meta stamp", "44 BCE" in meta and "Julian" in meta, meta[:70])
        sun = pg.eval_on_selector("#panel-table table",
            "t => { const r = [...t.rows].find(r => r.cells[0].textContent.trim() === 'Sun');"
            " return r ? r.cells[1].textContent : ''; }")
        check("live BCE Sun late Pisces", sun.startswith("Pisces 22"), sun)
        check("live BCE no errors", not cerr and not perr, f"console={cerr[:2]} page={perr[:2]}")
        b.close()
finally:
    harness.stop_relay(relay)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
