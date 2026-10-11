#!/usr/bin/env python3
"""Live check: Ingresses tab + lots label on the deployed site."""
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

        # Ingresses tab on the deployed bundle.
        tabs = pg.eval_on_selector_all("#views .tabs button", "els => els.map(e => e.textContent)")
        assert "Ingresses" in tabs, tabs
        pg.click("#views .tabs button[data-tab=ingresses]")
        fill_dt(pg, "ing-start", "2026-01-01T00:00")
        fill_dt(pg, "ing-end", "2026-01-31T23:59")
        pg.click("#ing-bnone"); pg.check("#ing-b0")
        pg.select_option("#ing-engine", "moshier")
        pg.click("#ing-go")
        pg.wait_for_selector("#ing-results table", timeout=180000)
        txt = pg.inner_text("#ing-results")
        assert "2026-01-20" in txt and "Capricorn → Aquarius" in txt, txt[:300]
        print("ingress live:", [l for l in txt.splitlines() if "2026-01-20" in l])

        # Lots label on the deployed bundle (phoenix day chart).
        pg.click("#views .tabs button[data-tab=table]")
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        pg.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        pg.click("#calc")
        pg.wait_for_selector("#panel-table #lots-section", timeout=120000)
        opts = pg.inner_text("#lots-section .lots-opts")
        assert "Nechepso/Valens; cf. Serapio" in opts, opts
        print("lots label live:", opts.splitlines()[0])
        assert not cerr and not perr, f"errors: {cerr[:2]} {perr[:2]}"
        print("LIVE OK", URL)
        browser.close()
finally:
    harness.stop_relay(relay)
