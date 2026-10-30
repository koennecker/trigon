"""BaZi subtable in the table view: a calculated chart renders the
four pillars for its wall time, with the Day Master note. Uses the
published Hong Kong example (1990-06-15 10:00 -> Geng Wu / Ren Wu /
Xin Hai / Gui Si); the pillars are invariant to the derived timezone
because the section reconstructs the wall time from the instant plus
the chart's own tz offset, so no tz forcing is needed here."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
from dtfill import fill_dt

PORT = 8971

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))

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
        fill_dt(page, "dt", "1990-06-15T10:00")
        page.click("details#manual-loc summary")
        page.fill("#lat", "22.3193"); page.fill("#lon", "114.1694")
        page.dispatch_event("#lon", "change")
        page.click("#calc")
        page.wait_for_selector("#bazi-section", timeout=60000)
        text = page.evaluate("document.querySelector('#bazi-section').textContent")
        rows = page.evaluate("""() => [...document.querySelectorAll('#bazi-section tbody tr')]
          .map(tr => [...tr.children].map(td => td.textContent))""")
        check("bazi section renders four pillar rows",
              len(rows) == 4 and [r[0] for r in rows] == ["Year", "Month", "Day", "Hour"], str(rows))
        check("year pillar Geng Wu", "Geng" in rows[0][1] and "Wu" in rows[0][2], str(rows[0]))
        check("month pillar Ren Wu", "Ren" in rows[1][1] and "Wu" in rows[1][2], str(rows[1]))
        check("day pillar Xin Hai", "Xin" in rows[2][1] and "Hai" in rows[2][2], str(rows[2]))
        check("hour pillar Gui Si", "Gui" in rows[3][1] and "Si" in rows[3][2], str(rows[3]))
        check("Day Master note names Xin Metal", "Day Master: 辛 Xin (Metal Yin)" in text, text[:200])
        check("hidden stems shown", "丁 Ding" in text and "壬 Ren" in text, text[:300])
        b.close()
        srv.shutdown()
    check("zero console/page errors", not errors, "; ".join(errors[:3]))
    failed = [n for n, ok in results if not ok]
    print(f"\nRESULT {len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
