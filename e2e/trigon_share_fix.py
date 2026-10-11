#!/usr/bin/env python3
"""E2E for: node-row escaping bug in clock mode, Calculate flicker, Share feature."""
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

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8124", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
shared_url = None
shared_epoch = None
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context()
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))

        page.goto("http://127.0.0.1:8124/", wait_until="networkidle")
        fill_dt(page, "dt", "2026-09-26T12:00")
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=90000)

        # True Node row renders dim dashes, not markup
        node_cells = page.eval_on_selector_all(
            "#panel-table tbody tr",
            "trs => trs.filter(tr => tr.cells[0].textContent.includes('True Node')).map(tr => tr.innerText)")
        check("node row shows plain dashes",
              len(node_cells) == 1 and "\u2014" in node_cells[0],
              str(node_cells)[:120])

        # start the clock; after live ticks no cell may contain raw markup
        page.click("#clock-toggle")
        page.wait_for_timeout(2600)
        raw = page.eval_on_selector_all(
            "#panel-table tbody td", "tds => tds.filter(td => td.textContent.includes('<span')).length")
        check("no raw markup in cells after clock ticks", raw == 0, f"raw={raw}")
        node_spd = page.eval_on_selector_all(
            "#panel-table tbody tr",
            "trs => trs.filter(tr => tr.cells[0].textContent.includes('True Node')).map(tr => tr.cells[3].textContent.trim())")
        check("node speed cell keeps dash in clock mode",
              node_spd == ["\u2014"], str(node_spd))

        # Calculate button must not pulse while the clock ticks
        opacities = set()
        for _ in range(6):
            opacities.add(page.evaluate("getComputedStyle(document.getElementById('calc')).opacity"))
            page.wait_for_timeout(500)
        check("Calculate button opacity steady during clock", opacities == {"1"}, str(opacities))

        # Share: click, read clipboard
        page.click("#share")
        page.wait_for_timeout(600)
        shared_url = page.evaluate("navigator.clipboard.readText()")
        m = re.fullmatch(r"http://127\.0\.0\.1:8124/#([A-Za-z0-9\-_]{14})", shared_url or "")
        check("share URL copied as 14-char base64url hash", m is not None, shared_url)
        if m:
            B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
            v = 0
            for ch in m.group(1):
                v = (v << 6) | B64U.index(ch)
            shared_epoch = ((v & ((1 << 39) - 1)) - 62167219200)
            lat = (v >> 61) / 1e4 - 90
            lon = ((v >> 39) & ((1 << 22) - 1)) / 1e4 - 180
            check("share coords round-trip", abs(lat - 40.7128) < 5e-5 and abs(lon + 74.006) < 5e-5,
                  f"{lat},{lon}")
            # the clock was ticking when Share was clicked, so the shared
            # instant is the latest tick, not the original manual pick
            check("share epoch is a live-tick instant",
                  abs(shared_epoch - int(time.time())) < 30, str(shared_epoch))
            btn_txt = page.text_content("#share")
            check("share button feedback", btn_txt in ("Copied", "Copy failed"), btn_txt)

        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()

        # open the shared URL in a fresh context: city lookup + auto-compute
        if shared_url and shared_epoch:
            browser = harness.launch(p)
            ctx2 = browser.new_context()
            page2 = ctx2.new_page()
            cerr2, perr2 = [], []
            page2.on("console", lambda m: cerr2.append(m.text) if m.type == "error" else None)
            page2.on("pageerror", lambda e: perr2.append(str(e)))
            h = "#" + shared_url.split("#", 1)[1]
            page2.goto(f"http://127.0.0.1:8124/{h}", wait_until="networkidle")
            page2.wait_for_selector("#panel-table table", timeout=90000)
            label = page2.text_content("#loc-label")
            check("share load names nearest city", "Nearest city" in label and "New York" in label, label)
            shared_dt = datetime.fromtimestamp(shared_epoch, tz=timezone.utc)
            stamp = page2.text_content("#meta-stamp")
            check("share load computes the shared instant",
                  shared_dt.strftime("%Y-%m-%d %H:%M") in stamp, stamp)
            # manual runs stamp minute precision; live-tick instant truncates to it
            from zoneinfo import ZoneInfo
            ny = shared_dt.astimezone(ZoneInfo("America/New_York"))
            picker = read_dt(page2, "dt")
            check("picker aligned to instant in zone",
                  picker == ny.strftime("%Y-ce-%m-%dT%H:%M") + ":00", picker)
            check("no console/page errors on share load", not cerr2 and not perr2,
                  f"console={cerr2[:2]} page={perr2[:2]}")
            # legacy readable hash still accepted
            page2.goto(f"http://127.0.0.1:8124/#40.7128,-74.006,{shared_epoch}",
                       wait_until="networkidle")
            page2.wait_for_selector("#panel-table table", timeout=90000)
            check("legacy comma hash still parses",
                  "Nearest city" in page2.text_content("#loc-label"))
            browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
