#!/usr/bin/env python3
"""E2E for the Hermetic lots table: day and night charts at Phoenix,
values checked against independently computed reference values,
mobile visibility, zero console/page errors."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time, http.server, threading, functools

SITE = harness.site_dir()


SHOT = "/tmp/lots_e2e"
PORT = 8915

passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

relay = harness.start_relay()
time.sleep(2)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs(SHOT, exist_ok=True)

from playwright.sync_api import sync_playwright
cerr, perr = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        pg = browser.new_page(viewport={"width": 1600, "height": 1000})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(f"http://127.0.0.1:{PORT}/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        # The app derives the zone from coordinates (Phoenix -> UTC-7).
        # Wait for that to land, then set wall times that hit exact UTC
        # instants under the derived offset.
        pg.wait_for_function(
            "document.getElementById('tz').value === '-420'", timeout=30000)
        def set_utc_time(hh, mm):
            off = int(pg.evaluate("document.getElementById('tz').value"))
            wall = (hh * 60 + mm + off) % 1440
            pg.evaluate(f"window.__trigonSetTime('dt', {wall // 60}, {wall % 60}, 0)")
        set_utc_time(19, 0)
        pg.click("#calc")
        pg.wait_for_selector("#panel-table #lots-section", timeout=90000)

        stamp = pg.inner_text("#meta-stamp")
        check("meta stamp is 1990-06-15 19:00 UTC", "1990" in stamp and "19:00" in stamp, stamp)
        note = pg.inner_text("#lots-section .lots-note")
        check("day-chart note with Sun altitude", note.startswith("Day chart") and "78.1" in note, note)
        rows = pg.evaluate("""() => [...document.querySelectorAll('#lots-section tbody tr')]
          .map(tr => [...tr.children].map(td => td.textContent.trim()))""")
        check("ten lot rows", len(rows) == 10, f"{len(rows)} rows")
        by_name = {r[0]: r for r in rows}
        check("Fortune day value/house/formula",
              by_name["Fortune"][1].startswith("Gemini 13°37′") and by_name["Fortune"][2] == "10"
              and by_name["Fortune"][3] == "Asc + ☽\uFE0E − ☉\uFE0E", str(by_name.get("Fortune")))
        check("Spirit day value",
              by_name["Spirit"][1].startswith("Sagittarius 23°54′"), str(by_name.get("Spirit")))
        check("Eros day value (recursive Spirit ref)",
              by_name["Eros"][1].startswith("Aquarius 13°58′"), str(by_name.get("Eros")))
        check("Exaltation day formula",
              by_name["Exaltation"][3] == "Asc + 19°♈\uFE0E − ☉\uFE0E", str(by_name.get("Exaltation")))
        pg.screenshot(path=f"{SHOT}/a_lots_day.png")

        # Night chart: same date, 07:00 UTC (local midnight).
        set_utc_time(7, 0)
        pg.click("#calc")
        pg.wait_for_function(
            "(document.querySelector('#lots-section .lots-note') || {textContent: ''})"
            ".textContent.startsWith('Night chart')",
            timeout=90000)
        note = pg.inner_text("#lots-section .lots-note")
        check("night-chart note with Sun altitude", "32.8" in note, note)
        rows = pg.evaluate("""() => [...document.querySelectorAll('#lots-section tbody tr')]
          .map(tr => [...tr.children].map(td => td.textContent.trim()))""")
        by_name = {r[0]: r for r in rows}
        check("Fortune night value/formula",
              by_name["Fortune"][1].startswith("Gemini 20°36′")
              and by_name["Fortune"][3] == "Asc + ☉\uFE0E − ☽\uFE0E", str(by_name.get("Fortune")))
        check("Exaltation night formula",
              by_name["Exaltation"][3] == "Asc + 3°♉\uFE0E − ☽\uFE0E", str(by_name.get("Exaltation")))
        pg.screenshot(path=f"{SHOT}/b_lots_night.png")

        # Conditional modifiers: 1990-06-14 21:00 MST = 06-15 04:00 UTC is a
        # night chart with the Moon set (alt -35.7). Standard Fortune is the
        # reversed Aries 26°44'45"; Valens's proviso unreverses it.
        pg.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 14)")
        pg.evaluate("window.__trigonSetTime('dt', 21, 0, 0)")
        pg.click("#calc")
        pg.wait_for_function(
            "(document.querySelector('#lots-section .lots-note') || {textContent: ''})"
            ".textContent.startsWith('Night chart')", timeout=90000)

        def fortune_text():
            return pg.evaluate("""() => [...document.querySelectorAll('#lots-section tbody tr')]
              .find(tr => tr.children[0].textContent.trim() === 'Fortune').children[1].textContent.trim()""")

        check("moon-down night: standard Fortune reversed",
              fortune_text().startswith("Aries 26°44′"), fortune_text())
        pg.click('#lots-section input[data-opt="valensMoon"]')
        pg.wait_for_function(
            "(() => { const tr = [...document.querySelectorAll('#lots-section tbody tr')]"
            ".find(tr => tr.children[0].textContent.trim() === 'Fortune');"
            " return !!tr && tr.children[1].textContent.includes('Libra'); })()",
            timeout=30000)
        check("proviso on: Fortune unreversed (day formula)",
              fortune_text().startswith("Libra 0°58′"), fortune_text())
        notes = pg.evaluate("[...document.querySelectorAll('#lots-section .lots-note')].map(n => n.textContent)")
        opts = pg.inner_text("#lots-section .lots-opts")
        check("proviso checkbox carries the Nechepso/Valens + Serapio label",
              "Nechepso/Valens; cf. Serapio" in opts, opts)
        check("proviso note exposes the rule",
              any("Nechepso rule" in n and "Serapio" in n and "below the horizon" in n for n in notes), " | ".join(notes))
        pg.screenshot(path=f"{SHOT}/d_lots_proviso.png")
        # Persistence: recalculate; the option (and its effect) must stick.
        pg.click("#calc")
        pg.wait_for_function(
            "(() => { const tr = [...document.querySelectorAll('#lots-section tbody tr')]"
            ".find(tr => tr.children[0].textContent.trim() === 'Fortune');"
            " return !!tr && tr.children[1].textContent.includes('Libra'); })()",
            timeout=90000)
        stuck = pg.evaluate("document.querySelector('#lots-section input[data-opt=\"valensMoon\"]').checked")
        check("proviso persists across recalculation", stuck is True and fortune_text().startswith("Libra"))
        pg.click('#lots-section input[data-opt="valensMoon"]')
        pg.wait_for_function(
            "(() => { const tr = [...document.querySelectorAll('#lots-section tbody tr')]"
            ".find(tr => tr.children[0].textContent.trim() === 'Fortune');"
            " return !!tr && tr.children[1].textContent.includes('Aries'); })()",
            timeout=30000)
        check("proviso off: standard Fortune restored",
              fortune_text().startswith("Aries 26°44′"), fortune_text())

        # Mobile: lots table must survive the planet-table -> cards swap.
        pg2 = browser.new_page(viewport={"width": 390, "height": 844})
        pg2.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg2.on("pageerror", lambda e: perr.append(str(e)))
        pg2.goto(f"http://127.0.0.1:{PORT}/", wait_until="load", timeout=90000)
        pg2.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg2.locator("#input-card.open").count() == 0:
            pg2.locator("#input-fab").click(timeout=8000)
            pg2.wait_for_selector("#input-card.open", timeout=8000)
        pg2.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        pg2.click("details#manual-loc summary")
        pg2.fill("#lat", "33.4484"); pg2.fill("#lon", "-112.0740")
        pg2.dispatch_event("#lon", "change")
        pg2.wait_for_function(
            "document.getElementById('tz').value === '-420'", timeout=30000)
        pg2.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        pg2.click("#calc")
        pg2.wait_for_selector("#panel-table #lots-section", timeout=90000)
        disp = pg2.evaluate("""() => getComputedStyle(
          document.querySelector('#lots-section .lots-table')).display""")
        check("lots table visible on mobile", disp == "table", disp)
        pg2.locator("#lots-section").scroll_into_view_if_needed()
        pg2.screenshot(path=f"{SHOT}/c_lots_mobile.png")
        pg2.close()
        pg.close()
        browser.close()
finally:
    srv.shutdown()
    harness.stop_relay(relay)

check("zero console errors", not cerr, "; ".join(cerr[:3]))
check("zero page errors", not perr, "; ".join(perr[:3]))
print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
