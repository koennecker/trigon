#!/usr/bin/env python3
"""E2E: 'Eclipses only' option -> exactly the 8 known 2024-2025 eclipses."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, socket
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.expanduser("~/.e2e-relay"))
from dtfill import fill_dt

SITE = harness.site_dir()

KNOWN = ["Total solar eclipse", "Penumbral lunar eclipse", "Partial lunar eclipse",
         "Annular solar eclipse", "Total lunar eclipse", "Partial solar eclipse",
         "Total lunar eclipse", "Partial solar eclipse"]

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8133", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
try:
    for _ in range(100):
        try:
            s = socket.create_connection(("127.0.0.1", 8899), timeout=1); s.close(); break
        except OSError: time.sleep(0.2)
    with sync_playwright() as p:
        b = harness.launch(p)
        pg = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
        cerr, perr = [], []
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8133/", wait_until="networkidle")
        pg.click("#views .tabs button[data-tab=aspects]")
        pg.check("#asp-eclipses")
        dis = pg.eval_on_selector("#asp-t0", "e => e.disabled") and \
              pg.eval_on_selector("#asp-b1", "e => e.disabled")
        print("pickers disabled while checked:", "PASS" if dis else "FAIL")
        fill_dt(pg, "asp-start", "2024-01-01T00:00")
        fill_dt(pg, "asp-end", "2026-01-01T00:00")
        pg.select_option("#asp-engine", "swiss")
        pg.click("#asp-go")
        pg.wait_for_selector("#asp-results .search-status", timeout=180000)
        t = pg.inner_text("#asp-results")
        ok_count = "8 eclipses found" in t
        ok_kinds = all(k in t for k in KNOWN)
        ok_noplain = "no eclipse" not in t and "New Moon ·" not in t.replace("New Moon · ", "")
        # every result row must carry an eclipse badge
        badges = t.count("eclipse") - t.count("eclipses found")
        print("8 eclipses found:", "PASS" if ok_count else f"FAIL ({t.splitlines()[0]})")
        print("all 8 kinds present:", "PASS" if ok_kinds else "FAIL")
        print("no non-eclipse rows:", "PASS" if ok_noplain and badges >= 16 else "FAIL")
        for line in t.splitlines()[1:9]: print("  " + line[:100])
        pg.uncheck("#asp-eclipses")
        en = pg.eval_on_selector("#asp-t0", "e => !e.disabled")
        print("pickers re-enabled on uncheck:", "PASS" if en else "FAIL")
        print("console errors:", cerr[:3] if cerr else "none")
        print("page errors:", perr[:3] if perr else "none")
        b.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)
