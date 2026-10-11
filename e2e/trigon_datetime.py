#!/usr/bin/env python3
"""E2E for the unified date+time input: segment typing and stepping, month
type-ahead, era toggling, the 1582 cutover skip, digit-run undo, paste,
Alt+Down, popup time steppers, forward-only range rejection, and the
live-clock focus guard."""
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

def sel(page, prefix):
    return page.evaluate(
        f"() => {{ const el = document.getElementById('{prefix}-in'); "
        f"return [el.selectionStart, el.selectionEnd]; }}")

def ensure_drawer(page):
    # Escape closes the drawer (even when a widget popup consumes it), so a
    # test that pressed Escape may have left the drawer shut. Reopen it.
    if not page.evaluate("document.getElementById('input-card').classList.contains('open')"):
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=8000)

def focus_in(page, prefix):
    # The drawer is scrollable; earlier fills can leave the input scrolled
    # out of view, which makes Playwright's click fail its stability check.
    # A programmatic focus is equivalent here: the widget keys segment
    # selection off focus + caret position, not the mouse.
    ensure_drawer(page)
    page.evaluate(f"""() => {{
      const el = document.getElementById('{prefix}-in');
      el.scrollIntoView({{block: 'center'}});
      el.focus({{preventScroll: true}});
    }}""")
    page.wait_for_timeout(120)

def goto_seg(page, prefix, idx):
    focus_in(page, prefix)
    page.keyboard.press("Home")
    for _ in range(idx):
        page.keyboard.press("ArrowRight")
    page.wait_for_timeout(80)

def hidden(page, prefix, name):
    return page.evaluate(f"document.getElementById('{prefix}-{name}').value")

def pick_day(page, n):
    page.evaluate(f"""() => {{
      const b = [...document.querySelectorAll('.dpick-day')]
        .find(x => x.textContent === {n!r} && !x.disabled);
      if (!b) throw new Error('day {n} not clickable');
      b.click();
    }}""")

def paste(page, prefix, text):
    page.evaluate(f"""() => {{
      const el = document.getElementById('{prefix}-in');
      const dt = new DataTransfer();
      dt.setData('text/plain', {text!r});
      el.dispatchEvent(new ClipboardEvent('paste', {{ clipboardData: dt, bubbles: true }}));
    }}""")
    page.wait_for_timeout(150)

