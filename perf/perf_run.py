#!/usr/bin/env python3
"""Trigon performance sampler.

Drives the deployed app through functional scenarios with Playwright,
polls CDP Performance.getMetrics + SystemInfo.getProcessInfo once per
second, reads per-process CPU ticks and RSS from /proc, and writes a
per-scenario CSV plus a summary (optionally appended to JOURNAL.md).

Metrics per second:
  task/script/layout/style %  main-thread busy fractions (CDP deltas)
  layouts, style recalcs      CDP counts per second
  heap MB                     JSHeapUsedSize
  cpu per Chrome process type (browser / renderer / GPU / other) from
                              /proc stat utime+stime deltas — GPU is the
                              GPU *process* CPU, the honest proxy headless
  rss MB                      summed resident set of the Chrome tree
  raf/s                       vsync callbacks observed in page (render
                              work shows in the CPU columns, not here)

Usage:
  perf_run.py --url https://<deployment>.trigon.pages.dev --label 38be57ec
              [--seconds 20] [--scenarios table-clock,sky-clock,sky-static]
              [--journal JOURNAL.md]
Exit code 0 always (this is a recorder, not a gate); failures print loudly.
"""
import argparse, csv, json, os, subprocess, sys, time
from datetime import datetime

WS = os.path.expanduser("~/workspace")
CLK_TCK = os.sysconf("SC_CLK_TCK")


def proc_stat(pid):
    """(cpu_seconds, rss_mb) for pid, or (None, None)."""
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            raw = f.read().decode()
        # comm may contain spaces/parens: split after the last ')'
        rest = raw[raw.rindex(")") + 2:].split()
        utime, stime = int(rest[11]), int(rest[12])  # fields 14,15 overall
        rss_pages = int(rest[21])                   # field 24 overall
        return (utime + stime) / CLK_TCK, rss_pages * 4096 / 1e6
    except Exception:
        return None, None


CDP_KEYS = ["TaskDuration", "ScriptDuration", "LayoutDuration",
            "RecalcStyleDuration", "JSHeapUsedSize", "LayoutCount",
            "RecalcStyleCount", "Nodes"]


def setup_chart(page, base):
    page.goto(base + "/", wait_until="networkidle")
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


def start_clock(page):
    page.evaluate("document.getElementById('clock-toggle').click()")
    page.wait_for_timeout(300)


def open_sky(page):
    page.click("#views .tabs button[data-tab=sky]")
    page.wait_for_selector("#sky-canvas canvas", state="visible", timeout=60000)
    page.wait_for_timeout(3000)  # star catalogue + first frames settle


def start_aspect_wide(page):
    """All bodies x all aspects, 1600-2400: the historical-search stress.
    The Moon in the set forces the 5-day grid over 800 years."""
    sys.path.insert(0, f"{WS}/.e2e-relay")
    from dtfill import fill_dt
    page.click("#views .tabs button[data-tab=aspects]")
    page.wait_for_selector("#asp-go", state="visible", timeout=30000)
    fill_dt(page, "asp-start", "1600-01-01T00:00")
    fill_dt(page, "asp-end", "2400-01-01T00:00")
    page.click("#asp-go")


def start_ingress_long(page):
    """All bodies' sign ingresses, 1600-2400."""
    sys.path.insert(0, f"{WS}/.e2e-relay")
    from dtfill import fill_dt
    page.click("#views .tabs button[data-tab=ingresses]")
    page.wait_for_selector("#ing-go", state="visible", timeout=30000)
    fill_dt(page, "ing-start", "1600-01-01T00:00")
    fill_dt(page, "ing-end", "2400-01-01T00:00")
    page.click("#ing-go")


def start_stations_century(page):
    """Stations + retrograde periods, Mercury-Pluto, 1900-2100."""
    sys.path.insert(0, f"{WS}/.e2e-relay")
    from dtfill import fill_dt
    page.click("#views .tabs button[data-tab=stations]")
    page.wait_for_selector("#stn-go", state="visible", timeout=30000)
    fill_dt(page, "stn-start", "1900-01-01T00:00")
    fill_dt(page, "stn-end", "2100-01-01T00:00")
    page.click("#stn-go")


