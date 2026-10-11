#!/usr/bin/env python3
"""E2E for the time-skip controls: +/- buttons, step size, unit dropdown
(Second..Year), seconds in the datetime picker, recalculation on skip, and
the controls being disabled in live-clock mode."""
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

SKIP_IDS = ["#skip-minus", "#skip-n", "#skip-unit", "#skip-plus"]

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8126", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8126/", wait_until="networkidle")

        harness.ensure_drawer(page)
        check("skip controls rendered", all(page.is_visible(s) for s in SKIP_IDS))
        check("picker accepts seconds",
              page.query_selector("#dt-s") is not None)

        # location via manual coordinates
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(500)

        fill_dt(page, "dt", "2026-09-26T12:00:30")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=60000)
        stamp0 = page.text_content("#meta-stamp")
        check("seconds survive a manual run", read_dt(page, "dt") == "2026-ce-09-26T12:00:30",
              read_dt(page, "dt"))

        def click_skip_and_wait(sel):
            prev = page.text_content("#meta-stamp")  # capture BEFORE the click
            page.click(sel)
            # the card blanks mid-run, so tolerate a missing stamp
            page.wait_for_function(
                "(p) => { const el = document.getElementById('meta-stamp');"
                " return el && el.textContent !== p; }",
                arg=prev, timeout=30000)

        # +1 hour: picker moves, chart recalculates (UTC stamp is wall+4h, EDT)
        page.select_option("#skip-unit", "hour")
        click_skip_and_wait("#skip-plus")
        check("skip +1h moves picker", read_dt(page, "dt") == "2026-ce-09-26T13:00:30",
              read_dt(page, "dt"))
        check("skip +1h recalculates",
              page.text_content("#meta-stamp") == "UTC 2026-09-26 17:00:30",
              page.text_content("#meta-stamp"))

        # -2 days
        page.fill("#skip-n", "2")
        page.select_option("#skip-unit", "day")
        click_skip_and_wait("#skip-minus")
        check("skip -2d moves picker", read_dt(page, "dt") == "2026-ce-09-24T13:00:30",
              read_dt(page, "dt"))

        # +45 seconds (crosses a minute boundary)
        page.fill("#skip-n", "45")
        page.select_option("#skip-unit", "second")
        click_skip_and_wait("#skip-plus")
        check("skip +45s moves picker", read_dt(page, "dt") == "2026-ce-09-24T13:01:15",
              read_dt(page, "dt"))

        # month and year steps (non-zero seconds: Playwright's fill rejects
        # ":00" seconds on datetime-local, an automation quirk, not an app bug)
        fill_dt(page, "dt", "2026-01-15T00:00:07")
        page.fill("#skip-n", "1")
        page.select_option("#skip-unit", "month")
        click_skip_and_wait("#skip-plus")
        check("skip +1mo moves picker", read_dt(page, "dt") == "2026-ce-02-15T00:00:07",
              read_dt(page, "dt"))
        page.select_option("#skip-unit", "year")
        click_skip_and_wait("#skip-plus")
        check("skip +1y moves picker", read_dt(page, "dt") == "2027-ce-02-15T00:00:07",
              read_dt(page, "dt"))
        page.select_option("#skip-unit", "week")
        click_skip_and_wait("#skip-minus")
        check("skip -1w moves picker", read_dt(page, "dt") == "2027-ce-02-08T00:00:07",
              read_dt(page, "dt"))

        # brand lives with the results, not in a page header
        check("results carry the Trigon brand",
              page.text_content(".res-brand") == "Trigon"
              and page.get_attribute(".res-brand .logo", "src") == "logo.svg")

        # skip must patch in place, not blank-and-rebuild: the table node
        # survives and the scroll position is kept (evaluate-click avoids
        # Playwright's scroll-into-view on click)
        tbl = page.query_selector("#panel-table table")
        page.evaluate("window.scrollTo(0, 250)")
        page.wait_for_timeout(200)
        y0 = page.evaluate("window.scrollY")
        prev = page.text_content("#meta-stamp")
        page.evaluate("document.getElementById('skip-plus').click()")
        page.wait_for_function(
            "(p) => { const el = document.getElementById('meta-stamp');"
            " return el && el.textContent !== p; }",
            arg=prev, timeout=30000)
        check("skip patches in place (table node stable)",
              page.evaluate("(t) => document.querySelector('#panel-table table') === t", tbl))
        check("skip preserves scroll position",
              page.evaluate("window.scrollY") == y0,
              f"scrollY={page.evaluate('window.scrollY')} (was {y0})")

        # clock mode disables the skip controls
        page.click("#clock-toggle")
        page.wait_for_timeout(300)
        check("skip disabled in clock mode",
              all(page.is_disabled(s) for s in SKIP_IDS))
        page.click("#clock-toggle")
        page.wait_for_timeout(300)
        check("skip re-enabled after clock mode",
              all(not page.is_disabled(s) for s in SKIP_IDS))

        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

n = sum(1 for _, ok, _ in results if ok)
print(f"\n{n}/{len(results)} passed")
sys.exit(0 if n == len(results) else 1)
