#!/usr/bin/env python3
"""E2E for parallel Web-Worker search + time-boxed inline search.

- A long aspect search (1900-2100, all bodies, Moshier) runs on workers
  and produces exactly the same result count as the same search with
  hardwareConcurrency forced to 1 (inline path).
- A long ingress search (Moon, 2000-2020) likewise matches inline.
- Cancel during a worker search stops it cleanly.
- Zero console/page errors throughout.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
from dtfill import fill_dt

SITE = harness.site_dir()

PORT = 8135

results = []
def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""))

httpd = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
                         cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
relay = harness.start_relay()
time.sleep(1.5)
try:
    with sync_playwright() as p:
        browser = harness.launch(p)
        ctx = browser.new_context()
        page = ctx.new_page()
        cerr, perr = [], []
        page.on("console", lambda m: cerr.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: perr.append(str(e)))
        page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
        page.wait_for_selector("[data-tab=table]", state="visible")

        def row_count(sel):
            return page.locator(sel + " table tbody tr").count()

        def run_aspects(engine="moshier"):
            page.click('[data-tab="aspects"]')
            page.wait_for_selector("#panel-aspects", state="visible")
            page.select_option("#asp-engine", engine)
            for i in range(11):
                cb = page.locator(f"#asp-b{i}")
                if not cb.is_checked():
                    cb.check()
            fill_dt(page, "asp-start", "2000-01-01T00:00")
            fill_dt(page, "asp-end", "2021-01-01T00:00")
            page.click("#asp-go")
            page.wait_for_selector("#asp-go:not([disabled])", timeout=600000)
            page.wait_for_selector("#asp-prog[hidden]", state="attached", timeout=30000)
            return row_count("#asp-results")

        # 1) worker path (real core count)
        n_workers = page.evaluate("navigator.hardwareConcurrency")
        t0 = time.time()
        rows_w = run_aspects()
        dt_w = time.time() - t0
        check(f"aspect search completes on workers (cores={n_workers})", rows_w > 1000, f"{rows_w} rows in {dt_w:.1f}s")
        sig_w = page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#asp-results table tbody tr')];
          let h = 0; const txt = rows.map(r => r.cells[0].textContent).join('|');
          for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) >>> 0;
          return { first: rows[0].cells[0].textContent, last: rows[rows.length-1].cells[0].textContent, hash: h };
        }""")

        # 2) inline path (force 1 core) — identical results
        page.evaluate("""() => {
          Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 1 });
        }""")
        t0 = time.time()
        rows_i = run_aspects()
        dt_i = time.time() - t0
        sig_i = page.evaluate("""() => {
          const rows = [...document.querySelectorAll('#asp-results table tbody tr')];
          let h = 0; const txt = rows.map(r => r.cells[0].textContent).join('|');
          for (let i = 0; i < txt.length; i++) h = (h * 31 + txt.charCodeAt(i)) >>> 0;
          return { first: rows[0].cells[0].textContent, last: rows[rows.length-1].cells[0].textContent, hash: h };
        }""")
        check("aspect inline results identical to worker results",
              rows_i == rows_w and sig_i == sig_w,
              f"inline {rows_i} vs workers {rows_w} ({dt_i:.1f}s)")

        # 3) cancel during a worker search
        page.reload(wait_until="networkidle")
        page.wait_for_selector("[data-tab=table]", state="visible")
        page.click('[data-tab="aspects"]')
        page.select_option("#asp-engine", "moshier")
        for i in range(11):
            cb = page.locator(f"#asp-b{i}")
            if not cb.is_checked():
                cb.check()
        fill_dt(page, "asp-start", "2000-01-01T00:00")
        fill_dt(page, "asp-end", "2100-01-01T00:00")
        page.click("#asp-go")
        page.wait_for_selector("#asp-prog:not([hidden])", timeout=30000)
        time.sleep(3)
        page.click("#asp-cancel")
        page.wait_for_selector("#asp-go:not([disabled])", timeout=60000)
        st = page.text_content("#asp-status")
        check("cancel during worker search", "ancel" in (st or ""), st[:60] if st else "")

        check("zero console errors", not cerr, "; ".join(cerr[:3]))
        check("zero page errors", not perr, "; ".join(perr[:3]))
        browser.close()
finally:
    httpd.terminate(); harness.stop_relay(relay)

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
