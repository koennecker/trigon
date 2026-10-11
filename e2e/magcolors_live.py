import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import sys, subprocess, os, time
relay = harness.start_relay()
time.sleep(1.0)
from playwright.sync_api import sync_playwright
bad = []
for base in ["https://464bf9fb.trigon.pages.dev", "https://trigon.pages.dev"]:
    with sync_playwright() as p:
        b = harness.launch(p)
        pg = b.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(base + "/", wait_until="networkidle")
        ok = pg.evaluate("""() => new Promise(res => {
          const t = setInterval(() => {
            const size = document.querySelector('#size-toggle');
            const trs = document.querySelectorAll('#panel-table .csv-block table tbody tr');
            if (size && trs.length >= 15) { clearInterval(t); res({
              size: size.textContent, glow: !!document.querySelector('.mag-glow'),
              coloredBodies: [...trs].slice(0, 10).every(tr => tr.children[0].style.color !== ''),
              dirColor: getComputedStyle(document.querySelector('#panel-table .direct, #panel-table .retro')).color,
            }); }
          }, 300);
          setTimeout(() => res(null), 90000);
        })""")
        print(base, ok, "errors:", errs[:2])
        if not ok or errs: bad.append(base)
        b.close()
harness.stop_relay(relay)
print("OK" if not bad else f"BAD {bad}")
