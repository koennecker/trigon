#!/usr/bin/env python3
"""Integration checks for the modules extracted out of app.js:
loader.js (download animation), datetime-groups.js (field groups +
picker + range pairs), outer-wheels.js (panels + animation target),
chart-style.js (Customize panel + persisted overrides), and
chart-tooltip.js (hover tooltips). Drives the real app in Chromium.
"""
import sys, time
sys.path.insert(0, '/home/hatch/workspace/swisseph-wasm/e2e')
import harness
from playwright.sync_api import sync_playwright

PORT = 8947
results = []
def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def main():
    errors = []
    with sync_playwright() as pw:
        srv = harness.serve(PORT)
        b = harness.launch(pw)
        page = b.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)

        # Hold every .se1 download for 1.5s so the loader is observable.
        def hold_se1(route):
            time.sleep(1.5)
            route.continue_()
        page.route('**/*.se1', hold_se1)

        page.goto(f'http://127.0.0.1:{PORT}/')
        harness.ensure_drawer(page)
        page.click('details#manual-loc summary')
        page.fill('#lat', '33.4484'); page.fill('#lon', '-112.074')

        # --- loader.js: shows during the ephemeris download, then clears.
        page.click('#calc')
        page.wait_for_selector('#loader', timeout=10000)
        label = page.text_content('#load-label')
        check('loader appears during download', True)
        check('loader label names the download', 'ephemeris' in (label or '') or 'engine' in (label or ''), label or '')
        page.wait_for_selector('#panel-table table', timeout=30000)
        check('results replace the loader', page.locator('#panel-table #loader').count() == 0)
        page.unroute('**/*.se1', hold_se1)

        # --- datetime-groups.js: picker commits a date; range pair follows.
        page.click('#dt-cal')
        page.wait_for_selector('.dpick', timeout=8000)
        check('calendar popup opens', True)
        before = page.evaluate("document.getElementById('dt-d').value")
        page.locator('.dpick-day:not(.dim)').filter(has_text='15').first.click()
        page.wait_for_timeout(300)
        check('popup day click commits the date',
              page.evaluate("document.getElementById('dt-d').value") == '15',
              f"d was {before}")
        page.evaluate("window.__trigonSetDate('asp-end','2026','ce','6','1')")
        page.evaluate("window.__trigonSetDate('asp-start','2026','ce','7','1')")
        check('range pair: end follows a start that passes it',
              page.evaluate("document.getElementById('asp-end-mo').value") == '7')

        # --- outer-wheels.js: add a wheel, calculate, band + points render.
        page.click('#add-wheel')
        page.wait_for_selector('#outer-panels .outer-panel', timeout=8000)
        check('outer wheel panel appears', True)
        radios = page.locator('#anim-target-wheels input[name="anim-target"]').count()
        check('animation-target radio for the wheel appears', radios == 1, f'{radios} radios')
        page.click('#calc')
        page.wait_for_selector('#panel-table table', timeout=30000)
        page.click('#views .tabs button[data-tab="chart"]')
        page.wait_for_selector('#panel-chart svg', timeout=10000)
        n_pts = page.locator('#panel-chart .chart-point[data-wheel="1"]').count()
        check('outer wheel points render on the chart', n_pts == 10, f'{n_pts} points')

        # --- chart-tooltip.js: hover shows the table-mirroring tooltip.
        sun_row = page.evaluate("""(() => {
          const rows = document.querySelectorAll('#panel-table table tr');
          for (const r of rows) if (r.cells[0] && r.cells[0].textContent.includes('Sun')) return r.cells[1].textContent.trim();
          return ''; })()""")
        g = page.locator('#panel-chart .chart-point[data-point="sun"]').first
        box = g.bounding_box()
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.wait_for_selector('#chart-tip', state='visible', timeout=8000)
        tip = page.text_content('#chart-tip')
        check('tooltip shows on hover', 'Sun' in (tip or ''))
        check('tooltip longitude mirrors the table row', sun_row != '' and sun_row in (tip or ''), sun_row)
        page.mouse.move(5, 5)
        page.wait_for_timeout(300)
        check('tooltip hides after pointer leaves',
              page.evaluate("document.getElementById('chart-tip').style.display") == 'none')

        # --- chart-style.js: edit persists + re-renders; reset clears.
        page.locator('.chart-style summary').click()
        inp = page.locator('.chart-style input[type=number]').first
        sec, key = inp.get_attribute('data-sec'), inp.get_attribute('data-key')
        cur = float(inp.input_value())
        inp.fill(str(cur * 1.5))
        inp.press('Tab')
        page.wait_for_timeout(400)
        stored = page.evaluate("localStorage.getItem('astroweb-chart-style')")
        check('style edit persists to storage', stored is not None and key in stored, stored or 'null')
        page.click('#cs-reset')
        page.wait_for_timeout(300)
        check('reset clears the persisted overrides',
              page.evaluate("localStorage.getItem('astroweb-chart-style')") is None)

        check('no page errors', not errors, '; '.join(errors[:3]))
        b.close(); srv.shutdown()
    fails = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(fails)}/{len(results)} checks passed")
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
