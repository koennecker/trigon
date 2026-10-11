// datetime.js — one unified date+time input with native-picker-like segments.
//
// Replaces the date button + separate hour/minute/second inputs with a single
// typable text field: "28 Sep 2026 CE 14:30:00". Like the native
// datetime-local picker it replaces, the field is split into segments
// (day, month, year, era, hour, minute, second) with idiosyncratic
// per-segment behavior:
//   - Left/Right arrows (or clicking) move between segments; the active
//     segment is highlighted.
//   - Up/Down steps the active segment: day wraps within the month (skipping
//     the nonexistent 1582-10-05..14), month cycles with the day clamped,
//     year steps with no year zero (1 CE <-> 1 BCE), era toggles,
//     hour/minute/second wrap.
//   - Typing digits shows the in-progress run inside the segment on every
//     keystroke and commits it exactly once: a full run (year: 4 digits CE,
//     5 BCE) commits and auto-advances; a partial run commits on blur,
//     Enter, or leaving the segment; Escape/Backspace abandon it.
//     Committing once keeps half-typed values out of the app's range guard,
//     so e.g. typing 2036 into a range end never stalls on rejections of
//     the intermediate 2/20/203.
//   - Typing letters in the month segment opens a suggestion list of the
//     matching months ("j" -> January, June, July): the matches are visible,
//     typing narrows them, repeating the letter cycles the highlight,
//     Enter/click commits, Escape dismisses. "c"/"b" sets the era.
//   - Alt+Down opens the calendar popup; Escape reverts the current run.
//   - Pasting "15 Mar 44 BCE 12:00:00" (the field's own format) works.
//
// The pure segment logic below is DOM-free and unit-tested; the component
// at the bottom only wires keyboard/mouse to get()/set() callbacks so the
// app's hidden canonical inputs stay the single source of truth.

import {
  MONTHS, BCE_MIN_ASTRO, CE_MAX_YEAR,
  daysInMonth, eraToAstro, astroToEra, checkYearRange, validDate,
} from './dateapi.js';

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = n => String(n).padStart(2, '0');

export const DT_SEGS = ['d', 'mo', 'y', 'era', 'hh', 'mi', 'ss'];
// Digit capacity per numeric segment (0 for text segments); the year takes
// 4 digits in CE and 5 in BCE (12999), mirroring the native picker's
// advance-when-full.
const NUMERIC = new Set(['d', 'y', 'hh', 'mi', 'ss']);
const numWidth = (seg, f) => {
  if (seg === 'y') return f.y < 1 ? 5 : 4;
  return NUMERIC.has(seg) ? 2 : 0;
};

// Segment texts, with an optional in-progress override { seg, text } for
// the segment the user is typing into (shown, not committed).
function dtParts(f, seconds, over) {
  const { yy, era } = astroToEra(f.y);
  const parts = [
    ['d', String(f.d)],
    ['mo', MONTHS[f.mo - 1]],
    ['y', String(yy)],
    ['era', era.toUpperCase()],
    ['hh', pad2(f.hh)],
    ['mi', pad2(f.mi)],
  ];
  if (seconds) parts.push(['ss', pad2(f.ss)]);
  if (over) {
    const i = DT_SEGS.indexOf(over.seg);
    if (i >= 0 && i < parts.length) parts[i][1] = over.text;
  }
  return parts;
}

// "28 Sep 2026 CE 14:30:00" (seconds=false drops ":ss").
export function formatDT(f, seconds, over) {
  const texts = dtParts(f, seconds, over).map(p => p[1]);
  const t = texts.slice(4).join(':');
  return `${texts[0]} ${texts[1]} ${texts[2]} ${texts[3]} ${t}`;
}

export function shownSegs(seconds) {
  return seconds ? DT_SEGS : DT_SEGS.slice(0, 6);
}

// Character spans of each shown segment in formatDT(f, seconds, over).
export function segSpans(f, seconds, over) {
  const parts = dtParts(f, seconds, over);
  const spans = [];
  let off = 0;
  for (const [seg, text] of parts) {
    spans.push({ seg, start: off, end: off + text.length });
    off += text.length + 1; // the separating space or colon
  }
  return spans;
}

