#!/usr/bin/env python3
"""E2E for search polish: aspect filter-evidence columns, Retrograde tab
(periods only) + period-whole sign filter, ingress sign filter."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

PORT = 8137

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
        ctx = browser.new_context()
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector('[data-tab="table"]', state="visible")

        # --- Tab renamed
        tab_text = page.text_content('[data-tab="stations"]')
        check("tab renamed to Retrograde", (tab_text or "").strip() == "Retrograde", tab_text)

        # --- Retrograde: periods only, sign filter
        page.click('[data-tab="stations"]')
        page.wait_for_selector("#stn-go", state="visible")
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-go")
        page.wait_for_selector("#stn-go:not([disabled])", timeout=180000)
        html = page.inner_html("#stn-results")
        check("periods table renders", "trigon-retrograde-periods.csv" in html or "Stations retrograde" in html)
        check("no atomic stations table", "trigon-stations.csv" not in html)
        rows_all = page.locator("#stn-results table tbody tr").count()
        check("period rows present", rows_all >= 6, f"{rows_all} rows")
        st = page.text_content("#stn-results .search-status")
        check("status counts periods", "retrograde period" in (st or ""), (st or "")[:60])

        # Sign filter semantics: a period matches iff either STATION falls in
        # the sign (shadow ingress/egress ignored). Read both station "At"
        # cells (sign name + degrees) from the unfiltered table and predict.
        SIGNS = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra",
                 "Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"]
        def station_signs():
            return page.evaluate("""(SIGNS) => {
              const rows = [...document.querySelectorAll('#stn-results table tbody tr')];
              return rows.map(r => {
                const c = r.querySelectorAll('td');
                const signOf = t => { for (const s of SIGNS) if ((t||'').includes(s)) return s; return null; };
                return [signOf(c[3] && c[3].textContent), signOf(c[6] && c[6].textContent)];
              });
            }""", SIGNS)
        before = station_signs()
        expect_aries = sum(1 for a, b in before if a == "Aries" or b == "Aries")
        page.check("#stn-s0")  # Aries
        page.click("#stn-go")
        page.wait_for_selector("#stn-go:not([disabled])", timeout=180000)
        rows_taurus = page.locator("#stn-results table tbody tr").count()
        st = page.text_content("#stn-results .search-status")
        check("sign filter = station-sign match", rows_taurus == expect_aries and expect_aries > 0,
              f"{rows_taurus} shown, {expect_aries} predicted of {rows_all}")
        after = station_signs()
        check("every shown period stations in Aries",
              all(a == "Aries" or b == "Aries" for a, b in after), str(after[:3]))
        check("filter status wording", "in the selected signs" in (st or ""), (st or "")[:70])
        page.click("#stn-snone")

        # --- Ingress sign filter
        page.click('[data-tab="ingresses"]')
        fill_dt(page, "ing-start", "2025-01-01T00:00")
        fill_dt(page, "ing-end", "2025-12-31T23:59")
        page.click("#ing-go")
        page.wait_for_selector("#ing-results table", timeout=180000)
        ing_all = page.locator("#ing-results table tbody tr").count()
        page.check("#ing-s0")  # into Aries
        page.click("#ing-go")
        page.wait_for_selector("#ing-go:not([disabled])", timeout=180000)
        ing_aries = page.locator("#ing-results table tbody tr").count()
        st = page.text_content("#ing-results .search-status")
        check("ingress sign filter", 0 < ing_aries < ing_all,
              f"{ing_aries} of {ing_all}; {(st or '')[:70]}")
        txt = page.inner_text("#ing-results table tbody")
        check("all rows into Aries", txt.count("→ Aries") >= ing_aries - 1, txt[:120].replace("\n", " "))

        # --- Aspect evidence columns
        page.click('[data-tab="aspects"]')
        page.select_option("#asp-engine", "moshier")
        # Sun-Moon only, 2025, add a condition: Moon in fire sign (element)
        page.click("#asp-bnone")
        page.check("#asp-b0"); page.check("#asp-b1")
        page.click("#asp-tnone")
        page.check("#asp-t0")
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2025-12-31T23:59")
        # proven editor pattern from aspect_conditions_e2e: default sign
        # condition on A (the Sun here), value = Aries.
        page.click("#asp-cond-add")
        page.wait_for_selector(".cond-row")
        page.select_option(".cond-row .f-value", "0")
        page.click("#asp-go")
        page.wait_for_selector("#asp-go:not([disabled])", timeout=300000)
        has_filter_col = page.locator("#asp-results table thead th", has_text="Filter 1").count() > 0
        check("Filter 1 column present", has_filter_col)
        cell = page.text_content("#asp-results table tbody tr td:nth-child(4)") if has_filter_col else ""
        check("evidence cell concrete", bool(cell and "Sun in Aries" in cell), (cell or "")[:80])

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
