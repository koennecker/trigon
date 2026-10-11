// datepicker.js — calendar popup with BCE support.
//
// Replaces the native datetime-local picker (CE-only, years 1-9999) with a
// hand-rolled month grid that navigates the full supported range
// (12999 BCE .. 9999 CE): month arrows skip the nonexistent year 0,
// the year editor takes an era, and October 1582 omits the 5th-14th.
// All calendar math comes from dateapi.js (Julian before the cutover).

import {
  MONTHS, BCE_MIN_ASTRO, CE_MAX_YEAR,
  daysInMonth, weekdayOf, shiftMonth, cmpDate, clampDate,
  astroToEra, eraToAstro, validDate,
} from './dateapi.js';

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Day numbers actually shown for a month: October 1582 skips the 5th-14th.
function monthDays(y, mo) {
  if (y === 1582 && mo === 10) return [1, 2, 3, 4, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  const n = daysInMonth(y, mo);
  const out = new Array(n);
  for (let d = 1; d <= n; d++) out[d - 1] = d;
  return out;
}

const GLOBAL_MIN = { y: BCE_MIN_ASTRO, mo: 1, d: 1 };
const GLOBAL_MAX = { y: CE_MAX_YEAR, mo: 12, d: 31 };

let openPanel = null;
let listenersAttached = false;

export function closeDatePicker() {
  if (openPanel) { openPanel.remove(); openPanel = null; }
}

function attachGlobalListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener('pointerdown', e => {
    if (openPanel && !openPanel.contains(e.target) &&
        !openPanel._anchor.contains(e.target)) closeDatePicker();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeDatePicker();
  });
}

