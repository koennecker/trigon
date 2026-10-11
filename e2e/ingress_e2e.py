#!/usr/bin/env python3
"""E2E for the Ingresses search tab: known sign crossings (Sun into
Aquarius; Mercury's retrograde re-entry into Pisces), tab wiring,
mobile cards, zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

PORT = 8129

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
        ctx = browser.new_context()
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))

        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        tabs = page.eval_on_selector_all("#views .tabs button", "els => els.map(e => e.textContent)")
        check("seven result tabs present, Ingresses after Retrograde",
              tabs == ["Table", "Chart", "Aspects", "Retrograde", "Ingresses", "Sky"], str(tabs))

        page.click("#views .tabs button[data-tab=ingresses]")
        check("ingresses panel shows on tab click",
              page.is_visible("#panel-ingresses") and not page.is_visible("#panel-stations"))
        check("ingresses form has 11 body checkboxes",
              page.eval_on_selector_all("#ing-bodies input", "els => els.length") == 11)

        # --- Sun into Aquarius, January 2026 ---
        fill_dt(page, "ing-start", "2026-01-01T00:00")
        fill_dt(page, "ing-end", "2026-01-31T23:59")
        page.click("#ing-bnone"); page.check("#ing-b0")  # Sun only
        page.select_option("#ing-engine", "moshier")
        page.click("#ing-go")
        page.wait_for_selector("#ing-results table", timeout=180000)
        sun_text = page.inner_text("#ing-results")
        check("Sun ingress Capricorn -> Aquarius found in Jan 2026",
              "2026-01-20" in sun_text and "Capricorn → Aquarius" in sun_text
              and "Aquarius 0°00′00″" in sun_text, sun_text[:300])
        check("exactly one Sun ingress in January",
              "1 ingress found" in sun_text, sun_text[:120])

        # --- Mercury retrograde re-entry into Pisces, March 2025 ---
        fill_dt(page, "ing-start", "2025-03-01T00:00")
        fill_dt(page, "ing-end", "2025-03-31T23:59")
        page.click("#ing-bnone"); page.check("#ing-b2")  # Mercury only
        page.click("#ing-go")
        page.wait_for_selector("#ing-results table", timeout=180000)
        merc_text = page.inner_text("#ing-results")
        check("Mercury enters Aries, then re-enters Pisces retrograde",
              "Pisces → Aries" in merc_text and "Aries → Pisces" in merc_text
              and "(retrograde)" in merc_text, merc_text[:400])
        page.screenshot(path="/tmp/ingress_e2e_desktop.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})
        check("no console/page errors on desktop flow", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # --- mobile cards ---
        mctx = browser.new_context(viewport={"width": 393, "height": 844})
        mp = mctx.new_page()
        merr, mperr = [], []
        mp.on("console", lambda m: merr.append(m.text) if m.type == "error" else None)
        mp.on("pageerror", lambda e: mperr.append(str(e)))
        mp.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        mp.click("#views .tabs button[data-tab=ingresses]")
        check("mobile ingresses panel visible", mp.is_visible("#panel-ingresses"))
        fill_dt(mp, "ing-start", "2026-01-01T00:00")
        fill_dt(mp, "ing-end", "2026-01-31T23:59")
        mp.click("#ing-bnone"); mp.check("#ing-b0")
        mp.select_option("#ing-engine", "moshier")
        mp.click("#ing-go")
        mp.wait_for_selector(".ing-card", timeout=180000)
        check("mobile ingress results render as cards, table hidden",
              mp.is_visible(".ing-card") and not mp.is_visible("#ing-results table"))
        mp.screenshot(path="/tmp/ingress_e2e_mobile.png", full_page=False)
        check("no console/page errors on mobile", not merr and not mperr,
              f"console={merr[:2]} page={mperr[:2]}")
        mctx.close()
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
