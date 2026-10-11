#!/usr/bin/env python3
"""Live check of the eclipse badges on the deployed site."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, socket
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.expanduser("~/.e2e-relay"))
from dtfill import fill_dt

URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()


relay = harness.start_relay()
try:
    for _ in range(100):
        try:
            s = socket.create_connection(("127.0.0.1", 8899), timeout=1); s.close(); break
        except OSError:
            time.sleep(0.2)
    else:
        print("relay never came up"); sys.exit(2)
    with sync_playwright() as p:
        b = harness.launch(p)
        pg = b.new_page()
        cerr, perr = [], []
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(URL, wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        pg.click("#views .tabs button[data-tab=aspects]")
        fill_dt(pg, "asp-start", "2024-04-01T00:00")
        fill_dt(pg, "asp-end", "2024-04-15T23:59")
        pg.click("#asp-tnone"); pg.check("#asp-t0")
        pg.click("#asp-bnone"); pg.check("#asp-b0"); pg.check("#asp-b1")
        pg.select_option("#asp-engine", "swiss")
        pg.click("#asp-go")
        pg.wait_for_selector("#asp-results .search-status", timeout=180000)
        t = pg.inner_text("#asp-results")
        ok = ("2024-04-08" in t and "New Moon" in t and "Total solar eclipse" in t
              and pg.eval_on_selector_all("#asp-results .ecl", "els => els.length") >= 1)
        print("LIVE eclipse badge:", "PASS" if ok else "FAIL")
        if not ok: print(t[:400])
        print("console errors:", cerr[:3] if cerr else "none")
        print("page errors:", perr[:3] if perr else "none")
        b.close()
        sys.exit(0 if ok and not cerr and not perr else 1)
finally:
    harness.stop_relay(relay)
