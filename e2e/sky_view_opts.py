#!/usr/bin/env python3
"""E2E for the Sky view batch: horizon-frame overlays ignored in sphere view,
degree ticks on the zodiac ring, slice fills, text/glyph size sliders,
deeper sphere zoom; zero console/page errors. Screenshots are the ground
truth for the visual claims."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import os, subprocess, sys, time, http.server, threading, functools

SITE = harness.site_dir()


SHOT = "/tmp/sky_view_opts"
PORT = 8911

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
        pg.evaluate("window.__trigonSetDate('dt', 2027, 'ce', 6, 13)")
        pg.evaluate("window.__trigonSetTime('dt', 18, 10, 28)")
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_timeout(400)
        # Sky renders from the last chart calculation; run one first.
        pg.click("#calc")
        pg.wait_for_selector("#panel-table table", timeout=90000)

        pg.click("#views .tabs button[data-tab=sky]")
        pg.wait_for_function("typeof window.__skyViewState === 'function'", timeout=120000)
        pg.wait_for_function("document.querySelectorAll('#sky-overlays label').length > 10", timeout=60000)
        pg.wait_for_timeout(2500)

        def vstate():
            return pg.evaluate("window.__skyViewState()")

        def set_overlay(label, on):
            pg.evaluate("""([text, on]) => {
              const lab = [...document.querySelectorAll('#sky-overlays label')]
                .find(l => l.textContent.trim() === text);
              if (!lab) throw new Error('no overlay label ' + text);
              const inp = lab.querySelector('input');
              if (inp.checked !== on) inp.click();
            }""", [label, on])

        def set_view(v):
            pg.evaluate(f"document.querySelector('#sky-overlays button[data-v=\"{v}\"]').click()")

        # Horizon/Meridian/Cardinals default ON. Observer view: visible.
        st = vstate()
        check("observer: horizon-frame overlays visible",
              st["viewMode"] == "observer" and st["horizonVisible"] and st["meridianVisible"]
              and st["cardinalsVisible"], str(st))
        pg.screenshot(path=f"{SHOT}/a0_observer_ticks.png")

        # Sphere view: ignored entirely even though the boxes stay checked.
        set_view("sphere")
        pg.wait_for_timeout(1500)
        st = vstate()
        check("sphere: horizon/meridian/cardinals hidden despite checked boxes",
              st["viewMode"] == "sphere" and not st["horizonVisible"]
              and not st["meridianVisible"] and not st["cardinalsVisible"], str(st))
        pg.screenshot(path=f"{SHOT}/a_sphere_no_horizon.png")

        # Degree ticks ride the zodiac ring; visible in the same shot.
        # Slice fills are per-ring toggles now: zodiac only.
        set_overlay("Zodiac slice fill", True)
        pg.wait_for_timeout(1500)
        st = vstate()
        check("zodiac slice fill on, others off",
              st["fills"]["zodiac"] and not st["fills"]["nakshatra"] and not st["fills"]["xiu"], str(st))
        pg.screenshot(path=f"{SHOT}/b_sphere_ticks_fills.png")

        # Size inputs: text 2.5x, glyph 2x (change events drive the handlers).
        pg.evaluate("""() => {
          const rngs = [...document.querySelectorAll('#sky-overlays input[type=number]')];
          rngs[0].value = '2.5'; rngs[0].dispatchEvent(new Event('change', {bubbles: true}));
          rngs[1].value = '2'; rngs[1].dispatchEvent(new Event('change', {bubbles: true}));
        }""")
        pg.wait_for_timeout(1200)
        st = vstate()
        check("number inputs set textScale=2.5 glyphScale=2",
              abs(st["textScale"] - 2.5) < 1e-9 and abs(st["glyphScale"] - 2) < 1e-9, str(st))
        pg.screenshot(path=f"{SHOT}/c_sphere_big_labels.png")

        # Zoom: wheel in past the old 1.6R floor (640) toward the 1.05R floor.
        box = pg.locator("#sky-wrap").bounding_box()
        pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        for _ in range(4):
            pg.mouse.wheel(0, -600)
            pg.wait_for_timeout(150)
        pg.wait_for_timeout(800)
        st = vstate()
        check("sphere zoom passes old floor, stops at new floor",
              419 <= st["sphDist"] < 640, f"sphDist={st['sphDist']}")
        pg.screenshot(path=f"{SHOT}/d_sphere_zoomed.png")

        # Back to observer: horizon-frame overlays return.
        pg.evaluate("""() => {
          const rngs = [...document.querySelectorAll('#sky-overlays input[type=number]')];
          rngs[0].value = '1'; rngs[0].dispatchEvent(new Event('change', {bubbles: true}));
          rngs[1].value = '1'; rngs[1].dispatchEvent(new Event('change', {bubbles: true}));
        }""")
        set_overlay("Zodiac slice fill", False)
        set_view("observer")
        pg.wait_for_timeout(1500)
        st = vstate()
        check("observer again: horizon visible", st["horizonVisible"] and not st["fills"]["zodiac"], str(st))

        # ---------------- persistence across reload ----------------
        # Distinctive state: sphere view, text 1.75x, zodiac+nakshatra fills
        # on, Horizon unchecked. Reload, redo the calc, reopen Sky: the
        # panel state must come back from localStorage.
        set_view("sphere")
        set_overlay("Nakshatra slice fill", True)
        set_overlay("Zodiac slice fill", True)
        set_overlay("Horizon", False)
        pg.evaluate("""() => {
          const rngs = [...document.querySelectorAll('#sky-overlays input[type=number]')];
          rngs[0].value = '1.75'; rngs[0].dispatchEvent(new Event('change', {bubbles: true}));
        }""")
        pg.wait_for_timeout(600)
        ls = pg.evaluate("localStorage.getItem('trigon.sky.v1')")
        check("prefs written to localStorage", bool(ls) and '"textScale":1.75' in ls, (ls or "")[:140])
        pg.reload(wait_until="load", timeout=90000)
        pg.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
        if pg.locator("#input-card.open").count() == 0:
            pg.locator("#input-fab").click(timeout=8000)
            pg.wait_for_selector("#input-card.open", timeout=8000)
        pg.click("details#manual-loc summary")
        pg.fill("#lat", "33.4484"); pg.fill("#lon", "-112.0740")
        pg.dispatch_event("#lon", "change")
        pg.wait_for_timeout(400)
        pg.click("#calc")
        pg.wait_for_selector("#panel-table table", timeout=90000)
        pg.click("#views .tabs button[data-tab=sky]")
        pg.wait_for_function("typeof window.__skyViewState === 'function'", timeout=120000)
        pg.wait_for_timeout(2500)
        st = vstate()
        check("prefs restored after reload",
              st["viewMode"] == "sphere" and abs(st["textScale"] - 1.75) < 1e-9
              and st["fills"]["zodiac"] and st["fills"]["nakshatra"], str(st))
        hz = pg.evaluate("""() => {
          const lab = [...document.querySelectorAll('#sky-overlays label')]
            .find(l => l.textContent.trim() === 'Horizon');
          return lab.querySelector('input').checked;
        }""")
        check("Horizon checkbox restored unchecked", hz is False)
        pg.screenshot(path=f"{SHOT}/e_restored.png")

        pg.close()
        browser.close()
finally:
    srv.shutdown()
    harness.stop_relay(relay)

check("zero console errors", not cerr, "; ".join(cerr[:3]))
check("zero page errors", not perr, "; ".join(perr[:3]))
print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
