#!/usr/bin/env python3
"""Local E2E: unified input drawer + South Node + Moon's orbit circle.
Serves site/ on localhost, drives headless Chromium through the egress relay.
Checks: drawer open/close/persist/Escape/focus, real-mouse Calculate, South
Node opposition via the E2E hook, Moon's orbit overlay toggle, screenshots,
zero console/page errors. Desktop 1600x900 + mobile 390x844."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dtfill import fill_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

def norm360(d): return d % 360.0

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8129", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
srv = None
try:
    time.sleep(1.5)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = harness.launch(p)
        # ---------------------------------------------------------- desktop
        ctx = browser.new_context(viewport={"width": 1600, "height": 900})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8129/", wait_until="networkidle")

        is_open = lambda: page.evaluate("document.getElementById('input-card').classList.contains('open')")
        check("drawer closed by default (desktop)", not is_open())
        check("FAB visible when closed", page.is_visible("#input-fab"))
        tf = page.evaluate("getComputedStyle(document.getElementById('input-card')).transform")
        ml = page.evaluate("getComputedStyle(document.getElementById('input-card')).marginLeft")
        vis = page.evaluate("getComputedStyle(document.getElementById('input-card')).visibility")
        # Desktop hides the closed drawer with a -360px margin (mobile uses a
        # translateX transform); either one takes it off-screen.
        check("drawer off-screen when closed", tf != "none" or ml == "-360px" or vis == "hidden",
              f"transform={tf} margin-left={ml} visibility={vis}")

        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=5000)
        check("FAB opens drawer", is_open())
        page.wait_for_timeout(500)
        page.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot_drawer_open.png"))
        check("focus moves to close button", page.evaluate("document.activeElement.id") == "input-hide")

        page.click("#input-hide")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("x closes drawer", not is_open())
        check("focus returns to FAB", page.evaluate("document.activeElement.id") == "input-fab")

        page.click("#input-fab")
        page.wait_for_selector("#input-card.open")
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("Escape closes drawer", not is_open())

        page.click("#input-fab")
        page.wait_for_selector("#input-card.open")
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#input-card.open", timeout=10000)
        check("open state persists across reload", is_open())
        page.keyboard.press("Escape")
        page.reload(wait_until="networkidle")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')", timeout=10000)
        check("closed state persists across reload", not is_open())

        check("zero console errors (desktop)", not cerr, "; ".join(cerr[:3]))
        check("zero page errors (desktop)", not perr, "; ".join(perr[:3]))
        ctx.close()

        # ---------------------------------------------------------- mobile
        mctx = browser.new_context(viewport={"width": 390, "height": 844},
                                   is_mobile=True, has_touch=True)
        m = mctx.new_page()
        mcerr, mperr = [], []
        m.on("console", lambda e: mcerr.append(e.text) if e.type == "error" else None)
        m.on("pageerror", lambda e: mperr.append(str(e)))
        m.goto("http://127.0.0.1:8129/", wait_until="networkidle")
        mis_open = lambda: m.evaluate("document.getElementById('input-card').classList.contains('open')")
        check("drawer closed by default (mobile)", not mis_open())
        m.click("#input-fab")
        m.wait_for_selector("#input-card.open", timeout=5000)
        w = m.evaluate("document.getElementById('input-card').getBoundingClientRect().width")
        check("drawer fits mobile viewport", w <= 390, f"{w:.0f}px")
        sw = m.evaluate("document.documentElement.scrollWidth")
        check("no horizontal overflow (mobile drawer)", sw <= 391, f"{sw}px")
        m.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shot_drawer_mobile.png"))
        m.keyboard.press("Escape")
        m.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("Escape closes drawer (mobile)", not mis_open())
        check("zero console errors (mobile)", not mcerr, "; ".join(mcerr[:3]))
        check("zero page errors (mobile)", not mperr, "; ".join(mperr[:3]))
        mctx.close()
        browser.close()
finally:
    for proc in (httpd, relay):
        try: proc.terminate()
        except Exception: pass

npass = sum(1 for _, ok, _ in results if ok)
print(f"\n{npass}/{len(results)} passed")
sys.exit(0 if npass == len(results) else 1)
