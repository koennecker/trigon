#!/usr/bin/env python3
"""E2E for BCE support: hand-rolled date fields, LMT, Julian calendar,
.meta formatting, .se1 fetch for negative years, BCE search ranges,
Moshier refusal, share-link round-trip, 1582 cutover gap, era-boundary
skips, 13200 BCE floor. Zero console/page/CORS errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

# 44 BCE Mar 15 12:00:00 LMT at Phoenix (33.4484, -112.0740), precomputed
BCE_EPOCH_SEC = -63517926702
BCE_HASH = f"#33.4484,-112.0740,{BCE_EPOCH_SEC}"

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8130", "--bind", "127.0.0.1"],
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

        page.goto("http://127.0.0.1:8130/", wait_until="networkidle")
        check("field group present (no datetime-local)",
              page.query_selector("#dt-y") is not None
              and page.query_selector("#datetime") is None)

        # manual location: Phoenix
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484")
        page.fill("#lon", "-112.0740")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(500)

        # --- BCE input + LMT UI ---
        fill_dt(page, "dt", "44-03-15T12:00:00", era="bce")
        page.wait_for_timeout(300)
        check("tz select disabled for BCE", page.is_disabled("#tz"))
        tzname = page.text_content("#tz-name")
        check("LMT label shown", "local mean time" in tzname and "UTC-07:28" in tzname, tzname)
        page.evaluate("window.__trigonSetDate('dt', '44', 'ce', '3', '15')")
        page.wait_for_timeout(300)
        check("tz select re-enabled for CE", not page.is_disabled("#tz"))
        page.evaluate("window.__trigonSetDate('dt', '44', 'bce', '3', '15')")
        page.wait_for_timeout(300)

        # --- BCE chart: Ides of March, 44 BCE ---
        # BCE 404: the Swiss file is missing -> error, and NO Moshier fallback
        page.route("**/seplm06.se1", lambda r: r.fulfill(status=404, body="nope"))
        page.route("**/semom06.se1", lambda r: r.fulfill(status=404, body="nope"))
        page.click("#calc")
        page.wait_for_selector("#error:not(:empty)", timeout=30000)
        check("BCE 404: missing-file error, no Moshier fallback offered",
              "not found on GitHub" in page.text_content("#error")
              and not page.is_visible("#fallback"),
              page.text_content("#error")[:90])
        page.unroute_all()
        cerr.clear(); perr.clear()  # intentional mock 404, not an app defect

        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=120000)
        meta = page.text_content("#views-head .meta")
        check("meta shows 44 BCE Julian stamp",
              "UTC 15 Mar 44 BCE 19:28" in meta and "Julian" in meta, meta)
        check("meta notes local mean time + Swiss engine",
              "local mean time" in meta and "Swiss Ephemeris" in meta, meta)
        sun_lon = page.eval_on_selector(
            "#panel-table table",
            "t => { const r = [...t.rows].find(r => r.cells[0].textContent.trim() === 'Sun');"
            " return r ? r.cells[1].textContent : ''; }")
        check("Sun late Pisces (Mar 15 Julian; equinox ~Mar 22.8 per Meeus)",
              sun_lon.startswith("Pisces 22"), sun_lon)

        # --- 1582 cutover gap ---
        fill_dt(page, "dt", "1582-10-10T12:00:00")
        page.click("#calc")
        page.wait_for_selector("#error:not(:empty)", timeout=5000)
        check("1582-10-10 rejected", "never existed" in page.text_content("#error"),
              page.text_content("#error"))

        # --- BCE aspect search (Sun/Moon conjunctions, 45-43 BCE) ---
        page.click("#views .tabs button[data-tab=aspects]")
        for deg in (60, 90, 120, 180):
            page.uncheck(f"#asp-t{deg}")
        for i in range(2, 11):
            page.uncheck(f"#asp-b{i}")
        fill_dt(page, "asp-start", "45-01-01T00:00", era="bce")
        fill_dt(page, "asp-end", "43-01-01T00:00", era="bce")
        page.click("#asp-go")
        page.wait_for_selector("#asp-results table", timeout=180000)
        n_asp = page.eval_on_selector_all("#asp-results table tbody tr", "rs => rs.length")
        check("BCE aspect search returns conjunctions", n_asp > 10, f"{n_asp} rows")
        first_asp = page.text_content("#asp-results table tbody tr td")
        check("BCE aspect dates show era", "BCE" in first_asp, first_asp[:60])

        # --- BCE station search (Mercury-Pluto, 45-44 BCE) ---
        page.click("#views .tabs button[data-tab=stations]")
        fill_dt(page, "stn-start", "45-01-01T00:00", era="bce")
        fill_dt(page, "stn-end", "44-01-01T00:00", era="bce")
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=180000)
        n_stn = page.eval_on_selector_all("#stn-results table tbody tr", "rs => rs.length")
        check("BCE station search returns stations", n_stn > 5, f"{n_stn} rows")

        # --- BCE search + Moshier engine refused ---
        page.select_option("#stn-engine", "moshier")
        page.click("#stn-go")
        page.wait_for_selector("#stn-status.err", timeout=10000)
        check("BCE station search + Moshier refused",
              "Swiss Ephemeris" in page.text_content("#stn-status"),
              page.text_content("#stn-status")[:80])
        page.select_option("#stn-engine", "swiss")

        # --- BCE share link round-trip (legacy readable form) ---
        page2 = ctx.new_page()
        p2cerr, p2perr = [], []
        page2.on("console", lambda m: p2cerr.append(m.text) if m.type == "error" else None)
        page2.on("pageerror", lambda e: p2perr.append(str(e)))
        page2.goto("http://127.0.0.1:8130/" + BCE_HASH, wait_until="networkidle")
        page2.wait_for_selector("#panel-table table", timeout=120000)
        stamp2 = page2.text_content("#meta-stamp")
        check("BCE share link computes the shared instant",
              "UTC 15 Mar 44 BCE 19:28" in stamp2, stamp2)
        check("BCE share restores LMT wall fields",
              read_dt(page2, "dt") == "0044-bce-03-15T12:00:00", read_dt(page2, "dt"))
        check("BCE share: tz select disabled", page2.is_disabled("#tz"))
        check("no errors on share-load page", not p2cerr and not p2perr,
              f"console={p2cerr[:2]} page={p2perr[:2]}")

        # --- era-boundary skip: 1 BCE +1yr -> 1 CE (no year zero) ---
        fill_dt(page, "dt", "0001-01-01T00:00:00", era="bce")
        page.select_option("#skip-unit", "year")
        page.fill("#skip-n", "1")
        prev = page.text_content("#meta-stamp")
        page.click("#skip-plus")
        page.wait_for_function(
            "(p) => { const el = document.getElementById('meta-stamp');"
            " return el && el.textContent !== p; }",
            arg=prev, timeout=120000)
        check("skip +1yr crosses era without year zero",
              read_dt(page, "dt") == "0001-ce-01-01T00:00:00", read_dt(page, "dt"))

        # --- 12999 BCE floor: deepest clean year inside the .se1 back-catalog
        # (seplm132.se1 starts 13000 BCE Aug 10 ET; Delta-T ~+8.4d there) ---
        fill_dt(page, "dt", "12999-01-15T12:00:00", era="bce")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=180000)
        stamp3 = page.text_content("#views-head .meta")
        check("12999 BCE floor computes", "12999 BCE" in stamp3, stamp3[:80])

        # --- mobile layout: BCE input row at 393px ---
        mp = ctx.new_page()
        mp.set_viewport_size({"width": 393, "height": 800})
        merr, mperr = [], []
        mp.on("console", lambda m: merr.append(m.text) if m.type == "error" else None)
        mp.on("pageerror", lambda e: mperr.append(str(e)))
        mp.goto("http://127.0.0.1:8130/", wait_until="networkidle")
        fill_dt(mp, "dt", "44-03-15T12:00:00", era="bce")
        mp.screenshot(path=os.path.join(harness.site_dir(), "test", "bce-mobile.png"))
        check("no errors on mobile page", not merr and not mperr,
              f"console={merr[:2]} page={mperr[:2]}")

        check("zero console/page errors on main page", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()

        bad = [r for r in results if not r[1]]
        print(f"\n{len(results) - len(bad)}/{len(results)} passed")
        sys.exit(1 if bad else 0)
finally:
    httpd.terminate(); harness.stop_relay(relay)
