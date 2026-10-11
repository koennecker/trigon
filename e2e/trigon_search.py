#!/usr/bin/env python3
"""E2E for the Aspects and Stations search tabs: known astronomical results,
range validation, cancel, cache-hit reload, mobile layout, zero console/CORS
errors."""
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

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8127", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context()  # fresh: no IndexedDB, no HTTP cache
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))

        page.goto("http://127.0.0.1:8127/", wait_until="networkidle")
        tabs = page.eval_on_selector_all("#views .tabs button", "els => els.map(e => e.textContent)")
        check("six view tabs present", tabs == ["Table", "Chart", "Aspects", "Retrograde", "Ingresses", "Sky"], str(tabs))

        # --- tab switching ---
        page.click("#views .tabs button[data-tab=stations]")
        check("stations panel shows on tab click",
              page.is_visible("#panel-stations") and not page.is_visible("#panel-table"))
        page.click("#views .tabs button[data-tab=aspects]")
        check("aspects panel shows on tab click",
              page.is_visible("#panel-aspects") and not page.is_visible("#panel-stations"))
        check("aspects form has 5 aspect + 11 body checkboxes",
              page.eval_on_selector_all("#asp-aspects input", "els => els.length") == 5 and
              page.eval_on_selector_all("#asp-bodies input", "els => els.length") == 11)
        check("stations form has 8 planet checkboxes",
              page.eval_on_selector_all("#stn-planets input", "els => els.length") == 8)

        # --- validation: end before start ---
        fill_dt(page, "asp-start", "2025-06-01T00:00")
        fill_dt(page, "asp-end", "2025-01-01T00:00")
        page.click("#asp-go")
        page.wait_for_selector("#asp-status.err", timeout=5000)
        check("end-before-start rejected",
              "after start" in page.text_content("#asp-status"),
              page.text_content("#asp-status"))

        # --- no range cap: 11-year Jupiter-Saturn conjunction search (was rejected at 731 days) ---
        fill_dt(page, "asp-start", "2035-01-01T00:00")
        fill_dt(page, "asp-end", "2045-12-31T23:59")  # 4017 days, would have been rejected
        page.click("#asp-tnone"); page.check("#asp-t0")       # conjunction only
        page.click("#asp-bnone"); page.check("#asp-b5"); page.check("#asp-b6")  # Jupiter, Saturn
        page.select_option("#asp-engine", "moshier")  # beyond .se1 downloadable range
        page.click("#asp-go")
        page.wait_for_selector("#asp-results table", timeout=300000)
        js_text = page.inner_text("#asp-results")
        check("4017-day range accepted (no 730-day cap)",
              "2040-10-31" in js_text and "Jupiter" in js_text and "Saturn" in js_text,
              js_text[:300])
        check("no 730-day cap error shown",
              "capped" not in page.text_content("#asp-status").lower())

        # --- stations: Venus 2025 (known: R 2025-03-02, D 2025-04-13) ---
        page.click("#views .tabs button[data-tab=stations]")
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-pnone")
        page.check("#stn-p3")  # Venus (index 3)
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=180000)
        stn_text = page.inner_text("#stn-results")
        check("Venus station retrograde 2025-03-02 found",
              "2025-03-02" in stn_text and "retrograde" in stn_text, stn_text[:200])
        check("Venus station direct 2025-04-13 found", "2025-04-13" in stn_text)
        check("retrograde period listed with extended (ingress->egress) span",
              "ingress" in stn_text.lower() and "egress" in stn_text.lower()
              and "2025-01-03" in stn_text and "2025-06-06" in stn_text,
              stn_text[-200:])
        check("station longitudes rendered",
              "\u00b0" in stn_text)
        check("search reports ephemeris evaluation count",
              "ephemeris evaluations" in stn_text)
        page.screenshot(path="/tmp/trigon_search_stations.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})

        # --- aspects: Sun-Moon conjunction Jan 2025 (new moon 2025-01-29) ---
        page.click("#views .tabs button[data-tab=aspects]")
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2025-02-01T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")       # conjunction only
        page.click("#asp-bnone"); page.check("#asp-b0"); page.check("#asp-b1")  # Sun, Moon
        page.click("#asp-go")
        page.wait_for_selector("#asp-results table", timeout=180000)
        asp_text = page.inner_text("#asp-results")
        check("Sun-Moon conjunction (new moon) 2025-01-29 found",
              "2025-01-29" in asp_text and "Sun" in asp_text and "Moon" in asp_text
              and "New Moon" in asp_text, asp_text[:300])
        # new moon 2025-01-29: Sun and Moon both in Aquarius -> single shared sign
        check("conjunction shows shared sign",
              "Aquarius" in asp_text and asp_text.count("Aquarius") >= 1,
              asp_text[:300])
        page.screenshot(path="/tmp/trigon_search_aspects.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})

        # --- cancel: long full scan (5 years, 1826 days), abort mid-refine ---
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2029-12-31T23:59")  # 1826 days, exercises long-scan cancel
        page.click("#asp-tall"); page.click("#asp-ball")
        page.select_option("#asp-engine", "moshier")  # no downloads, pure cancel-logic test
        page.click("#asp-go")
        page.wait_for_function(
            "document.querySelector('#asp-status').textContent.includes('Refining')",
            timeout=120000)
        page.click("#asp-cancel")
        page.wait_for_function(
            "document.querySelector('#asp-status').textContent.includes('Cancelled')",
            timeout=15000)
        check("cancel stops a long search", True)

        # --- reload: cache-hit rerun of the Venus station search ---
        page.reload(wait_until="networkidle")
        page.click("#views .tabs button[data-tab=stations]")
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-pnone"); page.check("#stn-p3")
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=120000)
        stn2 = page.inner_text("#stn-results")
        check("cache-hit reload reproduces Venus stations",
              "2025-03-02" in stn2 and "2025-04-13" in stn2)
        check("no console/page errors on desktop flow", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # --- mobile layout ---
        mctx = browser.new_context(viewport={"width": 393, "height": 844})
        mp = mctx.new_page()
        merr, mperr = [], []
        mp.on("console", lambda m: merr.append(m.text) if m.type == "error" else None)
        mp.on("pageerror", lambda e: mperr.append(str(e)))
        mp.goto("http://127.0.0.1:8127/", wait_until="networkidle")
        mp.click("#views .tabs button[data-tab=aspects]")
        check("mobile aspects panel visible", mp.is_visible("#panel-aspects"))
        check("mobile checkboxes render",
              mp.eval_on_selector_all("#asp-bodies input", "els => els.length") == 11)
        # station checkboxes show planet names, not SE body numbers
        mp.click("#views .tabs button[data-tab=stations]")
        stn_labels = mp.eval_on_selector_all(
            "#stn-planets label", "els => els.map(e => e.textContent.trim())")
        check("station checkboxes labeled with planet names",
              stn_labels == ["Mercury", "Venus", "Mars", "Jupiter",
                             "Saturn", "Uranus", "Neptune", "Pluto"],
              str(stn_labels))
        # mobile result cards: run a quick Venus station search, tables hidden, cards shown
        fill_dt(mp, "stn-start", "2025-01-01T00:00")
        fill_dt(mp, "stn-end", "2025-12-31T23:59")
        mp.click("#stn-pnone"); mp.check("#stn-p3")
        mp.click("#stn-go")
        mp.wait_for_selector(".stn-card", timeout=180000)
        check("mobile station results render as cards, table hidden",
              mp.is_visible(".stn-card") and not mp.is_visible("#stn-results table"))
        check("mobile retrograde-period cards render, table hidden",
              mp.is_visible(".sp-card") and
              mp.eval_on_selector(
                  "#stn-results h3 + table",
                  "el => !!el && getComputedStyle(el).display === 'none'"))
        mp.click("#views .tabs button[data-tab=aspects]")
        fill_dt(mp, "asp-start", "2025-01-01T00:00")
        fill_dt(mp, "asp-end", "2025-02-01T23:59")
        mp.click("#asp-tnone"); mp.check("#asp-t0")
        mp.click("#asp-bnone"); mp.check("#asp-b0"); mp.check("#asp-b1")
        mp.click("#asp-go")
        mp.wait_for_selector(".asp-card", timeout=180000)
        check("mobile aspect results render as cards, table hidden",
              mp.is_visible(".asp-card") and not mp.is_visible("#asp-results table"))
        mp.screenshot(path="/tmp/trigon_search_mobile.png", full_page=False)
        check("no console/page errors on mobile", not merr and not mperr,
              f"console={merr[:2]} page={mperr[:2]}")
        mctx.close()
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
