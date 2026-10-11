"""Display toggles: glyphs, arcseconds, merged speed, angle rows, nodes."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, json
PORT = 8379
SRV = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=harness.site_dir(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
from playwright.sync_api import sync_playwright
fails = []
def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f" — {detail}" if detail else ""))
    if not cond: fails.append(label)

try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page(viewport={"width": 1500, "height": 1150})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.click("#views .tabs button[data-tab=table]")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if page.locator("#input-card.open").count() == 0:
            page.locator("#input-fab").click(timeout=8000)
            page.wait_for_selector("#input-card.open", timeout=8000)
        page.evaluate("""() => {
          window.__trigonSetDate('dt', 1990, 'ce', 6, 15);
          window.__trigonSetTime('dt', 19, 30, 0);
          const set = (id, v) => { const el = document.getElementById(id); el.value = v;
            el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
          set('lat', '33.4484'); set('lon', '-112.074');
        }""")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)

        t = page.evaluate("""() => {
          const trs = [...document.querySelector('#panel-table .csv-block table').querySelectorAll('tbody tr')];
          const head = [...document.querySelectorAll('#panel-table thead th')].map(th => th.textContent);
          return { nRows: trs.length, head,
                   bodies: trs.map(tr => tr.children[0].textContent),
                   sunSpd: trs[0].children[3].textContent, mercSpd: trs[2].children[3].textContent,
                   sunLon: trs[0].children[1].textContent,
                   ascRow: [...trs[11].children].map(td => td.textContent) };
        }""")
        check("15 rows: 11 bodies + 4 angles", t["nRows"] == 15, str(t["nRows"]))
        check("no Motion column; Speed present", "Motion" not in t["head"] and "Speed" in t["head"], json.dumps(t["head"]))
        check("no Mean Node; True Node present", "Mean Node" not in t["bodies"] and "True Node" in t["bodies"])
        check("angle rows at bottom in order", t["bodies"][11:] == ["Ascendant", "Descendant", "Midheaven", "IC"], json.dumps(t["bodies"][11:]))
        check("Ascendant row carries lords (not dashes in dignity cols)", t["ascRow"][8] not in ("—", ""), json.dumps(t["ascRow"]))
        check("speed uses D/R, no +/-", t["sunSpd"].strip().endswith("D") and "+" not in t["sunSpd"] and "-" not in t["sunSpd"], t["sunSpd"])
        check("default longitude has arcseconds", "″" in t["sunLon"], t["sunLon"])

        # Colors: planet-colored body, element-colored sign, green D.
        cols = page.evaluate("""() => {
          const trs = [...document.querySelector('#panel-table .csv-block table').querySelectorAll('tbody tr')];
          const dirSpan = trs[0].children[3].querySelector('.direct, .retro');
          return { bodyColor: trs[0].children[0].style.color !== '',
                   signColor: !!trs[0].children[1].querySelector('span[style*="color"]'),
                   dirCls: dirSpan ? dirSpan.className : null,
                   dirColor: dirSpan ? getComputedStyle(dirSpan).color : null,
                   magTips: trs.slice(0, 10).every(tr => tr.children[4].querySelector('span').title.includes('brighter than')) };
        }""")
        check("body cells carry planet colors", cols["bodyColor"])
        check("signs carry element colors", cols["signColor"])
        check("D is green", cols["dirCls"] == "direct" and cols["dirColor"] == "rgb(63, 185, 80)", json.dumps(cols))
        check("magnitude tooltips give brightness percentile", cols["magTips"])

        # Compact on: the leading pair only — no row shows all three units.
        page.click("#size-toggle")
        page.wait_for_function("""() => document.querySelector('#size-toggle').textContent.includes('compact')""", timeout=30000)
        lons = page.evaluate("""() => [...document.querySelector('#panel-table .csv-block table').querySelectorAll('tbody tr')]
          .map(tr => tr.children[1].textContent)""")
        check("compact: no longitude shows degrees+minutes+seconds together",
              all(not ("°" in l and "″" in l) for l in lons), json.dumps(lons[:3]))

        # Glyphs on.
        page.click("#glyph-toggle")
        page.wait_for_function("""() => document.querySelector('#panel-table .csv-block table').querySelector('tbody tr').children[0].textContent.includes('☉')""", timeout=30000)
        g = page.evaluate("""() => {
          const trs = [...document.querySelector('#panel-table .csv-block table').querySelectorAll('tbody tr')];
          return { body: trs[0].children[0].textContent, lon: trs[0].children[1].textContent,
                   dom: trs[0].children[8].textContent };
        }""")
        check("glyph mode: body glyph", "☉" in g["body"], g["body"])
        check("glyph mode: sign glyph in longitude", "♓" in g["lon"] or "♍" in g["lon"] or "♊" in g["lon"], g["lon"])
        check("glyph mode: lord glyph (Jupiter or Saturn char)", len(g["dom"]) <= 3, repr(g["dom"]))

        # Persistence across reload.
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#panel-table .csv-block table tbody tr", timeout=60000)
        kept = page.evaluate("""() => ({
          size: document.querySelector('#size-toggle').getAttribute('aria-pressed'),
          gly: document.querySelector('#glyph-toggle').getAttribute('aria-pressed') })""")
        check("both toggles persist across reload", kept == {"size": "true", "gly": "true"}, json.dumps(kept))
        check("zero console errors", errors == [], str(errors[:3]))
        page.screenshot(path="/tmp/display_toggles.png")
        browser.close()
finally:
    SRV.terminate(); harness.stop_relay(relay)
print(f"\n{len(fails)} failures" if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
