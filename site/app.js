// app.js — Astroweb
// Runs the Swiss Ephemeris C library (compiled to WebAssembly) in the browser.
// Ephemeris data files (.se1) are fetched on demand from
// https://github.com/aloistr/swisseph/tree/master/ephe and cached in
// IndexedDB, mirroring the file-naming logic of swi_gen_filename() in swephlib.c.

import { migrateEpheCache, epheGet, ephePut } from './ephe-store.js';
import { renderChartSVG, renderChartSVGMobile, getLastChartDebug,
         CHART_STYLE_SECTIONS, defaultChartStyle, resolveChartStyle } from './chart.js';
import { jdFromCal, calFromJd, JD_UNIX_EPOCH, stationsAround, syzygiesAround } from './search.js';
import {
  BCE_MIN_ASTRO, CE_MAX_YEAR, eraToAstro, astroToEra, checkYearRange,
  validDate, daysInMonth, fmtInstant, lmtOffsetHours,
  cmpDate,
} from './dateapi.js';
import { openDatePicker } from './datepicker.js';
import { attachDateTime, clampDT, cmpDT, dtFloor, dtCeil } from './datetime.js';
import { fmtLon, fmtCoord, fmtSignPos, readAngleFmt, writeAngleFmt, rowsToCSV, gotoButtonHTML,
  readGlyphsPref, writeGlyphsPref, readAngleMode, writeAngleMode } from './format.js';
import { parseShareHashString, shareLink } from './share.js';
import { tableRows, buildTableHTML, speedIndicatorHTML, angleRows } from './table.js';
import { computeLots, buildLotsHTML, readLotOptions, writeLotOptions, sunAltitudeDeg,
  computeCatalogLots, buildCatalogHTML, buildCatalogSelectedHTML, readCatalogSelection, writeCatalogSelection } from './lots.js';
import {
  buildSyzygyHTML, buildLordshipHTML, readDignityOpts, writeDignityOpts,
} from './dignities.js';
import { epheFile, computeChart, createEpheClient, validateEphOut, ephProvider } from './ephe.js';
import { createSearchUI } from './search-ui.js';
import { loadSavedLocation, createLocationUI } from './location.js';
import { skipFields } from './skip.js';
import { createClock } from './clock.js';
import { createAnimation } from './animation.js';
import { nearestCity } from './cities.js';

// Storage handle with lazy access: referencing localStorage directly at
// module scope throws in storage-less contexts (e.g. sandboxed iframes).
// Every consumer wraps calls in try/catch.
const safeStorage = {
  getItem: (...a) => localStorage.getItem(...a),
  setItem: (...a) => localStorage.setItem(...a),
};

// JD of 0001-01-01 00:00 UTC: BCE/CE boundary for Moshier gating.
const JD_1CE = jdFromCal(1, 1, 1, 0);
// Millisecond instant of 12999 BCE-01-01 (share-link floor).
const BCE_MIN_MS = (jdFromCal(BCE_MIN_ASTRO, 1, 1, 0) - JD_UNIX_EPOCH) * 86400000;

// Mobile viewport: use the big-glyph outside layout (no degree tokens).
const isMobileChart = () => window.matchMedia('(max-width: 640px)').matches;
const renderChart = (out, opts) => isMobileChart()
  ? renderChartSVGMobile(out, opts)
  : renderChartSVG(out, opts);

// ---------------------------------------------------------------------------
// Formatting.
// Angle display format: 'dms' (12°34′56″) or 'dec' (12.5822°). Persisted;
// the storage handle is injected so the logic stays testable outside the browser.
let angleFmt = readAngleFmt(safeStorage);

// Table display preferences (persisted): glyphs instead of names, and
// angle size full/compact. The effective format folds the size choice
// into the dms variant; state always carries precise decimals.
let glyphsOn = readGlyphsPref(safeStorage);
let angleMode = readAngleMode(safeStorage);
const effFmt = () => angleFmt === 'dec' ? 'dec' : (angleMode === 'compact' ? 'compact' : 'dms');

// Hermetic-lot tradition variants (Valens/Ptolemy options in the Table
// tab). Persisted like the angle format.
let lotsOpts = readLotOptions(safeStorage);

// Hellenistic catalog: which attested names are displayed (persisted),
// and the prenatal syzygy longitude once the extras scan has run.
let catalogSelection = readCatalogSelection(safeStorage);
/** @type {number|null} */
let lastSyzygyLon = null;

// Decan method for the dignity columns / lordship deep dive. Persisted.
let digOpts = readDignityOpts(safeStorage);

// Last WASM module + engine, kept so the table extras (prev/next
// stations, lunations) can scan around the chart instant.
let lastMod = null, lastUseSwiss = true;
let extrasToken = 0, extrasJd = NaN;
let lordsSectShown = null;

// Dignity options for a chart: the persisted decan method plus day/night
// from the Sun's true altitude (drives Dorothean triplicity primaries).
function digFull(out) {
  const isDay = lastInp && lastInstantMs != null
    ? sunAltitudeDeg(out, lastInstantMs, lastInp.lat, lastInp.lon) > 0
    : true;
  return { decan: digOpts.decan, isDay };
}

// Chart style customization (radii, glyph sizes, aspect line width).
// Overrides only; merged over chart.js defaults on every render.
const CSTYLE_KEY = 'astroweb-chart-style';
let chartStyleOverrides = {};
try {
  const raw = localStorage.getItem(CSTYLE_KEY);
  if (raw) chartStyleOverrides = JSON.parse(raw) || {};
} catch (e) {}
const chartStyle = () => resolveChartStyle(chartStyleOverrides);
const chartOpts = () => ({ angleFmt, style: chartStyle() });

// UI wiring.
const $ = id => document.getElementById(id);

function log(msg) {
  const el = $('log');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function buildTzOptions() {
  const sel = $('tz');
  const localMin = -new Date().getTimezoneOffset(); // minutes east of UTC
  for (let m = -12 * 60; m <= 14 * 60; m += 15) {
    if (m > -12 * 60 && m < 14 * 60 && m % 30 !== 0 && m % 45 !== 0) continue;
    const sign = m < 0 ? '-' : '+';
    const hh = String(Math.floor(Math.abs(m) / 60)).padStart(2, '0');
    const mm = String(Math.abs(m) % 60).padStart(2, '0');
    const label = m === 0 ? 'UTC\u00B100:00' : `UTC${sign}${hh}:${mm}`;
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = label;
    if (m === localMin) opt.selected = true;
    sel.appendChild(opt);
  }
}

// Hand-rolled date/time field groups (BCE-capable; the native
// datetime-local picker cannot represent years before 0001).
// Group `p` is p-y, p-era, p-mo, p-d, p-h, p-mi, plus p-s when `seconds`.
// Returns astronomical years (y = 0 is 1 BCE).
function readDateFields(p, seconds) {
  const num = (id, label) => {
    const v = $(id).value.trim();
    if (!/^-?\d+$/.test(v)) throw new Error(`${label} is incomplete`);
    return parseInt(v, 10);
  };
  const y = eraToAstro(num(`${p}-y`, 'year'), $(`${p}-era`).value);
  checkYearRange(y);
  const mo = num(`${p}-mo`, 'month'), d = num(`${p}-d`, 'day');
  const hh = num(`${p}-h`, 'hour'), mi = num(`${p}-mi`, 'minute');
  const ss = seconds ? num(`${p}-s`, 'second') : 0;
  if (mo < 1 || mo > 12) throw new Error('month must be 1-12');
  if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss > 59)
    throw new Error(seconds ? 'time must be 00:00:00-23:59:59' : 'time must be 00:00-23:59');
  if (!validDate(y, mo, d)) {
    // The cutover gap gets its own message: those dates never existed.
    if (y === 1582 && mo === 10 && d >= 5 && d <= 14)
      throw new Error('1582-10-05 through 1582-10-14 never existed (Julian-to-Gregorian cutover)');
    throw new Error('day is out of range for that month');
  }
  return { y, mo, d, hh, mi, ss };
}

// Write back; only touches fields whose value actually changed, so the live
// clock ticking every second doesn't fight the user mid-edit.
function writeDateFields(p, f, seconds) {
  const { yy, era } = astroToEra(f.y);
  const set = (id, v) => { const el = $(id); v = String(v); if (el.value !== v) el.value = v; };
  set(`${p}-y`, yy);
  const eraEl = $(`${p}-era`);
  if (eraEl.value !== era) eraEl.value = era;
  set(`${p}-mo`, f.mo); set(`${p}-d`, f.d);
  set(`${p}-h`, f.hh); set(`${p}-mi`, f.mi);
  if (seconds) set(`${p}-s`, f.ss);
  refreshDTInput(p);
}

