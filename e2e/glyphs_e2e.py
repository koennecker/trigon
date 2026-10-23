#!/usr/bin/env python3
"""Integration checks for glyphs.js + the chart's vector glyphs:
the desktop sign band, spoke labels, outer wheels, and the mobile
wheel all render .svg-glyph groups (no sign/point unicode remains in
chart text), and the Glyphs style section (outline width, fill
opacity) drives the rendered paths and persists. Drives the real app
in Chromium over localhost.
"""
import sys
sys.path.insert(0, '/home/hatch/workspace/swisseph-wasm/e2e')
import harness
from playwright.sync_api import sync_playwright

PORT = 8951
GLYPH_CHARS = ''.join(chr(c) for c in list(range(0x2648, 0x2654)) +
                      [0x2609, 0x263D, 0x263F, 0x2640, 0x2642, 0x2643, 0x2644,
                       0x2645, 0x2646, 0x2647, 0x260A, 0x260B])
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))


def calc_and_open_chart(page):
    harness.ensure_drawer(page)
    if page.locator('#lat').input_value() == '':
        page.click('details#manual-loc summary')
        page.fill('#lat', '33.4484')
        page.fill('#lon', '-112.074')
    page.click('#calc')
    page.wait_for_selector('#panel-table table', state='attached', timeout=30000)
    page.wait_for_timeout(800)