// opts: { value: {y, mo, d} (astronomical y), min, max, onPick({y, mo, d}),
//         time: {hh, mi, ss, seconds, onTime({hh, mi, ss})} (optional) }.
// min/max are inclusive {y, mo, d} bounds; null means the global floor/ceiling.
export function openDatePicker(anchor, opts) {
  attachGlobalListeners();
  closeDatePicker();
  const min = opts.min || GLOBAL_MIN, max = opts.max || GLOBAL_MAX;
  const value = clampDate(opts.value, min, max);
  const onPick = opts.onPick;

  const panel = document.createElement('div');
  panel.className = 'dpick';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', opts.time ? 'Choose date and time' : 'Choose date');
  panel._anchor = anchor;

  // Clamp the viewed month into the allowed range.
  let view = clampDate({ y: value.y, mo: value.mo, d: 1 },
    { y: min.y, mo: min.mo, d: 1 }, { y: max.y, mo: max.mo, d: 1 });
  view = { y: view.y, mo: view.mo };
  let yearEditing = false;

  const titleFor = (y, mo) => {
    const { yy, era } = astroToEra(y);
    return `${FULL_MONTHS[mo - 1]} ${yy} ${era.toUpperCase()}`;
  };

  function render() {
    panel.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'dpick-head';

    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'dpick-nav'; prev.textContent = '‹';
    prev.setAttribute('aria-label', 'Previous month');
    const prevM = shiftMonth(view.y, view.mo, -1);
    prev.disabled = cmpDate({ ...prevM, d: 1 }, { y: min.y, mo: min.mo, d: 1 }) < 0;
    prev.addEventListener('click', () => { view = prevM; render(); });

    const next = document.createElement('button');
    next.type = 'button'; next.className = 'dpick-nav'; next.textContent = '›';
    next.setAttribute('aria-label', 'Next month');
    const nextM = shiftMonth(view.y, view.mo, 1);
    next.disabled = cmpDate({ ...nextM, d: 1 }, { y: max.y, mo: max.mo, d: 1 }) > 0;
    next.addEventListener('click', () => { view = nextM; render(); });

    head.append(prev);

    if (yearEditing) {
      const yin = document.createElement('input');
      yin.type = 'number'; yin.min = '1'; yin.max = '12999';
      yin.className = 'dpick-yin'; yin.setAttribute('aria-label', 'Year');
      const { yy, era } = astroToEra(view.y);
      yin.value = String(yy);
      const esel = document.createElement('select');
      esel.className = 'dpick-era'; esel.setAttribute('aria-label', 'Era');
      for (const [v, label] of [['ce', 'CE'], ['bce', 'BCE']]) {
        const o = document.createElement('option');
        o.value = v; o.textContent = label;
        if (v === era) o.selected = true;
        // The era toggle must not offer dates outside [min, max].
        if (v === 'bce' && min.y >= 1) o.disabled = true;
        if (v === 'ce' && max.y <= 0) o.disabled = true;
        esel.append(o);
      }
      const go = document.createElement('button');
      go.type = 'button'; go.className = 'dpick-go'; go.textContent = 'Go';
      const commit = () => {
        const yyIn = parseInt(yin.value, 10);
        if (!Number.isInteger(yyIn) || yyIn < 1) { yin.focus(); return; }
        let y;
        try { y = eraToAstro(yyIn, esel.value); }
        catch (e) { yin.focus(); return; }
        // CE years cap at 9999; BCE at 12999 (= 1 - BCE_MIN_ASTRO).
        const yyMax = esel.value === 'ce' ? CE_MAX_YEAR : 1 - BCE_MIN_ASTRO;
        if (yyIn > yyMax) { yin.value = String(yyMax); yin.focus(); return; }
        const c = clampDate({ y, mo: view.mo, d: 1 },
          { y: min.y, mo: min.mo, d: 1 }, { y: max.y, mo: max.mo, d: 1 });
        view = { y: c.y, mo: c.mo };
        yearEditing = false;
        render();
      };
      go.addEventListener('click', commit);
      yin.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
      const yedit = document.createElement('div');
      yedit.className = 'dpick-yedit';
      yedit.append(yin, esel, go);
      head.append(yedit);
    } else {
      const title = document.createElement('button');
      title.type = 'button'; title.className = 'dpick-title';
      title.textContent = titleFor(view.y, view.mo);
      title.setAttribute('aria-label', 'Change year');
      title.addEventListener('click', () => { yearEditing = true; render(); });
      head.append(title);
    }
    // keep nav order: prev, title/editor, next
    head.append(next);
    panel.append(head);

    const grid = document.createElement('div');
    grid.className = 'dpick-grid';
    for (const d of DOW) {
      const s = document.createElement('span');
      s.className = 'dpick-dow'; s.textContent = d;
      grid.append(s);
    }
    const days = monthDays(view.y, view.mo);
    const lead = weekdayOf(view.y, view.mo, days[0]);
    const prevM2 = shiftMonth(view.y, view.mo, -1);
    const prevDays = monthDays(prevM2.y, prevM2.mo);
    const cells = [];
    for (let i = lead - 1; i >= 0; i--)
      cells.push({ y: prevM2.y, mo: prevM2.mo, d: prevDays[prevDays.length - 1 - i], dim: true });
    for (const d of days) cells.push({ y: view.y, mo: view.mo, d, dim: false });
    const nextM2 = shiftMonth(view.y, view.mo, 1);
    let td = 1;
    while (cells.length % 7) cells.push({ y: nextM2.y, mo: nextM2.mo, d: td++, dim: true });

    for (const c of cells) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dpick-day' + (c.dim ? ' dim' : '');
      b.textContent = String(c.d);
      if (!c.dim && c.d === value.d && view.y === value.y && view.mo === value.mo)
        b.classList.add('sel');
      const date = { y: c.y, mo: c.mo, d: c.d };
      const ok = validDate(c.y, c.mo, c.d) &&
        cmpDate(date, min) >= 0 && cmpDate(date, max) <= 0;
      b.disabled = !ok;
      b.setAttribute('aria-label', `${c.d} ${MONTHS[c.mo - 1]} ${astroToEra(c.y).yy} ${astroToEra(c.y).era.toUpperCase()}`);
      if (ok) b.addEventListener('click', () => { closeDatePicker(); onPick(date); });
      grid.append(b);
    }
    panel.append(grid);

    if (opts.time) {
      // Time steppers: the unified input types time, the popup steps it.
      const t = opts.time;
      const trow = document.createElement('div');
      trow.className = 'dpick-time';
      trow.setAttribute('role', 'group');
      trow.setAttribute('aria-label', 'Time');
      const valSpans = {};
      const defs = [['hh', 23, 'Hour'], ['mi', 59, 'Min']];
  defs.push(['ss', 59, 'Sec']);
      for (const [key, mx, label] of defs) {
        const step = document.createElement('span');
        step.className = 'tstep';
        const lab = document.createElement('span');
        lab.className = 'tlab'; lab.textContent = label;
        const ctl = document.createElement('span');
        ctl.className = 'tctl';
        const dn = document.createElement('button');
        dn.type = 'button'; dn.className = 'tbtn'; dn.textContent = '\u2212';
        dn.setAttribute('aria-label', `Decrease ${label}`);
        const val = document.createElement('span');
        val.className = 'tval';
        val.textContent = String(t[key]).padStart(2, '0');
        valSpans[key] = val;
        const up = document.createElement('button');
        up.type = 'button'; up.className = 'tbtn'; up.textContent = '+';
        up.setAttribute('aria-label', `Increase ${label}`);
        const nudge = dir => {
          t[key] = (t[key] + dir + mx + 1) % (mx + 1);
          // The app commits (possibly clamped by the search-range bounds)
          // and writes the committed values back into t.
          t.onTime({ hh: t.hh, mi: t.mi, ss: t.ss });
          for (const [k2] of defs) valSpans[k2].textContent = String(t[k2]).padStart(2, '0');
        };
        dn.addEventListener('click', () => nudge(-1));
        up.addEventListener('click', () => nudge(1));
        ctl.append(dn, val, up);
        step.append(lab, ctl);
        trow.append(step);
      }
      panel.append(trow);
    }
  }

  render();
  document.body.append(panel);
  openPanel = panel;

  // Position below the anchor; flip above if there is no room.
  const r = anchor.getBoundingClientRect();
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}