// ---- Unified date+time inputs ----
// Each date group shows one typable text field ("28 Sep 2026 CE 14:30:00")
// with native-picker-like segments (see datetime.js) plus a calendar button
// opening the popup. The y/era/mo/d/h/mi/s inputs are hidden but keep their
// ids, so readDateFields/writeDateFields and all validation are unchanged;
// the text field commits through setHiddenDateTime, which dispatches the
// same change events the old visible fields used to fire.

// Full {y, mo, d, hh, mi, ss} (astronomical y) from a group's hidden
// inputs, or null when any field is incomplete.
function groupValue(p, seconds) {
  const num = id => {
    const v = $(id).value.trim();
    return /^\d+$/.test(v) ? parseInt(v, 10) : null;
  };
  const yy = num(`${p}-y`), mo = num(`${p}-mo`), d = num(`${p}-d`);
  const hh = num(`${p}-h`), mi = num(`${p}-mi`);
  const ss = seconds ? num(`${p}-s`) : 0;
  const era = $(`${p}-era`).value;
  if (yy === null || mo === null || d === null ||
      hh === null || mi === null || ss === null) return null;
  try { return { y: eraToAstro(yy, era), mo, d, hh, mi, ss }; }
  catch (e) { return null; }
}

// {y, mo, d} (astronomical y) from a group's hidden inputs, or null.
function dateGroupValue(p) {
  const num = id => {
    const v = $(id).value.trim();
    return /^\d+$/.test(v) ? parseInt(v, 10) : null;
  };
  const yy = num(`${p}-y`), mo = num(`${p}-mo`), d = num(`${p}-d`);
  const era = $(`${p}-era`).value;
  if (yy === null || mo === null || d === null) return null;
  try { return { y: eraToAstro(yy, era), mo, d }; }
  catch (e) { return null; }
}

const dtInputs = {}; // p -> attachDateTime api

function refreshDTInput(p) {
  const api = dtInputs[p];
  if (api) api.refresh();
}

