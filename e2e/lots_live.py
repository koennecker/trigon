#!/usr/bin/env python3
"""Live check: Hermetic lots on the deployed site (day chart, Phoenix)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time


URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()
relay = harness.start_relay()
time.sleep(2)
from playwright.sync_api import sync_playwright
cerr, perr = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        pg = browser.new_page(viewport={"width": 1600, "height": 1000})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(URL + "/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 15)")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        pg.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")  # 12:00 MST = 19:00 UTC
        pg.click("#calc")
        pg.wait_for_selector("#panel-table #lots-section", timeout=120000)
        note = pg.inner_text("#lots-section .lots-note")
        fortune = pg.evaluate("""() => [...document.querySelectorAll('#lots-section tbody tr')]
          .find(tr => tr.children[0].textContent.trim() === 'Fortune').children[1].textContent.trim()""")
        print("note:", note)
        print("Fortune:", fortune)
        assert note.startswith("Day chart") and fortune.startswith("Gemini 13°37′"), "MISMATCH"
        # Modifier flow: 1990-06-14 21:00 MST = 06-15 04:00 UTC, night with
        # the Moon set; standard Fortune reversed, proviso unreverses it.
        pg.evaluate("window.__trigonSetDate('dt', 1990, 'ce', 6, 14)")
        pg.evaluate("window.__trigonSetTime('dt', 21, 0, 0)")
        pg.click("#calc")
        pg.wait_for_function("""() => {
          const tr = [...document.querySelectorAll('#lots-section tbody tr')]
            .find(tr => tr.children[0].textContent.trim() === 'Fortune');
          return !!tr && tr.children[1].textContent.includes('Aries 26°44');
        }""", timeout=120000)
        pg.click('#lots-section input[data-opt="valensMoon"]')
        pg.wait_for_function("""() => {
          const tr = [...document.querySelectorAll('#lots-section tbody tr')]
            .find(tr => tr.children[0].textContent.trim() === 'Fortune');
          return !!tr && tr.children[1].textContent.includes('Libra 0°58');
        }""", timeout=60000)
        notes = pg.evaluate("[...document.querySelectorAll('#lots-section .lots-note')].map(n => n.textContent)")
        assert any("Valens" in n and "below the horizon" in n for n in notes), notes
        print("modifier notes:", " | ".join(notes))
        assert not cerr and not perr, f"errors: {cerr[:2]} {perr[:2]}"
        print("LIVE OK")
        browser.close()
finally:
    harness.stop_relay(relay)
