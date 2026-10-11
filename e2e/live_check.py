#!/usr/bin/env python3
"""Live verification of the deployed Cloudflare Pages site (public URL)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness
import json
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else harness.live_url()


console_errors = []
page_errors = []
se1 = []

with sync_playwright() as p:
    browser = harness.launch(p)
    page = browser.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("response", lambda r: se1.append((r.status, r.url)) if ".se1" in r.url else None)
    page.goto(URL, wait_until="load", timeout=90000)
    page.wait_for_function("!document.getElementById('calc').disabled", timeout=90000)
    page.evaluate("document.getElementById('manual-loc').open = true")
    page.fill("#lat", "40.7128")
    page.fill("#lon", "-74.0060")
    page.dispatch_event("#lat", "change")
    page.dispatch_event("#lon", "change")
    page.wait_for_timeout(800)
    tz_name = page.text_content("#tz-name")
    tz_val = page.input_value("#tz")
    page.click("#calc")
    page.wait_for_function(
        "document.querySelectorAll('#panel-table table').length > 0",
        timeout=180000,
    )
    results_text = page.text_content("#views")
    err_text = page.text_content("#error")
    idb = page.evaluate(
        "async () => 'indexedDB' in window ? (await indexedDB.databases()).map(d => d.name) : 'no-idb'"
    )
    idb_files = page.evaluate(
        """async () => {
          return await new Promise((res, rej) => {
            const q = indexedDB.open('swisseph-ephe');
            q.onsuccess = () => {
              const db = q.result;
              if (!db.objectStoreNames.contains('files')) { res('no-store'); return; }
              const tx = db.transaction('files', 'readonly');
              const rq = tx.objectStore('files').getAllKeys();
              rq.onsuccess = () => res(rq.result.length);
              rq.onerror = () => rej(rq.error);
            };
            q.onerror = () => rej(q.error);
          });
        }"""
    )
    browser.close()

se1_ok = [u for s, u in se1 if s == 200]
print(json.dumps({
    "console_errors": console_errors,
    "page_errors": page_errors,
    "tz_name": tz_name,
    "tz_select_value": tz_val,
    "results_has_sun": "Sun" in results_text,
    "results_preview": results_text[:200].replace("\n", " "),
    "error_box": err_text.strip(),
    "idb_databases": idb,
    "idb_ephe_files": idb_files,
    "se1_downloads_200": len(se1_ok),
}, indent=2))
