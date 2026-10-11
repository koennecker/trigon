import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright

relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page()
        page.goto("https://trigon.pages.dev/", wait_until="networkidle")
        out = page.evaluate("""async () => {
          const t = await (await fetch('app.js')).text();
          const i = t.indexOf('decan-method');
          return { handlerCtx: t.slice(i - 200, i + 260),
                   hasDigFullBuild: t.includes('buildTableHTML(out, angleFmt, dig)') };
        }""")
        print(out["handlerCtx"])
        print("buildTableHTML with dig:", out["hasDigFullBuild"])
        browser.close()
finally:
    harness.stop_relay(relay)
