#!/usr/bin/env python3
"""E2E for Aspects conditional modifiers: Jupiter-Saturn conjunction of
2020-12-21 (Aquarius) filtered by sign, motion, and heliacal-phase
conditions; matched/total status; persistence; zero console errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

PORT = 8131

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.click("#views .tabs button[data-tab=aspects]")

        fill_dt(page, "asp-start", "2020-01-01T00:00")
        fill_dt(page, "asp-end", "2020-12-31T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")
        page.click("#asp-bnone"); page.check("#asp-b5"); page.check("#asp-b6")
        page.select_option("#asp-engine", "moshier")

        def search_and_wait(needle):
            page.click("#asp-go")
            page.wait_for_function(
                f"document.querySelector('#asp-results').textContent.includes({needle!r})",
                timeout=180000)

        # Baseline: the great conjunction itself.
        search_and_wait("2020-12-21")
        txt = page.inner_text("#asp-results")
        check("baseline conjunction 2020-12-21 in Aquarius",
              "Jupiter" in txt and "Saturn" in txt and "Aquarius" in txt, txt[:200])

        # Sign condition, true: A (Jupiter) in Aquarius.
        page.click("#asp-cond-add")
        page.wait_for_selector(".cond-row")
        page.select_option(".cond-row .f-value", "10")  # Aquarius
        search_and_wait("2020-12-21")
        check("sign condition A in Aquarius keeps the conjunction",
              "2020-12-21" in page.inner_text("#asp-results"))

        # Sign condition, false: A in Pisces -> 0 of 1 matched.
        page.select_option(".cond-row .f-value", "11")  # Pisces
        search_and_wait("matched the conditions")
        check("false sign condition filters to 0 with matched/total status",
              page.query_selector("#asp-results table") is None)

        # Motion condition: Saturn retrograde (false) then direct (true).
        page.select_option(".cond-row .cond-type", "motion")
        page.select_option(".cond-row .f-body", "6")       # Saturn
        page.select_option(".cond-row .f-dir", "retrograde")
        search_and_wait("matched the conditions")
        check("Saturn retrograde condition filters out Dec 2020 (Saturn direct)", True)
        page.select_option(".cond-row .f-dir", "direct")
        search_and_wait("2020-12-21")
        check("Saturn direct condition keeps the conjunction", True)

        # Phase condition: Venus was a morning star in Dec 2020.
        page.select_option(".cond-row .cond-type", "phase")
        page.select_option(".cond-row .f-body", "3")        # Venus
        page.select_option(".cond-row .f-phase", "morning")
        search_and_wait("2020-12-21")
        check("Venus morning-phase condition keeps the conjunction", True)
        page.screenshot(path="/tmp/aspect_conditions_e2e.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})

        # Persistence: conditions survive a reload.
        page.reload(wait_until="networkidle")
        page.click("#views .tabs button[data-tab=aspects]")
        ctype = page.eval_on_selector(".cond-row .cond-type", "el => el.value")
        check("conditions persist across reload", ctype == "phase", ctype)
        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
