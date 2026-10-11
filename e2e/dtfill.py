"""Helpers for the unified date+time input field groups.

Each group `prefix` is a typable text input (`prefix-in`) plus a calendar
button (`prefix-cal`), backed by hidden inputs prefix-y, prefix-era,
prefix-mo, prefix-d, prefix-h, prefix-mi (plus prefix-s on the main tab).
Dates are set through the app's own `window.__trigonSetDate` seam and times
through `window.__trigonSetTime`, so the input text, change listeners, and
the search start<=end invariant all run exactly as in production.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness


def fill_dt(pg, prefix, iso, era="ce"):
    """Fill a date field group. iso: 'YYYY-MM-DDTHH:MM[:SS]'; '' clears."""
    has_s = pg.query_selector(f"#{prefix}-s") is not None
    if iso == "":
        pg.evaluate(
            f"window.__trigonSetDate({prefix!r}, '', '', '', '')")
        pg.evaluate(f"window.__trigonRefresh({prefix!r})")
        return
    date, _, time = iso.partition("T")
    y, mo, d = date.split("-")
    parts = (time.split(":") + ["0", "0"])[:3]
    pg.evaluate(
        f"window.__trigonSetDate({prefix!r}, {int(y)}, {era!r}, {int(mo)}, {int(d)})")
    pg.evaluate(
        f"window.__trigonSetTime({prefix!r}, {int(parts[0])}, {int(parts[1])}, "
        f"{int(parts[2]) if has_s else 'null'})")


def read_dt(pg, prefix):
    """Read a group back as 'YYYY-era-MM-DDTHH:MM:SS' (zero-padded like the app)."""
    g = lambda s: pg.evaluate(f"document.getElementById({prefix + '-' + s!r}).value")
    y = g("y")
    y = y if y.startswith("-") or y == "" else y.zfill(4)
    p2 = lambda s: g(s).zfill(2)
    s = pg.query_selector(f"#{prefix}-s")
    return f"{y}-{g('era')}-{p2('mo')}-{p2('d')}T{p2('h')}:{p2('mi')}:{p2('s') if s else '00'}"


def read_in(pg, prefix):
    """Read the visible unified input's text."""
    return pg.input_value(f"#{prefix}-in")