def start_retro_animate(page):
    """Retrograde animation: Mercury-Venus-Mars periods in 2025, then the
    first period's animate button (Sky sphere + comet trail playback).
    Samples a fixed window while the animation plays."""
    sys.path.insert(0, f"{WS}/.e2e-relay")
    from dtfill import fill_dt
    page.click("#views .tabs button[data-tab=stations]")
    page.wait_for_selector("#stn-go", state="visible", timeout=30000)
    fill_dt(page, "stn-start", "2025-01-01T00:00")
    fill_dt(page, "stn-end", "2026-01-01T00:00")
    page.click("#stn-go")
    page.wait_for_selector("[data-anim-period]", state="visible", timeout=180000)
    page.click("[data-anim-period]")
    page.wait_for_selector("#sky-canvas", state="visible", timeout=60000)
    time.sleep(1.0)  # let playback get going before the first sample


def search_done(page, prefix):
    return page.evaluate(
        f"!document.getElementById('{prefix}-go').disabled "
        f"&& document.getElementById('{prefix}-prog').hidden")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True)
    ap.add_argument("--label", required=True, help="deployment id or 'local'")
    ap.add_argument("--seconds", type=int, default=20)
    ap.add_argument("--cap", type=int, default=300, help="max seconds for until-done scenarios")
    ap.add_argument("--scenarios", default="table-clock,sky-clock,sky-static")
    ap.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "runs"))
    ap.add_argument("--journal", default="")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    relay = subprocess.Popen([sys.executable, f"{WS}/.e2e-relay/relay.py"],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    from playwright.sync_api import sync_playwright
    summaries = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path=f"{WS}/.browsers/chrome-linux64/chrome",
                args=["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
                proxy={"server": "http://127.0.0.1:8899", "bypass": "127.0.0.1,localhost"})
            context = browser.new_context(viewport={"width": 1500, "height": 1150})
            bcdp = browser.new_browser_cdp_session()
            for scen in [s.strip() for s in args.scenarios.split(",") if s.strip()]:
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                setup_chart(page, args.url)
                # done_fn: stress scenarios sample until the action
                # completes (capped); fixed scenarios sample --seconds.
                done_fn = None
                if scen == "table-clock":
                    start_clock(page)
                elif scen in ("sky-clock", "sky-static"):
                    open_sky(page)
                    if scen == "sky-clock":
                        start_clock(page)
                elif scen == "sky-drag":
                    open_sky(page)
                    box = page.eval_on_selector("#sky-canvas",
                        "el => { const r = el.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }")
                    cx, cy = box["x"] + box["w"] / 2, box["y"] + box["h"] / 2
                    page.mouse.move(cx, cy); page.mouse.down()
                    done_fn = ("drag", (cx, cy))
                elif scen == "aspect-wide":
                    start_aspect_wide(page); done_fn = lambda: search_done(page, "asp")
                elif scen == "ingress-long":
                    start_ingress_long(page); done_fn = lambda: search_done(page, "ing")
                elif scen == "stations-century":
                    start_stations_century(page); done_fn = lambda: search_done(page, "stn")
                elif scen == "retro-animate":
                    start_retro_animate(page)
                else:
                    print(f"unknown scenario {scen}, skipped"); page.close(); continue
                cdp = context.new_cdp_session(page)
                cdp.send("Performance.enable")
                page.evaluate("""() => { window.__fr = 0;
                  const f = () => { window.__fr++; requestAnimationFrame(f); };
                  requestAnimationFrame(f); }""")

                rows = []
                prev = None
                t_start = time.time()
                action_secs = None
                while True:
                    t0 = time.time()
                    m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
                    procs = bcdp.send("SystemInfo.getProcessInfo")["processInfo"]
                    fr = page.evaluate("window.__fr")
                    now = time.time()
                    cpu = {}
                    rss_total = 0.0
                    for pr in procs:
                        cs, rss = proc_stat(pr["id"])
                        if cs is None: continue
                        cpu.setdefault(pr["type"], []).append((pr["id"], cs))
                        if rss: rss_total += rss
                    snap = {"t": now - t_start, "metrics": m, "fr": fr,
                            "cpu": cpu, "rss": rss_total}
                    if prev is not None:
                        dt = snap["t"] - prev["t"]
                        pm, cm = prev["metrics"], m
                        def pct(k): return 100.0 * (cm.get(k, 0) - pm.get(k, 0)) / dt if dt > 0 else 0.0
                        def cpct(kind):
                            before = dict(prev["cpu"].get(kind, []))
                            tot = 0.0
                            for pid, cs in snap["cpu"].get(kind, []):
                                if pid in before: tot += cs - before[pid]
                            return 100.0 * tot / dt if dt > 0 else 0.0
                        rows.append({
                            "t_s": round(snap["t"], 1),
                            "task_pct": round(pct("TaskDuration"), 2),
                            "script_pct": round(pct("ScriptDuration"), 2),
                            "layout_pct": round(pct("LayoutDuration"), 2),
                            "style_pct": round(pct("RecalcStyleDuration"), 2),
                            "layouts": int(cm.get("LayoutCount", 0) - pm.get("LayoutCount", 0)),
                            "recalcs": int(cm.get("RecalcStyleCount", 0) - pm.get("RecalcStyleCount", 0)),
                            "heap_mb": round(cm.get("JSHeapUsedSize", 0) / 1e6, 1),
                            "nodes": int(cm.get("Nodes", 0)),
                            "cpu_browser_pct": round(cpct("browser"), 1),
                            "cpu_renderer_pct": round(cpct("renderer"), 1),
                            "cpu_gpu_pct": round(cpct("GPU"), 1),
                            "rss_mb": round(rss_total),
                            "raf_fps": round((fr - prev["fr"]) / dt, 1) if dt > 0 else 0,
                        })
                    prev = snap
                    elapsed = time.time() - t_start
                    if isinstance(done_fn, tuple) and done_fn[0] == "drag":
                        # Continuous circular drag between samples.
                        import math
                        cx, cy = done_fn[1]
                        for k in range(10):
                            a = (elapsed + k / 10) * 1.4
                            page.mouse.move(cx + 160 * math.cos(a), cy + 90 * math.sin(a))
                            time.sleep(0.05)
                    if callable(done_fn):
                        if done_fn() or elapsed > args.cap:
                            action_secs = round(elapsed, 1)
                            break
                    elif elapsed >= args.seconds:
                        action_secs = round(elapsed, 1)
                        break
                    time.sleep(max(0.0, 1.0 - (time.time() - t0)))
                csv_path = os.path.join(args.outdir, f"{stamp}-{args.label}-{scen}.csv")
                with open(csv_path, "w", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                    w.writeheader(); w.writerows(rows)
                def avg(k): return sum(r[k] for r in rows) / len(rows) if rows else 0
                def mx(k): return max((r[k] for r in rows), default=0)
                summ = {
                    "scenario": scen, "label": args.label,
                    "action_secs": action_secs,
                    "task_pct_avg": round(avg("task_pct"), 1), "task_pct_max": round(mx("task_pct"), 1),
                    "cpu_chrome_pct_avg": round(avg("cpu_browser_pct") + avg("cpu_renderer_pct") + avg("cpu_gpu_pct"), 1),
                    "cpu_renderer_pct_avg": round(avg("cpu_renderer_pct"), 1),
                    "cpu_gpu_pct_avg": round(avg("cpu_gpu_pct"), 1),
                    "heap_mb_last": rows[-1]["heap_mb"] if rows else 0,
                    "rss_mb_avg": round(avg("rss_mb")),
                    "layouts_per_s": round(avg("layouts"), 1),
                    "console_errors": len(errors), "csv": csv_path,
                }
                summaries.append(summ)
                print(json.dumps(summ))
                if isinstance(done_fn, tuple):
                    try: page.mouse.up()
                    except Exception: pass
                page.close()
            browser.close()
    finally:
        relay.terminate()

    if args.journal:
        lines = []
        for s in summaries:
            lines.append(
                f"| {stamp} | {s['label']} | {s['scenario']} | {s['task_pct_avg']} "
                f"| {s['cpu_renderer_pct_avg']} | {s['cpu_gpu_pct_avg']} | {s['cpu_chrome_pct_avg']} "
                f"| {s['heap_mb_last']} | {s['rss_mb_avg']} | {s['layouts_per_s']} | {s['console_errors']} "
                f"| {s['action_secs'] if s['action_secs'] is not None else '—'} |")
        with open(args.journal, "a") as f:
            f.write("\n".join(lines) + "\n")
        print(f"journal appended: {args.journal}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
