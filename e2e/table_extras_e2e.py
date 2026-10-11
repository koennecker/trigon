#!/usr/bin/env python3
"""E2E for table extras: prev/next stations fill in, lunations bracket the
chart instant, lordship deep dive renders, decan-method toggle changes
the Decan column, positions CSV carries the new columns."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, re
from playwright.sync_api import sync_playwright

SITE = harness.site_dir()

PORT = 8137
TMP = "/tmp/csv_e2e"

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1600, "height": 1100}, accept_downloads=True)
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")

        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484"); page.fill("#lon", "-112.0740")
        page.dispatch_event("#lon", "change")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)

        # --- Stations fill in (async scan around the instant) ---
        page.wait_for_function(
            "document.querySelector('#panel-table td.stn-prev[data-ib=\"2\"]').textContent.match(/\\d{4}-\\d{2}-\\d{2}/)",
            timeout=120000)
        merc = page.evaluate("""() => {
          const q = s => document.querySelector(s).textContent.trim().replace(/\\s+/g, ' ');
          return { prev: q('#panel-table td.stn-prev[data-ib="2"]'),
                   next: q('#panel-table td.stn-next[data-ib="2"]') };
        }""")
        mprev = re.search(r"(\d{4}-\d{2}-\d{2})", merc["prev"])
        mnext = re.search(r"(\d{4}-\d{2}-\d{2})", merc["next"])
        check("Mercury prev station filled, before 1990-06-15",
              bool(mprev) and mprev.group(1) < "1990-06-15" and merc["prev"][0] in "RD",
              merc["prev"])
        check("Mercury next station filled, after 1990-06-15",
              bool(mnext) and mnext.group(1) > "1990-06-15" and merc["next"][0] in "RD",
              merc["next"])
        pluto = page.inner_text('#panel-table td.stn-next[data-ib="9"]')
        check("Pluto next station filled", bool(re.search(r"\d{4}-\d{2}-\d{2}", pluto)), pluto.strip()[:40])
        sun_dash = page.evaluate(
            "document.querySelector('#panel-table tbody tr').children[7].textContent.trim()")
        check("Sun station cells are dashes", sun_dash == "—")

        # --- Lunations bracket the instant ---
        page.wait_for_function(
            "document.querySelector('#syzygy-section').textContent.includes('Moon')",
            timeout=60000)
        syz = page.inner_text("#syzygy-section")
        dates = re.findall(r"(\d{4}-\d{2}-\d{2})", syz)
        check("lunations bracket 1990-06-15",
              len(dates) == 2 and dates[0] <= "1990-06-15" <= dates[1]
              and ("New Moon" in syz or "Full Moon" in syz),
              " | ".join(dates))

        # --- Deep dive renders ---
        check("deep dive: 7 cards + summary",
              page.locator("#lords-section .lord-card").count() == 7
              and page.locator("#lords-section .lords-table").count() == 1
              and "Lords over Sun" in page.inner_text("#lords-section"))

        # --- Decan toggle: Sun in late Gemini: Chaldean Sun -> Indian Saturn ---
        def sun_decan():
            return page.evaluate(
                "document.querySelector('#panel-table tbody tr').children[9].textContent.trim()")
        d0 = sun_decan()
        page.select_option("#lords-section .decan-method", "indian")
        page.wait_for_function(
            f"document.querySelector('#panel-table tbody tr').children[9].textContent.trim() !== {d0!r}",
            timeout=60000)
        d1 = sun_decan()
        check("decan method toggle re-renders Decan column", (d0, d1) == ("Sun", "Saturn"), f"{d0} -> {d1}")
        # Stations refill after the re-render.
        page.wait_for_function(
            "document.querySelector('#panel-table td.stn-prev[data-ib=\"2\"]').textContent.match(/\\d{4}-\\d{2}-\\d{2}/)",
            timeout=120000)

        # --- CSV carries the new columns ---
        with page.expect_download(timeout=60000) as dl_info:
            page.click("#panel-table .csv-block .csv-btn")
        dl = dl_info.value
        path = os.path.join(TMP, dl.suggested_filename)
        dl.save_as(path)
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        check("CSV header has station + dignity columns",
              "House,Prev station,Next station,Domicile,Decan,Bound,Triplicity,Exaltation,D12,D9" in lines[0],
              lines[0][-90:])
        merc_row = [l for l in lines if l.startswith("Mercury,")]
        check("CSV Mercury row carries a station date",
              len(merc_row) == 1 and bool(re.search(r"\d{4}-\d{2}-\d{2}", merc_row[0])),
              merc_row[0][-60:] if merc_row else "none")

        page.evaluate("document.querySelector('#lords-section').scrollIntoView()")
        page.wait_for_timeout(400)
        page.screenshot(path="/tmp/table_extras_e2e.png")
        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
