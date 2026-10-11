#!/usr/bin/env python3
"""E2E for the speed-dot fix: after a time step (live patch path) the
percentile dots must survive with refreshed color/tooltip/data, and the
positions CSV must carry Speed percentile + Speed sigma (z) columns."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

SITE = harness.site_dir()

PORT = 8134
TMP = "/tmp/csv_e2e"

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
        page = browser.new_page(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")

        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484"); page.fill("#lon", "-112.0740")
        page.dispatch_event("#lon", "change")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)

        n0 = page.locator("#panel-table tbody .spdind").count()
        check("full render shows 10 percentile dots", n0 == 10, f"count={n0}")
        merc_before = page.locator("#panel-table tbody .spdind").nth(2).get_attribute("data-pct")
        stamp_before = page.inner_text("#meta-stamp")
        # Mark the tbody: a full innerHTML rebuild would wipe this; the live
        # patch path must preserve it (proving the patcher ran).
        page.evaluate("document.querySelector('#panel-table tbody').dataset.marker = 'patched'")

        page.fill("#skip-n", "30")
        page.click("#skip-plus")
        page.wait_for_function(
            f"document.getElementById('meta-stamp').textContent !== {stamp_before!r}",
            timeout=120000)
        page.wait_for_timeout(500)
        dots = page.locator("#panel-table tbody .spdind")
        check("dots survive the time step", dots.count() == 10, f"count={dots.count()}")
        check("patch path used (tbody marker intact)",
              page.evaluate("document.querySelector('#panel-table tbody').dataset.marker") == "patched")
        merc_after = dots.nth(2).get_attribute("data-pct")
        check("dot data refreshed after step (Mercury percentile moved)",
              merc_after != merc_before, f"{merc_before} -> {merc_after}")
        check("dot tooltip present after step",
              bool(dots.nth(2).get_attribute("title")))

        with page.expect_download(timeout=60000) as dl_info:
            page.click("#panel-table .csv-block .csv-btn")
        dl = dl_info.value
        path = os.path.join(TMP, dl.suggested_filename)
        dl.save_as(path)
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        hdr = lines[0]
        check("CSV header has Speed percentile + sigma columns",
              "Speed,Speed percentile,Speed sigma (z)" in hdr, hdr)
        merc = [l for l in lines if l.startswith("Mercury,")]
        check("Mercury CSV row carries percentile + signed sigma",
              len(merc) == 1 and f",{merc_after}," in merc[0] and (",+" in merc[0] or ",-" in merc[0]),
              merc[0] if merc else "no row")
        node = [l for l in lines if l.startswith("True Node,")]
        check("node row leaves percentile/sigma empty",
              len(node) == 1 and ",,," in node[0], node[0] if node else "no row")

        page.screenshot(path="/tmp/spdind_fix_e2e.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})
        check("no console/page errors", not cerr and not perr,
              f"console={cerr[:2]} page={perr[:2]}")
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
