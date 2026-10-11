#!/usr/bin/env python3
"""E2E for the chart Customize panel: number inputs re-render the wheel SVG in
place, arbitrary sizes are accepted (no caps), invalid entries revert, aspect-line thickness scales, glyph sizes apply, settings persist
across reload via localStorage, Reset restores defaults, the live clock
does not clobber custom style, and the mobile wheel honors its own section."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def set_num(page, sec, key, val):
    page.evaluate(f"""() => {{
      const i = document.querySelector('input[data-sec="{sec}"][data-key="{key}"]');
      i.value = {val};
      i.dispatchEvent(new Event('change', {{ bubbles: true }}));
    }}""")
    page.wait_for_timeout(150)

def num_val(page, sec, key):
    return page.evaluate(f"""() => {{
      const r = document.querySelector('input[data-sec="{sec}"][data-key="{key}"]');
      return r.value;
    }}""")

def outer_r(page):
    return page.evaluate("""() => document.querySelector(
      '#panel-chart .chart-wrap circle[stroke="#8b949e"][stroke-width="1.5"]'
    ).getAttribute('r')""")

def aspect_w(page):
    return page.evaluate("""() => {
      const l = document.querySelector('#panel-chart .chart-wrap line[opacity="0.9"]');
      return l ? +l.getAttribute('stroke-width') : null;
    }""")

def calc_and_chart(page):
    page.click("#views .tabs button[data-tab=table]")
    fill_dt(page, "dt", "2026-03-15T12:00:00")
    page.click("#calc")
    page.wait_for_selector("#panel-chart svg", timeout=60000, state="attached")
    page.click("#views .tabs button[data-tab=chart]")
    page.wait_for_selector("#panel-chart svg", timeout=10000, state="visible")

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8129", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8129/", wait_until="networkidle")
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)
        calc_and_chart(page)

        # --- panel structure ---
        nsec = page.eval_on_selector_all(".chart-style .cs-sec", "els => els.length")
        nsl = page.eval_on_selector_all(".chart-style input[type=number]", "els => els.length")
        check("customize panel has 3 sections and 18 number inputs", nsec == 3 and nsl == 18,
              f"sections={nsec} inputs={nsl}")
        check("outer circle renders at default r=294", outer_r(page) == "294", outer_r(page))

        # --- details stays open while dragging ---
        page.click(".chart-style summary")
        page.wait_for_timeout(120)
        set_num(page, "desktop", "rOut", 310)
        check("rOut input moves the rendered circle", outer_r(page) == "310", outer_r(page))
        check("input shows the typed value", num_val(page, "desktop", "rOut") == "310",
              num_val(page, "desktop", "rOut"))
        check("details stays open during input",
              page.eval_on_selector(".chart-style", "el => el.open"))

        # --- aspect line thickness scales ---
        w1 = aspect_w(page)
        set_num(page, "shared", "aspWidth", 2)
        w2 = aspect_w(page)
        check("aspect width doubles line widths",
              w1 and w2 and abs(w2 / w1 - 2) < 0.02, f"{w1} -> {w2}")

        # --- arbitrary sizes: beyond the old 18 cap, and invalid reverts ---
        set_num(page, "desktop", "lblGlyphSize", 48)
        bigpitch = page.evaluate("""() => {
          const texts = [...document.querySelectorAll('#panel-chart .chart-wrap text')];
          for (const t of texts) {
            const sp = [...t.querySelectorAll('tspan')];
            if (sp.length > 1) {
              const a = sp[0], b = sp[1];
              return Math.hypot(+b.getAttribute('x') - +a.getAttribute('x'),
                                +b.getAttribute('y') - +a.getAttribute('y'));
            }
          }
          return null;
        }""")
        check("arbitrary lblGlyphSize=48 widens token pitch to 60",
              bigpitch and abs(bigpitch - 60) < 1, str(bigpitch))
        page.evaluate("""() => {
          const i = document.querySelector('input[data-sec="desktop"][data-key="lblGlyphSize"]');
          i.value = 'abc';
          i.dispatchEvent(new Event('change', { bubbles: true }));
        }""")
        page.wait_for_timeout(150)
        check("invalid input reverts to the current value",
              num_val(page, "desktop", "lblGlyphSize") == "48", num_val(page, "desktop", "lblGlyphSize"))

        # --- separation multiplier applies ---
        set_num(page, "shared", "sepScale", 0.5)
        sepset = page.evaluate("""() => JSON.parse(localStorage.getItem('astroweb-chart-style'))
          .shared.sepScale""")
        check("sepScale=0.5 persists", sepset == 0.5, str(sepset))
        set_num(page, "shared", "sepScale", 1)

        # --- glyph size applies ---
        set_num(page, "desktop", "signSize", 24)
        has24 = page.evaluate("""() => [...document.querySelectorAll(
          '#panel-chart .chart-wrap text')].some(t => t.getAttribute('font-size') === '24')""")
        check("sign glyph size renders at 24", has24)

        # --- live clock does not reset custom style ---
        page.check("#clock-toggle")
        set_num(page, "desktop", "rOut", 305)
        page.wait_for_timeout(2400)
        check("clock ticks keep the customized radius", outer_r(page) == "305", outer_r(page))
        page.uncheck("#clock-toggle")

        # --- persistence across reload ---
        page.reload(wait_until="networkidle")
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)
        calc_and_chart(page)
        check("rOut=305 survives reload", outer_r(page) == "305", outer_r(page))
        check("input restores from storage",
              num_val(page, "desktop", "rOut") == "305")
        check("localStorage holds overrides",
              page.evaluate("() => JSON.parse(localStorage.getItem('astroweb-chart-style'))")
              == {"desktop": {"rOut": 305, "signSize": 24, "lblGlyphSize": 48}, "shared": {"aspWidth": 2}})

        # --- reset restores defaults ---
        page.click(".chart-style summary")
        page.click("#cs-reset")
        page.wait_for_timeout(200)
        check("reset restores r=294", outer_r(page) == "294", outer_r(page))
        check("reset clears storage",
              page.evaluate("() => localStorage.getItem('astroweb-chart-style')") is None)
        page.screenshot(path="/tmp/cs_desktop.png")

        # --- mobile wheel honors its own section ---
        mctx = browser.new_context(viewport={"width": 390, "height": 844})
        m = mctx.new_page()
        m.on("console", lambda e: cerr.append(e.text) if e.type == "error" else None)
        m.on("pageerror", lambda e: perr.append(str(e)))
        m.goto("http://127.0.0.1:8129/", wait_until="networkidle")
        if m.locator("#input-card.open").count() == 0:
            m.locator("#input-fab").click(timeout=8000)
            m.wait_for_selector("#input-card.open", timeout=8000)
        m.click("details#manual-loc summary")
        m.fill("#lat", "40.7128")
        m.fill("#lon", "-74.0060")
        m.dispatch_event("#lon", "change")
        m.wait_for_timeout(400)
        m.click("#calc")
        m.wait_for_selector("#panel-chart svg", timeout=60000, state="attached")
        if m.locator("#input-card.open").count() > 0:
            m.click("#input-hide", timeout=8000)  # drawer is a fixed overlay on mobile
            m.wait_for_selector("#input-card:not(.open)", timeout=8000)
        m.click("#views .tabs button[data-tab=chart]")
        m.wait_for_selector("#panel-chart svg", timeout=10000, state="visible")
        is_mobile = m.evaluate("""() => document.querySelector('#panel-chart svg')
          .getAttribute('viewBox') === '110 110 480 480'""")
        check("mobile viewport renders the mobile wheel", is_mobile)
        g1 = m.evaluate("""() => [...document.querySelectorAll(
          '#panel-chart .chart-wrap text')].some(t => t.getAttribute('font-size') === '32')""")
        check("mobile glyphs default to 32", g1)
        m.click(".chart-style summary")
        set_num(m, "mobile", "glyphSize", 40)
        g2 = m.evaluate("""() => [...document.querySelectorAll(
          '#panel-chart .chart-wrap text')].some(t => t.getAttribute('font-size') === '40')""")
        check("mobile glyphSize number input applies", g2)
        set_num(m, "mobile", "glyphSize", 96)
        g3 = m.evaluate("""() => [...document.querySelectorAll(
          '#panel-chart .chart-wrap text')].some(t => t.getAttribute('font-size') === '96')""")
        check("mobile accepts arbitrary glyphSize=96", g3)
        set_num(m, "mobile", "rOut", 150)
        mr = m.evaluate("""() => document.querySelector(
          '#panel-chart .chart-wrap circle[stroke="#8b949e"][stroke-width="1.5"]'
        ).getAttribute('r')""")
        check("mobile rOut number input moves the rim", mr == "150", mr)
        m.screenshot(path="/tmp/cs_mobile.png")

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