// Segment index containing char offset off (separators map to the segment
// on their right, like the native picker's caret behavior).
export function segAtOffset(f, seconds, off) {
  const spans = segSpans(f, seconds);
  for (let i = 0; i < spans.length; i++)
    if (off < spans[i].end) return i;
  return spans.length - 1;
}

// Clamp the day into the month, skipping the 1582 cutover gap toward dir.
function withDayClamp(f, dir = 0) {
  let d = Math.min(Math.max(1, f.d), daysInMonth(f.y, f.mo));
  if (f.y === 1582 && f.mo === 10 && d >= 5 && d <= 14)
    d = dir >= 0 ? 15 : 4;
  return { ...f, d };
}

function stepDay(y, mo, d, dir) {
  const dim = daysInMonth(y, mo);
  let nd = d + dir;
  if (nd < 1) nd = dim;
  if (nd > dim) nd = 1;
  if (y === 1582 && mo === 10)
    while (nd >= 5 && nd <= 14) {
      nd += dir;
      if (nd < 1) nd = dim;
      if (nd > dim) nd = 1;
    }
  return nd;
}

// Step one segment by dir (+1/-1). Pure; wraps like the native picker and
// never produces an invalid date.
export function stepSeg(f, seg, dir) {
  switch (seg) {
    case 'd': return { ...f, d: stepDay(f.y, f.mo, f.d, dir) };
    case 'mo': {
      const mo = ((f.mo - 1 + dir + 12) % 12) + 1;
      return withDayClamp({ ...f, mo }, dir);
    }
    case 'y': {
      let y = f.y + dir;
      if (y < BCE_MIN_ASTRO) y = BCE_MIN_ASTRO;
      if (y > CE_MAX_YEAR) y = CE_MAX_YEAR;
      return withDayClamp({ ...f, y }, dir);
    }
    case 'era': {
      const { yy, era } = astroToEra(f.y);
      const other = era === 'ce' ? 'bce' : 'ce';
      let y;
      try {
        y = eraToAstro(yy, other);
        checkYearRange(y);
      } catch (e) { y = other === 'ce' ? CE_MAX_YEAR : BCE_MIN_ASTRO; }
      return withDayClamp({ ...f, y }, 0);
    }
    case 'hh': return { ...f, hh: (f.hh + dir + 24) % 24 };
    case 'mi': return { ...f, mi: (f.mi + dir + 60) % 60 };
    case 'ss': return { ...f, ss: (f.ss + dir + 60) % 60 };
    default: return { ...f };
  }
}

// Commit a typed digit run to a numeric segment, clamping into range
// (Feb 30 -> Feb 28/29, hour 29 -> 23). The caller tracks the run length
// for auto-advance.
export function applyDigits(f, seg, digits) {
  const v = parseInt(digits, 10);
  if (!Number.isFinite(v)) return { ...f };
  switch (seg) {
    case 'd': return withDayClamp({ ...f, d: Math.max(1, v) }, 0);
    case 'y': {
      const { era } = astroToEra(f.y);
      const yyMax = era === 'ce' ? CE_MAX_YEAR : 1 - BCE_MIN_ASTRO; // 12999 BCE
      return withDayClamp({ ...f, y: eraToAstro(Math.min(Math.max(1, v), yyMax), era) }, 0);
    }
    case 'hh': return { ...f, hh: Math.min(23, Math.max(0, v)) };
    case 'mi': return { ...f, mi: Math.min(59, Math.max(0, v)) };
    case 'ss': return { ...f, ss: Math.min(59, Math.max(0, v)) };
    default: return { ...f };
  }
}

// Type-ahead month match: months whose name starts with prefix, cycling
// past the current month (native select semantics). Null when no match.
export function matchMonths(prefix) {
  const p = prefix.toLowerCase();
  const hits = [];
  MONTHS.forEach((m, i) => { if (m.toLowerCase().startsWith(p)) hits.push(i + 1); });
  return hits;
}

export function matchMonth(f, prefix) {
  const hits = matchMonths(prefix);
  if (!hits.length) return null;
  const after = hits.find(m => m > f.mo);
  return withDayClamp({ ...f, mo: after !== undefined ? after : hits[0] }, 0);
}

