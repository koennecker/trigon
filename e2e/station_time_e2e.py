"""Station time display: the settings modal's Station times toggle
switches the prev/next station cells between absolute datetimes and
durations relative to the chart instant. The chart tooltip follows the
table cells, and a relative label still sets the chart to the absolute
station instant when clicked. The choice persists across reload."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
from dtfill import read_dt
from datetime import datetime, timedelta, timezone
import re

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

PORT = 8967

def cell_text(pg, kind, ib):
    return pg.evaluate(
        f"document.querySelector('#panel-table td.stn-{kind}[data-ib=\"{ib}\"]').textContent"
        " .trim().replace(/\\s+/g, ' ')")

def wait_cell(pg, pattern, kind="prev", ib="2"):
    pg.wait_for_function(
        f"document.querySelector('#panel-table td.stn-{kind}[data-ib=\"{ib}\"]')"
        f" .textContent.match(/{pattern}/)",
        timeout=120000)

def main():
    errors = []
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        srv = harness.serve(PORT)
        base = f"http://127.0.0.1:{PORT}"
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

        # Default is absolute: Mercury's prev station carries a date.
        wait_cell(page, r"\d{4}-\d{2}-\d{2}")
        check("default station time is absolute",
              bool(re.search(r"\d{4}-\d{2}-\d{2}", cell_text(page, "prev", "2"))),
              cell_text(page, "prev", "2"))

        # Relative mode: prev reads "… ago", next reads "in …", no date.
        open_settings(page)
        check("station seg starts on Absolute",
              page.get_attribute('[data-set-stn-time="absolute"]', "aria-pressed") == "true")
        page.click('[data-set-stn-time="relative"]')
        close_settings(page)
        wait_cell(page, r"ago")
        prev_rel = cell_text(page, "prev", "2")
        next_rel = cell_text(page, "next", "2")
        check("relative prev station reads '… ago'",
              "ago" in prev_rel and not re.search(r"\d{4}-\d{2}-\d{2}", prev_rel), prev_rel)
        check("relative next station reads 'in …'",
              next_rel.startswith("D ") or "in " in next_rel, next_rel)
        btn = page.evaluate("""() => {
          const el = document.querySelector('#panel-table td.stn-next[data-ib="2"] button.goto-dt');
          return { jd: el.dataset.gotoJd, title: el.title, aria: el.getAttribute('aria-label'),
                   label: el.textContent }; }""")
        check("relative button keeps the absolute instant in title/aria",
              bool(re.search(r"\d{4}-\d{2}-\d{2}", btn["title"]))
              and bool(re.search(r"\d{4}-\d{2}-\d{2}", btn["aria"])), str(btn))
        check("relative button still carries the station JD",
              float(btn["jd"]) > 2460000, btn["jd"])

        # Chart tooltip follows the table cells into relative mode.
        page.click('#views .tabs button[data-tab="chart"]')
        page.wait_for_selector("#panel-chart svg", timeout=10000)
        merc = page.query_selector('.chart-point[data-point="mercury"]')
        box = merc.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_selector("#chart-tip", state="visible", timeout=5000)
        tip = page.evaluate("document.querySelector('#chart-tip').textContent")
        check("chart tooltip station rows follow relative mode",
              "Prev station" in tip and ("ago" in tip or "in " in tip), tip[:200])
        page.click('#views .tabs button[data-tab="table"]')
        page.wait_for_selector("#panel-table table", timeout=30000)

        # Clicking a relative label sets the input to the ABSOLUTE station
        # instant (UTC, tz pinned), not to a duration.
        jd = float(btn["jd"])
        page.click('#panel-table td.stn-next[data-ib="2"] button.goto-dt')
        page.wait_for_selector("#panel-table table", timeout=90000)
        exp = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(days=jd - 2440587.5)
        want = f"{exp.year:04d}-ce-{exp.month:02d}-{exp.day:02d}T{exp.hour:02d}:{exp.minute:02d}:{exp.second:02d}"
        got = read_dt(page, "dt")
        check("relative click sets input to the absolute station instant",
              got == want, f"got {got} want {want}")
        check("relative click pins tz to UTC",
              page.eval_on_selector("#tz", "el => el.value") == "0")

        # Persistence across reload: relative stays selected and renders.
        page.reload(wait_until="networkidle")
        page.wait_for_selector("#panel-table table", timeout=60000)
        open_settings(page)
        check("station mode persists across reload",
              page.get_attribute('[data-set-stn-time="relative"]', "aria-pressed") == "true")
        close_settings(page)
        wait_cell(page, r"ago|in ")
        check("station cells render relative after reload",
              "ago" in cell_text(page, "prev", "2") or "in " in cell_text(page, "next", "2"))

        # Back to absolute restores the dates.
        open_settings(page)
        page.click('[data-set-stn-time="absolute"]')
        close_settings(page)
        wait_cell(page, r"\d{4}-\d{2}-\d{2}")
        check("absolute mode restores station dates",
              bool(re.search(r"\d{4}-\d{2}-\d{2}", cell_text(page, "prev", "2"))))
        b.close()
        srv.shutdown()
    check("zero console/page errors", not errors, "; ".join(errors[:3]))
    failed = [n for n, ok in results if not ok]
    print(f"\nRESULT {len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
