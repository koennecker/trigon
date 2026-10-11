#!/usr/bin/env python3
"""E2E for the animation system: absolute/relative ranges + speed on the main
panel, retrograde-period animate (sky sphere + camera lock), and sky
fullscreen. Zero console/page errors required."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, re
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))
PORT = "8129"

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

def utc_stamp(page):
    t = page.text_content("#meta-stamp") or ""
    m = re.search(r"UTC (\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?", t)
    if not m:
        return None
    y, mo, d, h, mi = map(int, m.groups()[:5])
    s = int(m.group(6) or 0)
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc).timestamp()

def sky_readout_ts(page):
    t = page.text_content("#sky-readout") or ""
    m = re.search(r"UTC (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})", t)
    if not m:
        return None
    return datetime(*map(int, m.groups()), tzinfo=timezone.utc).timestamp()

def play_text(page):
    return (page.text_content("#anim-play") or "").strip()

httpd = subprocess.Popen([sys.executable, "-m", "http.server", PORT, "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
LAT, LON = 40.7128, -74.0060
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")

        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.click("details#manual-loc summary")
        page.fill("#lat", str(LAT)); page.fill("#lon", str(LON))
        page.dispatch_event("#lon", "change")
        fill_dt(page, "dt", "2026-10-01T12:00")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.wait_for_timeout(600)

        # --- 1. animation UI present (relative inputs are hidden in absolute mode)
        for sel in ["#anim-mode", "#anim-start", "#anim-end",
                    "#anim-speed", "#anim-play", "#anim-stop", "#anim-status"]:
            check(f"animation UI {sel} visible", page.is_visible(sel))
        for sel in ["#anim-n", "#anim-unit"]:
            check(f"animation UI {sel} attached",
                  page.eval_on_selector(sel, "el => !!el"))
        nopts = page.eval_on_selector_all("#anim-speed option", "els => els.length")
        check("speed select has 7 options", nopts == 7, f"{nopts}")
        check("stop disabled before play",
              page.eval_on_selector("#anim-stop", "b => b.disabled"))

        page.select_option("#anim-mode", "relative")
        page.wait_for_timeout(200)
        check("relative inputs shown", page.is_visible("#anim-relative")
              and not page.is_visible("#anim-absolute"))
        page.select_option("#anim-mode", "absolute")
        page.wait_for_timeout(200)
        check("absolute inputs shown", page.is_visible("#anim-absolute")
              and not page.is_visible("#anim-relative"))

        # --- 2. absolute-range animation: 30 days at 1 day/s (won't finish mid-test)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        s0 = (now - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M")
        e0 = (now + timedelta(days=30)).strftime("%Y-%m-%dT%H:%M")
        page.eval_on_selector("#anim-start", f"el => el.value = '{s0}'")
        page.eval_on_selector("#anim-end", f"el => el.value = '{e0}'")
        page.select_option("#anim-speed", "86400")  # 1 day/s
        page.click("#anim-play")
        page.wait_for_timeout(500)
        check("play toggles to Pause", play_text(page) == "Pause", play_text(page))
        check("status shows Animating",
              "Animating" in (page.text_content("#anim-status") or ""))
        check("range inputs disabled while playing",
              page.eval_on_selector("#anim-mode", "el => el.disabled"))
        t_a = utc_stamp(page)
        page.wait_for_timeout(2000)
        t_b = utc_stamp(page)
        adv_days = (t_b - t_a) / 86400 if (t_a and t_b) else -1
        check("instant advances during animation", adv_days > 1.0,
              f"advanced {adv_days:.2f} days in 2 s at 1 day/s")
        page.screenshot(path=f"{SHOT}/shot_anim_panel.png",
                        clip={"x": 0, "y": 0, "width": 420, "height": 800})

        # pause holds the instant
        page.click("#anim-play")
        page.wait_for_timeout(300)
        check("pause toggles to Resume", play_text(page) == "Resume", play_text(page))
        t_p1 = utc_stamp(page)
        page.wait_for_timeout(1200)
        t_p2 = utc_stamp(page)
        check("paused instant does not advance",
              t_p1 is not None and t_p2 is not None and abs(t_p2 - t_p1) < 1,
              f"delta {abs((t_p2 or 0) - (t_p1 or 0)):.1f} s")

        # resume advances again, then stop
        page.click("#anim-play")  # resume
        page.wait_for_timeout(300)
        check("resume toggles to Pause", play_text(page) == "Pause", play_text(page))
        t_r1 = utc_stamp(page)
        page.wait_for_timeout(1200)
        t_r2 = utc_stamp(page)
        check("resumed instant advances",
              t_r1 and t_r2 and (t_r2 - t_r1) > 3600,
              f"advanced {((t_r2 or 0) - (t_r1 or 0)) / 3600:.2f} h")
        page.click("#anim-stop")
        page.wait_for_timeout(300)
        check("stop clears status", (page.text_content("#anim-status") or "").strip() == "")
        check("stop restores transport",
              page.eval_on_selector("#anim-stop", "b => b.disabled")
              and play_text(page) == "Play"
              and not page.eval_on_selector("#anim-mode", "el => el.disabled"))

        # --- 3. relative range (40 hours) finishes on its own at 1 day/s
        page.select_option("#anim-mode", "relative")
        page.fill("#anim-n", "40")
        page.select_option("#anim-unit", "hour")
        page.select_option("#anim-speed", "86400")  # 1 day/s -> 40 h in ~1.7 s
        t_rel0 = utc_stamp(page)
        page.click("#anim-play")
        page.wait_for_function(
            "document.getElementById('anim-status').textContent.includes('Finished')",
            timeout=15000)
        t_rel1 = utc_stamp(page)
        rel_h = (t_rel1 - t_rel0) / 3600 if (t_rel1 and t_rel0) else -1
        check("relative range auto-finishes", True)
        check("relative range covers ~40 h", 38 < rel_h < 42, f"{rel_h:.1f} h")
        check("transport idle after finish",
              play_text(page) == "Play"
              and page.eval_on_selector("#anim-stop", "b => b.disabled"))

        # --- 4. retrograde-period animate: Venus 2025-03-02 -> 2025-04-13
        page.click('button[data-tab="stations"]')
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-12-31T23:59")
        page.click("#stn-pnone"); page.check("#stn-p3")  # Venus only
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=180000)
        page.wait_for_function(
            "document.getElementById('stn-results').textContent.toLowerCase().includes('retrograde period')",
            timeout=60000)
        nbtn = page.eval_on_selector_all(
            '#stn-results button[data-anim-period]', "els => els.length")
        check("retrograde periods have animate buttons", nbtn >= 1, f"{nbtn}")
        page.click('#stn-results table button[data-anim-period]')
        page.wait_for_selector("#sky-canvas canvas", timeout=60000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')",
            timeout=90000)
        page.wait_for_timeout(1500)
        stn_txt = page.text_content("#stn-results") or ""
        check("no error shown in station results",
              "failed" not in stn_txt.lower() and "error" not in stn_txt.lower(),
              stn_txt[-120:] if ("error" in stn_txt.lower()) else "")
        check("animate switches to sky tab",
              page.eval_on_selector('button[data-tab="sky"]',
                                    "b => b.getAttribute('aria-selected')") == "true")
        check("sphere view engaged",
              page.eval_on_selector('button[data-v="sphere"]',
                                    "b => b.classList.contains('on')"))
        check("animation mode set to absolute",
              page.eval_on_selector("#anim-mode", "el => el.value") == "absolute")
        s_val = page.eval_on_selector("#anim-start", "el => el.value")
        e_val = page.eval_on_selector("#anim-end", "el => el.value")
        check("absolute range prefilled with the shadow span",
              s_val.startswith("2025-01-03") and e_val.startswith("2025-06-06"),
              f"{s_val} -> {e_val}")
        check("speed auto-picked to 1 day/s",
              page.eval_on_selector("#anim-speed", "el => el.value") == "86400")
        lock_txt = page.text_content("#sky-lockbtn") or ""
        check("camera lock chip visible", page.is_visible("#sky-lockbtn"), lock_txt.strip())
        check("lock chip names Venus", "Venus" in lock_txt, lock_txt.strip())
        ro = page.text_content("#sky-readout") or ""
        check("readout shows tracking Venus", "tracking Venus" in ro, ro[-60:])
        check("retrograde animation is playing",
              "Animating" in (page.text_content("#anim-status") or ""))

        # lock holds while time advances: readout UTC moves, chip stays
        r0 = sky_readout_ts(page)
        page.wait_for_timeout(4000)
        r1 = sky_readout_ts(page)
        check("locked animation advances sky time",
              r0 and r1 and (r1 - r0) / 86400 > 2.5,
              f"advanced {((r1 or 0) - (r0 or 0)) / 86400:.2f} days")
        check("lock chip persists during animation", page.is_visible("#sky-lockbtn"))
        ro2 = page.text_content("#sky-readout") or ""
        check("readout still tracking", "tracking Venus" in ro2)
        page.screenshot(path=f"{SHOT}/shot_anim_lock.png")

        # drag does not break the lock; unlock chip releases it
        box = page.eval_on_selector("#sky-canvas",
            "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")
        page.mouse.move(box["x"] + box["w"] / 2, box["y"] + box["h"] / 2)
        page.mouse.down(); page.mouse.move(box["x"] + box["w"] / 2 + 120,
                                           box["y"] + box["h"] / 2, steps=8)
        page.mouse.up(); page.wait_for_timeout(1200)
        check("lock survives a drag", "tracking Venus" in (page.text_content("#sky-readout") or ""))
        if not page.eval_on_selector("#anim-stop", "b => b.disabled"):
            page.click("#anim-stop")  # stop so the unlock state is observable
            page.wait_for_timeout(300)
        page.click("#sky-lockbtn")
        page.wait_for_timeout(800)
        check("unlock chip hides the lock", not page.is_visible("#sky-lockbtn"))
        check("readout drops tracking",
              "tracking" not in (page.text_content("#sky-readout") or ""))

        # --- 5. fullscreen
        page.click("#sky-fsbtn")
        page.wait_for_function("!!document.fullscreenElement", timeout=5000)
        page.wait_for_timeout(800)
        check("fullscreen engages", True)
        page.screenshot(path=f"{SHOT}/shot_anim_fullscreen.png")
        page.click("#sky-fsbtn")
        page.wait_for_function("!document.fullscreenElement", timeout=5000)
        check("fullscreen exits", True)

        # --- 6. clock start stops the animation
        page.eval_on_selector("#anim-start", f"el => el.value = '{s0}'")
        page.eval_on_selector("#anim-end", f"el => el.value = '{e0}'")
        page.select_option("#anim-mode", "absolute")
        page.click("#anim-play")
        page.wait_for_timeout(800)
        check("animation playing before clock test",
              "Animating" in (page.text_content("#anim-status") or ""))
        page.check("#clock-toggle")
        page.wait_for_timeout(400)
        check("clock start stops animation",
              play_text(page) == "Play"
              and (page.text_content("#anim-status") or "").strip() == "")
        page.uncheck("#clock-toggle")

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