export function setEraSeg(f, era) {
  if (era !== 'ce' && era !== 'bce') return { ...f };
  const { yy } = astroToEra(f.y);
  let y;
  try {
    y = eraToAstro(yy, era);
    checkYearRange(y);
  } catch (e) { y = era === 'ce' ? CE_MAX_YEAR : BCE_MIN_ASTRO; }
  return withDayClamp({ ...f, y }, 0);
}

// Full-datetime comparison and clamping (astronomical y, then calendar,
// then time-of-day).
export function cmpDT(a, b) {
  return (a.y - b.y) || (a.mo - b.mo) || (a.d - b.d) ||
         (a.hh - b.hh) || (a.mi - b.mi) || (a.ss - b.ss);
}

export function clampDT(v, lo, hi) {
  if (lo && cmpDT(v, lo) < 0) return { ...lo };
  if (hi && cmpDT(v, hi) > 0) return { ...hi };
  return { ...v };
}

export const dtFloor = () => ({ y: BCE_MIN_ASTRO, mo: 1, d: 1, hh: 0, mi: 0, ss: 0 });
export const dtCeil = () => ({ y: CE_MAX_YEAR, mo: 12, d: 31, hh: 23, mi: 59, ss: 59 });

// Parse the field's own display format ("15 Mar 44 BCE 12:00[:00]"),
// for paste. Null when it does not parse or is not a valid date.
export function parseDTText(s, seconds) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{1,5})\s+(CE|BCE)\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/i.exec(s);
  if (!m) return null;
  const mo = MONTHS.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase()) + 1;
  if (!mo) return null;
  const era = m[4].toLowerCase();
  let y;
  try {
    y = eraToAstro(parseInt(m[3], 10), era);
    checkYearRange(y);
  } catch (e) { return null; }
  const d = parseInt(m[1], 10), hh = parseInt(m[5], 10), mi = parseInt(m[6], 10);
  const ss = m[7] !== undefined ? parseInt(m[7], 10) : 0;
  if (hh > 23 || mi > 59 || ss > 59 || !validDate(y, mo, d)) return null;
  return { y, mo, d, hh, mi, ss: seconds ? ss : 0 };
}

// ---------------------------------------------------------------------------
// Component: wires one text input to the segment model.
//
// opts: {
//   seconds: bool (show the seconds segment),
//   get: () => {y,mo,d,hh,mi,ss} | null   (canonical value, astronomical y),
//   set: (f, seg) => void                 (commit; runs the app's clamping,
//                                          hidden-input write-through and
//                                          change events, then get() reads
//                                          the committed value back),
//   openPicker: () => void                (calendar popup),
// }
// Returns { refresh() } — repaint from get(), unless the user is editing.

