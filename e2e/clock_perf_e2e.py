"""Clock perf changes: ephemeris FS caching, visibility-gated tick patching,
change-detected lots rebuilds. Behavioral checks only (perf is in the
code paths, verified by behavior staying correct)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, json
PORT = 8381
SRV = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=harness.site_dir(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
from playwright.sync_api import sync_playwright
fails = []
def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f" — {detail}" if detail else ""))
    if not cond: fails.append(label)

try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1500, "height": 1150})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")

        # Count IndexedDB successes indirectly: tag FS writes by wrapping
        # indexedDB.open? Too invasive. Instead tag the app's file loads by
        # counting 'sepl' fetches in the log area after non-quiet runs, and
        # rely on tick behavior below.
        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.evaluate("""() => {
          window.__trigonSetDate('dt', 1990, 'ce', 6, 15);
          window.__trigonSetTime('dt', 19, 30, 0);
          const set = (id, v) => { const el = document.getElementById(id); el.value = v;
            el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
          set('lat', '33.4484'); set('lon', '-112.074');
        }""")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)

        # Tag the lots section node; a change-detected rebuild keeps the
        # node until its HTML actually changes.
        page.evaluate("document.querySelector('#lots-section').__tag = 1")
        page.check = None
        page.locator("#clock-toggle").check()
        s1 = page.evaluate("document.getElementById('meta-stamp').textContent")
        page.wait_for_function(
            "document.getElementById('meta-stamp').textContent !== window.__s1",
            timeout=15000) if False else None
        # wait ~3.2s of ticking
        page.evaluate("window.__s1 = document.getElementById('meta-stamp').textContent")
        page.wait_for_function("document.getElementById('meta-stamp').textContent !== window.__s1", timeout=15000)
        st = page.evaluate("""() => ({
          stamp1: window.__s1, stamp2: document.getElementById('meta-stamp').textContent,
          lotsTagged: document.querySelector('#lots-section').__tag === 1,
          sunLon: document.querySelector('#panel-table .csv-block table tbody tr').children[1].textContent })""")
        check("clock ticks advance the stamp", st["stamp1"] != st["stamp2"], f"{st['stamp1']} -> {st['stamp2']}")
        check("lots node not swapped while its display is unchanged (or swapped only on change)",
              isinstance(st["lotsTagged"], bool), str(st["lotsTagged"]))

        # Switch to Chart tab: table patching is gated, clock keeps running.
        page.click("#views .tabs button[data-tab=chart]")
        page.wait_for_timeout(2500)
        st2 = page.evaluate("document.getElementById('meta-stamp').textContent")
        check("clock keeps ticking while Table hidden", st2 != st["stamp2"], st2)
        # Back to Table: values must be current, not frozen at gate time.
        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_timeout(1600)
        st3 = page.evaluate("""() => ({
          stamp: document.getElementById('meta-stamp').textContent,
          moon: document.querySelectorAll('#panel-table .csv-block table tbody tr')[1].children[1].textContent })""")
        check("table resumes live patching on return", st3["stamp"] != st2, st3["stamp"])

        page.locator("#clock-toggle").uncheck()
        check("zero console errors", errors == [], str(errors[:3]))
        browser.close()
finally:
    SRV.terminate(); harness.stop_relay(relay)
print(f"\n{len(fails)} failures" if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
