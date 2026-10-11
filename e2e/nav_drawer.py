"""Nav-drawer verification: desktop persistent sidebar pushes content;
mobile overlay drawer slides over content + scrim. Zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

SITE = harness.site_dir()


fails, cerr, perr = [], [], []

def check(name, cond, info=""):
    print(("PASS " if cond else "FAIL ") + name + (f" — {info}" if info else ""))
    if not cond: fails.append(name)

def launch(p, width, height):
    browser = harness.launch(p)
    ctx = browser.new_context(viewport={"width": width, "height": height},
        is_mobile=width <= 640, has_touch=width <= 640,
        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" if width <= 640 else None)
    page = ctx.new_page()
    page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: perr.append(str(e)))
    page.goto("http://127.0.0.1:8130/", wait_until="networkidle")
    page.wait_for_timeout(400)
    return browser, page

def rect(page, sel):
    return page.evaluate(f"""() => {{ const e = document.querySelector('{sel}');
        if (!e) return null; const r = e.getBoundingClientRect();
        return {{x: r.x, y: r.y, w: r.width}}; }}""")

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8130", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(2)
try:
    with sync_playwright() as p:
        # ---------- desktop: persistent sidebar ----------
        browser, page = launch(p, 1280, 900)
        is_open = lambda: page.evaluate("document.getElementById('input-card').classList.contains('open')")
        fab_hidden = lambda: page.evaluate("document.getElementById('input-fab').hidden")
        check("desktop: closed by default", not is_open() and not fab_hidden())
        check("desktop: no horizontal scrollbar",
              page.evaluate("document.documentElement.scrollWidth") <= 1281)
        main_x_closed = rect(page, "main")["x"]
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open")
        page.wait_for_timeout(400)
        r = rect(page, "#input-card"); m = rect(page, "main")
        check("desktop: drawer takes layout width", abs(r["x"]) < 2 and abs(r["w"] - 360) < 2, r)
        check("desktop: content pushed right", m["x"] > main_x_closed + 200,
              f"main x {main_x_closed:.0f} -> {m['x']:.0f}")
        check("desktop: fab hidden while open", fab_hidden())
        check("desktop: main has no horizontal overflow",
              page.evaluate("() => { const m = document.querySelector('main'); return m.scrollWidth - m.clientWidth; }") <= 1)
        page.screenshot(path="/tmp/nav_desktop_open.png")
        page.click("#input-hide")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        page.wait_for_timeout(400)
        check("desktop: close via x, fab returns", not is_open() and not fab_hidden())
        check("desktop: main re-centers", abs(rect(page, "main")["x"] - main_x_closed) < 2)
        page.click("#input-fab"); page.wait_for_selector("#input-card.open")
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("desktop: Escape closes", not is_open())
        check("desktop: state persists",
              page.evaluate("() => { try { return localStorage.getItem('trigon-input-open'); } catch(e){ return 'ERR'; } }") == "0")
        page.screenshot(path="/tmp/nav_desktop_closed.png")
        check("desktop: zero console errors", not cerr, cerr[:3])
        check("desktop: zero page errors", not perr, perr[:3])
        browser.close(); cerr.clear(); perr.clear()

        # ---------- mobile: overlay drawer ----------
        browser, page = launch(p, 390, 844)
        is_open = lambda: page.evaluate("document.getElementById('input-card').classList.contains('open')")
        main_x0 = rect(page, "main")["x"]
        card0 = rect(page, "#input-card")
        check("mobile: drawer off-canvas left when closed", card0["x"] + card0["w"] < 1, card0)
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open")
        page.wait_for_timeout(400)
        r = rect(page, "#input-card"); m = rect(page, "main")
        check("mobile: drawer slides in from left", abs(r["x"]) < 2 and r["w"] > 300, r)
        check("mobile: main layout unshifted (overlay)", abs(m["x"] - main_x0) < 2,
              f"main x {main_x0:.0f} -> {m['x']:.0f}")
        check("mobile: scrim visible",
              page.evaluate("() => { const s = document.getElementById('scrim'); const r = s.getBoundingClientRect(); return !s.hidden && r.width > 300; }"))
        check("mobile: body scroll locked",
              page.evaluate("document.body.classList.contains('nav-open')"))
        page.screenshot(path="/tmp/nav_mobile_open.png")
        # scrim click closes
        page.mouse.click(370, 700)
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("mobile: scrim click closes", not is_open())
        page.click("#input-fab"); page.wait_for_selector("#input-card.open")
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")
        check("mobile: Escape closes", not is_open())
        check("mobile: zero console errors", not cerr, cerr[:3])
        check("mobile: zero page errors", not perr, perr[:3])
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

print()
print(f"{len(fails)} failures" if fails else "ALL NAV CHECKS PASSED")
sys.exit(1 if fails else 0)
