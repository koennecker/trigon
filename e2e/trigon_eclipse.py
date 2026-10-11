#!/usr/bin/env python3
"""E2E for the idiosyncratic Sun-Moon eclipse check in the Aspects tab:
known eclipses render with their type, non-eclipse lunations render
"no eclipse", zero console/page errors. Localhost, real CORS + downloads."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8128", "--bind", "127.0.0.1"],
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

        page.goto("http://127.0.0.1:8128/", wait_until="networkidle")
        page.click("#views .tabs button[data-tab=aspects]")

        def run_search(start, end, aspects, bodies):
            fill_dt(page, "asp-start", start)
            fill_dt(page, "asp-end", end)
            page.click("#asp-tnone")
            for d in aspects: page.check(f"#asp-t{d}")
            page.click("#asp-bnone")
            for b in bodies: page.check(f"#asp-b{b}")
            page.select_option("#asp-engine", "swiss")
            page.click("#asp-go")
            page.wait_for_selector("#asp-results table", timeout=300000)
            return page.inner_text("#asp-results")

        # --- 1. total solar eclipse: 2024-04-08 new moon ---
        t = run_search("2024-04-01T00:00", "2024-04-15T23:59", [0], [0, 1])
        check("2024-04-08 new moon found", "2024-04-08" in t, t[:200])
        check("renders New Moon + Total solar eclipse",
              "New Moon" in t and "Total solar eclipse" in t, t[:300])
        n_badges = page.eval_on_selector_all(
            "#asp-results .ecl", "els => els.length")
        check("eclipse badge uses .ecl markup", n_badges >= 1, f"{n_badges} badges")

        # --- 2. penumbral lunar eclipse: 2024-03-25 full moon ---
        t = run_search("2024-03-20T00:00", "2024-03-30T23:59", [180], [0, 1])
        check("2024-03-25 full moon found", "2024-03-25" in t, t[:200])
        check("renders Full Moon + Penumbral lunar eclipse",
              "Full Moon" in t and "Penumbral lunar eclipse" in t, t[:300])

        # --- 3. non-eclipse lunations say so explicitly ---
        t = run_search("2024-01-01T00:00", "2024-02-15T23:59", [0, 180], [0, 1])
        check("Jan 2024 lunations found", "2024-01-11" in t and "2024-01-25" in t, t[:200])
        check("non-eclipse lunations render 'no eclipse'", "no eclipse" in t, t[:300])
        check("no eclipse badge on plain lunations",
              "eclipse<" not in t.replace("no eclipse", ""))

        check("zero console errors", not cerr, str(cerr[:3]))
        check("zero page errors", not perr, str(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
