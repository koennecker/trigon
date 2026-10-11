#!/usr/bin/env python3
"""E2E for the BCE-capable date-picker popup: opening, day picking, year/era
editing, year-zero skipping, the 1582-10 gap, min/max clamping, and the
search start<=end invariant (forward-only ranges, no BCE end after a CE start)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt, read_dt, read_in

SITE = harness.site_dir()


results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

def pick_day(page, n):
    """Click the enabled day cell with exact text n in the open picker."""
    page.evaluate(f"""() => {{
      const b = [...document.querySelectorAll('.dpick-day')]
        .find(x => x.textContent === {n!r} && !x.disabled);
      if (!b) throw new Error('day {n} not clickable');
      b.click();
    }}""")

def picker_title(page):
    t = page.query_selector(".dpick-title")
    return t.text_content() if t else None

def goto_year(page, yy, era):
    page.click(".dpick-title")
    page.fill(".dpick-yin", str(yy))
    page.select_option(".dpick-era", era)
    page.click(".dpick-go")

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8127", "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        page = browser.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto("http://127.0.0.1:8127/", wait_until="networkidle")

        # --- popup opens and picks a CE day ---
        fill_dt(page, "dt", "2026-09-01T12:00:00")
        harness.ensure_drawer(page)
        page.click("#dt-cal")
        check("popup opens with current month", picker_title(page) == "September 2026 CE",
              picker_title(page))
        pick_day(page, "15")
        check("popup closes after pick", page.query_selector(".dpick") is None)
        check("input text updates", read_in(page, "dt") == "15 Sep 2026 CE 12:00:00",
              read_in(page, "dt"))
        check("hidden inputs follow", read_dt(page, "dt") == "2026-ce-09-15T12:00:00",
              read_dt(page, "dt"))

        # --- year editor jumps to BCE; picking fires the era change path ---
        page.click("#dt-cal")
        goto_year(page, 44, "bce")
        check("year editor reaches 44 BCE", picker_title(page) == "September 44 BCE",
              picker_title(page))
        pick_day(page, "15")
        check("BCE text in input", read_in(page, "dt") == "15 Sep 44 BCE 12:00:00",
              read_in(page, "dt"))
        check("BCE disables the timezone select (change event fired)",
              page.is_disabled("#tz") and "local mean time" in page.text_content("#tz-name"),
              page.text_content("#tz-name"))

        # --- year zero is skipped in both directions ---
        page.click("#dt-cal")
        goto_year(page, 1, "ce")
        check("year editor reaches 1 CE", picker_title(page) == "September 1 CE",
              picker_title(page))
        page.evaluate("""() => {
          for (let i = 0; i < 8; i++)
            document.querySelectorAll('.dpick-nav')[0].click(); // Sep -> Jan
        }""")
        check("navigated to Jan 1 CE", picker_title(page) == "January 1 CE",
              picker_title(page))
        page.click(".dpick-nav:first-child")
        check("prev from Jan 1 CE lands on Dec 1 BCE", picker_title(page) == "December 1 BCE",
              picker_title(page))
        page.click(".dpick-nav:last-child")
        check("next from Dec 1 BCE lands on Jan 1 CE", picker_title(page) == "January 1 CE",
              picker_title(page))
        page.keyboard.press("Escape")
        check("Escape closes the popup", page.query_selector(".dpick") is None)

        # --- 1582-10 cutover gap has no day cells for the 5th-14th ---
        page.click("#dt-cal")
        goto_year(page, 1582, "ce")
        page.evaluate("""() => {
          document.querySelectorAll('.dpick-nav')[1].click(); // Sep -> Oct
        }""")
        check("October 1582 shown", picker_title(page) == "October 1582 CE", picker_title(page))
        days = page.evaluate("""() => [...document.querySelectorAll('.dpick-day')]
          .filter(b => !b.classList.contains('dim')).map(b => b.textContent)""")
        check("Oct 1582 omits the 5th-14th",
              days == ["1","2","3","4","15","16","17","18","19","20","21","22",
                       "23","24","25","26","27","28","29","30","31"],
              ",".join(days[:8]))
        page.keyboard.press("Escape")

        # --- outside click closes ---
        page.click("#dt-cal")
        page.mouse.click(5, 5)
        check("outside click closes the popup", page.query_selector(".dpick") is None)

        # --- a full calculate still works after picker-driven edits ---
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)
        fill_dt(page, "dt", "2026-03-15T12:00:00")
        page.click("#dt-cal")
        pick_day(page, "20")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=60000)
        check("calculate works after picker pick",
              "2026-03-20" in page.text_content("#meta-stamp"),
              page.text_content("#meta-stamp")[:40])

        # --- search ranges: forward-only, CE start blocks BCE end ---
        page.click("#views .tabs button[data-tab=aspects]")
        fill_dt(page, "asp-start", "2026-01-10T00:00")
        fill_dt(page, "asp-end", "2026-01-20T00:00")
        page.click("#asp-end-cal")
        bce_disabled = page.evaluate("""() => {
          document.querySelector('.dpick-title').click();
          const sel = document.querySelector('.dpick-era');
          const opt = [...sel.options].find(o => o.value === 'bce');
          return opt.disabled;
        }""")
        check("BCE era disabled in end picker when start is CE", bce_disabled)
        # days before the start are disabled in the start month
        early_disabled = page.evaluate("""() => {
          const cells = [...document.querySelectorAll('.dpick-day')]
            .filter(b => !b.classList.contains('dim') && !b.disabled)
            .map(b => b.textContent);
          return cells[0];
        }""")
        check("end picker days clamp to the start date", early_disabled == "10", early_disabled)
        page.keyboard.press("Escape")

        # --- start moving past end drags the end along (no wrapping) ---
        fill_dt(page, "asp-start", "2027-01-10T00:00")
        check("end follows start past it",
              read_dt(page, "asp-end").startswith("2027-ce-01-10"),
              read_dt(page, "asp-end"))
        fill_dt(page, "asp-end", "2026-01-10T00:00")
        check("start follows end back",
              read_dt(page, "asp-start").startswith("2026-ce-01-10"),
              read_dt(page, "asp-start"))

        # --- BCE start allows a BCE end ---
        fill_dt(page, "asp-start", "0044-03-15T00:00", era="bce")
        fill_dt(page, "asp-end", "0044-03-20T00:00", era="bce")
        check("BCE range holds",
              read_dt(page, "asp-start").startswith("0044-bce-03-15") and
              read_dt(page, "asp-end").startswith("0044-bce-03-20"),
              read_dt(page, "asp-start") + " / " + read_dt(page, "asp-end"))

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