// The currently open month-suggestion popup, if any (one at a time across
// all datetime inputs on the page).
let activeSuggest = null;
let suggestListenersAttached = false;
function closeActiveSuggest() {
  if (activeSuggest) activeSuggest.close();
}
function attachSuggestListeners() {
  if (suggestListenersAttached) return;
  suggestListenersAttached = true;
  document.addEventListener('pointerdown', e => {
    if (activeSuggest && !activeSuggest.panel?.contains(e.target) &&
        e.target !== activeSuggest.input) closeActiveSuggest();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeActiveSuggest();
  });
}
export function attachDateTime(input, opts) {
  const segs = shownSegs(opts.seconds);
  let seg = 0;          // active segment index
  let dbuf = '';        // in-progress digit run (shown, not yet committed)
  // Month suggestion popup state (letters on the month segment open it).
  let ms = null;        // { cands: [mo...], hi: index, prefix, time }
  let mpanel = null;    // popup element, or null

  const cur = () => opts.get();
  function todayBase() {
    const n = new Date();
    return { y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(),
             hh: 0, mi: 0, ss: 0 };
  }
  const base = () => cur() || todayBase();

  function paint(f, s, over) {
    seg = Math.max(0, Math.min(segs.length - 1, s));
    if (!f) { input.value = ''; return; }
    input.value = formatDT(f, opts.seconds, over);
    const sp = segSpans(f, opts.seconds, over)[seg];
    input.setSelectionRange(sp.start, sp.end);
  }

  // The display override for an in-progress digit run (shown, uncommitted).
  const runOver = () => dbuf ? { seg: segs[seg], text: dbuf } : null;

  // Repaint the committed value with the in-progress run shown in place.
  function paintRun(s) { paint(cur(), s, runOver()); }

  function resetRun() { dbuf = ''; }

  // --- Month suggestion popup -------------------------------------------
  // One popup at a time across all datetime inputs.
  function closeSuggest() {
    if (mpanel) { mpanel.remove(); mpanel = null; }
    ms = null;
    if (activeSuggest && activeSuggest.input === input) activeSuggest = null;
  }

  function renderSuggest() {
    if (!ms) return;
    if (!mpanel) {
      closeActiveSuggest();
      mpanel = document.createElement('div');
      mpanel.className = 'msuggest';
      mpanel.setAttribute('role', 'listbox');
      mpanel.setAttribute('aria-label', 'Choose month');
      document.body.append(mpanel);
      activeSuggest = { input, panel: mpanel, close: closeSuggest };
      // Position below the input; flip above if there is no room.
      const r = input.getBoundingClientRect();
      const pw = mpanel.offsetWidth, ph = mpanel.offsetHeight;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
      let top = r.bottom + 6;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      mpanel.style.left = `${left}px`;
      mpanel.style.top = `${top}px`;
    }
    mpanel.innerHTML = '';
    ms.cands.forEach((mo, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'msuggest-item' + (i === ms.hi ? ' hi' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', i === ms.hi ? 'true' : 'false');
      b.textContent = FULL_MONTHS[mo - 1];
      // pointerdown + preventDefault: commits before input blur can
      // dismiss the popup.
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        commitSuggest(i);
      });
      mpanel.append(b);
    });
  }

  function moveSuggestHi(d) {
    if (!ms) return;
    ms.hi = (ms.hi + d + ms.cands.length) % ms.cands.length;
    renderSuggest();
  }

  function commitSuggest(i) {
    if (!ms) return;
    const mo = ms.cands[i !== undefined ? i : ms.hi];
    closeSuggest();
    commit(withDayClamp({ ...base(), mo }, 0), seg);
  }

  // A letter keystroke on the month segment: open/update the suggestion
  // list. Typing narrows the candidates; repeating the same letter cycles
  // the highlight through them. Nothing commits until Enter/click.
  function monthKey(key) {
    const now = Date.now();
    const cycling = ms && ms.prefix.length > 0 && key === ms.prefix[0] &&
      [...ms.prefix].every(c => c === key);
    if (!ms || now - ms.time > 1000) {
      ms = { cands: [], hi: 0, prefix: '', time: now };
    }
    ms.time = now;
    let cands;
    if (cycling) {
      cands = matchMonths(key);
      ms.hi = (ms.hi + 1) % cands.length;
    } else {
      ms.prefix += key;
      cands = matchMonths(ms.prefix);
      if (!cands.length && ms.prefix.length > 1) {
        ms.prefix = key;
        cands = matchMonths(key);
      }
      const f0 = base();
      ms.hi = cands.includes(f0.mo) ? cands.indexOf(f0.mo) : 0;
    }
    if (!cands.length) { closeSuggest(); return; }
    ms.cands = cands;
    renderSuggest();
  }

  // Commit the in-progress run, if any. The range guard inside opts.set
  // may reject it; then the canonical value is unchanged.
  function flush() {
    if (!dbuf) return;
    const buf = dbuf;
    dbuf = '';
    opts.set(applyDigits(base(), segs[seg], buf), segs[seg]);
  }

  // Commit f and repaint the (possibly clamped/rejected) result on
  // segment s. Settles any in-progress run first.
  function commit(f, s) {
    flush();
    closeSuggest();
    opts.set(f, segs[s]);
    paint(cur() || f, s);
    resetRun();
  }

  attachSuggestListeners();

  input.setAttribute('inputmode', 'text');
  input.placeholder = opts.seconds ? 'd MMM yyyy era hh:mm:ss'
                                   : 'd MMM yyyy era hh:mm';

  input.addEventListener('focus', () => {
    const f = cur();
    paint(f, f ? segAtOffset(f, opts.seconds, input.selectionStart || 0) : 0);
    resetRun();
  });

  input.addEventListener('click', () => {
    // The browser sets the caret after click; read it on the next tick.
    setTimeout(() => {
      flush(); // a run abandoned mid-typing commits when clicking away
      const f = cur();
      if (!f) return;
      paint(f, segAtOffset(f, opts.seconds, input.selectionStart || 0));
      resetRun();
    }, 0);
  });

  input.addEventListener('blur', () => {
    closeSuggest(); // dismiss uncommitted; the value never changed
    flush(); resetRun(); paint(cur(), seg);
  });

  input.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text');
    const f = parseDTText(t, opts.seconds);
    if (f) commit(f, seg);
  });
  input.addEventListener('drop', e => e.preventDefault());

  // Defensive: the field is fully managed, so any uncontrolled edit
  // (IME, autofill) is reverted to the canonical value — or to the
  // canonical value with the in-progress run shown, while typing.
  input.addEventListener('input', () => {
    const f = cur();
    const exp = f ? formatDT(f, opts.seconds, runOver()) : '';
    if (input.value !== exp) paint(f, seg, runOver());
  });

  // iOS Safari's software keyboard ignores keydown preventDefault for
  // insertion/deletion; beforeinput is the cancelable point there. The
  // field is fully managed through keydown, so direct edits are suppressed
  // (paste and drop keep their own handlers above).
  input.addEventListener('beforeinput', e => {
    if (e.inputType === 'insertText' || e.inputType === 'insertLineBreak' ||
        e.inputType === 'deleteContentBackward' ||
        e.inputType === 'deleteContentForward') {
      e.preventDefault();
    }
  });

  input.addEventListener('keydown', e => {
    const name = segs[seg];
    const f = base();

    // Month suggestion popup open: it owns Enter/Escape/Up/Down/Tab;
    // anything else dismisses the choice without committing.
    if (ms) {
      if (e.key === 'Enter') { e.preventDefault(); commitSuggest(); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSuggest();
        paint(cur(), seg);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        moveSuggestHi(e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (e.key === 'Tab') { commitSuggest(); return; } // close, then tab away
      // Month letters fall through to monthKey with the popup state intact
      // (they narrow or cycle the candidates); anything else dismisses the
      // choice without committing.
      if (!(/^[a-zA-Z]$/.test(e.key) && name === 'mo')) closeSuggest();
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      flush(); // leaving the segment commits the run
      const ns = seg + (e.key === 'ArrowRight' ? 1 : -1);
      paint(cur(), ns);
      resetRun();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      flush();
      paint(cur(), e.key === 'Home' ? 0 : segs.length - 1);
      resetRun();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (e.altKey) { opts.openPicker(); return; }
      flush();
      const g = base();
      commit(stepSeg(g, name, e.key === 'ArrowUp' ? 1 : -1), seg);
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); return; }
    if (e.key === 'Escape') {
      // Abandon the in-progress run; nothing was committed, so the
      // canonical value is already intact. The global handler closes popups.
      if (dbuf) {
        e.preventDefault();
        dbuf = '';
        paint(cur(), seg);
      }
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      // Abandon the in-progress run; otherwise swallow (segments are
      // fixed-width, so there is nothing to delete).
      e.preventDefault();
      if (dbuf) { dbuf = ''; paint(cur(), seg); }
      return;
    }
    if (e.key.length === 1) {
      // Printable: handled per segment, everything else swallowed.
      // Modifier combos (copy, select-all) pass through untouched.
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (/^[0-9]$/.test(e.key) && numWidth(name, f)) {
        const w = numWidth(name, f);
        dbuf += e.key;
        if (dbuf.length >= w) {
          // Full run: commit once (the range guard sees the intended
          // value, never the half-typed intermediates) and auto-advance.
          const nf = applyDigits(f, name, dbuf);
          dbuf = '';
          commit(nf, seg < segs.length - 1 ? seg + 1 : seg);
        } else {
          paintRun(seg); // immediate feedback; nothing committed yet
        }
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && name === 'mo') {
        e.preventDefault();
        monthKey(e.key.toLowerCase());
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) && name === 'era') {
        const c = e.key.toLowerCase();
        if (c === 'c' || c === 'b') commit(setEraSeg(f, c === 'c' ? 'ce' : 'bce'), seg);
        return;
      }
      // Digits on text segments and letters on numeric segments: ignore.
    }
  });

  return {
    refresh() {
      if (document.activeElement !== input) paint(cur(), seg);
    },
  };
}