httpd = subprocess.Popen([sys.executable, "-m", "http.server", "8128", "--bind", "127.0.0.1"],
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
        page.goto("http://127.0.0.1:8128/", wait_until="networkidle")
        # The drawer starts closed (state persists in localStorage; fresh
        # profile = closed). Open it before touching drawer controls.
        page.click("#input-fab")
        page.wait_for_selector("#input-card.open", timeout=8000)
        page.click("details#manual-loc summary")
        page.fill("#lat", "40.7128")
        page.fill("#lon", "-74.0060")
        page.dispatch_event("#lon", "change")
        page.wait_for_timeout(400)

        # --- unified input shows date and time as one text ---
        fill_dt(page, "dt", "2026-09-28T14:30:00")
        check("unified input text", read_in(page, "dt") == "28 Sep 2026 CE 14:30:00",
              read_in(page, "dt"))

        # --- click selects a constituent segment ---
        focus_in(page, "dt")
        check("click selects the day segment", sel(page, "dt") == [0, 2], str(sel(page, "dt")))

        # --- arrows walk the segments ---
        goto_seg(page, "dt", 3)
        check("ArrowRight reaches the era segment", sel(page, "dt") == [12, 14],
              str(sel(page, "dt")))
        page.keyboard.press("ArrowLeft")
        check("ArrowLeft steps back to the year", sel(page, "dt") == [7, 11],
              str(sel(page, "dt")))

        # --- typing b/c toggles the era and fires change (tz disables) ---
        goto_seg(page, "dt", 3)
        page.keyboard.type("b")
        page.wait_for_timeout(300)
        check("typing b toggles BCE", read_in(page, "dt") == "28 Sep 2026 BCE 14:30:00",
              read_in(page, "dt"))
        check("BCE disables the timezone select",
              page.is_disabled("#tz") and "local mean time" in page.text_content("#tz-name"),
              page.text_content("#tz-name"))
        page.keyboard.type("c")
        page.wait_for_timeout(300)
        check("typing c restores CE", read_in(page, "dt") == "28 Sep 2026 CE 14:30:00",
              read_in(page, "dt"))
        check("CE re-enables the timezone select", not page.is_disabled("#tz"))

        # --- Up/Down toggles the era ---
        goto_seg(page, "dt", 3)
        page.keyboard.press("ArrowUp")
        check("ArrowUp toggles era to BCE", "BCE" in read_in(page, "dt"), read_in(page, "dt"))
        page.keyboard.press("ArrowDown")
        check("ArrowDown toggles era back", " CE " in read_in(page, "dt"), read_in(page, "dt"))

        # --- year typing with auto-advance ---
        goto_seg(page, "dt", 2)
        page.keyboard.type("1999")
        check("year typing commits", read_in(page, "dt") == "28 Sep 1999 CE 14:30:00",
              read_in(page, "dt"))
        check("year typing auto-advances to era", sel(page, "dt") == [12, 14],
              str(sel(page, "dt")))

        # --- year step crosses 1 CE <-> 1 BCE (no year zero) ---
        fill_dt(page, "dt", "0001-06-15T00:00:00")
        goto_seg(page, "dt", 2)
        page.keyboard.press("ArrowDown")
        check("year step 1 CE -> 1 BCE", read_in(page, "dt") == "15 Jun 1 BCE 00:00:00",
              read_in(page, "dt"))
        page.keyboard.press("ArrowUp")
        check("year step 1 BCE -> 1 CE", read_in(page, "dt") == "15 Jun 1 CE 00:00:00",
              read_in(page, "dt"))

        # --- day wraps within the month ---
        fill_dt(page, "dt", "2026-01-31T00:00:00")
        goto_seg(page, "dt", 0)
        page.keyboard.press("ArrowUp")
        check("day wraps 31 -> 1", read_in(page, "dt") == "1 Jan 2026 CE 00:00:00",
              read_in(page, "dt"))

        # --- month suggestion popup ---
        def sug_items(pg):
            return pg.eval_on_selector_all(
                ".msuggest-item",
                "els => els.map(e => [e.textContent, e.classList.contains('hi')])")
        def sug_open(pg):
            return pg.evaluate("document.querySelectorAll('.msuggest').length")

        goto_seg(page, "dt", 1)
        page.keyboard.type("f")
        check("month letter opens the suggestion popup",
              sug_items(page) == [["February", True]], str(sug_items(page)))
        page.keyboard.press("Enter")
        check("Enter commits the suggestion + day clamp",
              read_in(page, "dt") == "1 Feb 2026 CE 00:00:00", read_in(page, "dt"))
        check("popup closes after commit", sug_open(page) == 0)

        # repeated letter cycles the highlight through the visible matches
        goto_seg(page, "dt", 1)
        page.keyboard.type("m")
        check("m lists March and May",
              [t for t, _ in sug_items(page)] == ["March", "May"],
              str(sug_items(page)))
        check("m highlights March first",
              sug_items(page)[0][1] and not sug_items(page)[1][1],
              str(sug_items(page)))
        page.keyboard.type("m")
        check("second m cycles the highlight to May",
              sug_items(page)[1][1] and not sug_items(page)[0][1],
              str(sug_items(page)))
        page.keyboard.press("Enter")
        check("Enter commits May", "May" in read_in(page, "dt"),
              read_in(page, "dt"))

        # Scenario: j j j shows Jan/Jun/Jul and lands on July
        goto_seg(page, "dt", 1)
        page.keyboard.type("j")
        check("j lists January, June, July",
              [t for t, _ in sug_items(page)] == ["January", "June", "July"],
              str(sug_items(page)))
        page.keyboard.type("j")
        check("second j highlights June",
              [t for t, h in sug_items(page) if h] == ["June"],
              str(sug_items(page)))
        page.keyboard.type("j")
        check("third j highlights July",
              [t for t, h in sug_items(page) if h] == ["July"],
              str(sug_items(page)))
        page.keyboard.press("Enter")
        check("Enter commits July", "Jul" in read_in(page, "dt"),
              read_in(page, "dt"))

        # narrowing: "ju" jumps straight to the Ju- months
        goto_seg(page, "dt", 1)
        page.keyboard.type("ju")
        check("ju narrows to June and July",
              [t for t, _ in sug_items(page)] == ["June", "July"],
              str(sug_items(page)))
        page.keyboard.press("Escape")
        check("Escape dismisses without committing",
              "Jul" in read_in(page, "dt") and sug_open(page) == 0,
              read_in(page, "dt"))

        # clicking a suggestion commits it
        goto_seg(page, "dt", 1)
        page.keyboard.type("a")
        page.evaluate("""() => [...document.querySelectorAll('.msuggest-item')]
          .find(e => e.textContent === 'August')
          .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))""")
        page.wait_for_timeout(150)
        check("clicking August commits it", "Aug" in read_in(page, "dt"),
              read_in(page, "dt"))

        # --- day typing clamps to the month ---
        fill_dt(page, "dt", "2026-09-28T14:30:00")
        goto_seg(page, "dt", 0)
        page.keyboard.type("39")
        check("day typing 39 in Sep clamps to 30",
              read_in(page, "dt").startswith("30 Sep"), read_in(page, "dt"))

        # --- cutover day step skips the gap ---
        fill_dt(page, "dt", "1582-10-04T00:00:00")
        goto_seg(page, "dt", 0)
        page.keyboard.press("ArrowUp")
        check("day step skips the 1582 gap",
              read_in(page, "dt") == "15 Oct 1582 CE 00:00:00", read_in(page, "dt"))

        # --- hour typing auto-advances to the minute ---
        fill_dt(page, "dt", "2026-09-28T14:30:00")
        goto_seg(page, "dt", 4)
        page.keyboard.type("09")
        check("hour typing commits", read_in(page, "dt") == "28 Sep 2026 CE 09:30:00",
              read_in(page, "dt"))
        check("hour typing auto-advances to minute", sel(page, "dt") == [18, 20],
              str(sel(page, "dt")))

        # --- minute wraps 59 -> 0 ---
        page.evaluate("window.__trigonSetTime('dt', 9, 59, 0)")
        goto_seg(page, "dt", 5)
        page.keyboard.press("ArrowUp")
        check("minute wraps 59 -> 0", read_in(page, "dt") == "28 Sep 2026 CE 09:00:00",
              read_in(page, "dt"))

        # --- Backspace abandons the digit run ---
        goto_seg(page, "dt", 4)
        page.keyboard.type("2")
        check("hour digit shows the in-progress run",
              read_in(page, "dt") == "28 Sep 2026 CE 2:00:00", read_in(page, "dt"))
        page.keyboard.press("Backspace")
        check("Backspace abandons the run",
              read_in(page, "dt") == "28 Sep 2026 CE 09:00:00", read_in(page, "dt"))

        # --- digit runs show per-keystroke feedback and commit once ---
        fill_dt(page, "dt", "2026-09-28T09:00:00")
        goto_seg(page, "dt", 2)
        page.keyboard.type("2")
        check("year keystroke shows the in-progress run",
              read_in(page, "dt") == "28 Sep 2 CE 09:00:00", read_in(page, "dt"))
        page.keyboard.type("03")
        check("year run keeps showing while typing",
              read_in(page, "dt") == "28 Sep 203 CE 09:00:00", read_in(page, "dt"))
        page.keyboard.type("6")
        check("full year run commits and auto-advances",
              read_in(page, "dt") == "28 Sep 2036 CE 09:00:00", read_in(page, "dt"))
        check("year commit auto-advances to era", sel(page, "dt") == [12, 14],
              str(sel(page, "dt")))

        # --- a partial run commits on blur ---
        goto_seg(page, "dt", 2)
        page.keyboard.type("45")
        page.evaluate("() => document.getElementById('dt-in').blur()")
        page.wait_for_timeout(150)
        check("partial year run commits on blur",
              read_in(page, "dt") == "28 Sep 45 CE 09:00:00", read_in(page, "dt"))

        # --- Escape abandons the run ---
        goto_seg(page, "dt", 2)
        page.keyboard.type("99")
        page.keyboard.press("Escape")
        check("Escape abandons the run",
              read_in(page, "dt") == "28 Sep 45 CE 09:00:00", read_in(page, "dt"))

        # --- unhandled keys don't corrupt the field ---
        before = read_in(page, "dt")
        goto_seg(page, "dt", 0)
        page.keyboard.type("!")
        check("unhandled key swallowed", read_in(page, "dt") == before, read_in(page, "dt"))

        # --- paste parses the canonical format ---
        paste(page, "dt", "15 Mar 44 BCE 12:00:00")
        check("paste commits a BCE instant",
              read_in(page, "dt") == "15 Mar 44 BCE 12:00:00", read_in(page, "dt"))
        check("pasted BCE disables the timezone select", page.is_disabled("#tz"))
        paste(page, "dt", "not a date")
        check("invalid paste is ignored",
              read_in(page, "dt") == "15 Mar 44 BCE 12:00:00", read_in(page, "dt"))

        # --- Alt+Down opens the popup; Escape closes ---
        fill_dt(page, "dt", "2026-09-28T14:30:00")
        focus_in(page, "dt")
        page.keyboard.press("Alt+ArrowDown")
        page.wait_for_timeout(200)
        check("Alt+Down opens the picker", page.query_selector(".dpick") is not None)
        page.keyboard.press("Escape")
        check("Escape closes the picker", page.query_selector(".dpick") is None)

        # --- popup time steppers adjust the time, popup stays open ---
        ensure_drawer(page)  # the Escape above also closed the drawer
        page.click("#dt-cal")
        page.wait_for_timeout(200)
        page.click("button[aria-label=\"Increase Hour\"]")  # hour up
        check("popup hour stepper up", hidden(page, "dt", "h") == "15", hidden(page, "dt", "h"))
        check("input follows the stepper",
              read_in(page, "dt") == "28 Sep 2026 CE 15:30:00", read_in(page, "dt"))
        check("popup stays open after stepping", page.query_selector(".dpick") is not None)
        page.click("button[aria-label=\"Decrease Hour\"]")
        page.click("button[aria-label=\"Decrease Hour\"]")
        check("popup hour stepper down x2", hidden(page, "dt", "h") == "13",
              hidden(page, "dt", "h"))
        page.evaluate("window.__trigonSetTime('dt', 23, 0, 0)")
        page.keyboard.press("Escape")  # reopen so the popup re-syncs its state
        ensure_drawer(page)  # the Escape above also closed the drawer
        page.click("#dt-cal")
        page.wait_for_timeout(200)
        page.click("button[aria-label=\"Increase Hour\"]")
        check("hour stepper wraps 23 -> 0", hidden(page, "dt", "h") == "0",
              hidden(page, "dt", "h"))
        pick_day(page, "15")
        check("popup day pick keeps the time",
              read_in(page, "dt") == "15 Sep 2026 CE 00:00:00", read_in(page, "dt"))

        # --- forward-only ranges reject edits crossing the paired endpoint ---
        page.click("#views .tabs button[data-tab=aspects]")
        fill_dt(page, "asp-start", "2026-01-10T00:00")
        fill_dt(page, "asp-end", "2026-01-20T00:00")
        goto_seg(page, "asp-end", 3)
        page.keyboard.type("b")
        check("end era rejected when start is CE",
              read_in(page, "asp-end") == "20 Jan 2026 CE 00:00", read_in(page, "asp-end"))
        goto_seg(page, "asp-end", 0)
        page.keyboard.type("05")
        check("end day rejected before the start",
              read_in(page, "asp-end") == "20 Jan 2026 CE 00:00", read_in(page, "asp-end"))
        goto_seg(page, "asp-start", 0)
        page.keyboard.type("25")  # full run commits once; 25 Jan crosses the end
        check("start day crossing the end is rejected atomically",
              read_in(page, "asp-start") == "10 Jan 2026 CE 00:00",
              read_in(page, "asp-start"))
        check("search input has no seconds",
              read_in(page, "asp-start").count(":") == 1, read_in(page, "asp-start"))

        # --- a full calculate works from a typed year ---
        page.click("#views .tabs button[data-tab=table]")
        fill_dt(page, "dt", "2026-03-15T12:00:00")
        goto_seg(page, "dt", 2)
        page.keyboard.type("2027")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=60000)
        check("calculate works after typed input",
              "2027-03-15" in page.text_content("#meta-stamp"),
              page.text_content("#meta-stamp")[:40])

        # --- live clock doesn't clobber a focused field ---
        page.check("#clock-toggle")
        fill_dt(page, "dt", "2026-09-28T14:30:05")
        focus_in(page, "dt")
        frozen = read_in(page, "dt")
        page.wait_for_timeout(1600)
        check("focused field survives clock ticks", read_in(page, "dt") == frozen,
              read_in(page, "dt"))
        page.evaluate("() => document.getElementById('dt-in').blur()")  # blur
        page.wait_for_timeout(1300)
        check("blur repaints from the clock", read_in(page, "dt") != frozen,
              read_in(page, "dt")[:24])
        page.uncheck("#clock-toggle")

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    harness.stop_relay(relay); httpd.terminate()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
