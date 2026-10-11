#!/usr/bin/env python3
"""Live verification of the Trigon deployment on trigon.pages.dev."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import re, subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt

URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()

results = []
def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

relay = harness.start_relay()
time.sleep(1)
try:
    with sync_playwright() as p:
        b = harness.launch(p)
        pg = b.new_context().new_page()
        cerr, perr = [], []
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))

        # (curl, not Playwright's fetch: binary downloads abort through the egress relay)
        cr = subprocess.run(["curl", "-s", "-o", "/tmp/live_src.zip", "-w", "%{http_code} %{size_download}",
                             "--max-time", "60", URL + "/source/trigon-source.zip"],
                            capture_output=True, text=True)
        code, size = cr.stdout.split()
        magic = open("/tmp/live_src.zip", "rb").read(2) if code == "200" else b""
        check("source zip 200 live", code == "200" and magic == b"PK", f"{code} {size}B")

        pg.goto(URL, wait_until="networkidle")
        check("live title Trigon", pg.title() == "Trigon", pg.title())
        fill_dt(pg, "dt", "2026-09-26T12:00")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "40.7128"); pg.fill("#lon", "-74.0060")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_timeout(400)
        check("live tz derived", pg.text_content("#tz-name") == "America/New_York",
              pg.text_content("#tz-name"))
        pg.click("#calc")
        pg.wait_for_selector("#panel-table table", timeout=90000)
        lon = pg.text_content("#panel-table tbody tr:first-child td.num")
        check("live calc renders DMS", "′" in lon, lon)
        pg.click('.seg button[data-fmt="dec"]')
        pg.wait_for_timeout(300)
        lon2 = pg.text_content("#panel-table tbody tr:first-child td.num")
        check("live decimal toggle", re.match(r"^\d+\.\d{4}°$", lon2) is not None, lon2)
        pg.click('.tabs button[data-tab="chart"]')
        pg.wait_for_timeout(400)
        svg = pg.inner_html("#panel-chart svg")
        check("live chart tab renders wheel",
              pg.is_visible("#panel-chart svg") and "☊" in svg and ">Mc<" in svg)
        check("live chart has aspects",
              len(re.findall(r"<title>[^<]*, orb [\d.]+°</title>", svg)) > 0)
        check("live footer license", "Affero" in pg.inner_text("footer"))
        check("no console/page errors live", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        b.close()
finally:
    harness.stop_relay(relay)
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
