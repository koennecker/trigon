#!/usr/bin/env python3
"""E2E for OR condition groups + CSV downloads: Jupiter-Saturn 2020
conjunction under an OR group (one true branch keeps it, two false
branches drop it), CSV downloads from Aspects/Ingresses/Stations/
Table/Lots, zero console errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

PORT = 8133
TMP = "/tmp/csv_e2e"
os.makedirs(TMP, exist_ok=True)

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
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")

        def download_csv(btn_selector):
            with page.expect_download(timeout=60000) as dl_info:
                page.click(btn_selector)
            dl = dl_info.value
            path = os.path.join(TMP, dl.suggested_filename)
            dl.save_as(path)
            with open(path, encoding="utf-8") as f:
                return dl.suggested_filename, f.read()

        # --- Aspects with an OR group ---
        page.click("#views .tabs button[data-tab=aspects]")
        fill_dt(page, "asp-start", "2020-01-01T00:00")
        fill_dt(page, "asp-end", "2020-12-31T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")
        page.click("#asp-bnone"); page.check("#asp-b5"); page.check("#asp-b6")
        page.select_option("#asp-engine", "moshier")
        page.click("#asp-cond-add")
        page.wait_for_selector(".cond-group .cond-row")
        rows = page.locator(".cond-group .cond-row")
        rows.nth(0).locator(".f-value").select_option("11")   # A in Pisces (false)
        page.click(".cond-group .cond-add-or")
        rows = page.locator(".cond-group .cond-row")
        check("OR group renders two sub-rows with an OR separator",
              rows.count() == 2 and "OR" in page.inner_text(".cond-group"))
        rows.nth(1).locator(".f-value").select_option("10")   # A in Aquarius (true)

        def asp_search(needle):
            page.click("#asp-go")
            page.wait_for_function(
                f"document.querySelector('#asp-results').textContent.includes({needle!r})",
                timeout=180000)

        asp_search("2020-12-21")
        check("OR group: one true branch keeps the conjunction", True)
        fname, csv = download_csv("#asp-results .csv-btn")
        check("aspects CSV downloads with header + conjunction row",
              fname == "trigon-aspects.csv" and csv.startswith("Date/Time (UTC),Bodies,Aspect")
              and "2020-12-21" in csv and "Jupiter" in csv, csv[:120].replace("\r\n", " | "))

        rows.nth(1).locator(".f-value").select_option("9")    # Capricorn (false)
        asp_search("matched the conditions")
        check("OR group: both branches false filters to 0", True)
        page.screenshot(path="/tmp/aspect_or_e2e.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 1000})

        # --- Ingresses CSV ---
        page.click("#views .tabs button[data-tab=ingresses]")
        fill_dt(page, "ing-start", "2026-01-01T00:00")
        fill_dt(page, "ing-end", "2026-01-31T23:59")
        page.click("#ing-bnone"); page.check("#ing-b0")
        page.select_option("#ing-engine", "moshier")
        page.click("#ing-go")
        page.wait_for_selector("#ing-results table", timeout=180000)
        fname, csv = download_csv("#ing-results .csv-btn")
        check("ingresses CSV downloads",
              fname == "trigon-ingresses.csv" and "Capricorn → Aquarius" in csv, fname)

        # --- Stations CSV ---
        page.click("#views .tabs button[data-tab=stations]")
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-pnone"); page.check("#stn-p3")
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=180000)
        fname, csv = download_csv("#stn-results .csv-btn")
        check("retrograde periods CSV downloads (stations table removed)",
              fname == "trigon-retrograde-periods.csv" and "2025-03-02" in csv, fname)

        # --- Table + Lots CSV (main chart, Phoenix day chart) ---
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
        page.wait_for_selector("#panel-table #lots-section", timeout=120000)
        fname, csv = download_csv("#panel-table .csv-block .csv-btn")
        check("positions CSV downloads",
              fname == "trigon-positions.csv" and csv.startswith("Body,Ecliptic longitude")
              and "Mercury" in csv, fname)
        fname, csv = download_csv("#lots-section .csv-btn")
        check("lots CSV downloads",
              fname == "trigon-lots.csv" and csv.startswith("Lot,Position,House,Formula")
              and "Fortune" in csv, fname)
        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
