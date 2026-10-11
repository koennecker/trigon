"""Table tab fixes: decan toggle both ways on the MAIN table, Mars-range
stations, clickable station/lunation datetimes, triplicity text."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
SRV = subprocess.Popen([sys.executable, "-m", "http.server", "8373", "--bind", "127.0.0.1"],
    cwd=harness.site_dir(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
from playwright.sync_api import sync_playwright
fails = []
def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond: fails.append(label)

def set_chart(page, y, mo, d, hh=19, mi=30):
    page.evaluate("""([y,mo,d,hh,mi]) => {
      window.__trigonSetDate('dt', y, 'ce', mo, d);
      window.__trigonSetTime('dt', hh, mi, 0);
      document.getElementById('lat').value = '33.4484';
      document.getElementById('lat').dispatchEvent(new Event('input', {bubbles:true}));
      document.getElementById('lon').value = '-112.074';
      document.getElementById('lon').dispatchEvent(new Event('input', {bubbles:true}));
    }""", [y, mo, d, hh, mi])

try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://127.0.0.1:8373/", wait_until="networkidle")
        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        set_chart(page, 1990, 6, 15)
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)
        # Decan column is now index 10 (Domicile added at 9).
        def cell(row, idx):
            return page.eval_on_selector_all("#panel-table tbody tr",
                f"(trs, [r,i]) => trs[r].children[i].textContent.trim()", [row, idx])
        page.wait_for_function("""() => {
          const trs = document.querySelectorAll('#panel-table tbody tr');
          return trs.length && trs[2].children[7].textContent.includes('1990');
        }""", timeout=60000)
        # 1. Main-table decan follows the toggle, BOTH directions.
        check(cell(2, 8) == "Mercury", f"Mercury domicile lord Mercury: {cell(2,8)!r}")
        check(cell(2, 9) == "Jupiter", f"Chaldean Mercury decan Jupiter: {cell(2,9)!r}")
        check(cell(1, 9) == "Mars", f"Chaldean Moon decan Mars (Pisces III): {cell(1,9)!r}")
        page.select_option("#lords-section .decan-method", "indian")
        page.wait_for_function("""() => {
          const trs = document.querySelectorAll('#panel-table tbody tr');
          return trs[2].children[9].textContent.trim() === 'Mercury';
        }""", timeout=15000)
        check(True, "main table Mercury decan -> Mercury after Indian toggle")
        check(cell(1, 9) == "Mars", f"Indian Moon decan Mars (coincides at this position): {cell(1,9)!r}")
        page.screenshot(path="/tmp/decan_indian_main_table.png")
        page.select_option("#lords-section .decan-method", "chaldean")
        page.wait_for_function("""() => {
          const trs = document.querySelectorAll('#panel-table tbody tr');
          return trs[2].children[9].textContent.trim() === 'Jupiter';
        }""", timeout=15000)
        check(True, "main table Mercury decan back to Jupiter after Chaldean toggle")
        # 2. Triplicity secondary line renders as its own item, no '(also ...)'.
        txt = page.text_content("#lords-section")
        check("(also " not in txt, "no '(also ...)' text anywhere in deep dive")
        # 3. Clickable station datetime sets the main chart to it.
        page.click("#panel-table tbody tr:nth-child(3) td:nth-child(8) button.goto-dt")
        page.wait_for_function("""() => {
          const m = document.querySelector('.meta');
          return m && m.textContent.includes('1990-08-25');
        }""", timeout=30000)
        check(True, "station date click set main chart to 1990-08-25 (Mercury R station)")
        # 4. Clickable lunation datetime likewise.
        page.wait_for_selector("#syzygy-section button.goto-dt", timeout=30000)
        page.click("#syzygy-section button.goto-dt >> nth=0")
        page.wait_for_function("""() => {
          const m = document.querySelector('.meta');
          return m && m.textContent.includes('1990-08-2');
        }""", timeout=30000)
        check(True, "lunation date click set main chart to prev lunation (1990-08-2x)")
        # 5. Mars-range stations: 2023-03-01 sits >500 days before Mars's
        # next station (2024-12-07); the Mars-based window must still find it.
        set_chart(page, 2023, 3, 1, 12, 0)
        page.click("#calc")
        page.wait_for_function("""() => {
          const trs = document.querySelectorAll('#panel-table tbody tr');
          return trs.length && trs[4].children[7].textContent.includes('2024-12');
        }""", timeout=60000)
        mars_next = page.eval_on_selector_all("#panel-table tbody tr",
            "(trs) => trs[4].children[7].textContent.trim()")
        check(mars_next.startswith("R "), f"Mars next station found beyond 500d: {mars_next!r}")
        mars_prev = page.eval_on_selector_all("#panel-table tbody tr",
            "(trs) => trs[4].children[6].textContent.trim()")
        check(mars_prev.startswith("D "), f"Mars prev station found: {mars_prev!r}")
        check(errors == [], f"zero console errors: {errors}")
        browser.close()
finally:
    SRV.terminate()
    harness.stop_relay(relay)
print(f"\n{0 if fails else 'ALL PASS'} ({len(fails)} failures)" if not fails else f"\nFAILURES: {fails}")
sys.exit(1 if fails else 0)
