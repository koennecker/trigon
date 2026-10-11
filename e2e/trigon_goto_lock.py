#!/usr/bin/env python3
"""E2E for (1) clickable search-result dates -> main chart datetime, and
(2) the always-available Sky camera-lock picker. Zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, re
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt

SITE = harness.site_dir()

SHOT = os.path.dirname(os.path.abspath(__file__))

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def jd_to_utc(jd):
    return datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=jd - 2440587.5)

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8128", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)

def launch(p, width=1280, height=900):
    browser = harness.launch(p)
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    cerr, perr = [], []
    page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: perr.append(str(e)))
    page.goto("http://127.0.0.1:8128/", wait_until="networkidle")
    return browser, page, cerr, perr

def set_nyc(page):
    page.click("#input-fab")
    page.wait_for_selector("#input-card.open", timeout=5000)
    page.wait_for_timeout(400)
    page.click("details#manual-loc summary")
    page.fill("#lat", "40.7128"); page.fill("#lon", "-74.0060")
    page.dispatch_event("#lon", "change")
    page.keyboard.press("Escape")
    page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")

def goto_btn_info(page, container, nth=0):
    sel = f"{container} button.goto-dt >> nth={nth}"
    jd = float(page.get_attribute(sel, "data-goto-jd"))
    txt = page.inner_text(sel)
    return sel, jd, txt

def expect_dt_matches(page, jd, label):
    exp = jd_to_utc(jd)
    got = read_dt(page, "dt")
    want = f"{exp.year:04d}-ce-{exp.month:02d}-{exp.day:02d}T{exp.hour:02d}:{exp.minute:02d}:{exp.second:02d}"
    check(f"{label}: dt fields match clicked instant", got == want, f"got {got} want {want}")
    check(f"{label}: tz pinned to UTC", page.eval_on_selector("#tz", "el => el.value") == "0",
          page.eval_on_selector("#tz", "el => el.value"))
    check(f"{label}: table tab active",
          page.get_attribute('#views .tabs button[data-tab="table"]', "aria-selected") == "true")
    stamp = page.text_content("#meta-stamp")
    check(f"{label}: table re-rendered at that instant",
          f"{exp.year:04d}-{exp.month:02d}-{exp.day:02d}" in stamp or str(exp.year) in stamp, stamp[:80])

try:
    with sync_playwright() as p:
        # ---------------- desktop: feature 1 ----------------
        browser, page, cerr, perr = launch(p)
        set_nyc(page)

        page.click('#views .tabs button[data-tab="aspects"]')
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2025-02-01T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")
        page.click("#asp-bnone"); page.check("#asp-b0"); page.check("#asp-b1")
        page.click("#asp-go")
        page.wait_for_selector("#asp-results table", timeout=180000)
        n = page.eval_on_selector_all("#asp-results button.goto-dt", "els => els.length")
        check("aspect dates rendered as goto buttons", n >= 2, f"{n} buttons")
        page.screenshot(path=f"{SHOT}/shot_goto_dates.png",
                        clip={"x": 0, "y": 0, "width": 1280, "height": 900})
        sel, jd, txt = goto_btn_info(page, "#asp-results")
        check("goto button carries a finite JD + date label",
              jd > 2460000 and re.match(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", txt), f"{jd} / {txt[:40]}")
        page.click(sel)
        page.wait_for_selector("#panel-table table", timeout=90000)
        expect_dt_matches(page, jd, "aspect goto")

        # stations tab: Mercury station date
        page.click('#views .tabs button[data-tab="stations"]')
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-06-30T23:59")
        page.click("#stn-pnone"); page.check("#stn-p2")  # Mercury only
        page.click("#stn-go")
        page.wait_for_selector("#stn-results table", timeout=180000)
        sel, jd, txt = goto_btn_info(page, "#stn-results")
        page.click(sel)
        page.wait_for_selector("#panel-table table", timeout=90000)
        expect_dt_matches(page, jd, "station goto")

        # retrograde period start date
        page.click('#views .tabs button[data-tab="stations"]')
        page.wait_for_selector("#stn-results table", timeout=30000)
        btns = page.eval_on_selector_all(
            "#stn-results table button.goto-dt", "els => els.map(e => e.dataset.gotoJd)")
        check("period dates are goto buttons", len(btns) >= 2, f"{len(btns)}")
        if btns:
            jd = float(btns[0])
            page.click("#stn-results table button.goto-dt >> nth=0")
            page.wait_for_selector("#panel-table table", timeout=90000)
            expect_dt_matches(page, jd, "period goto")

        check("desktop feature-1: zero console errors", not cerr, cerr[:2])
        check("desktop feature-1: zero page errors", not perr, perr[:2])
        browser.close()

        # ---------------- mobile: feature 1 card ----------------
        browser, page, cerr, perr = launch(p, 390, 844)
        set_nyc(page)
        page.click('#views .tabs button[data-tab="aspects"]')
        fill_dt(page, "asp-start", "2025-01-01T00:00")
        fill_dt(page, "asp-end", "2025-02-01T23:59")
        page.click("#asp-tnone"); page.check("#asp-t0")
        page.click("#asp-bnone"); page.check("#asp-b0"); page.check("#asp-b1")
        page.click("#asp-go")
        page.wait_for_selector("#asp-results .asp-card", timeout=180000)
        sel, jd, txt = goto_btn_info(page, "#asp-results .asp-cards")
        page.click(sel)
        # mobile renders the table tab as planet cards (the <table> is CSS-hidden)
        page.wait_for_selector("#panel-table .planet-card", timeout=90000)
        expect_dt_matches(page, jd, "mobile card goto")
        check("mobile: zero console errors", not cerr, cerr[:2])
        check("mobile: zero page errors", not perr, perr[:2])
        browser.close()

        # ---------------- desktop: feature 2 sky lock ----------------
        browser, page, cerr, perr = launch(p)
        set_nyc(page)
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=5000)
        page.wait_for_timeout(400)
        fill_dt(page, "dt", "2026-10-01T12:00")
        page.locator("#calc").scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        box = page.locator("#calc").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_selector("#panel-table table", timeout=90000)
        page.keyboard.press("Escape")
        page.wait_for_function("!document.getElementById('input-card').classList.contains('open')")

        page.click('button[data-tab="sky"]')
        page.wait_for_selector("#sky-canvas canvas", timeout=30000)
        page.wait_for_function(
            "document.getElementById('sky-readout').textContent.includes('UTC')", timeout=90000)
        page.wait_for_timeout(1200)

        page.click("#sky-opts summary")
        page.wait_for_selector("#sky-locksel", timeout=5000)
        opts = page.eval_on_selector_all("#sky-locksel option", "els => els.map(e => [e.value, e.text])")
        check("lock picker lists Off + 12 bodies",
              len(opts) == 13 and opts[0] == ["", "Off"] and opts[4] == ["3", "Venus"]
              and opts[-1] == ["11", "South Node"], str(len(opts)))
        check("lock picker starts Off",
              page.eval_on_selector("#sky-locksel", "el => el.value") == "")
        check("no lock chip when unlocked",
              not page.is_visible("#sky-lockbtn"))

        page.select_option("#sky-locksel", "3")  # Venus
        page.wait_for_selector("#sky-lockbtn:visible", timeout=5000)
        chip = page.inner_text("#sky-lockbtn")
        check("chip shows Venus tracking", "Venus" in chip, chip)
        page.wait_for_timeout(800)
        page.screenshot(path=f"{SHOT}/shot_skylock_venus.png")
        # unlock via the picker
        page.select_option("#sky-locksel", "")
        check("picker Off hides chip", not page.is_visible("#sky-lockbtn"))
        # lock Mars, unlock via the chip
        page.select_option("#sky-locksel", "4")
        page.wait_for_selector("#sky-lockbtn:visible", timeout=5000)
        page.click("#sky-lockbtn")
        check("chip click unlocks", not page.is_visible("#sky-lockbtn"))
        check("chip unlock resets picker",
              page.eval_on_selector("#sky-locksel", "el => el.value") == "")

        # retrograde animate path still drives the picker (sync check)
        page.click('#views .tabs button[data-tab="stations"]')
        fill_dt(page, "stn-start", "2025-01-01T00:00")
        fill_dt(page, "stn-end", "2025-06-30T23:59")
        page.click("#stn-go")
        page.wait_for_selector("#stn-results button[data-anim-period]", timeout=180000)
        ib = page.get_attribute("#stn-results button[data-anim-period] >> nth=0", "data-ib")
        page.click("#stn-results button[data-anim-period] >> nth=0")
        page.wait_for_selector("#sky-lockbtn:visible", timeout=15000)
        check("animate sets lock chip", "tracking" in page.inner_text("#sky-lockbtn"))
        if not page.get_attribute("#sky-opts", "open"):
            page.click("#sky-opts summary")
        check("animate syncs lock picker",
              page.eval_on_selector("#sky-locksel", "el => el.value") == ib,
              f"picker={page.eval_on_selector('#sky-locksel', 'el => el.value')} ib={ib}")
        page.click("#sky-lockbtn")  # unlock; leave animation state alone

        check("desktop feature-2: zero console errors", not cerr, cerr[:2])
        check("desktop feature-2: zero page errors", not perr, perr[:2])
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
