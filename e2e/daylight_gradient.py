#!/usr/bin/env python3
"""Dawn-to-noon daylight gradient check: screenshots at several sun altitudes,
verifying the sky keeps evolving after sunrise (no static 'noon' image)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, re, subprocess, sys, time, http.server, threading, functools

SITE = harness.site_dir()


SHOT = "/tmp/daylight_gradient"

passed, failed = [], []
def check(name, ok, detail=""):
    (passed if ok else failed).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

relay = harness.start_relay()
time.sleep(2)
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8902), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs(SHOT, exist_ok=True)

from playwright.sync_api import sync_playwright
cerr, perr = [], []
alts, means = [], []
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        pg = browser.new_page(viewport={"width": 1280, "height": 800})
        pg.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto("http://127.0.0.1:8902/", wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.select_option("#tz", "UTC-07:00")
        pg.wait_for_timeout(600)
        # open sky once
        pg.evaluate("window.__trigonSetDate('dt', 2026, 'ce', 10, 1)")
        pg.evaluate("window.__trigonSetTime('dt', 12, 0, 0)")
        pg.locator("#calc").click(timeout=15000)
        pg.wait_for_selector("#panel-table table", state="attached", timeout=120000)
        pg.locator('#views .tabs button[data-tab="sky"]').click(timeout=15000)
        pg.wait_for_selector("#sky-wrap canvas", timeout=90000)
        # daylight must be on: sunAlt (and the 'Sun' readout segment) only exists then
        if pg.locator("#sky-opts[open]").count() == 0:
            pg.locator("#sky-opts summary").click(timeout=8000)
        pg.get_by_label("Realistic daylight").check(timeout=8000)
        pg.locator("#sky-opts summary").click(timeout=8000)  # close: it would darken the pixel sample
        pg.wait_for_function("document.getElementById('sky-readout').textContent.includes('Sun')", timeout=60000)

        from PIL import Image
        for label, hh, mm in [("dawn", 6, 0), ("sunrise", 6, 40), ("morning", 8, 0),
                              ("midmorn", 10, 0), ("late", 11, 30), ("noon", 12, 30)]:
            pg.evaluate(f"window.__trigonSetTime('dt', {hh}, {mm}, 0)")
            pg.locator("#calc").click(timeout=15000)
            pg.wait_for_timeout(1500)
            txt = pg.locator("#sky-readout").inner_text(timeout=15000)
            m = re.search(r"Sun ([+-]?\d+\.?\d*)", txt)
            alt = float(m.group(1)) if m else None
            path = f"{SHOT}/{label}.png"
            pg.screenshot(path=path)
            # mean brightness of sky region (upper half of canvas)
            box = pg.locator("#sky-wrap canvas").bounding_box(timeout=8000)
            im = Image.open(path).convert("RGB")
            crop = im.crop((int(box["x"]), int(box["y"]),
                            int(box["x"] + box["width"]), int(box["y"] + box["height"] // 2)))
            px = list(crop.getdata())
            mean = sum(sum(c) / 3 for c in px) / len(px)
            alts.append(alt); means.append(mean)
            print(f"  {label}: sun alt {alt}°, upper-sky mean {mean:.0f}")
        browser.close()
finally:
    srv.shutdown()
    harness.stop_relay(relay)

# The sky must keep evolving while the sun climbs through the morning:
# consecutive screenshots below the 35° saturation knee must differ.
# (Above ~35° the design intentionally holds the verified noon look.)
diffs = [abs(means[i+1] - means[i]) for i in range(len(means) - 1)]
evolving = [d for d, a in zip(diffs, alts[1:]) if a < 35]
check("sky evolves dawn->morning (no static image)", all(d > 1.5 for d in evolving),
      f"step diffs {[round(d,1) for d in diffs]} at alts {[round(a,1) for a in alts]}")
check("zero console errors", not cerr, "; ".join(cerr[:3]))
check("zero page errors", not perr, "; ".join(perr[:3]))
print(f"\n{len(passed)}/{len(passed)+len(failed)} passed")
sys.exit(1 if failed else 0)
