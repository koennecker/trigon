"""On-demand Sky rendering: scene still renders, drags, clocks, animates."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
PORT = 8385
SRV = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=harness.site_dir(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
from playwright.sync_api import sync_playwright
fails = []
def check(label, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + label + (f" — {detail}" if detail else ""))
    if not cond: fails.append(label)

def shot(page, name):
    page.screenshot(path=f"/tmp/{name}.png")
    return open(f"/tmp/{name}.png", "rb").read()

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

        # Open Sky; first paint must appear (stars/glyphs), not a black box.
        page.click("#views .tabs button[data-tab=sky]")
        page.wait_for_selector("#sky-canvas canvas", state="visible", timeout=60000)
        page.wait_for_timeout(2500)
        img1 = shot(page, "sky_a")
        px1 = page.evaluate("""() => new Promise(res => {
          const c = document.querySelector('#sky-canvas canvas');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
            const ctx = g.getContext('2d'); ctx.drawImage(c, 0, 0);
            const d = ctx.getImageData(0, 0, g.width, g.height).data;
            let bright = 0; for (let i = 0; i < d.length; i += 401) if (d[i] + d[i+1] + d[i+2] > 90) bright++;
            res(bright);
          }));
        })""")
        if px1 == 0:  # WebGL readback can still race; fall back to the screenshot
            from PIL import Image
            import io as _io
            im = Image.open(_io.BytesIO(open("/tmp/sky_a.png", "rb").read() if False else page.screenshot())).convert("RGB")
            px1 = sum(1 for px in im.resize((80, 46)).getdata() if sum(px) > 120)
        check("sky renders content after open", px1 > 30, f"bright samples {px1}")

        # Clock on: readout + frame must keep updating with on-demand rendering.
        ro1 = page.text_content("#sky-readout")
        page.locator("#input-fab").click(timeout=8000) if page.locator("#input-card.open").count() == 0 else None
        page.locator("#clock-toggle").check()
        page.wait_for_timeout(2600)
        ro2 = page.text_content("#sky-readout")
        check("clock advances sky readout", ro1 != ro2, f"{ro1[4:24]} -> {ro2[4:24]}")
        img2 = shot(page, "sky_b")
        check("sky frame changes under clock", img1 != img2)
        page.locator("#clock-toggle").uncheck()

        # Drag: frame must follow (camera invalidation path).
        box = page.eval_on_selector("#sky-canvas", "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")
        cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
        page.mouse.move(cx, cy); page.mouse.down()
        page.mouse.move(cx + 120, cy + 30, steps=8); page.mouse.up()
        page.wait_for_timeout(600)
        img3 = shot(page, "sky_c")
        check("drag re-renders sky", img3 != img2)

        # Sphere view switch renders.
        page.evaluate("""() => { [...document.querySelectorAll('#sky-overlays button')].find(b => b.textContent === 'Sphere')?.click(); }""")
        page.wait_for_timeout(1200)
        img4 = shot(page, "sky_d")
        check("sphere view renders", img4 != img3)

        check("zero console errors", errors == [], str(errors[:3]))
        browser.close()
finally:
    SRV.terminate(); harness.stop_relay(relay)
print(f"\n{len(fails)} failures" if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
