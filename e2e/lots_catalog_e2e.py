"""Hellenistic lots catalog: browser, selection, syzygy lots, deep dive."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os, json, urllib.request
PORT = 8377
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
          const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
          set('lat', '33.4484'); set('lon', '-112.074');
        }""")
        page.wait_for_function("document.getElementById('tz').value === '-420'", timeout=30000)
        page.click("#calc")
        page.wait_for_selector("#panel-table tbody .spdind", timeout=120000)

        # --- Browser structure: 181 names under 86 calculation groups ---
        info = page.evaluate("""() => ({
          groups: document.querySelectorAll('#cat-browser .cat-group').length,
          rows: document.querySelectorAll('#cat-browser .cat-row').length,
          checked: document.querySelectorAll('#cat-browser .cat-sel:checked').length,
        })""")
        check("catalog browser: 86 calculation groups", info["groups"] == 86, str(info["groups"]))
        check("catalog browser: 181 attested names", info["rows"] == 181, str(info["rows"]))
        check("nothing selected by default", info["checked"] == 0)

        # --- Select Eros (Valens) and Releaser (syzygy lot) ---
        page.evaluate("""() => {
          const find = name => [...document.querySelectorAll('#cat-browser .cat-row')]
            .find(r => r.querySelector('.cat-name').textContent === name);
          for (const n of ['Eros (Valens)', 'Releaser']) {
            const cb = find(n).querySelector('.cat-sel');
            cb.checked = true; cb.dispatchEvent(new Event('change', {bubbles: true}));
          }
        }""")
        page.wait_for_selector("#catalog-table tbody tr", timeout=30000)
        rows = page.evaluate("""() => [...document.querySelectorAll('#catalog-table tbody tr')]
          .map(tr => ({ name: tr.children[0].textContent, pos: tr.children[1].textContent }))""")
        check("selected table shows both lots", len(rows) == 2, json.dumps(rows)[:120])
        # Releaser starts as ellipsis, fills once the syzygy scan lands.
        page.wait_for_function("""() => [...document.querySelectorAll('#catalog-table tbody tr')]
          .every(tr => !tr.children[1].textContent.includes('…'))""", timeout=60000)
        rows = page.evaluate("""() => [...document.querySelectorAll('#catalog-table tbody tr')]
          .map(tr => ({ name: tr.children[0].textContent, pos: tr.children[1].textContent }))""")
        check("syzygy-dependent lot (Releaser) resolves after extras scan",
              all(r["pos"] for r in rows), json.dumps(rows)[:140])

        # --- Filter narrows rows and groups ---
        page.fill(".cat-filter", "Olympiodorus")
        page.wait_for_function("""() => {
          const vis = [...document.querySelectorAll('#cat-browser .cat-row')]
            .filter(r => r.style.display !== 'none');
          return vis.length > 0 && vis.length < 181;
        }""", timeout=15000)
        filt = page.evaluate("""() => ({
          rows: [...document.querySelectorAll('#cat-browser .cat-row')].filter(r => r.style.display !== 'none').length,
          groups: [...document.querySelectorAll('#cat-browser .cat-group')].filter(g => g.style.display !== 'none').length,
        })""")
        check("filter 'Olympiodorus' narrows to a subset", 0 < filt["rows"] < 181, json.dumps(filt))

        # --- Selection persists across reload ---
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#catalog-section", timeout=30000)
        kept = page.evaluate("""() => [...document.querySelectorAll('#cat-browser .cat-sel:checked')]
          .map(cb => cb.closest('.cat-row').querySelector('.cat-name').textContent)""")
        check("selection persists across reload", sorted(kept) == ["Eros (Valens)", "Releaser"], json.dumps(kept))
        check("zero console errors", errors == [], str(errors[:3]))
        page.screenshot(path="/tmp/catalog.png")
        browser.close()
finally:
    SRV.terminate(); harness.stop_relay(relay)
print(f"\n{len(fails)} failures" if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
