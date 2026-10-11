#!/usr/bin/env python3
"""Mobile 390x844 check: animation panel layout, retrograde animate buttons,
sky lock chip and fullscreen on a narrow viewport. Zero errors required."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, re
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8131", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, is_mobile=True,
                                  has_touch=True)
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8131/", wait_until="networkidle")
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128"); page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        fill_dt(page, "dt", "2026-10-01T12:00")
        page.click("#calc")
        # mobile CSS hides the table and shows planet cards instead
        page.wait_for_selector("#panel-table .planet-card", state="visible",
                               timeout=90000)
        page.wait_for_timeout(500)

        # animation panel: no horizontal overflow of its container
        page.eval_on_selector("#anim-mode", "el => el.scrollIntoView({block:'center'})")
        page.wait_for_timeout(300)
        overflow = page.evaluate("""() => {
          const f = document.getElementById('anim-field');
          if (!f) return -999;
          return f.scrollWidth - f.clientWidth;
        }""")
        check("animation panel fits 390px", overflow == 0, f"overflow {overflow}px")
        page.screenshot(path=f"{SHOT}/shot_anim_mobile_panel.png")

        # retrograde animate on mobile card
        page.click('button[data-tab="stations"]')
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-pnone"); page.check("#stn-p3")
        page.click("#stn-go")
        page.wait_for_function(
            "document.getElementById('stn-results').textContent.includes('Retrograde periods')",
            timeout=180000)
        nbtn = page.eval_on_selector_all(
            '#stn-results button[data-anim-period]', "els => els.length")
        check("mobile cards have animate buttons", nbtn >= 1, f"{nbtn}")
        page.eval_on_selector('#stn-results button[data-anim-period]',
                              "el => el.scrollIntoView({block:'center'})")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOT}/shot_anim_mobile_card.png")
        # the desktop table button is hidden on mobile; click the visible card one
        page.click('#stn-results button[data-anim-period]:visible')
        page.wait_for_selector("#sky-canvas canvas", timeout=60000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')",
            timeout=90000)
        page.wait_for_timeout(1500)
        check("mobile: lock chip visible", page.is_visible("#sky-lockbtn"))
        check("mobile: sphere engaged",
              page.eval_on_selector('button[data-v="sphere"]',
                                    "b => b.classList.contains('on')"))
        # lock chip must not overlap the overlays summary or fs button
        overlap = page.evaluate("""() => {
          const r = s => { const e = document.querySelector(s); if (!e) return null;
            const b = e.getBoundingClientRect(); return [b.left,b.top,b.right,b.bottom]; };
          const inter = (a,b) => a && b && a[0]<b[2] && b[0]<a[2] && a[1]<b[3] && b[1]<a[3];
          const lock = r('#sky-lockbtn'), ov = r('#sky-opts'), fs = r('#sky-fsbtn');
          return { lockOv: inter(lock, ov), lockFs: inter(lock, fs), ovFs: inter(ov, fs) };
        }""")
        check("mobile: no control overlap", not any(overlap.values()), str(overlap))
        page.screenshot(path=f"{SHOT}/shot_anim_mobile_sky.png")
        check("zero console errors", len(cerr) == 0,
              "; ".join(cerr[:3]) if cerr else "")
        check("zero page errors", len(perr) == 0,
              "; ".join(perr[:3]) if perr else "")
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