// Write the canonical hidden inputs, dispatching change on each field that
// actually changed (drives deriveTimezone and the BCE LMT note).
function setHiddenDateTime(p, v, seconds) {
  const { yy, era } = astroToEra(v.y);
  const vals = {
    y: String(yy), era, mo: String(v.mo), d: String(v.d),
    h: String(v.hh), mi: String(v.mi),
  };
  if (seconds) vals.s = String(v.ss);
  for (const k of Object.keys(vals)) {
    const el = $(`${p}-${k}`);
    if (!el) continue;
    if (el.value !== vals[k]) {
      el.value = vals[k];
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

// Commit a datetime from the unified input or the popup time steppers:
// sanitize into the global range, then write through. For search ranges
// (forward-only) an edit that would cross the paired endpoint is rejected
// outright — like the popup's disabled days/era option, prevention beats
// clamping to the boundary.
function commitGroupDT(p, f, seconds) {
  let v = { ...f };
  v.y = Number.isFinite(v.y) ? Math.trunc(v.y) : new Date().getFullYear();
  v.y = Math.max(BCE_MIN_ASTRO, Math.min(CE_MAX_YEAR, v.y));
  v.mo = Number.isFinite(v.mo) ? Math.max(1, Math.min(12, Math.trunc(v.mo))) : 1;
  v.hh = Number.isFinite(v.hh) ? Math.max(0, Math.min(23, Math.trunc(v.hh))) : 0;
  v.mi = Number.isFinite(v.mi) ? Math.max(0, Math.min(59, Math.trunc(v.mi))) : 0;
  v.ss = Number.isFinite(v.ss) ? Math.max(0, Math.min(59, Math.trunc(v.ss))) : 0;
  v.d = Number.isFinite(v.d) ? Math.trunc(v.d) : 1;
  v.d = Math.max(1, Math.min(v.d, daysInMonth(v.y, v.mo)));
  if (v.y === 1582 && v.mo === 10 && v.d >= 5 && v.d <= 14) v.d = 4;
  v = clampDT(v, dtFloor(), dtCeil());
  const b = pickerDTBounds(p);
  const crosses = (b.min && cmpDT(v, b.min) < 0) || (b.max && cmpDT(v, b.max) > 0);
  if (crosses) {
    const cur0 = groupValue(p, seconds);
    const wasOk = cur0 &&
      !(b.min && cmpDT(cur0, b.min) < 0) && !(b.max && cmpDT(cur0, b.max) > 0);
    if (wasOk) return; // reject the edit; keep the current value
    v = clampDT(v, b.min, b.max); // already invalid (programmatic): pull back in
  }
  setHiddenDateTime(p, v, seconds);
}

// Set a group's date (astronomical y), keeping its time-of-day, and notify
// the change listeners that the old visible fields used to reach.
function setGroupDate(p, y, mo, d) {
  const seconds = !!$(`${p}-s`);
  const cur = groupValue(p, seconds) || { hh: 0, mi: 0, ss: 0 };
  setHiddenDateTime(p, { y, mo, d, hh: cur.hh, mi: cur.mi, ss: cur.ss }, seconds);
  refreshDTInput(p);
}

const RANGE_PAIRS = [['asp-start', 'asp-end'], ['stn-start', 'stn-end'], ['ing-start', 'ing-end']];

// Searches scan forward only: the start date never passes the end date.
// When one side moves past the other, the other side's date follows
// (its time-of-day is kept). The pickers additionally clamp navigation
// to [start, end], so this is the backstop for programmatic changes.
function enforceRangePair(changed) {
  for (const [sp, ep] of RANGE_PAIRS) {
    if (changed !== sp && changed !== ep) continue;
    const s = dateGroupValue(sp), e = dateGroupValue(ep);
    if (!s || !e || cmpDate(s, e) <= 0) continue;
    const src = changed === sp ? s : e;
    setGroupDate(changed === sp ? ep : sp, src.y, src.mo, src.d);
  }
}

function pickerBounds(p) {
  for (const [sp, ep] of RANGE_PAIRS) {
    if (p === sp) return { min: null, max: dateGroupValue(ep) };
    if (p === ep) return { min: dateGroupValue(sp), max: null };
  }
  return { min: null, max: null }; // main chart: the global floor/ceiling
}

// Full-datetime bounds for the unified input's capping: the edited side
// can never cross the paired endpoint's instant.
function pickerDTBounds(p) {
  for (const [sp, ep] of RANGE_PAIRS) {
    if (p === sp) return { min: null, max: groupValue(ep, false) };
    if (p === ep) return { min: groupValue(sp, false), max: null };
  }
  return { min: null, max: null };
}

function openGroupPicker(p) {
  const seconds = p === 'dt';
  const g = groupValue(p, seconds);
  const now = new Date();
  const cur = g || {
    y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(),
    hh: 0, mi: 0, ss: 0,
  };
  const { min, max } = pickerBounds(p);
  const t = { hh: cur.hh, mi: cur.mi, ss: cur.ss, seconds };
  t.onTime = nt => {
    const gg = groupValue(p, seconds) || cur;
    commitGroupDT(p, { ...gg, hh: nt.hh, mi: nt.mi, ss: nt.ss }, seconds);
    // The commit may have capped at the paired endpoint: write the
    // committed values back so the steppers show the truth.
    const back = groupValue(p, seconds) || gg;
    t.hh = back.hh; t.mi = back.mi; t.ss = back.ss;
    refreshDTInput(p);
  };
  openDatePicker($(`${p}-in`), {
    value: { y: cur.y, mo: cur.mo, d: cur.d }, min, max,
    time: t,
    onPick: date => {
      setGroupDate(p, date.y, date.mo, date.d);
      enforceRangePair(p);
    },
  });
}

function initDateTimeInputs() {
  for (const p of ['dt', 'asp-start', 'asp-end', 'stn-start', 'stn-end', 'ing-start', 'ing-end']) {
    const input = $(`${p}-in`);
    if (!input) continue;
    const seconds = p === 'dt';
    dtInputs[p] = attachDateTime(input, {
      seconds,
      get: () => groupValue(p, seconds),
      set: (f, seg) => commitGroupDT(p, f, seconds),
      openPicker: () => openGroupPicker(p),
    });
    $(`${p}-cal`).addEventListener('click', () => openGroupPicker(p));
    refreshDTInput(p);
  }
}

// Test seams for the E2E harness. __trigonSetDate keeps the date-only path
// (hidden inputs + range follow) the popup uses; __trigonSetTime sets the
// time fields; __trigonSetDateTime sets both with the input's cap semantics.
// Any of yy/era/mo/d may be '' to clear the group.
window.__trigonSetDate = (p, yy, era, mo, d) => {
  if (yy === '' || era === '' || mo === '' || d === '') {
    $(`${p}-y`).value = yy; $(`${p}-era`).value = era || 'ce';
    $(`${p}-mo`).value = mo; $(`${p}-d`).value = d;
    refreshDTInput(p);
    return;
  }
  setGroupDate(p, eraToAstro(parseInt(yy, 10), era), parseInt(mo, 10), parseInt(d, 10));
  enforceRangePair(p);
};

window.__trigonSetTime = (p, hh, mi, ss) => {
  const seconds = !!$(`${p}-s`);
  const g = groupValue(p, seconds) ||
    { y: new Date().getFullYear(), mo: 1, d: 1, hh: 0, mi: 0, ss: 0 };
  setHiddenDateTime(p, {
    ...g,
    hh: Math.max(0, Math.min(23, hh | 0)),
    mi: Math.max(0, Math.min(59, mi | 0)),
    ss: seconds ? Math.max(0, Math.min(59, (ss == null ? 0 : ss) | 0)) : 0,
  }, seconds);
  refreshDTInput(p);
};

window.__trigonSetDateTime = (p, yy, era, mo, d, hh, mi, ss) => {
  const seconds = !!$(`${p}-s`);
  commitGroupDT(p, {
    y: eraToAstro(parseInt(yy, 10), era),
    mo: parseInt(mo, 10), d: parseInt(d, 10),
    hh: parseInt(hh, 10), mi: parseInt(mi, 10),
    ss: seconds && ss != null ? parseInt(ss, 10) : 0,
  }, seconds);
  refreshDTInput(p);
};

window.__trigonRefresh = p => refreshDTInput(p);

function readInputs(utcMs = null) {
  const lat = parseFloat($('lat').value);
  const lon = parseFloat($('lon').value);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('latitude must be -90..90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('longitude must be -180..180');
  let y, mo, d, hourUT, stampMs;
  if (utcMs != null) {
    // Exact instant (astrological clock / share link): full precision, no
    // picker or timezone interpretation. Decomposed via calFromJd — Date's
    // getters are proleptic Gregorian and skew pre-1582 dates.
    if (!Number.isFinite(utcMs)) throw new Error('time is not available');
    const c = calFromJd(JD_UNIX_EPOCH + utcMs / 86400000);
    y = c.y; mo = c.mo; d = c.d; hourUT = c.hourUT;
    stampMs = utcMs;
  } else {
    const f = readDateFields('dt', true);
    y = f.y; mo = f.mo; d = f.d;
    const wallH = f.hh + f.mi / 60 + f.ss / 3600;
    if (y < 1) {
      // BCE: wall time is local mean time at the site longitude. Time zones
      // are meaningless this far back, so the tz select is disabled for BCE.
      hourUT = wallH - lmtOffsetHours(lon);
    } else {
      const tzMin = parseInt($('tz').value, 10);
      if (!Number.isFinite(tzMin)) throw new Error('timezone is not selected');
      hourUT = wallH - tzMin / 60;
    }
    // jdFromCal is linear in the hour: out-of-range hours (LMT shifts,
    // negative offsets) roll into neighboring days.
    stampMs = (jdFromCal(y, mo, d, hourUT) - JD_UNIX_EPOCH) * 86400000;
  }
  return { y, mo, d, hourUT, lat, lon, utcMs: stampMs, bce: y < 1,
           gregorian: (y > 1582 || (y === 1582 && (mo > 10 || (mo === 10 && d >= 15)))) };
}

// Last rendered results, so the angle-format toggle can re-render in place.
let lastOut = null, lastMeta = '', lastInstantMs = null;
let lastInp = null;                 // last chart input {jd, lat, lon, ...}
let skyUI = null;
// Shared Sky init promise: concurrent callers (tab switch, retrograde
// animate) all await the same load instead of racing a boolean flag.
let skyLoadPromise = null;

function setAngleFmt(f) {
  if (f !== 'dms' && f !== 'dec') return;
  angleFmt = f;
  writeAngleFmt(safeStorage, f);
  if (lastOut) renderResults(lastOut, lastMeta);
}

// Lots option toggles: one delegated listener (the section is rebuilt on
// every render and live tick, so per-node wiring would not survive).
// Catalog filter: name-level matching, empty groups collapse. Rules are
// visible in the UI: the placeholder names the searchable fields.
$('panel-table').addEventListener('input', e => {
  const t = e.target;
  if (!t.classList || !t.classList.contains('cat-filter')) return;
  const q = t.value.trim().toLowerCase();
  document.querySelectorAll('#panel-table .cat-group').forEach(g => {
    let any = false;
    g.querySelectorAll('.cat-row').forEach(r => {
      const show = !q || r.dataset.search.includes(q);
      r.style.display = show ? '' : 'none';
      if (show) any = true;
    });
    g.style.display = any ? '' : 'none';
  });
});

// Datetimes in the Table tab (station cells, lunation instants) are
// clickable chart-generators, same as the search-result dates: one
// delegated handler for every [data-goto-jd] button in the panel.
$('panel-table').addEventListener('click', e => {
  const b = e.target.closest('button[data-goto-jd]');
  if (b) gotoSearchInstant(parseFloat(b.dataset.gotoJd));
});

$('panel-table').addEventListener('change', e => {
  const t = e.target;
  if (t.classList && t.classList.contains('cat-sel')) {
    const id = t.dataset.id;
    catalogSelection = t.checked
      ? [...catalogSelection, id]
      : catalogSelection.filter(x => x !== id);
    writeCatalogSelection(safeStorage, catalogSelection);
    refreshCatalogAndLords();
    return;
  }
  if (t.classList && t.classList.contains('decan-method')) {    digOpts = { decan: t.value === 'indian' ? 'indian' : 'chaldean' };
    writeDignityOpts(safeStorage, digOpts);
    if (lastOut) renderResults(lastOut, lastMeta);
    return;
  }
  if (!t.classList || !t.classList.contains('lots-opt')) return;
  lotsOpts = { ...lotsOpts, [t.dataset.opt]: t.checked };
  writeLotOptions(safeStorage, lotsOpts);
  const el = document.querySelector('#panel-table #lots-section');
  if (el && lastOut && lastInp && lastInstantMs != null) {
    el.outerHTML = buildLotsHTML(
      computeLots(lastOut, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts), effFmt(), lotsOpts);
  }
});

// CSV download buttons above output tables (rendered by table.js, lots.js,
// search-ui.js inside .csv-block wrappers): serialize the table's visible
// text to a CSV file. Cell buttons (e.g. goto dates) contribute their text.
document.addEventListener('click', e => {
  const b = e.target.closest('.csv-btn');
  if (!b) return;
  const tbl = b.closest('.csv-block')?.querySelector('table');
  if (!tbl) return;
  const rows = [...tbl.querySelectorAll('tr')].map(tr =>
    [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim().replace(/\s+/g, ' ')));
  // Speed percentile dots carry no text: expand them into percentile +
  // sigma (z-score) columns right after the Speed column, from the dot's
  // data-pct/data-z attributes (node rows get empty cells).
  const spdCol = rows.length ? rows[0].indexOf('Speed') : -1;
  if (spdCol >= 0 && tbl.querySelector('.spdind')) {
    const trs = [...tbl.querySelectorAll('tr')];
    rows.forEach((cells, ri) => {
      const dot = ri > 0 ? trs[ri].querySelector('.spdind') : null;
      cells.splice(spdCol + 1, 0,
        ri === 0 ? 'Speed percentile' : (dot ? dot.dataset.pct : ''),
        ri === 0 ? 'Speed sigma (z)' : (dot ? dot.dataset.z : ''));
    });
  }
  const blob = new Blob([rowsToCSV(rows)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = b.dataset.csvName || 'trigon.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// Result views: table/chart hold the last calculation; aspects/stations are
// independent searches. The tab bar is persistent; the selection sticks
// across recalculations within the session.
const TABS = ['table', 'chart', 'aspects', 'stations', 'ingresses', 'sky'];
let activeTab = 'table';

function setTab(t) {
  if (!TABS.includes(t)) return;
  activeTab = t;
  document.querySelectorAll('#views .tabs button')
    .forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  for (const k of TABS) $('panel-' + k).style.display = k === t ? '' : 'none';
  if (t === 'sky') {
    ensureSky().then(() => {
      if (activeTab === 'sky' && skyUI) { skyUI.setVisible(true); skyUI.onEphemeris(); }
    });
  } else if (skyUI) {
    skyUI.setVisible(false);
  }
}

// Sky tab: lazily import the viewer (and three.js) on first open, then hand
// it the live ephemeris state. The star catalogue downloads once and is
// cached in IndexedDB like the Swiss .se1 files.
async function ensureSky() {
  if (skyUI) return;
  if (!skyLoadPromise) {
    skyLoadPromise = (async () => {
      try {
        const mod = await import('./sky.js');
        skyUI = mod.createSkyUI({
          getEphemeris: () => (lastOut && lastInp && lastInstantMs != null)
            ? { out: lastOut, inp: lastInp, utcMs: lastInstantMs } : null,
          store: { get: epheGet, put: ephePut },
          setLoading: label => {
            const el = $('sky-loading');
            if (label) { el.textContent = label; el.style.display = 'flex'; }
            else el.style.display = 'none';
          },
          log: msg => log('sky: ' + msg),
        });
        $('sky-hint').style.display = 'none';
        $('sky-wrap').style.display = '';
        await skyUI.ensureInit();
      } catch (e) {
        skyUI = null;
        $('sky-wrap').style.display = 'none';
        $('sky-hint').style.display = '';
        $('sky-hint').textContent = 'Sky view failed to load: ' + (e && e.message ? e.message : e);
        skyLoadPromise = null; // allow a later retry
      }
    })();
  }
  return skyLoadPromise;
}

// Loading animation: shown only while uncached data downloads (WASM engine
// first load, ephemeris .se1 files). An SVG glyph that melts through the
// twelve zodiac signs: at each transition a turbulence/displacement filter
// peaks while the glyph blurs, scales and cross-swaps mid-morph.
// Zodiac glyphs in order, colored by element like the chart wheel.
const MORPH_GLYPHS = ['\u2648', '\u2649', '\u264A', '\u264B', '\u264C', '\u264D',
                      '\u264E', '\u264F', '\u2650', '\u2651', '\u2652', '\u2653'];
const MORPH_COLORS = ['#ff7b72', '#e3b341', '#79c0ff', '#a371f7']; // fire, earth, air, water
const TVS2 = '\uFE0E'; // text presentation, matching the chart
let loaderGen = 0, loaderRAF = 0, loaderArmed = false;

function loaderHTML(label) {
  return `<div class="loader" id="loader" role="status" aria-live="polite">`
    + `<svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true">`
    + `<defs><filter id="lmorph" x="-40%" y="-40%" width="180%" height="180%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/>`
    + `</filter></defs>`
    + `<circle class="orbit" cx="60" cy="60" r="46" fill="none" stroke="#30363d" stroke-width="1.5" stroke-dasharray="4 10" stroke-linecap="round"/>`
    + `<g filter="url(#lmorph)"><text id="lglyph" x="60" y="79" text-anchor="middle" font-size="52" fill="${MORPH_COLORS[0]}"`
    + ` font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">${MORPH_GLYPHS[0]}${TVS2}</text></g>`
    + `</svg><div class="load-label" id="load-label">${label}</div></div>`;
}

function setGlyph(el, i) {
  el.textContent = MORPH_GLYPHS[i] + TVS2;
  el.setAttribute('fill', MORPH_COLORS[i % 4]);
}

function morphFrame(el, disp, s) {
  disp.setAttribute('scale', (22 * s).toFixed(2));
  el.style.filter = s > 0.01 ? `blur(${(6 * s).toFixed(2)}px)` : '';
  el.style.opacity = (1 - 0.3 * s).toFixed(3);
  el.style.transform = `scale(${(1 - 0.12 * s).toFixed(4)})`;
}

// One morph cycle per glyph: hold crisp, then melt into the next sign.
function morphLoop(gen, idx) {
  if (gen !== loaderGen) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = reduce ? 900 : 550, MORPH = reduce ? 0 : 450;
  const t0 = performance.now();
  let swapped = false;
  const frame = now => {
    if (gen !== loaderGen) return;
    const el = document.getElementById('lglyph');
    if (!el) return; // card was replaced; stop quietly
    const t = now - t0;
    if (MORPH > 0 && t >= HOLD) {
      const q = Math.min(1, (t - HOLD) / MORPH);
      if (!swapped && q >= 0.5) { swapped = true; setGlyph(el, (idx + 1) % 12); }
      morphFrame(el, document.querySelector('#lmorph feDisplacementMap'), Math.sin(Math.PI * q));
    }
    if (t < HOLD + MORPH) loaderRAF = requestAnimationFrame(frame);
    else morphLoop(gen, (idx + 1) % 12);
  };
  loaderRAF = requestAnimationFrame(frame);
}

function showLoader(label) {
  if (document.getElementById('loader')) {
    const lb = document.getElementById('load-label');
    if (lb && label) lb.textContent = label;
    return;
  }
  setTab('table'); // the download belongs to the chart calculation
  const el = $('panel-table');
  el.innerHTML = loaderHTML(label);
  morphLoop(++loaderGen, 0);
}

function hideLoader() {
  loaderGen++;
  if (loaderRAF) { cancelAnimationFrame(loaderRAF); loaderRAF = 0; }
}

// Customize-chart panel: free-form numeric inputs generated from the
// chart.js style descriptors (arbitrary sizes, no caps).
// Any positive finite value is accepted; anything else reverts to the
// current value. Overrides persist in localStorage; changes re-render the
// wheel SVG in place (the details element is untouched, so it stays open).
function styleParam(sec, key) {
  return CHART_STYLE_SECTIONS.find(s => s.id === sec).params.find(q => q.key === key);
}
function buildChartStyleHTML() {
  const st = chartStyle();
  let h = '<details class="chart-style"><summary>Customize chart</summary>';
  for (const sec of CHART_STYLE_SECTIONS) {
    h += `<div class="cs-sec"><h4>${sec.title}</h4>`;
    for (const p of sec.params) {
      const v = st[sec.id][p.key];
      h += `<label class="cs-row"><span class="cs-lab"${p.hint ? ` title="${p.hint}"` : ''}>${p.label}</span>`
        + `<input type="number" step="${p.step}" value="${v}"`
        + ` data-sec="${sec.id}" data-key="${p.key}" aria-label="${sec.title}: ${p.label}">`
        + `</label>`;
    }
    h += '</div>';
  }
  h += '<button id="cs-reset" class="ghost" type="button">Reset to defaults</button></details>';
  return h;
}
// Returns the parsed value, or null when the raw text is not acceptable
// (the caller reverts the input then). Params with allowZero (e.g. the
// label-separation multiplier) accept 0; everything else needs v > 0.
function parseStyleNum(raw, allowZero) {
  const v = parseFloat(raw);
  return (Number.isFinite(v) && (v > 0 || (v === 0 && allowZero))) ? v : null;
}
function setChartStyleOverride(sec, key, v) {
  const def = defaultChartStyle()[sec][key];
  if (!chartStyleOverrides[sec]) chartStyleOverrides[sec] = {};
  if (v === def) delete chartStyleOverrides[sec][key];
  else chartStyleOverrides[sec][key] = v;
  if (!Object.keys(chartStyleOverrides[sec]).length) delete chartStyleOverrides[sec];
  try { localStorage.setItem(CSTYLE_KEY, JSON.stringify(chartStyleOverrides)); } catch (e) {}
}
function rerenderChartSVG() {
  if (!lastOut) return;
  const svg = renderChart(lastOut, chartOpts());
  lastChartSVG = svg;
  const wrap = document.querySelector('#panel-chart .chart-wrap');
  if (wrap) wrap.innerHTML = svg;
}
function wireChartStyle(root) {
  const det = root.querySelector('.chart-style');
  if (!det) return;
  det.querySelectorAll('input[type=number]').forEach(inp => {
    // 'change' (not 'input'): re-render once per committed edit, and an
    // invalid entry reverts instead of clamping.
    inp.addEventListener('change', () => {
      const v = parseStyleNum(inp.value, styleParam(inp.dataset.sec, inp.dataset.key).allowZero);
      if (v == null) { inp.value = chartStyle()[inp.dataset.sec][inp.dataset.key]; return; }
      inp.value = v;
      setChartStyleOverride(inp.dataset.sec, inp.dataset.key, v);
      rerenderChartSVG();
    });
  });
  det.querySelector('#cs-reset').addEventListener('click', () => {
    chartStyleOverrides = {};
    try { localStorage.removeItem(CSTYLE_KEY); } catch (e) {}
    det.querySelectorAll('input[type=number]').forEach(inp => {
      inp.value = styleParam(inp.dataset.sec, inp.dataset.key).def;
    });
    rerenderChartSVG();
  });
}

function renderResults(out, meta) {
  lastOut = out; lastMeta = meta;
  lastChartSVG = renderChart(out, chartOpts());
  $('views-head').innerHTML =
      `<div class="res-brand"><img class="logo" src="logo.svg" alt="">Trigon</div>`
    + `<div class="meta" style="margin-bottom:4px">${meta}</div>`;
  const dig = digFull(out);
  lordsSectShown = dig.isDay;
  const lotsRes = lastInp && lastInstantMs != null
    ? computeLots(out, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts) : null;
  const catRes = lastInp && lastInstantMs != null
    ? computeCatalogLots(out, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts, catalogSelection, lastSyzygyLon) : null;
  $('panel-table').innerHTML = buildTableHTML(out, effFmt(), dig, { glyphs: glyphsOn, angleMode })
    + buildSyzygyHTML(null)
    + (lotsRes ? buildLotsHTML(lotsRes, effFmt(), lotsOpts) : '')
    + (catRes ? buildCatalogHTML(catRes.values, catalogSelection, effFmt()) : '')
    + buildLordshipHTML(out, [...(lotsRes ? lotsRes.values : []), ...(catRes ? catRes.values.filter(v => v.lon != null) : [])], dig);
  $('panel-chart').innerHTML =
      `<div class="chart-wrap">${lastChartSVG}</div>`
    + `<div class="chart-cap">Whole-sign houses \u00B7 1st house = Ascendant\u2019s sign `
    + `\u00B7 Ptolemaic aspects, 3\u00B0 orb \u00B7 true node axis `
    + `<button id="dbgcopy" class="ghost" type="button" title="Copy chart debug state as JSON">Copy debug</button></div>`
    + buildChartStyleHTML();
  $('views').dataset.ready = '1';
  // Mobile: scroll results into view (input card is above the fold).
  if (window.matchMedia('(max-width: 640px)').matches) {
    requestAnimationFrame(() => $('views').scrollIntoView({ block: 'start' }));
  }
  $('panel-table').querySelectorAll('.seg button').forEach(b =>
    b.addEventListener('click', () => setAngleFmt(b.dataset.fmt)));
  const shareBtn = $('panel-table').querySelector('#share');
  if (shareBtn) shareBtn.addEventListener('click', shareChart);
  const sizeBtn = $('panel-table').querySelector('#size-toggle');
  if (sizeBtn) sizeBtn.addEventListener('click', () => {
    angleMode = angleMode === 'compact' ? 'full' : 'compact';
    writeAngleMode(safeStorage, angleMode);
    renderResults(lastOut, lastMeta);
  });
  const glyphBtn = $('panel-table').querySelector('#glyph-toggle');
  if (glyphBtn) glyphBtn.addEventListener('click', () => {
    glyphsOn = !glyphsOn; writeGlyphsPref(safeStorage, glyphsOn);
    renderResults(lastOut, lastMeta);
  });
  const dbgBtn = $('panel-chart').querySelector('#dbgcopy');
  if (dbgBtn) dbgBtn.addEventListener('click', copyDebug);
  wireChartStyle($('panel-chart'));
  maybeRefreshExtras(true);
}

// Rebuild the catalog selected-table and the lordship deep dive from the
// current chart state (selection change, syzygy arrival). The catalog
// browser DOM is left untouched so its scroll and focus survive.
function refreshCatalogAndLords() {
  if (!lastOut || !lastInp || lastInstantMs == null) return;
  const herm = computeLots(lastOut, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts);
  const cat = computeCatalogLots(lastOut, lastInstantMs, lastInp.lat, lastInp.lon,
    lotsOpts, catalogSelection, lastSyzygyLon);
  const selDiv = document.querySelector('#panel-table #catalog-selected');
  if (selDiv) selDiv.innerHTML = buildCatalogSelectedHTML(cat.values, effFmt());
  const lords = document.querySelector('#panel-table #lords-section');
  if (lords) lords.outerHTML = buildLordshipHTML(lastOut,
    [...herm.values, ...cat.values.filter(v => v.lon != null)], digFull(lastOut));
}

// Table extras: prev/next stations (Mercury..Pluto) and the bracketing
// lunations, from an ephemeris scan around the chart instant using the
// same module/engine as the chart itself. Runs synchronously (a few
// hundred WASM evaluations) but is token-guarded so stale passes never
// patch the DOM; live ticks only re-run it once the instant has drifted
// ~30 min from the last pass.
function maybeRefreshExtras(force = false) {
  const jd = lastInstantMs == null ? null : lastInstantMs / 86400000 + JD_UNIX_EPOCH;
  if (jd == null || !lastMod) return;
  if (!force && Number.isFinite(extrasJd) && Math.abs(jd - extrasJd) < 0.02) return;
  extrasJd = jd;
  const tk = ++extrasToken;
  try {
    const eph = ephProvider(lastMod, lastUseSwiss, (1 << 10) - 1);
    try {
      const scan = (jd0, step, n) => {
        const grid = [];
        for (let k = 0; k <= n; k++) {
          const g = jd0 + k * step, s = eph(g);
          grid.push({ jd: g, lon: s.lon, spd: s.spd });
        }
        return grid;
      };
      // Mars sets the window: its station cycle is the longest (the
      // station-to-station gap across a retrograde loop runs ~710 days,
      // vs ~500 or less for every other body), so ±850 days guarantees
      // every body has a station on both sides of the instant.
      const grid = scan(jd - 850, 5, 340);
      const fmtStn = s => s
        ? `${s.type} ${fmtSignPos(s.lon, 'dms', glyphsOn)} ${gotoButtonHTML(s.jd, fmtInstant(s.jd))}` : '—';
      for (let ib = 2; ib <= 9; ib++) {
        const { prev, next } = stationsAround(grid, eph, ib, jd);
        const p = document.querySelector(`#panel-table td.stn-prev[data-ib="${ib}"]`);
        const n = document.querySelector(`#panel-table td.stn-next[data-ib="${ib}"]`);
        if (p) p.innerHTML = fmtStn(prev);
        if (n) n.innerHTML = fmtStn(next);
      }
      const syz = syzygiesAround(scan(jd - 40, 1, 80), eph, jd);
      const el = document.querySelector('#panel-table #syzygy-section');
      if (el && tk === extrasToken) el.outerHTML = buildSyzygyHTML(syz);
      // Feed the prenatal syzygy to the catalog (Syzygy / Ruler Syzygy
      // lots) and rebuild the catalog table + deep dive with it.
      const newSyzLon = syz.prev ? syz.prev.moonLon : null;
      if (tk === extrasToken && newSyzLon !== lastSyzygyLon) {
        lastSyzygyLon = newSyzLon; refreshCatalogAndLords();
      }
    } finally { eph.free(); }
  } catch (e) {
    // Ephemeris unavailable around the instant (e.g. Swiss files for the
    // neighboring era not loaded): the station cells fall back to dashes.
    document.querySelectorAll('#panel-table td.stn-prev, #panel-table td.stn-next')
      .forEach(td => { td.textContent = '—'; });
  }
}

// Share-link codec lives in share.js (14-char packed / readable / BCE
// forms); this is the live-DOM entry point.
function parseShareHash() { return parseShareHashString(location.hash, BCE_MIN_MS); }

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    ta.remove();
    return ok;
  }
}

async function shareChart() {
  const btn = $('share');
  if (lastInstantMs == null) return;
  const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const url = location.origin + location.pathname + shareLink(lat, lon, lastInstantMs);
  const ok = await copyText(url);
  if (btn) {
    const prev = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { const b = $('share'); if (b) b.textContent = prev; }, 1500);
  }
}

// Copy Debug: serialize the last chart render's debug state as JSON.
async function copyDebug() {
  const btn = $('dbgcopy');
  const dbg = getLastChartDebug();
  if (!dbg) {
    if (btn) btn.textContent = 'No chart yet';
    return;
  }
  const payload = {
    meta: {
      stamp: $('meta-stamp') ? $('meta-stamp').textContent : null,
      url: location.href,
      viewport: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio || 1,
    },
    chart: dbg,
  };
  const ok = await copyText(JSON.stringify(payload, null, 1));
  if (btn) {
    const prev = 'Copy debug';
    btn.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { const b = $('dbgcopy'); if (b) b.textContent = prev; }, 1500);
  }
}

// Opening a shared link: set the coordinates, name the nearest gazetteer
// city, align picker and timezone with the shared instant, then compute it.
async function initShare(share) {
  let cityName = null, country = null;
  try {
    await locUI.ensureCities();
    const c = nearestCity(share.lat, share.lon);
    if (c) { cityName = c.name; country = c.country; $('city').value = c.name; }
  } catch (e) { /* gazetteer unavailable: fall back to raw coordinates */ }
  const label = cityName
    ? `Nearest city: ${cityName}, ${country} \u2014 ${fmtCoord(share.lat, share.lon)}`
    : `Shared coordinates \u2014 ${fmtCoord(share.lat, share.lon)}`;
  locUI.setLocation(share.lat, share.lon, label, cityName);
  if (share.utcMs < -62167219200000) {
    // BCE share: Intl has no BCE zones, so restore the wall fields directly
    // as local mean time at the shared longitude.
    const c = calFromJd(share.utcMs / 86400000 + JD_UNIX_EPOCH + share.lon / 15 / 24);
    const s = Math.min(86399, Math.floor(c.hourUT * 3600 + 1e-3));
    writeDateFields('dt', {
      y: c.y, mo: c.mo, d: c.d,
      hh: Math.floor(s / 3600), mi: Math.floor((s % 3600) / 60), ss: s % 60,
    }, true);
    locUI.updateTzForEra();
  } else {
    const z = locUI.getDerivedZone();
    if (z) { clockApi.setDateTimeToInstantInZone(share.utcMs, z); locUI.deriveTimezone(); }
  }
  run(true, { utcMs: share.utcMs });
}

// Live clock fast path: the full renderResults rebuild (innerHTML of the whole
// card) every second is what flickers. Instead update the timestamp text in
// place, diff table cells, and re-render the chart SVG every tick, swapping it
// into the DOM only when the markup actually changed (one atomic assignment,
// never a blank-then-fill).
let lastChartSVG = '';
// Tick rebuild caches: last HTML actually swapped into the lots and
// catalog-selected sections (swap only when the string changes).
let lastLotsHTML = '';
let lastCatSelHTML = '';

function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }

// Speed cell: percentile dot span + .spd-txt span + colored D/R span.
// setText on the cell would set textContent and delete the dot (the bug
// where the indicator vanished on the first live/skip tick), so patch
// each part and refresh the dot's color, tooltip, and CSV data.
function setSpeedCell(td, r) {
  const dot = td.querySelector('.spdind');
  if (dot && r.spdColor) {
    if (dot.style.background !== r.spdColor) dot.style.background = r.spdColor;
    if (dot.title !== r.spdTip) dot.title = r.spdTip;
    const z = `${r.spdZ >= 0 ? '+' : ''}${r.spdZ.toFixed(2)}`;
    if (dot.dataset.pct !== r.spdPct.toFixed(1)) dot.dataset.pct = r.spdPct.toFixed(1);
    if (dot.dataset.z !== z) dot.dataset.z = z;
    setText(td.querySelector('.spd-txt'), r.spdMag);
    const dir = td.querySelector('.direct, .retro');
    if (dir && r.spdDir) {
      const cls = r.spdDir === 'R' ? 'retro' : 'direct';
      if (dir.className !== cls) dir.className = cls;
      if (dir.textContent !== r.spdDir) dir.textContent = r.spdDir;
    }
  } else if (r.spdColor) {
    // Dot missing (shouldn't happen): rebuild the cell content.
    td.textContent = '';
    td.insertAdjacentHTML('afterbegin', speedIndicatorHTML(r));
    td.append(r.spd);
  } else {
    setText(td, r.spd); // node rows: plain dash, no dot
  }
}

function updateLiveResults(out, stamp) {
  setText($('meta-stamp'), 'UTC ' + stamp);
  // Tick DOM work is gated on the panel being the visible tab: patching a
  // display:none subtree still costs style/layout work per second for
  // pixels nobody sees, and the next visible tick patches everything at
  // once (all values are recomputed from `out`, nothing accumulates).
  const tableVisible = $('panel-table').style.display !== 'none';
  const chartVisible = $('panel-chart').style.display !== 'none';
  if (tableVisible) {
  setText(document.querySelector('#panel-table [data-asc]'), fmtLon(out[72], effFmt()));
  setText(document.querySelector('#panel-table [data-mc]'), fmtLon(out[73], effFmt()));
  const trs = document.querySelectorAll('#panel-table tbody tr');
  const dig = digFull(out);
  const rows = tableRows(out, effFmt(), dig, glyphsOn);
  // Longitude cells wrap the sign in an element-color span: patch via
  // innerHTML (built from our own rows, no user text) when changed so the
  // color keeps following ticks. Same for the glowing magnitude cell.
  const setHTML = (td, html) => { if (td && td.__h !== html) { td.innerHTML = html; td.__h = html; } };
  const setCell = (tr, idx, text, color) => {
    const td = tr.children[idx];
    setText(td, text);
    if (color && td.style.color !== color) td.style.color = color;
  };
  for (let i = 0; i < trs.length && i < rows.length; i++) {
    const tr = trs[i], tds = tr.children, r = rows[i];
    setHTML(tds[1], r.lonHtml); setText(tds[2], r.dec); setSpeedCell(tds[3], r);
    setHTML(tds[4], r.magHtml); setText(tds[5], r.house);
    // Dignity cells: text + the lord's planet color (lords move with ticks).
    if (tds.length > 14) {
      const d = r.dign, dc = r.dignCol || {};
      setCell(tr, 8, d ? d.domicile : '—', dc.domicile);
      setCell(tr, 9, d ? d.decan : '—', dc.decan);
      setCell(tr, 10, d ? d.bound : '—', dc.bound);
      setCell(tr, 11, d ? d.trip : '—', dc.trip);
      if (d) tds[11].title = `Triplicity lords: ${d.tripFull}`;
      setCell(tr, 12, d && d.exalt ? d.exalt : '—', dc.exalt);
      setCell(tr, 13, d ? d.d12 : '—', dc.d12);
      setCell(tr, 14, d ? d.d9 : '—', dc.d9);
    }
  }
  // Angle rows close the table (after the 11 body rows).
  const arows = angleRows(out, dig, effFmt(), glyphsOn);
  for (let j = 0; j < arows.length; j++) {
    const tr = trs[rows.length + j];
    if (!tr) break;
    const tds = tr.children, d = arows[j].dign, dc = arows[j].dignCol || {};
    setHTML(tds[1], arows[j].lonHtml);
    if (tds.length > 14) {
      setCell(tr, 8, d ? d.domicile : '—', dc.domicile);
      setCell(tr, 9, d ? d.decan : '—', dc.decan);
      setCell(tr, 10, d ? d.bound : '—', dc.bound);
      setCell(tr, 11, d ? d.trip : '—', dc.trip);
      if (d) tds[11].title = `Triplicity lords: ${d.tripFull}`;
      setCell(tr, 12, d && d.exalt ? d.exalt : '—', dc.exalt);
      setCell(tr, 13, d ? d.d12 : '—', dc.d12);
      setCell(tr, 14, d ? d.d9 : '—', dc.d9);
    }
  }
  } // if (tableVisible) — table/dignity patching
  // Chart: coordinates print at 0.1 px and the Ascendant (the fastest chart
  // element, ~0.02 px/s at the rim) flips the markup about every 5 s. Re-render
  // every tick so the wheel tracks the clock; the DOM swap happens only when
  // the markup changed, so identical seconds cost a string compare, not a
  // re-parse.
  if (chartVisible) {
    const svg = renderChart(out, chartOpts());
    if (svg !== lastChartSVG) {
      const wrap = document.querySelector('#panel-chart .chart-wrap');
      if (wrap) wrap.innerHTML = svg;
      lastChartSVG = svg;
    }
  }
  // Lots move with the Ascendant; rebuild only when the rendered HTML
  // actually changed at display precision (most seconds it has not), so
  // most ticks cost a string build only, not a DOM swap + layout.
  if (tableVisible) {
  const lotsEl = document.querySelector('#panel-table #lots-section');
  if (lotsEl && lastInp && lastInstantMs != null) {
    const lh = buildLotsHTML(
      computeLots(out, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts), effFmt(), lotsOpts);
    if (lh !== lastLotsHTML) { lotsEl.outerHTML = lh; lastLotsHTML = lh; }
  }
  // The selected catalog lots likewise (the browser DOM stays untouched).
  const catSelEl = document.querySelector('#panel-table #catalog-selected');
  if (catSelEl && lastInp && lastInstantMs != null) {
    const ch = buildCatalogSelectedHTML(
      computeCatalogLots(out, lastInstantMs, lastInp.lat, lastInp.lon,
        lotsOpts, catalogSelection, lastSyzygyLon).values, effFmt());
    if (ch !== lastCatSelHTML) { catSelEl.innerHTML = ch; lastCatSelHTML = ch; }
  }
  // The deep dive only changes wholesale at a sect flip (triplicity
  // primaries swap); rebuild it then, not every tick (it also carries
  // the decan-method <select>, which a rebuild would close mid-use).
  const lordsEl = document.querySelector('#panel-table #lords-section');
  if (lordsEl && lastInp && lastInstantMs != null) {
    const dig = digFull(out);
    if (dig.isDay !== lordsSectShown) {
      lordsSectShown = dig.isDay;
      const lr = computeLots(out, lastInstantMs, lastInp.lat, lastInp.lon, lotsOpts);
      const cr = computeCatalogLots(out, lastInstantMs, lastInp.lat, lastInp.lon,
        lotsOpts, catalogSelection, lastSyzygyLon);
      lordsEl.outerHTML = buildLordshipHTML(out,
        [...lr.values, ...cr.values.filter(v => v.lon != null)], dig);
    }
  }
  } // if (tableVisible)
  lastOut = out;
  // Keep the stored meta stamp fresh so a mid-clock format toggle re-renders
  // with the current second; the next tick corrects it regardless.
  lastMeta = lastMeta.replace(/(<span id="meta-stamp">UTC )[^<]*/, '$1' + stamp);
}

// Latest run wins: guards overlapping auto-run/clock/manual calculations.
let runToken = 0;

// ---------------------------------------------------------------------------
async function run(useSwiss, opts = {}) {  const token = ++runToken; // overlapping runs: only the latest renders
  const status = opts.quiet ? () => {} : log;
  $('error').textContent = '';
  $('fallback').style.display = 'none';
  // Skip steps reuse the live-tick patch path when a render already exists:
  // blanking the card would flicker and collapse the page height, which
  // resets the scroll position.
  const patchReuse = opts.skip && $('views').dataset.ready === '1'
                  && $('meta-stamp') && $('panel-table');
  // Live ticks must not blank the card: emptying + rebuilding innerHTML every
  // second is the flicker. Keep the previous render visible until the new one
  // is ready, then patch it in place.
  if (!opts.live && !patchReuse) { $('panel-table').innerHTML = ''; $('panel-chart').innerHTML = ''; delete $('views').dataset.ready; }
  lastOut = null;
  // The loader appears only while uncached data downloads (never on quiet
  // live ticks): fetchEphe/ensureWasm show it on a cache miss.
  loaderArmed = !opts.live;
  let inp;
  try {
    inp = readInputs(opts.utcMs ?? null);
    // BCE dates require the Swiss data files: Moshier's accuracy degrades
    // far from the present, so it is not offered for BCE at all.
    if (inp.bce && !useSwiss)
      throw new Error('BCE dates require the Swiss Ephemeris data files (Moshier is not accurate this far back).');
  } catch (e) { $('error').textContent = e.message; return; }

  // Live ticks recompute in the background; pulsing the button's disabled
  // state (opacity 0.5) at 1 Hz is the flicker.
  if (!opts.live) $('calc').disabled = true;
  try {
    const mod = await ephe.ensureWasm(status);
    lastMod = mod; lastUseSwiss = useSwiss;
    if (useSwiss) {
      const fpl = epheFile('sepl', inp.y);
      const fmo = epheFile('semo', inp.y);
      status(`date needs ${fpl} + ${fmo}`);
      await ephe.ensureChartFiles(mod, fpl, fmo, status);
      status('ephemeris files in WASM filesystem');
    } else {
      status('using built-in Moshier ephemeris (no data files)');
    }
    const out = computeChart(mod, inp.y, inp.mo, inp.d, inp.hourUT, inp.lat, inp.lon, useSwiss);
    const ephBad = validateEphOut(out);
    if (ephBad.length) throw new Error('Ephemeris output failed validation: ' + ephBad.join('; '));
    if (token !== runToken) return; // superseded by a newer run
    hideLoader(); // downloads done (or were cached and never shown)
    lastInstantMs = inp.utcMs;
    lastInp = inp;
    // Live clock ticks and skip steps stamp the exact second; manual/auto
    // runs use minutes. Formatted from the JD, not Date: toISOString is
    // proleptic Gregorian and skews pre-1582 dates.
    const stamp = fmtInstant(inp.utcMs / 86400000 + JD_UNIX_EPOCH, !!(opts.live || opts.skip));
    const meta = `<span id="meta-stamp">UTC ${stamp}</span> \u00B7 `
      + `${inp.gregorian ? 'Gregorian' : 'Julian'} calendar \u00B7 `
      + `${inp.lat.toFixed(4)}\u00B0 ${inp.lat >= 0 ? 'N' : 'S'}, ${Math.abs(inp.lon).toFixed(4)}\u00B0 ${inp.lon >= 0 ? 'E' : 'W'} \u00B7 `
      + (inp.bce ? 'local mean time \u00B7 ' : '')
      + (useSwiss ? 'Swiss Ephemeris (JPL-based .se1 files)' : 'Moshier analytic ephemeris (approximate)');
    if ((opts.live || patchReuse) && $('views').dataset.ready === '1' && $('meta-stamp') && $('panel-table')) {
      updateLiveResults(out, stamp);
      if ($('panel-table').style.display !== 'none') maybeRefreshExtras(false);
    } else {
      renderResults(out, meta);
    }
    // Sky tab: push the fresh ephemeris through (no-op while hidden).
    if (skyUI) skyUI.onEphemeris();
    if (!useSwiss) $('warn').textContent = 'Moshier fallback: positions good to ~arcseconds for most planets, worse for the Moon and outer planets.';
    else if (token === runToken) $('warn').textContent = '';
    status('done');
  } catch (e) {
    if (token !== runToken) return; // superseded: the newer run owns the UI
    hideLoader(); // don't leave the spinner on a failed download
    if (useSwiss && e.httpStatus === 404) {
      // BCE dates require the Swiss data files — Moshier's accuracy degrades
      // far from the present, so no fallback is offered for BCE.
      const noFallback = !!(inp && inp.bce);
      $('error').textContent = `Ephemeris file ${e.file} not found on GitHub for this date.`
        + (noFallback ? ' BCE dates require the Swiss Ephemeris data files.' : '');
      $('fallback').style.display = noFallback ? 'none' : 'block';
      status('file missing on GitHub' + (noFallback ? '; no Moshier fallback for BCE'
                                                   : '; offering Moshier fallback'));
    } else {
      $('error').textContent = 'Error: ' + e.message;
      status('error: ' + e.message);
    }
  } finally {
    if (!opts.live) $('calc').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Time skipping: the calendar math lives in skip.js (pure, BCE-capable);
// this is the DOM wrapper.
function skipStep(dir) {
  if (clockApi.isRunning()) return;
  animApi.stop();
  let f;
  try { f = readDateFields('dt', true); } catch (e) { $('error').textContent = e.message; return; }
  let n = Math.max(1, Math.floor(parseFloat($('skip-n').value) || 1));
  $('skip-n').value = n;
  const r = skipFields(f, dir, n, $('skip-unit').value);
  writeDateFields('dt', r, true);
  $('error').textContent = '';
  locUI.deriveTimezone(); // re-derive the offset if the skip crossed a DST boundary
  if (clockApi.hasLocation()) run(true, { skip: true });
}

function setSkipEnabled(on) {
  for (const id of ['skip-minus', 'skip-n', 'skip-unit', 'skip-plus']) $(id).disabled = !on;
}

// Input drawer: left navigation panel. Persistent sidebar on desktop (takes
// layout width, pushing the main column right); overlay drawer with scrim on
// mobile. Collapsed by default; state persists.
const DRAWER_KEY = 'trigon-input-open';

function setDrawerOpen(open, focus) {
  $('input-card').classList.toggle('open', open);
  const fab = $('input-fab');
  fab.setAttribute('aria-expanded', open ? 'true' : 'false');
  fab.hidden = open; // the drawer's own close button takes over while open
  $('scrim').hidden = !open;
  document.body.classList.toggle('nav-open', open);
  try { localStorage.setItem(DRAWER_KEY, open ? '1' : '0'); } catch (e) {}
  if (focus) $(open ? 'input-hide' : 'input-fab').focus();
}

// ---------------------------------------------------------------------------
// Module wiring: extracted concerns, composed here.
// Ephemeris (WASM + .se1 fetch/cache). isArmed is read lazily, so referencing
// the loader section's `let loaderArmed` here is safe (only called post-init).
const ephe = createEpheClient({ ui: { showLoader, isArmed: () => loaderArmed } });
// Timezone / location UI.
const locUI = createLocationUI({ el: $, log, storage: safeStorage, readDateFields });
// Aspect + station search tabs.
const searchUI = createSearchUI({
  el: $, readDateFields, writeDateFields,
  ensureWasm: (...a) => ephe.ensureWasm(...a),
  ensureSearchFiles: (...a) => ephe.ensureSearchFiles(...a),
  JD_1CE, getAngleFmt: () => angleFmt,
  getLoaderArmed: () => loaderArmed, setLoaderArmed: v => { loaderArmed = v; },
  animateRetrogradePeriod, gotoSearchInstant,
});
// The astrological clock (live recompute every second).
const clockApi = createClock({
  el: $, readDateFields, writeDateFields,
  updateTzForEra: (...a) => locUI.updateTzForEra(...a),
  deriveTimezone: (...a) => locUI.deriveTimezone(...a),
  run, getDerivedZone: (...a) => locUI.getDerivedZone(...a), setSkipEnabled,
});

// Time-lapse animation over an absolute or relative date range. Drives the
// same quiet live-tick calculation path as the clock, so table, chart and
// sky all track the advancing instant.
const animApi = createAnimation({
  el: $,
  readInstantMs: () => readInputs().utcMs,
  setPickerToInstantMs: ms => {
    const zone = locUI.getDerivedZone();
    if (zone) {
      clockApi.setDateTimeToInstantInZone(ms, zone);
    } else {
      const d = new Date(ms);
      writeDateFields('dt', {
        y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(),
        hh: d.getUTCHours(), mi: d.getUTCMinutes(), ss: d.getUTCSeconds(),
      }, true);
    }
    locUI.deriveTimezone();
  },
  run, hasLocation: () => clockApi.hasLocation(),
  stopClock: () => clockApi.setClock(false),
  setSkipEnabled,
  onError: msg => { $('error').textContent = msg; },
});

// Animate a retrograde period in the sky view: absolute range, sphere view,
// camera tracking the planet.
async function animateRetrogradePeriod({ ib, startJd, endJd }) {
  setTab('sky');
  await ensureSky();
  if (activeTab !== 'sky' || !skyUI || skyUI.failed) return;
  skyUI.setViewMode('sphere');
  skyUI.setCameraLock(ib);
  animApi.playRange({
    startMs: (startJd - 2440587.5) * 86400000,
    endMs: (endJd - 2440587.5) * 86400000,
    autoSpeed: true,
  });
}

// Set the main chart datetime from a search result's UTC instant (JD).
// CE: write the UTC wall time and pin the timezone select to UTC, so the
// input shows exactly what the result cell displayed. BCE: wall time is
// local mean time at the site longitude (time zones did not exist),
// mirroring the share-link path. Then show the table and recalculate.
function gotoSearchInstant(jd) {
  if (!Number.isFinite(jd)) return;
  animApi.stop(); // a running animation would immediately overwrite this
  let c = calFromJd(jd);
  if (c.y >= 1) {
    const s = Math.min(86399, Math.max(0, Math.floor(c.hourUT * 3600 + 1e-3)));
    writeDateFields('dt', {
      y: c.y, mo: c.mo, d: c.d,
      hh: Math.floor(s / 3600), mi: Math.floor((s % 3600) / 60), ss: s % 60,
    }, true);
    $('tz').value = '0';
    $('tz-name').textContent = '';
    locUI.setTzAuto(false); // a hand-picked timezone wins over derivation
    locUI.updateTzForEra();
  } else {
    const lon = parseFloat($('lon').value);
    if (Number.isFinite(lon)) c = calFromJd(jd + lon / 15 / 24);
    const s = Math.min(86399, Math.max(0, Math.floor(c.hourUT * 3600 + 1e-3)));
    writeDateFields('dt', {
      y: c.y, mo: c.mo, d: c.d,
      hh: Math.floor(s / 3600), mi: Math.floor((s % 3600) / 60), ss: s % 60,
    }, true);
    locUI.updateTzForEra();
  }
  setTab('table');
  run(true);
}

function init() {
  buildTzOptions();
  locUI.initLocation();
  clockApi.setDateTimeToNow();
  // A date change can change the derived offset (DST): re-derive while the
  // timezone is still following the location automatically. Any field of the
  // hand-rolled group counts as a change (no single 'change' on the group).
  for (const id of ['dt-y', 'dt-era', 'dt-mo', 'dt-d', 'dt-h', 'dt-mi', 'dt-s'])
    $(id).addEventListener('change', () => { animApi.stop(); locUI.deriveTimezone(); });
  // A hand-picked timezone wins over derivation until the location changes.
  $('tz').addEventListener('change', () => {
    locUI.setTzAuto(false); // a hand-picked timezone wins over derivation
    $('tz-name').textContent = '';
  });
  // Restore the saved location, deriving the timezone from it. A shared link
  // (#lat,lon,epoch) wins: it names the nearest gazetteer city and computes
  // the chart for that exact instant, without overwriting the saved location.
  const share = parseShareHash();
  const saved = share ? null : loadSavedLocation(safeStorage);
  if (share) {
    initShare(share);
  } else if (saved) {
    if (saved.city) $('city').value = saved.city;
    locUI.setLocation(saved.lat, saved.lon, saved.label, saved.city);
    // Show the wall time in the location's zone so picker and timezone agree,
    // then re-derive the offset against the corrected wall time (matters only
    // within an hour of a DST transition).
    const z0 = locUI.getDerivedZone();
    if (z0) { clockApi.setDateTimeToZoneNow(z0); locUI.deriveTimezone(); }
  }
  // Move any ephemeris files left in the old Cache API store into IndexedDB.
  migrateEpheCache(log);
  searchUI.initSearchTabs();
  // The persistent 4-tab bar (table/chart/aspects/stations) lives in app.js.
  document.querySelectorAll('#views .tabs button').forEach(b =>
    b.addEventListener('click', () => setTab(b.dataset.tab)));
  initDateTimeInputs();
  animApi.init();
  $('calc').addEventListener('click', () => { animApi.stop(); run(true); });
  $('moshier').addEventListener('click', () => run(false));
  // Time stepping: shift the picker by n units and recalculate.
  $('skip-minus').addEventListener('click', () => skipStep(-1));
  $('skip-plus').addEventListener('click', () => skipStep(1));
  // Astrological clock: live recompute every second.
  $('clock-toggle').addEventListener('change', e => {
    if (e.target.checked) animApi.stop();
    clockApi.setClock(e.target.checked);
  });
  // Left navigation drawer: hamburger toggles, close button / scrim / Escape dismiss.
  $('input-hide').addEventListener('click', () => setDrawerOpen(false, true));
  $('scrim').addEventListener('click', () => setDrawerOpen(false, true));
  $('input-fab').addEventListener('click', () =>
    setDrawerOpen(!$('input-card').classList.contains('open'), true));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('input-card').classList.contains('open')) setDrawerOpen(false, true);
  });
  try { setDrawerOpen(localStorage.getItem(DRAWER_KEY) === '1', false); } catch (e) {}
  // With a known location, compute immediately for this exact instant.
  if (saved) run(true, { utcMs: Date.now() });
}

init();