def main():
    errors = []
    with sync_playwright() as pw:
        srv = harness.serve(PORT)
        b = harness.launch(pw)
        page = b.new_page(viewport={'width': 1280, 'height': 950})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.goto(f'http://127.0.0.1:{PORT}/')
        calc_and_open_chart(page)
        page.click('#views .tabs button[data-tab="chart"]')
        page.wait_for_selector('#panel-chart svg', timeout=10000)
        page.wait_for_function(
            "document.querySelectorAll('#panel-chart svg .svg-glyph').length > 0", timeout=8000)

        chart = page.locator('#panel-chart svg')
        n_glyph = chart.locator('.svg-glyph').count()
        check('desktop chart renders vector glyphs', n_glyph == 40,
              f'{n_glyph} glyph groups (12 band + 28 label)')
        texts = chart.locator('text').all_text_contents()
        bad = [t for t in texts if any(ch in t for ch in GLYPH_CHARS)]
        check('no sign/point unicode left in chart texts', not bad, str(bad[:3]))
        check('16 hoverable point groups remain',
              chart.locator('g.chart-point').count() == 16)

        # --- outer wheel glyphs are vector too ---
        harness.ensure_drawer(page)
        page.click('#add-wheel')
        page.wait_for_selector('#outer-panels .outer-panel', timeout=8000)
        page.click('#calc')
        page.wait_for_function(
            "document.querySelectorAll('#panel-chart svg g.chart-point[data-wheel=\"1\"] .svg-glyph').length === 10",
            timeout=10000)
        check('outer wheel points are vector glyphs', True)

        # --- Glyphs style section drives the paths and persists ---
        page.locator('.chart-style summary').click()
        sw = page.locator('.chart-style input[data-sec="glyphs"][data-key="outlineW"]')
        check('Glyphs section outlineW input exists', sw.count() == 1)
        sw.fill('3')
        sw.press('Tab')
        page.wait_for_function(
            "document.querySelector('#panel-chart svg .svg-glyph path').getAttribute('stroke-width') === '3'",
            timeout=8000)
        check('outlineW 3 reaches the rendered glyph paths', True)
        stored = page.evaluate("localStorage.getItem('astroweb-chart-style')")
        check('outlineW persisted', stored is not None and '"outlineW":3' in stored,
              str(stored))
        fo = page.locator('.chart-style input[data-sec="glyphs"][data-key="fillOpacity"]')
        fo.fill('0.25')
        fo.press('Tab')
        page.wait_for_function(
            "[...document.querySelectorAll('#panel-chart svg .svg-glyph path')]"
            ".some(p => p.getAttribute('fill-opacity') === '0.25')",
            timeout=8000)
        check('fillOpacity 0.25 reaches the glyph fill paths', True)

        # --- table in glyphs mode renders vector glyphs ---
        page.click('#views .tabs button[data-tab="table"]')
        page.wait_for_selector('#panel-table table', timeout=10000)
        page.click('#glyph-toggle')
        page.wait_for_selector('#panel-table td.body svg.glyph-inline', timeout=10000)
        tbl = page.evaluate("""() => {
          const sunCell = document.querySelector('#panel-table tbody tr td.body');
          const lonCell = document.querySelector('#panel-table tbody tr td.num');
          return {
            inline: document.querySelectorAll('#panel-table table svg.glyph-inline').length,
            sunTitle: sunCell ? sunCell.textContent.trim() : '',
            lonSvg: lonCell ? !!lonCell.querySelector('svg.glyph-inline') : false,
            lonText: lonCell ? lonCell.textContent : '',
          };
        }""")
        check('table glyphs mode: many inline vector glyphs', tbl['inline'] >= 30, tbl)
        check('table body cell keeps the char as svg title', tbl['sunTitle'] == '☉', tbl)
        check('table longitude cell carries a vector sign glyph', tbl['lonSvg'], tbl)
        check('table longitude text still reads with the sign char',
              any(c in tbl['lonText'] for c in '♈♉♊♋♌♍♎♏♐♑♒♓'), tbl)
        try:
            page.wait_for_selector('#panel-table td.stn-prev[data-ib="2"] svg.glyph-inline',
                                   timeout=30000)
            check('station cell sign glyph is vector', True)
        except Exception as e:
            check('station cell sign glyph is vector', False, repr(e)[:100])
        page.screenshot(path='/tmp/glyphs_table.png')

        # --- hover tooltip honors glyphs mode with vector glyphs ---
        page.click('#views .tabs button[data-tab="chart"]')
        page.wait_for_selector('#panel-chart svg', timeout=10000)
        sun = page.query_selector('.chart-point[data-point="sun"]')
        box = sun.bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_selector('#chart-tip', state='visible', timeout=5000)
        page.wait_for_function(
            "document.querySelector('#chart-tip').innerHTML.includes('glyph-inline')",
            timeout=5000)
        tip = page.evaluate("""() => {
          const t = document.querySelector('#chart-tip');
          return { html: t.innerHTML, text: t.textContent };
        }""")
        check('tooltip renders vector glyphs in glyphs mode',
              'glyph-inline' in tip['html'], tip['html'][:120])
        check('tooltip text still carries the sign char (svg title)',
              any(c in tip['text'] for c in '♈♉♊♋♌♍♎♏♐♑♒♓'), tip['text'][:120])
        page.screenshot(path='/tmp/glyphs_tip.png')

        # --- mobile renderer ---
        mob = b.new_page(viewport={'width': 393, 'height': 800})
        mob.on('pageerror', lambda e: errors.append('mobile: ' + str(e)))
        mob.goto(f'http://127.0.0.1:{PORT}/')
        mob.evaluate("localStorage.removeItem('astroweb-chart-style')")
        mob.reload()
        calc_and_open_chart(mob)
        if mob.locator('#input-card.open').count():
            mob.evaluate("document.getElementById('input-fab').click()")
            mob.wait_for_selector('#input-card:not(.open)', timeout=8000)
        mob.click('#views .tabs button[data-tab="chart"]')
        mob.wait_for_function(
            "document.querySelectorAll('#panel-chart svg .svg-glyph').length >= 24",
            timeout=15000)
        mtexts = mob.locator('#panel-chart svg text').all_text_contents()
        mbad = [t for t in mtexts if any(ch in t for ch in GLYPH_CHARS)]
        check('mobile chart glyphs are vector, no unicode glyphs', not mbad,
              str(mbad[:3]))

        check('zero console/page errors', not errors, '; '.join(errors[:3]))
        b.close()
        srv.shutdown()
    failed = [n for n, ok in results if not ok]
    print(f'RESULT {len(results) - len(failed)} passed, {len(failed)} failed')
    return 1 if failed else 0


sys.exit(main())
