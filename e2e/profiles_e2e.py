"""Profiles and saved charts: settings move from localStorage to IndexedDB,
per-profile settings, named saved charts, and multiwheel from saved charts."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness

results = []
def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f" -- {detail}" if detail and not cond else ""))

PORT = 8973

def open_settings(pg):
    if pg.locator("#input-card.open").count() == 0:
        pg.locator("#input-fab").click(timeout=8000)
        pg.wait_for_selector("#input-card.open", timeout=8000)
    pg.click("#settings-open")
    pg.wait_for_selector("#settings-modal:not([hidden])", timeout=8000)

def close_settings(pg):
    pg.click("#settings-close")
    pg.wait_for_selector("#settings-modal[hidden]", state="attached", timeout=8000)

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
        page.on("dialog", lambda d: d.accept())
        # Migration: a pre-existing localStorage setting is imported once.
        page.add_init_script("localStorage.setItem('astroweb-angle-fmt', 'dec')")
        page.goto(base + "/")
        page.wait_for_function("!document.getElementById('calc').disabled", timeout=60000)
        harness.ensure_drawer(page)
        page.click("details#manual-loc summary")
        page.fill("#lat", "33.4484"); page.fill("#lon", "-112.074")
        page.evaluate("window.__trigonSetDateTime('dt', 2026, 'ce', 1, 1, 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=30000)
        check("migrated angle format renders decimal",
              page.wait_for_function("""() => /\\d+\\.\\d{4}°/.test(
                document.querySelector('#panel-table tbody tr td.num').textContent)""", timeout=15000) is not None)
        check("migrated localStorage key is removed",
              page.evaluate("localStorage.getItem('astroweb-angle-fmt')") is None)
        check("saved charts section exists in the drawer",
              page.locator("#saved-field").count() == 1)
        check("no saved charts yet", "No saved charts yet" in page.text_content("#saved-charts"))

        # Profiles: create "Work", which carries over the current (decimal) settings.
        open_settings(page)
        check("Profiles section in settings modal",
              page.locator("#set-profiles-h").count() == 1)
        check("Default profile active initially",
              page.locator("#profile-select").input_value() == "default")
        page.fill("#profile-new-name", "Work")
        page.click("#profile-create")
        page.wait_for_function(
            "() => document.querySelector('#profile-note').textContent.includes('Active profile: Work')",
            timeout=8000)
        check("creating a profile activates it", True)
        check("profile carries over the decimal angle format",
              page.locator('[data-set-fmt="dec"]').get_attribute("aria-pressed") == "true")
        # Change a setting in Work, then switch to Default and back: per-profile.
        page.click('[data-set-fmt="dms"]')
        page.wait_for_function("""() => document.querySelector(
          '#panel-table tbody tr td.num').textContent.includes('″')""", timeout=15000)
        close_settings(page)
        page.click("#settings-open")
        page.wait_for_selector("#settings-modal:not([hidden])", timeout=8000)
        page.select_option("#profile-select", "default")
        page.wait_for_function("""() => document.querySelector(
          '#panel-table tbody tr td.num').textContent.includes('°') &&
          !document.querySelector('#panel-table tbody tr td.num').textContent.includes('″')""",
            timeout=15000)
        check("switching to Default restores its decimal format", True)
        page.select_option("#profile-select", label="Work")
        page.wait_for_function("""() => document.querySelector(
          '#panel-table tbody tr td.num').textContent.includes('″')""", timeout=15000)
        check("switching back to Work restores its dms format", True)
        close_settings(page)

        # Save the current chart, then a second chart a day later.
        page.fill("#save-chart-name", "Birth")
        page.click("#save-chart")
        page.wait_for_selector(".saved-row:has-text('Birth')", timeout=8000)
        check("named saved chart appears in the drawer", True)
        page.evaluate("window.__trigonSetDateTime('dt', 2026, 'ce', 1, 2, 12, 0, 0)")
        page.click("#calc")
        page.wait_for_selector("#panel-table table", timeout=30000)
        page.fill("#save-chart-name", "Later")
        page.click("#save-chart")
        page.wait_for_selector(".saved-row:has-text('Later')", timeout=8000)
        check("second saved chart appears", page.locator(".saved-row").count() == 2)

        # Multiwheel from saved charts: first checked is the root, the rest outer.
        page.locator(".saved-check").nth(0).check()
        page.locator(".saved-check").nth(1).check()
        page.click("#saved-multiwheel")
        page.wait_for_function(
            "() => document.querySelectorAll('#outer-panels .outer-panel').length === 1",
            timeout=30000)
        check("multiwheel from saved charts adds one outer wheel", True)
        check("outer wheel carries the saved chart name",
              page.locator(".outer-label").input_value() == "Later")
        page.wait_for_function("""() => document.querySelector('#meta-stamp') &&
          document.querySelector('#meta-stamp').textContent.includes('2026-01-01')""", timeout=30000)
        check("multiwheel root is the first checked chart", True)

        # Delete a saved chart, then delete the profile (with its charts).
        page.locator(".saved-row:has-text('Later') .saved-delete").click()
        page.wait_for_function(
            "() => document.querySelectorAll('.saved-row').length === 1", timeout=8000)
        check("deleting a saved chart removes its row", True)
        open_settings(page)
        page.click("#profile-delete")
        page.wait_for_function(
            "() => document.querySelector('#profile-select').value === 'default'",
            timeout=8000)
        check("deleting the active profile returns to Default", True)
        check("profile's saved charts are gone with it",
              "No saved charts yet" in page.text_content("#saved-charts"))
        close_settings(page)

        b.close(); srv.shutdown()
        bad = [e for e in errors if e]
        check("zero console/page errors", not bad, "; ".join(bad[:3]))
        fails = [n for n, ok in results if not ok]
        print(f"{len(results)-len(fails)}/{len(results)} checks passed")
        if fails or bad:
            print("FAILURES:", fails); sys.exit(1)

if __name__ == "__main__":
    main()
