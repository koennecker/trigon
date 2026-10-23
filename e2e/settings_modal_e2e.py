"""Unified settings modal: gear in the drawer head opens one modal whose
Table / Chart / Sky sections hold the controls that used to live in the
results head, the chart panel, and the sky overlay panel."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))

def open_settings(pg):
    if pg.locator("#input-card.open").count() == 0:
        pg.locator("#input-fab").click(timeout=8000)
        pg.wait_for_selector("#input-card.open", timeout=8000)
    pg.click("#settings-open")
    pg.wait_for_selector("#settings-modal:not([hidden])", timeout=8000)

def close_settings(pg):
    pg.click("#settings-close")
    pg.wait_for_selector("#settings-modal[hidden]", state="attached", timeout=8000)

PORT = 8963

def main():
    errors = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        srv = harness.serve(PORT)
        base = f"http://127.0.0.1:{PORT}"
        if True:
            b = harness.launch(pw)
            page = b.new_page(viewport={"width": 1280, "height": 950})
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.goto(base + "/")
            page.wait_for_function("!document.getElementById('calc').disabled", timeout=60000)
            harness.ensure_drawer(page)
            page.click("details#manual-loc summary")
            page.fill("#lat", "33.4484"); page.fill("#lon", "-112.074")
            page.click("#calc")
            page.wait_for_selector("#panel-table table", timeout=30000)

            # Gear lives in the drawer head; modal starts hidden.
            check("gear button in drawer head", page.locator("#drawer-head #settings-open").count() == 1)
            check("modal hidden initially", page.locator("#settings-modal[hidden]").count() == 1)
            check("no settings controls left in the results head",
                  page.locator("#panel-table #glyph-toggle, #panel-table #size-toggle, #panel-table .results-head .seg").count() == 0)
            check("no chart style panel left in the chart panel",
                  page.locator("#panel-chart .chart-style").count() == 0)
            check("no sky options overlay left in the sky panel",
                  page.locator("#sky-opts").count() == 0)

            open_settings(page)
            secs = page.evaluate("""() => [...document.querySelectorAll('#settings-modal .set-sec > h3')]
              .map(h => h.textContent)""")
            check("modal sections are Table/Chart/Sky", secs == ["Table", "Chart", "Sky"], str(secs))
            check("chart section carries the style inputs",
                  page.locator("#settings-chart input[type=number]").count() == 33)
            check("sky section shows the load hint before the Sky view opens",
                  "load with the Sky view" in page.text_content("#sky-overlays"))

            # Table settings act on the rendered table.
            page.click('[data-set-fmt="dec"]')
            page.wait_for_function("""() => /\\d+\\.\\d{4}°/.test(
              document.querySelector('#panel-table tbody tr td.num').textContent)""", timeout=15000)
            check("angle format seg switches longitudes to decimal", True)
            page.click('[data-set-fmt="dms"]')
            page.wait_for_function("""() => document.querySelector(
              '#panel-table tbody tr td.num').textContent.includes('″')""", timeout=15000)
            page.click('[data-set-size="compact"]')
            page.wait_for_function("""() => !document.querySelector(
              '#panel-table tbody tr td.num').textContent.includes('″')""", timeout=15000)
            check("angle size seg switches longitudes to compact", True)
            page.select_option("#set-decan", "indian")
            page.wait_for_function(
                "document.querySelector('#lords-section') && !document.querySelector('#lords-section .decan-method')",
                timeout=15000)
            check("decan select applies; lordship section has no select of its own", True)
            page.check('#set-lots-opts input[data-opt="valensMoon"]')
            page.wait_for_function(
                "document.querySelector('#set-lots-opts input[data-opt=valensMoon]').checked",
                timeout=5000)
            check("lots option checkbox toggles in the modal", True)
            close_settings(page)

            # Sky section populates once the Sky view has loaded.
            page.click('#views .tabs button[data-tab="sky"]')
            page.wait_for_selector("#sky-canvas canvas", timeout=60000)
            page.click('#views .tabs button[data-tab="table"]')
            open_settings(page)
            check("sky options populate the modal Sky section",
                  page.locator("#sky-overlays input").count() > 10,
                  str(page.locator("#sky-overlays input").count()))

            # Close paths: Escape and backdrop.
            page.keyboard.press("Escape")
            page.wait_for_selector("#settings-modal[hidden]", state="attached", timeout=5000)
            check("Escape closes the modal", True)
            open_settings(page)
            page.mouse.click(6, 6)  # backdrop corner
            page.wait_for_selector("#settings-modal[hidden]", state="attached", timeout=5000)
            check("backdrop click closes the modal", True)

            # Persistence across reload: seg states, decan, lots checkbox.
            page.reload(wait_until="networkidle")
            page.wait_for_selector("#panel-table table", timeout=60000)
            open_settings(page)
            kept = page.evaluate("""() => ({
              size: document.querySelector('[data-set-size="compact"]').getAttribute('aria-pressed'),
              decan: document.getElementById('set-decan').value,
              lots: document.querySelector('#set-lots-opts input[data-opt="valensMoon"]').checked })""")
            check("settings persist across reload",
                  kept == {"size": "true", "decan": "indian", "lots": True}, str(kept))
            close_settings(page)
            page.screenshot(path="/tmp/settings_modal.png")

            # Mobile: gear reachable from the overlay drawer, card fits.
            mp = b.new_page(viewport={"width": 390, "height": 844})
            mp.on("pageerror", lambda e: errors.append("mobile: " + str(e)))
            mp.goto(base + "/")
            mp.wait_for_function("!document.getElementById('calc').disabled", timeout=60000)
            open_settings(mp)
            card = mp.evaluate("""() => { const b = document.querySelector('.settings-card')
              .getBoundingClientRect(); return {x: b.x, w: b.width, vw: window.innerWidth}; }""")
            check("mobile: settings card inside viewport",
                  card["x"] >= -1 and card["x"] + card["w"] <= card["vw"] + 1, str(card))
            mp.screenshot(path="/tmp/settings_modal_m.png")
            close_settings(mp)
            b.close()
    check("zero console/page errors", not errors, "; ".join(errors[:3]))
    failed = [n for n, ok in results if not ok]
    print(f"\nRESULT {len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
