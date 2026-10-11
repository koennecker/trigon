#!/usr/bin/env python3
"""Local E2E for the Astroweb rewrite: serve site/ on localhost, drive
headless Chromium through the egress relay (bypassing localhost)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import re, subprocess, sys, time, os
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8123", "--bind", "127.0.0.1"],
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

        page.goto("http://127.0.0.1:8123/", wait_until="networkidle")
        check("title is Trigon", page.title() == "Trigon", page.title())
        check("no page-level header (brand lives in the results card)",
              page.query_selector("h1") is None and page.query_selector("p.sub") is None)
        check("hand-rolled date field group present",
              page.query_selector("#dt-y") is not None
              and page.query_selector("#dt-era") is not None
              and page.query_selector("#dt-s") is not None)
        check("no console/page errors on load", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # date + NYC coords -> timezone derivation
        fill_dt(page, "dt", "2026-09-26T12:00")
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(500)
        check("tz derived America/New_York", page.text_content("#tz-name") == "America/New_York",
              page.text_content("#tz-name"))

        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=60000)
        sun_lon = page.text_content("#panel-table tbody tr:first-child td.num")
        check("DMS longitude rendered", "°" in sun_lon and "′" in sun_lon, sun_lon)
        head = page.inner_html("#panel-table .results-head")
        check("angle toggle lives in table panel",
              'role="group"' in head and "12°34′56″" in head)
        meta_pos = page.inner_html("#views").index("UTC 2026-09-26")
        tabs_pos = page.inner_html("#views").index('role="tablist"')
        check("meta precedes tabs", meta_pos < tabs_pos)
        check("Ascendant rendered", "Ascendant" in page.inner_text("#views"))

        # angle-format toggle
        page.click('.seg button[data-fmt="dec"]')
        page.wait_for_timeout(300)
        sun_dec = page.text_content("#panel-table tbody tr:first-child td.num")
        check("decimal longitude rendered", re.match(r"^\d+\.\d{4}°$", sun_dec) is not None, sun_dec)
        check("format persisted",
              page.evaluate("localStorage.getItem('astroweb-angle-fmt')") == "dec")

        # empty datetime -> clean error
        fill_dt(page, "dt", "")
        page.click("#calc")
        page.wait_for_timeout(300)
        check("empty datetime errors cleanly",
              "incomplete" in page.text_content("#error"), page.text_content("#error"))

        # persistence of the toggle across reload; the saved location also
        # triggers an automatic compute for the current moment on load
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#panel-table table", timeout=60000)
        check("auto-compute on reload with saved location", True)
        fill_dt(page, "dt", "2026-09-26T12:00")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=60000)
        sun_dec2 = page.text_content("#panel-table tbody tr:first-child td.num")
        check("decimal format survives reload",
              re.match(r"^\d+\.\d{4}°$", sun_dec2) is not None, sun_dec2)
        check("no console/page errors after calc", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # geolocation -> nearest city in local state, precise coords kept
        ctx2 = browser.new_context(
            geolocation={"latitude": 48.8566, "longitude": 2.3522, "accuracy": 50},
            permissions=["geolocation"])
        g = ctx2.new_page()
        gerr = []
        g.on("pageerror", lambda e: gerr.append(str(e)))
        g.goto("http://127.0.0.1:8123/", wait_until="networkidle")
        g.click("#geolocate")
        g.wait_for_function("document.getElementById('city').value !== ''", timeout=30000)
        check("reverse lookup names Paris", g.input_value("#city") == "Paris",
              g.input_value("#city"))
        check("precise coords kept (not city-center)",
              g.input_value("#lat") == "48.856600", g.input_value("#lat"))
        check("label shows nearest city",
              "Nearest city: Paris" in g.text_content("#loc-label"),
              g.text_content("#loc-label")[:80])
        check("tz derived Europe/Paris", g.text_content("#tz-name") == "Europe/Paris",
              g.text_content("#tz-name"))
        check("no page errors in geo context", not gerr, str(gerr[:2]))
        ctx2.close()

        # license footer + source archive
        check("footer links source zip",
              page.get_attribute("footer a[href$='trigon-source.zip']", "href") == "./source/trigon-source.zip")
        r = page.request.get("http://127.0.0.1:8123/source/trigon-source.zip")
        check("source zip serves 200", r.status == 200, str(r.status))
        check("source zip is a zip", r.body()[:2] == b"PK")
        check("footer names AGPL", "Affero" in page.inner_text("footer"))

        # astrological clock: live recompute every second (location is saved,
        # format is decimal from earlier in the suite)
        page.check("#clock-toggle")
        page.wait_for_selector("#panel-table table", timeout=60000)
        moon1 = page.text_content("#panel-table tbody tr:nth-child(2) td.num")
        page.wait_for_timeout(9000)
        moon2 = page.text_content("#panel-table tbody tr:nth-child(2) td.num")
        check("clock recomputes live (Moon moves)", moon1 != moon2, f"{moon1} -> {moon2}")
        check("clock shows current time",
              "UTC " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H")
              in page.inner_text("#views"), page.inner_text("#views")[:60])
        # chart tracks the live clock: re-rendered every tick, swapped into the
        # DOM only when the markup changed (the Ascendant flips the 0.1px
        # markup about every 5s), wrapper node stable, never blanked mid-tick
        # (the flicker regression: blank-then-fill)
        page.click(".tabs button[data-tab='chart']")
        page.wait_for_selector("#panel-chart .chart-wrap svg", timeout=15000)
        page.evaluate("""() => {
          window.__chartMuts = 0; window.__chartEmpty = 0;
          window.__wrapNode = document.querySelector('#panel-chart .chart-wrap');
          new MutationObserver(muts => {
            for (const m of muts) if (m.type === 'childList') {
              window.__chartMuts++;
              if (!window.__wrapNode.innerHTML.trim()) window.__chartEmpty++;
            }
          }).observe(window.__wrapNode, {childList: true});
        }""")
        page.wait_for_timeout(14000)
        muts = page.evaluate("window.__chartMuts")
        empty = page.evaluate("window.__chartEmpty")
        same_wrap = page.evaluate(
            "document.querySelector('#panel-chart .chart-wrap') === window.__wrapNode")
        check("chart re-renders in clock mode (markup swaps)", muts >= 1,
              f"mutations={muts}")
        check("chart never blanked mid-tick (no flicker)", empty == 0,
              f"empty={empty}")
        check("chart-wrap node stable across ticks", same_wrap, str(same_wrap))
        page.uncheck("#clock-toggle")
        check("no console/page errors after clock", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")

        # floating input panel on wide screens (>=1600px)
        ctx3 = browser.new_context(viewport={"width": 1700, "height": 950})
        w = ctx3.new_page()
        werr = []
        w.on("pageerror", lambda e: werr.append(str(e)))
        w.goto("http://127.0.0.1:8123/", wait_until="networkidle")
        check("input card floats bottom-right",
              w.evaluate("getComputedStyle(document.getElementById('input-card')).position") == "fixed")
        check("results take full viewport width",
              w.evaluate("getComputedStyle(document.querySelector('main')).maxWidth") == "none")
        w.click("#input-hide")
        check("hide button conceals panel",
              not w.is_visible("#input-card") and w.is_visible("#input-fab"))
        w.click("#input-fab")
        check("fab reopens panel", w.is_visible("#input-card"))
        w.click("#input-hide")
        w.reload(wait_until="networkidle")
        check("panel hidden-state persists",
              not w.is_visible("#input-card") and w.is_visible("#input-fab"),
              w.evaluate("localStorage.getItem('astroweb-input-hidden')"))
        # regression: real mouse click on Calculate after editing coords in the
        # bottom-anchored floating panel — the blur re-derivation used to grow
        # #log, shifting the button upward between mousedown and mouseup so the
        # click missed. page.click uses a real mouse sequence, not element.click().
        w.click("#input-fab")
        w.click("details#manual-loc summary")
        w.fill("#lat", "40.7128")
        w.fill("#lon", "-74.0060")
        w.click("#calc")
        w.wait_for_selector("#panel-table table", timeout=60000)
        check("wide panel: real-mouse Calculate completes after editing coords",
              "done" in w.inner_text("#log"),
              w.inner_text("#log")[-80:])
        check("no page errors on wide viewport", not werr, str(werr[:2]))
        ctx3.close()
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [n for n, ok, _ in results if not ok]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
