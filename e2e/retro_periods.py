#!/usr/bin/env python3
"""E2E for extended retrograde periods: shadow ingress/egress columns,
Sun-event column, degree-span shadow for Jupiter, the sky comet trail
during a period animation, mobile cards; zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time, http.server, threading, functools

SITE = harness.site_dir()


SHOT = "/tmp/retro_periods"
sys.path.insert(0, os.path.expanduser("~/.e2e-relay"))
from dtfill import fill_dt

passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

relay = harness.start_relay()
time.sleep(2)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8907), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs(SHOT, exist_ok=True)

from playwright.sync_api import sync_playwright
cerr, perr = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)

        # ---------------- desktop: stations table ----------------
        pg = browser.new_page(viewport={"width": 1280, "height": 900})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8907/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.evaluate("window.__trigonSetDate('dt', 2026, 'ce', 10, 1)")
        pg.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_timeout(400)

        pg.click("#views .tabs button[data-tab=stations]")
        fill_dt(pg, "stn-start", "2025-06-01T00:00")
        fill_dt(pg, "stn-end", "2027-01-31T23:59")
        pg.click("#stn-pnone")
        pg.check("#stn-p2"); pg.check("#stn-p3"); pg.check("#stn-p5")  # Mercury Venus Jupiter
        pg.click("#stn-go")
        pg.wait_for_selector("#stn-results table", timeout=300000)
        pg.wait_for_timeout(800)
        txt = pg.inner_text("#stn-results")
        check("new columns present", all(h in txt.upper() for h in ("INGRESS", "SUN EVENT", "EGRESS")))
        # Venus row: sign-span shadow example.
        check("Venus SRx/SD match example", "2026-10-03" in txt and "2026-11-14" in txt)
        check("Venus inferior conjunction listed", "inferior" in txt)
        check("Venus ingress Aug 2026 / egress Jan 2027", "2026-08" in txt and "2027-01" in txt)
        check("Venus extended days ~153", any(f"15{d}" in txt for d in "0123456789"), txt[txt.find('Venus'):txt.find('Venus')+400])
        # Jupiter row: degree-span shadow.
        check("Jupiter SRx 2025-11-11", "2025-11-11" in txt)
        check("Jupiter opposition listed", "opposition" in txt)
        check("Jupiter shadow ingress 2025-08 / egress 2026-06", "2025-08" in txt and "2026-06" in txt)
        # Animate range starts at ingress (before SRx) for Venus.
        btn = pg.locator('#stn-results table button[data-anim-period][data-ib="3"]').first
        a_start = float(btn.get_attribute("data-start")); a_end = float(btn.get_attribute("data-end"))
        srx_txt = btn.evaluate("b => b.closest('tr').children[2].textContent")
        check("animate spans ingress->egress", a_end - a_start > 140, f"{a_end - a_start:.1f} d, SRx cell {srx_txt!r}")
        pg.locator("#stn-results").screenshot(path=f"{SHOT}/table_desktop.png")

        # ---------------- sky animation + comet trail ----------------
        btn.scroll_into_view_if_needed()
        btn.click()
        pg.wait_for_selector("#sky-lockbtn", state="visible", timeout=60000)
        pg.wait_for_function("document.getElementById('sky-lockbtn').textContent.includes('Venus')", timeout=60000)
        check("animate locks camera on Venus", True)
        pg.wait_for_function("typeof window.__skyTrailCount === 'function'", timeout=30000)
        # Speed the playback up to 1 week/s so the loop draws quickly.
        pg.select_option("#anim-speed", "604800")
        t0 = time.time()
        n = 0
        while time.time() - t0 < 90:
            n = pg.evaluate("window.__skyTrailCount()")
            if n > 30: break
            pg.wait_for_timeout(1000)
        check("comet trail grows during animation", n > 30, f"{n} points")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=f"{SHOT}/sky_trail.png")
        readout = pg.inner_text("#sky-readout")
        check("sky readout shows tracking", "tracking Venus" in readout, readout[:120])
        pg.close()

        # ---------------- mobile: period cards ----------------
        pg = browser.new_page(viewport={"width": 390, "height": 844})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8907/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        pg.click("#views .tabs button[data-tab=stations]")
        fill_dt(pg, "stn-start", "2026-01-01T00:00")
        fill_dt(pg, "stn-end", "2026-12-31T23:59")
        pg.click("#stn-pnone"); pg.check("#stn-p3")
        pg.click("#stn-go")
        pg.wait_for_selector("#stn-results .sp-card", timeout=300000)
        ctxt = pg.inner_text("#stn-results")
        check("mobile card has ingress/egress lines", "ingress" in ctxt and "egress" in ctxt)
        check("mobile card has inferior line", "inferior" in ctxt)
        pg.locator(".stn-period-cards").screenshot(path=f"{SHOT}/cards_mobile.png")
        pg.close()
        browser.close()
finally:
    srv.shutdown()
    harness.stop_relay(relay)

check("zero console errors", not cerr, "; ".join(cerr[:3]))
check("zero page errors", not perr, "; ".join(perr[:3]))
print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
