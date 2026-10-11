#!/usr/bin/env python3
"""Live check: Aspects conditions on the deployed site."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time


URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dtfill import fill_dt
relay = harness.start_relay()
time.sleep(2)
from playwright.sync_api import sync_playwright
cerr, perr = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        pg = browser.new_page(viewport={"width": 1600, "height": 1000})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(URL + "/", wait_until="load", timeout=90000)
        pg.click("#views .tabs button[data-tab=aspects]")
        fill_dt(pg, "asp-start", "2020-01-01T00:00")
        fill_dt(pg, "asp-end", "2020-12-31T23:59")
        pg.click("#asp-tnone"); pg.check("#asp-t0")
        pg.click("#asp-bnone"); pg.check("#asp-b5"); pg.check("#asp-b6")
        pg.select_option("#asp-engine", "moshier")
        pg.click("#asp-cond-add")
        pg.wait_for_selector(".cond-row")
        pg.select_option(".cond-row .f-value", "10")  # A in Aquarius
        pg.click("#asp-go")
        pg.wait_for_function(
            "document.querySelector('#asp-results').textContent.includes('2020-12-21')",
            timeout=180000)
        pg.select_option(".cond-row .f-value", "11")  # A in Pisces: no match
        pg.click("#asp-go")
        pg.wait_for_function(
            "document.querySelector('#asp-results').textContent.includes('matched the conditions')",
            timeout=180000)
        assert not cerr and not perr, f"errors: {cerr[:2]} {perr[:2]}"
        print("LIVE OK", URL)
        browser.close()
finally:
    harness.stop_relay(relay)
