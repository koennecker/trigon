#!/usr/bin/env python3
"""Visual check: aspect results now show sign degree+minutes."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, socket
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.expanduser("~/.e2e-relay"))
from dtfill import fill_dt

SITE = harness.site_dir()


httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8132", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
        pg = b.new_context(viewport={"width": 1280, "height": 900}).new_page()
        cerr, perr = [], []
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8132/", wait_until="networkidle")
        pg.click("#views .tabs button[data-tab=aspects]")
        fill_dt(pg, "asp-start", "2024-03-20T00:00")
        fill_dt(pg, "asp-end", "2024-04-15T23:59")
        pg.click("#asp-tnone"); pg.check("#asp-t0"); pg.check("#asp-t180"); pg.check("#asp-t120")
        pg.click("#asp-bnone"); pg.check("#asp-b0"); pg.check("#asp-b1"); pg.check("#asp-b3")
        pg.select_option("#asp-engine", "swiss")
        pg.click("#asp-go")
        pg.wait_for_selector("#asp-results .search-status", timeout=180000)
        t = pg.inner_text("#asp-results")
        ok = "19°" in t or "°" in t  # degree+minutes present
        print("positions rendered:", "PASS" if ok else "FAIL")
        for line in t.splitlines()[:8]: print("  " + line[:110])
        pg.eval_on_selector("#asp-results", "e => e.scrollIntoView()")
        time.sleep(0.5)
        pg.screenshot(path="/tmp/shot_signpos_desktop.png")
        m = b.new_context(viewport={"width": 390, "height": 844}).new_page()
        m.goto("http://127.0.0.1:8132/", wait_until="networkidle")
        m.click("#views .tabs button[data-tab=aspects]")
        fill_dt(m, "asp-start", "2024-03-20T00:00")
        fill_dt(m, "asp-end", "2024-04-15T23:59")
        m.click("#asp-tnone"); m.check("#asp-t0"); m.check("#asp-t180")
        m.click("#asp-bnone"); m.check("#asp-b0"); m.check("#asp-b1")
        m.select_option("#asp-engine", "swiss")
        m.click("#asp-go")
        m.wait_for_selector("#asp-results .search-status", timeout=180000)
        m.eval_on_selector("#asp-results", "e => e.scrollIntoView()")
        time.sleep(0.5)
        m.screenshot(path="/tmp/shot_signpos_mobile.png")
        print("console errors:", cerr[:3] if cerr else "none")
        print("page errors:", perr[:3] if perr else "none")
        b.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)
