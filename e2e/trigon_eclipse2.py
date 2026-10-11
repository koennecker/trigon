#!/usr/bin/env python3
"""Eclipse E2E + screenshots, with a relay readiness check before launch."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, socket
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8131", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
try:
    # relay readiness: wait until 127.0.0.1:8899 accepts connections
    for _ in range(100):
        try:
            s = socket.create_connection(("127.0.0.1", 8899), timeout=1)
            s.close()
            break
        except OSError:
            time.sleep(0.2)
    else:
        print("relay never came up"); sys.exit(2)

    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))

        page.goto("http://127.0.0.1:8131/", wait_until="networkidle")
        page.click("#views .tabs button[data-tab=aspects]")

        def run_search(pg, start, end, aspects, bodies):
            fill_dt(pg, "asp-start", start)
            fill_dt(pg, "asp-end", end)
            pg.click("#asp-tnone")
            for d in aspects: pg.check(f"#asp-t{d}")
            pg.click("#asp-bnone")
            for b in bodies: pg.check(f"#asp-b{b}")
            pg.select_option("#asp-engine", "swiss")
            pg.click("#asp-go")
            # .search-status renders exactly once, when results land (desktop
            # shows the table, mobile shows cards instead -- both are in the DOM)
            pg.wait_for_selector("#asp-results .search-status", timeout=180000)
            return pg.inner_text("#asp-results")

        t = run_search(page, "2024-04-01T00:00", "2024-04-15T23:59", [0], [0, 1])
        check("2024-04-08 total solar eclipse row",
              "2024-04-08" in t and "New Moon" in t and "Total solar eclipse" in t)
        check("eclipse badge markup",
              page.eval_on_selector_all("#asp-results .ecl", "els => els.length") >= 1)

        t = run_search(page, "2024-03-20T00:00", "2024-03-30T23:59", [180], [0, 1])
        check("2024-03-25 penumbral lunar eclipse row",
              "2024-03-25" in t and "Full Moon" in t and "Penumbral lunar eclipse" in t)

        t = run_search(page, "2024-01-01T00:00", "2024-02-15T23:59", [0, 180], [0, 1])
        check("plain lunations say 'no eclipse'",
              "2024-01-11" in t and "no eclipse" in t
              and "eclipse<" not in t.replace("no eclipse", ""))

        # desktop screenshot of the eclipse rows
        run_search(page, "2024-03-20T00:00", "2024-04-15T23:59", [0, 180], [0, 1])
        page.eval_on_selector("#asp-results", "e => e.scrollIntoView()")
        time.sleep(0.5)
        page.screenshot(path="/tmp/shot_eclipse_desktop.png")

        # mobile screenshot (fresh context -> re-downloads .se1)
        m = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        m.goto("http://127.0.0.1:8131/", wait_until="networkidle")
        m.click("#views .tabs button[data-tab=aspects]")
        run_search(m, "2024-03-20T00:00", "2024-04-15T23:59", [0, 180], [0, 1])
        m.eval_on_selector("#asp-results", "e => e.scrollIntoView()")
        time.sleep(0.5)
        m.screenshot(path="/tmp/shot_eclipse_mobile.png")

        check("zero console errors", not cerr, str(cerr[:3]))
        check("zero page errors", not perr, str(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
