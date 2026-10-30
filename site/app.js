// app.js — Astroweb
// Runs the Swiss Ephemeris C library (compiled to WebAssembly) in the browser.
// Ephemeris data files (.se1) are fetched on demand from
// https://github.com/aloistr/swisseph/tree/master/ephe and cached in
// IndexedDB, mirroring the file-naming logic of swi_gen_filename() in swephlib.c.

import { migrateEpheCache, epheGet, ephePut } from './ephe-store.js';
import { renderChartSVG, renderChartSVGMobile, getLastChartDebug, aspectsForPoint, setAspectHighlight } from './chart.js';
import { jdFromCal, calFromJd, JD_UNIX_EPOCH, stationsAround, syzygiesAround } from './search.js';
import {
  BCE_MIN_ASTRO, eraToAstro, fmtInstant, lmtOffsetHours,
} from './dateapi.js';
import { openDatePicker } from './datepicker.js';
import { attachDateTime } from './datetime.js';
import { fmtLon, fmtCoord, fmtSignPos, rowsToCSV, gotoButtonHTML,
  fmtRelativeInstant } from './format.js';
import { parseShareHashString, shareLink, shareLinks } from './share.js';
import { tableRows, buildTableHTML, speedIndicatorHTML, angleRows, pointTooltip, swapGlyphChars } from './table.js';
import { computeLots, buildLotsHTML, buildLotOptionsHTML, sunAltitudeDeg,
  computeCatalogLots, buildCatalogHTML, buildCatalogSelectedHTML } from './lots.js';
import {
  buildSyzygyHTML, buildLordshipHTML,
} from './dignities.js';
import { epheFile, computeChart, createEpheClient, validateEphOut, ephProvider } from './ephe.js';
import { computeBazi, buildBaziHTML } from './bazi.js';
import { createSearchUI } from './search-ui.js';
import { loadSavedLocation, createLocationUI } from './location.js';
import { skipFields } from './skip.js';
import { createClock } from './clock.js';
import { createLoader } from './loader.js';
import { createChartStyle } from './chart-style.js';
import { createOuterWheels } from './outer-wheels.js';
import { createChartTooltip } from './chart-tooltip.js';
import { setText, setHTML, createSwapGuard } from './dom-patch.js';
import {
  S, update, subscribe, initPrefs, setPref,
  angleFmt, angleMode, glyphsOn, stationTime, lotsOpts, catalogSelection, digOpts,
} from './store.js';
import { createDateTimeGroups } from './datetime-groups.js';
import { createAnimation } from './animation.js';
import { nearestCity } from './cities.js';

// Storage handle with lazy access: referencing localStorage directly at
// module scope throws in storage-less contexts (e.g. sandboxed iframes).
// Every consumer wraps calls in try/catch.
const safeStorage = {
  getItem: (...a) => localStorage.getItem(...a),
  setItem: (...a) => localStorage.setItem(...a),
  removeItem: (...a) => localStorage.removeItem(...a),
};

// Session state (S) and preferences live in the store (store.js): this
// file reads them and writes only via update()/setPref(). initPrefs
// loads the preferences before anything reads them.
initPrefs(safeStorage);

// JD of 0001-01-01 00:00 UTC: BCE/CE boundary for Moshier gating.
const JD_1CE = jdFromCal(1, 1, 1, 0);
// Millisecond instant of 12999 BCE-01-01 (share-link floor).
const BCE_MIN_MS = (jdFromCal(BCE_MIN_ASTRO, 1, 1, 0) - JD_UNIX_EPOCH) * 86400000;

// Mobile viewport: use the big-glyph outside layout (no degree tokens).
const isMobileChart = () => window.matchMedia('(max-width: 640px)').matches;
const renderChart = (out, opts) => isMobileChart()
  ? renderChartSVGMobile(out, opts)
  : renderChartSVG(out, opts);

// The effective format folds the size choice into the dms variant;
// state always carries precise decimals.
const effFmt = () => angleFmt === 'dec' ? 'dec' : (angleMode === 'compact' ? 'compact' : 'dms');

// Last WASM module + engine, kept so the table extras (prev/next
// stations, lunations) can scan around the chart instant.
let extrasToken = 0, extrasJd = NaN;
let lordsSectShown = null;

// Dignity options for a chart: the persisted decan method plus day/night
// from the Sun's true altitude (drives Dorothean triplicity primaries).
function digFull(out) {
  const isDay = S.inp && S.instantMs != null
    ? sunAltitudeDeg(out, S.instantMs, S.inp.lat, S.inp.lon) > 0
    : true;
  return { decan: digOpts.decan, isDay };
}

// Chart style customization (radii, glyph sizes, aspect line width) is
// owned by chart-style.js; chartStyleApi is created in the wiring section.
const chartOpts = () => ({ angleFmt, style: chartStyleApi.style() });

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

// Test seams for the E2E harness. __trigonSetDate keeps the date-only path
// (hidden inputs + range follow) the popup uses; __trigonSetTime sets the
// time fields; __trigonSetDateTime sets both with the input's cap semantics.
// Any of yy/era/mo/d may be '' to clear the group.
window.__trigonSetDate = (p, yy, era, mo, d) => {
  if (yy === '' || era === '' || mo === '' || d === '') {
    $(`${p}-y`).value = yy; $(`${p}-era`).value = era || 'ce';
    $(`${p}-mo`).value = mo; $(`${p}-d`).value = d;
    dtg.refreshDTInput(p);
    return;
  }
  dtg.setGroupDate(p, eraToAstro(parseInt(yy, 10), era), parseInt(mo, 10), parseInt(d, 10));
  dtg.enforceRangePair(p);
};

window.__trigonSetTime = (p, hh, mi, ss) => {
  const seconds = !!$(`${p}-s`);
  const g = dtg.groupValue(p, seconds) ||
    { y: new Date().getFullYear(), mo: 1, d: 1, hh: 0, mi: 0, ss: 0 };
  dtg.setHiddenDateTime(p, {
    ...g,
    hh: Math.max(0, Math.min(23, hh | 0)),
    mi: Math.max(0, Math.min(59, mi | 0)),
    ss: seconds ? Math.max(0, Math.min(59, (ss == null ? 0 : ss) | 0)) : 0,
  }, seconds);
  dtg.refreshDTInput(p);
};

window.__trigonSetDateTime = (p, yy, era, mo, d, hh, mi, ss) => {
  const seconds = !!$(`${p}-s`);
  dtg.commitGroupDT(p, {
    y: eraToAstro(parseInt(yy, 10), era),
    mo: parseInt(mo, 10), d: parseInt(d, 10),
    hh: parseInt(hh, 10), mi: parseInt(mi, 10),
    ss: seconds && ss != null ? parseInt(ss, 10) : 0,
  }, seconds);
  dtg.refreshDTInput(p);
};

window.__trigonRefresh = p => dtg.dtg.refreshDTInput(p);

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
    const f = dtg.readDateFields('dt', true);
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
let skyUI = null;
// Shared Sky init promise: concurrent callers (tab switch, retrograde
// animate) all await the same load instead of racing a boolean flag.
let skyLoadPromise = null;

function setAngleFmt(f) {
  if (f !== 'dms' && f !== 'dec') return;
  setPref('angleFmt', f);
  syncSettingsUI();
  if (S.out) renderResults(S.out);
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
  if (b) { gotoSearchInstant(parseFloat(b.dataset.gotoJd)); return; }
  // The share button is rebuilt with the table on every render, so it
  // is wired by delegation like the goto buttons, not per render.
  if (e.target.closest('#share')) shareChart();
});

// The debug-copy button is rebuilt with the chart panel on every
// render, so it is wired by delegation on the static panel element.
$('panel-chart').addEventListener('click', e => {
  if (e.target.closest('#dbgcopy')) copyDebug();
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.classList && t.classList.contains('cat-sel')) {
    const id = t.dataset.id;
    setPref('catalogSelection', t.checked
      ? [...catalogSelection, id]
      : catalogSelection.filter(x => x !== id));
    refreshSections(['catalog', 'lords']);
    return;
  }
  if (t.classList && t.classList.contains('decan-method')) {
    setPref('digOpts', { decan: t.value === 'indian' ? 'indian' : 'chaldean' });
    if (S.out) renderResults(S.out);
    return;
  }
  if (!t.classList || !t.classList.contains('lots-opt')) return;
  setPref('lotsOpts', { ...lotsOpts, [t.dataset.opt]: t.checked });
  refreshSection('lots');
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
          // Sky uses the root chart only; outer wheels are a chart-tab
          // concept and never reach the sky.
          getEphemeris: () => (S.out && S.inp && S.instantMs != null)
            ? { out: S.out, inp: S.inp, utcMs: S.instantMs } : null,
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

function rerenderChartSVG() {
  if (!S.out) return;
  chartTip.hide();
  const svg = renderChart(S.out, { ...chartOpts(), outerWheels: S.outerOuts });
  chartGuard.mark(svg);
  const wrap = document.querySelector('#panel-chart .chart-wrap');
  if (wrap) wrap.innerHTML = svg;
}

// ---------------------------------------------------------------------------
// Chart point tooltip data: mirrors the point's row in the positions
// table (table.js pointTooltip). The station values are read back from
// the table cells at hover time, since they are filled asynchronously
// after the chart renders. Display mechanics live in chart-tooltip.js.
function chartTipData(g) {
  const key = g.dataset.point;
  const wheel = parseInt(g.dataset.wheel || '0', 10);
  let out = S.out, utcMs = S.instantMs, stations = null;
  if (wheel > 0) {
    const w = S.outerOuts[wheel - 1];
    if (!w) return null;
    out = w.out; utcMs = w.utcMs;
  }
  if (!out) return null;
  let dig;
  if (wheel > 0) {
    dig = S.inp
      ? { decan: digOpts.decan, isDay: sunAltitudeDeg(out, utcMs, S.inp.lat, S.inp.lon) > 0 }
      : { decan: digOpts.decan, isDay: true };
  } else {
    dig = digFull(out);
    const ib = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn',
                'uranus', 'neptune', 'pluto', 'true-node'].indexOf(key);
    if (ib >= 2 && ib <= 9) {
      const p = document.querySelector(`#panel-table td.stn-prev[data-ib="${ib}"]`);
      const n = document.querySelector(`#panel-table td.stn-next[data-ib="${ib}"]`);
      if (p && n) stations = { prev: p.textContent.trim(), next: n.textContent.trim() };
    }
  }
  const data = pointTooltip(key, out, effFmt(), dig, stations, glyphsOn);
  // Root-wheel points list their aspects at the bottom of the tooltip;
  // outer-wheel points get none (the root aspects do not describe
  // their instant), and angles/nodes have none to list.
  if (data && wheel === 0) data.aspects = aspectsForPoint(key, out);
  return data ? { ...data, wheel } : null;
}

// Meta line HTML, built in render from data, never stored as markup:
// the stored stamp, the chart input (calendar, latitude, longitude, BCE
// flag), and the engine. The stamp span keeps its id so the live tick
// can patch its text, and copyDebug can read it back.
function buildMetaHTML() {
  const inp = S.inp;
  if (!inp) return '';
  return `<span id="meta-stamp">UTC ${S.metaStamp}</span> \u00B7 `
    + `${inp.gregorian ? 'Gregorian' : 'Julian'} calendar \u00B7 `
    + `${inp.lat.toFixed(4)}\u00B0 ${inp.lat >= 0 ? 'N' : 'S'}, ${Math.abs(inp.lon).toFixed(4)}\u00B0 ${inp.lon >= 0 ? 'E' : 'W'} \u00B7 `
    + (inp.bce ? 'local mean time \u00B7 ' : '')
    + (S.useSwiss ? 'Swiss Ephemeris (JPL-based .se1 files)' : 'Moshier analytic ephemeris (approximate)');
}

// BaZi subtable HTML for the root chart, or '' when the state is not
// usable. The wall time is the chart instant shifted by the chart's
// timezone offset (tz select; local mean time at the site longitude
// for BCE, where the select is disabled) — the same wall time the
// input fields show, reconstructed from the instant so re-renders
// (angle format, decan method) never depend on picker edits in flight.
// A bad state returns '' rather than throwing into the render.
function buildBaziSection() {
  if (!S.inp || S.instantMs == null) return '';
  try {
    const offsetMin = S.inp.bce
      ? Math.round(lmtOffsetHours(S.inp.lon) * 60)
      : parseInt($('tz').value, 10);
    if (!Number.isFinite(offsetMin)) return '';
    const c = calFromJd(JD_UNIX_EPOCH + S.instantMs / 86400000 + offsetMin / 1440);
    const hh = Math.floor(c.hourUT);
    const mi = Math.floor((c.hourUT - hh) * 60 + 1e-3);
    return buildBaziHTML(computeBazi({ y: c.y, mo: c.mo, d: c.d, hh, mi, offsetMin }));
  } catch (e) { return ''; }
}

function renderResults(out, outerOuts = []) {
  update({ out, outerOuts });
  const svg = renderChart(out, { ...chartOpts(), outerWheels: outerOuts });
  chartGuard.mark(svg);
  $('views-head').innerHTML =
      `<div class="res-brand"><img class="logo" src="logo.svg" alt="">Trigon</div>`
    + `<div class="meta" style="margin-bottom:4px">${buildMetaHTML()}</div>`;
  const dig = digFull(out);
  lordsSectShown = dig.isDay;
  const lotsRes = S.inp && S.instantMs != null
    ? computeLots(out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts) : null;
  const catRes = S.inp && S.instantMs != null
    ? computeCatalogLots(out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts, catalogSelection, S.syzygyLon) : null;
  $('panel-table').innerHTML = buildTableHTML(out, effFmt(), dig, { glyphs: glyphsOn, angleMode })
    + buildSyzygyHTML(null)
    + (lotsRes ? buildLotsHTML(lotsRes, effFmt()) : '')
    + (catRes ? buildCatalogHTML(catRes.values, catalogSelection, effFmt()) : '')
    + buildLordshipHTML(out, [...(lotsRes ? lotsRes.values : []), ...(catRes ? catRes.values.filter(v => v.lon != null) : [])], dig)
    + buildBaziSection();
  $('panel-chart').innerHTML =
      `<div class="chart-wrap">${svg}</div>`
    + `<div class="chart-cap">Whole-sign houses \u00B7 1st house = Ascendant\u2019s sign `
    + `\u00B7 Ptolemaic aspects, 3\u00B0 orb \u00B7 true node axis `
    + `<button id="dbgcopy" class="ghost" type="button" title="Copy chart debug state as JSON">Copy debug</button></div>`
    ;
  $('views').dataset.ready = '1';
  // Mobile: scroll results into view (input card is above the fold).
  if (window.matchMedia('(max-width: 640px)').matches) {
    requestAnimationFrame(() => $('views').scrollIntoView({ block: 'start' }));
  }
  maybeRefreshExtras(true);
}

// Table sections, one registry entry each: the DOM anchor, the session
// keys the section depends on, and how to rebuild it from a computed
// bundle. Every targeted section rebuild goes through refreshSection(s)
// instead of ad-hoc outerHTML/innerHTML lines, so the rebuild sites are
// named here and each section's dependencies are visible at its entry.
// The syzygy subscription refreshes exactly the sections that declare
// the changed key, so a new dependent section needs no call-site
// change; preference-driven refreshes (catalog selection, lot options)
// call refreshSections explicitly, because preferences are not store
// keys. The catalog browser DOM is deliberately not a section:
// rebuilding it would lose scroll and focus, so it is left untouched by
// every refresh path. The live tick keeps its own guarded patch path
// (dom-patch guards, sect-flip lordship rebuild) and does not go
// through this registry, so its change-guards stay exact.
const tableSections = {
  lots: {
    anchor: '#panel-table #lots-section',
    dependsOn: [],
    render: bundle => buildLotsHTML(bundle.herm, effFmt()),
    mode: 'outer',
  },
  catalog: {
    anchor: '#panel-table #catalog-selected',
    dependsOn: ['syzygyLon'],
    render: bundle => buildCatalogSelectedHTML(bundle.cat.values, effFmt()),
    mode: 'inner',
  },
  lords: {
    anchor: '#panel-table #lords-section',
    dependsOn: ['syzygyLon'],
    render: bundle => buildLordshipHTML(S.out,
      [...bundle.herm.values, ...bundle.cat.values.filter(v => v.lon != null)], digFull(S.out)),
    mode: 'outer',
  },
  syzygy: {
    anchor: '#panel-table #syzygy-section',
    dependsOn: [],
    render: bundle => buildSyzygyHTML(bundle.syz),
    mode: 'outer',
  },
};

// Rebuild the named sections from the current chart state, computing
// each bundle part at most once and only when a section needs it, so a
// single-section refresh costs what its old ad-hoc line cost and a
// combined refresh costs what the old combined refresh cost. A missing
// section node is skipped, and a missing chart state rebuilds nothing —
// the same guards the old call sites carried.
function refreshSections(ids, extra = {}) {
  if (!S.out || !S.inp || S.instantMs == null) return;
  let herm, cat;
  const bundle = {
    get herm() { return herm ??= computeLots(S.out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts); },
    get cat() { return cat ??= computeCatalogLots(S.out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts, catalogSelection, S.syzygyLon); },
    syz: extra.syz ?? null,
  };
  for (const id of ids) {
    const sec = tableSections[id];
    const el = document.querySelector(sec.anchor);
    if (!el) continue;
    const html = sec.render(bundle);
    if (sec.mode === 'outer') el.outerHTML = html;
    else el.innerHTML = html;
  }
}
function refreshSection(id, extra = {}) { refreshSections([id], extra); }

// The catalog and lordship sections depend on the prenatal syzygy: when
// the extras scan lands a new syzygy longitude, exactly the sections
// that declare it rebuild, from the dependency, not from an imperative
// call at the producer.
subscribe(['syzygyLon'], (_state, changed) => {
  refreshSections(Object.keys(tableSections).filter(id =>
    tableSections[id].dependsOn.some(k => changed.includes(k))));
});

// Table extras: prev/next stations (Mercury..Pluto) and the bracketing
// lunations, from an ephemeris scan around the chart instant using the
// same module/engine as the chart itself. Runs synchronously (a few
// hundred WASM evaluations) but is token-guarded so stale passes never
// patch the DOM; live ticks only re-run it once the instant has drifted
// ~30 min from the last pass.
function maybeRefreshExtras(force = false) {
  const jd = S.instantMs == null ? null : S.instantMs / 86400000 + JD_UNIX_EPOCH;
  if (jd == null || !S.mod) return;
  if (!force && Number.isFinite(extrasJd) && Math.abs(jd - extrasJd) < 0.02) return;
  extrasJd = jd;
  const tk = ++extrasToken;
  try {
    const eph = ephProvider(S.mod, S.useSwiss, (1 << 10) - 1);
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
      const fmtStn = s => {
        if (!s) return '—';
        // The button's JD never changes with the display mode: a
        // relative label still sets the chart to the absolute station
        // instant, and the absolute instant rides in the button's
        // title/aria-label for hover and screen readers.
        const abs = fmtInstant(s.jd);
        const label = stationTime === 'relative' ? fmtRelativeInstant(s.jd, jd) : abs;
        const str = `${s.type} ${fmtSignPos(s.lon, 'dms', glyphsOn)} `
          + gotoButtonHTML(s.jd, label, stationTime === 'relative' ? abs : null);
        return glyphsOn ? swapGlyphChars(str) : str;
      };
      for (let ib = 2; ib <= 9; ib++) {
        const { prev, next } = stationsAround(grid, eph, ib, jd);
        const p = document.querySelector(`#panel-table td.stn-prev[data-ib="${ib}"]`);
        const n = document.querySelector(`#panel-table td.stn-next[data-ib="${ib}"]`);
        if (p) p.innerHTML = fmtStn(prev);
        if (n) n.innerHTML = fmtStn(next);
      }
      const syz = syzygiesAround(scan(jd - 40, 1, 80), eph, jd);
      if (tk === extrasToken) refreshSection('syzygy', { syz });
      // Feed the prenatal syzygy to the catalog (Syzygy / Ruler Syzygy
      // lots) and rebuild the catalog table + deep dive with it.
      const newSyzLon = syz.prev ? syz.prev.moonLon : null;
      if (tk === extrasToken && newSyzLon !== S.syzygyLon) {
        update({ syzygyLon: newSyzLon });
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
  if (S.instantMs == null) return;
  const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  // Share all wheels: root triplet plus one per outer wheel.
  const states = [{ lat, lon, utcMs: S.instantMs }];
  for (const w of outerApi.readPanels()) states.push({ lat, lon, utcMs: w.utcMs });
  const url = location.origin + location.pathname + shareLinks(states);
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
async function initShare(shares) {
  // shares: array of {lat, lon, utcMs}; [0] is the root chart, the rest
  // become outer wheels.
  const share = shares[0];
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
  // Outer wheels from the remaining triplets.
  outerApi.setWheels(shares.slice(1).map((s, i) => ({ utcMs: s.utcMs, label: `Wheel ${i + 1}` })));
  if (share.utcMs < -62167219200000) {
    // BCE share: Intl has no BCE zones, so restore the wall fields directly
    // as local mean time at the shared longitude.
    const c = calFromJd(share.utcMs / 86400000 + JD_UNIX_EPOCH + share.lon / 15 / 24);
    const s = Math.min(86399, Math.floor(c.hourUT * 3600 + 1e-3));
    dtg.writeDateFields('dt', {
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
// Swap guards for the live-tick path: the last markup swapped into the
// chart wrapper and the lots / catalog-selected sections. Wholesale
// rebuilds record their output with mark(); the tick swaps only on
// change. Guarded cell writes live in dom-patch.js.
const chartGuard = createSwapGuard();
const lotsGuard = createSwapGuard();
const catSelGuard = createSwapGuard();
const baziGuard = createSwapGuard();

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
    const svg = renderChart(out, { ...chartOpts(), outerWheels: S.outerOuts });
    const wrap = document.querySelector('#panel-chart .chart-wrap');
    if (chartGuard.changed(svg)) {
      chartTip.hide();
      if (wrap) chartGuard.applyInner(wrap, svg);
      else chartGuard.mark(svg);
    }
  }
  // Lots move with the Ascendant; rebuild only when the rendered HTML
  // actually changed at display precision (most seconds it has not), so
  // most ticks cost a string build only, not a DOM swap + layout.
  if (tableVisible) {
  const lotsEl = document.querySelector('#panel-table #lots-section');
  if (lotsEl && S.inp && S.instantMs != null) {
    const lh = buildLotsHTML(
      computeLots(out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts), effFmt());
    lotsGuard.applyOuter(lotsEl, lh);
  }
  // BaZi pillars change only at double-hour and solar-term boundaries,
  // so most ticks are a string build with no swap — same guard pattern
  // as the lots section, so a clock crossing 23:00 still updates it.
  const baziEl = document.querySelector('#panel-table #bazi-section');
  if (baziEl) {
    const bh = buildBaziSection();
    if (bh) baziGuard.applyOuter(baziEl, bh);
  }
  // The selected catalog lots likewise (the browser DOM stays untouched).
  const catSelEl = document.querySelector('#panel-table #catalog-selected');
  if (catSelEl && S.inp && S.instantMs != null) {
    const ch = buildCatalogSelectedHTML(
      computeCatalogLots(out, S.instantMs, S.inp.lat, S.inp.lon,
        lotsOpts, catalogSelection, S.syzygyLon).values, effFmt());
    catSelGuard.applyInner(catSelEl, ch);
  }
  // The deep dive only changes wholesale at a sect flip (triplicity
  // primaries swap); rebuild it then, not every tick (it also carries
  // the decan-method <select>, which a rebuild would close mid-use).
  const lordsEl = document.querySelector('#panel-table #lords-section');
  if (lordsEl && S.inp && S.instantMs != null) {
    const dig = digFull(out);
    if (dig.isDay !== lordsSectShown) {
      lordsSectShown = dig.isDay;
      const lr = computeLots(out, S.instantMs, S.inp.lat, S.inp.lon, lotsOpts);
      const cr = computeCatalogLots(out, S.instantMs, S.inp.lat, S.inp.lon,
        lotsOpts, catalogSelection, S.syzygyLon);
      lordsEl.outerHTML = buildLordshipHTML(out,
        [...lr.values, ...cr.values.filter(v => v.lon != null)], dig);
    }
  }
  } // if (tableVisible)
  // The stored stamp is written by run() before this branch; the tick
  // only patches the visible span above, so no markup patching is needed
  // here to keep a later re-render fresh.
  update({ out });
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
  update({ out: null });
  // The loader appears only while uncached data downloads (never on quiet
  // live ticks): fetchEphe/ensureWasm show it on a cache miss.
  loader.arm(!opts.live);
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
    update({ mod, useSwiss });
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
    // Outer wheels: one ephemeris per wheel, same location as root
    // (geocentric longitudes don't depend on it).
    const wheels = outerApi.readPanels();
    const outerOuts = [];
    for (const w of wheels) {
      const c = calFromJd(JD_UNIX_EPOCH + w.utcMs / 86400000);
      const o = computeChart(mod, c.y, c.mo, c.d, c.hourUT, inp.lat, inp.lon, useSwiss);
      const bad = validateEphOut(o);
      if (bad.length) throw new Error('Outer wheel ephemeris failed validation: ' + bad.join('; '));
      outerOuts.push({ out: o, label: w.label, utcMs: w.utcMs });
    }
    if (token !== runToken) return; // superseded by a newer run
    loader.hide(); // downloads done (or were cached and never shown)
    // Live clock ticks and skip steps stamp the exact second; manual/auto
    // runs use minutes. Formatted from the JD, not Date: toISOString is
    // proleptic Gregorian and skews pre-1582 dates.
    const stamp = fmtInstant(inp.utcMs / 86400000 + JD_UNIX_EPOCH, !!(opts.live || opts.skip));
    update({ instantMs: inp.utcMs, inp, metaStamp: stamp });
    if ((opts.live || patchReuse) && $('views').dataset.ready === '1' && $('meta-stamp') && $('panel-table')) {
      update({ outerOuts });
      updateLiveResults(out, stamp);
      if ($('panel-table').style.display !== 'none') maybeRefreshExtras(false);
    } else {
      renderResults(out, outerOuts);
    }
    // Sky tab: push the fresh ephemeris through (no-op while hidden).
    if (skyUI) skyUI.onEphemeris();
    if (!useSwiss) $('warn').textContent = 'Moshier fallback: positions good to ~arcseconds for most planets, worse for the Moon and outer planets.';
    else if (token === runToken) $('warn').textContent = '';
    status('done');
  } catch (e) {
    if (token !== runToken) return; // superseded: the newer run owns the UI
    loader.hide(); // don't leave the spinner on a failed download
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
  try { f = dtg.readDateFields('dt', true); } catch (e) { $('error').textContent = e.message; return; }
  let n = Math.max(1, Math.floor(parseFloat($('skip-n').value) || 1));
  $('skip-n').value = n;
  const r = skipFields(f, dir, n, $('skip-unit').value);
  dtg.writeDateFields('dt', r, true);
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
// Date/time field groups (hidden inputs, unified text inputs, range
// pairs, picker bounds) — created first; location/search/clock consume
// its field codec.
const dtg = createDateTimeGroups({
  el: $,
  openPicker: (input, opts) => openDatePicker(input, opts),
  attach: (input, opts) => attachDateTime(input, opts),
});
// Chart point tooltips (display mechanics; data assembled by chartTipData).
// The hover callback emphasizes the hovered point's aspect lines on the
// wheel (other planets' lines hidden, its own thickened and glowing)
// and clears the emphasis when the tooltip hides; outer-wheel points
// clear it too, since the drawn lines are the root wheel's aspects.
const chartTip = createChartTooltip({ panel: () => $('panel-chart'), tipData: chartTipData,
  decorateHTML: html => glyphsOn ? swapGlyphChars(html) : html,
  onPointHover: (key, wheel) => {
    const svg = document.querySelector('#panel-chart .chart-wrap svg');
    if (svg) setAspectHighlight(svg, wheel === 0 ? key : null);
  } });
// Outer wheels (biwheel/triwheel panels + animation target).
const outerApi = createOuterWheels({
  el: $, rootInstantMs: () => S.instantMs,
  panels: () => document.querySelectorAll('#outer-panels .outer-panel'),
  panelInput: i => document.querySelector(`#outer-panels .outer-dt[data-idx="${i}"]`),
  rootRadio: () => document.querySelector('input[name="anim-target"][value="0"]'),
});
// Customize-chart panel + persisted style overrides; a committed change
// re-renders the wheel in place.
const chartStyleApi = createChartStyle({
  storage: safeStorage,
  onChange: () => rerenderChartSVG(),
});

// ---------------------------------------------------------------- settings
// One modal (gear button in the drawer head) holds the table, chart and
// sky settings. The controls are static DOM wired once here; their state
// lives in the same vars/prefs the renderers already read, and
// syncSettingsUI() reflects that state back into the controls.
function syncSettingsUI() {
  const modal = $('settings-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-set-fmt]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.setFmt === angleFmt)));
  modal.querySelectorAll('[data-set-size]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.setSize === angleMode)));
  modal.querySelectorAll('[data-set-glyphs]').forEach(b =>
    b.setAttribute('aria-pressed', String((b.dataset.setGlyphs === 'glyphs') === glyphsOn)));
  modal.querySelectorAll('[data-set-stn-time]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.setStnTime === stationTime)));
  const dec = $('set-decan');
  if (dec) dec.value = digOpts.decan;
}
{
  const modal = $('settings-modal');
  $('set-lots-opts').innerHTML = buildLotOptionsHTML(lotsOpts);
  $('settings-chart').innerHTML = chartStyleApi.html();
  chartStyleApi.wire(modal);
  modal.querySelectorAll('[data-set-fmt]').forEach(b =>
    b.addEventListener('click', () => setAngleFmt(b.dataset.setFmt)));
  modal.querySelectorAll('[data-set-size]').forEach(b =>
    b.addEventListener('click', () => {
      setPref('angleMode', b.dataset.setSize === 'compact' ? 'compact' : 'full');
      syncSettingsUI();
      if (S.out) renderResults(S.out);
    }));
  modal.querySelectorAll('[data-set-glyphs]').forEach(b =>
    b.addEventListener('click', () => {
      setPref('glyphsOn', b.dataset.setGlyphs === 'glyphs');
      syncSettingsUI();
      if (S.out) renderResults(S.out);
    }));
  modal.querySelectorAll('[data-set-stn-time]').forEach(b =>
    b.addEventListener('click', () => {
      setPref('stationTime', b.dataset.setStnTime === 'relative' ? 'relative' : 'absolute');
      syncSettingsUI();
      if (S.out) renderResults(S.out);
    }));
  syncSettingsUI();
  const open = () => {
    modal.hidden = false;
    document.body.classList.add('settings-open');
    $('settings-close').focus();
  };
  const close = () => {
    modal.hidden = true;
    // Only the modal's own lock is released here. The drawer holds its
    // scroll lock through the nav-open class (mobile CSS only), so the
    // two locks can no longer leak into each other: on desktop the open
    // sidebar must not lock the page, and closing the drawer must not
    // leave a modal lock behind.
    document.body.classList.remove('settings-open');
    $('settings-open').focus();
  };
  $('settings-open').addEventListener('click', open);
  $('settings-close').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) close();
  });
}
// Download loading animation (owns its armed flag and RAF state).
const loader = createLoader({
  mount: html => { $('panel-table').innerHTML = html; },
  onShow: () => setTab('table'),
  glyphEl: () => document.getElementById('lglyph'),
  dispEl: () => document.querySelector('#lmorph feDisplacementMap'),
  labelEl: () => document.getElementById('load-label'),
  exists: () => !!document.getElementById('loader'),
  reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});
// Ephemeris (WASM + .se1 fetch/cache).
const ephe = createEpheClient({ ui: { showLoader: loader.show, isArmed: loader.isArmed } });
// Timezone / location UI.
const locUI = createLocationUI({ el: $, log, storage: safeStorage, readDateFields: dtg.readDateFields });
// Aspect + station search tabs.
const searchUI = createSearchUI({
  el: $, readDateFields: dtg.readDateFields, writeDateFields: dtg.writeDateFields,
  ensureWasm: (...a) => ephe.ensureWasm(...a),
  ensureSearchFiles: (...a) => ephe.ensureSearchFiles(...a),
  JD_1CE, getAngleFmt: () => angleFmt,
  getLoaderArmed: loader.isArmed, setLoaderArmed: v => loader.arm(v),
  animateRetrogradePeriod, gotoSearchInstant,
});
// The astrological clock (live recompute every second).
const clockApi = createClock({
  el: $, readDateFields: dtg.readDateFields, writeDateFields: dtg.writeDateFields,
  updateTzForEra: (...a) => locUI.updateTzForEra(...a),
  deriveTimezone: (...a) => locUI.deriveTimezone(...a),
  run, getDerivedZone: (...a) => locUI.getDerivedZone(...a), setSkipEnabled,
  getAnimTarget: outerApi.getTarget, setOuterWheelToMs: outerApi.setWheelMs,
});

// Time-lapse animation over an absolute or relative date range. Drives the
// same quiet live-tick calculation path as the clock, so table, chart and
// sky all track the advancing instant.
const animApi = createAnimation({
  el: $,
  readInstantMs: () => {
    const t = outerApi.getTarget();
    if (t === 0) return readInputs().utcMs;
    const w = outerApi.readPanels()[t - 1];
    if (!w) throw new Error('animation target wheel not found');
    return w.utcMs;
  },
  setPickerToInstantMs: ms => {
    const t = outerApi.getTarget();
    if (t !== 0) { outerApi.setWheelMs(t - 1, ms); return; }
    const zone = locUI.getDerivedZone();
    if (zone) {
      clockApi.setDateTimeToInstantInZone(ms, zone);
    } else {
      const d = new Date(ms);
      dtg.writeDateFields('dt', {
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
    dtg.writeDateFields('dt', {
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
    dtg.writeDateFields('dt', {
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
  dtg.initInputs();
  outerApi.init();
  chartTip.init();
  outerApi.renderPanels();
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
    if (e.key === 'Escape' && $('input-card').classList.contains('open')
        && $('settings-modal').hidden) setDrawerOpen(false, true);
  });
  try { setDrawerOpen(localStorage.getItem(DRAWER_KEY) === '1', false); } catch (e) {}
  // With a known location, compute immediately for this exact instant.
  if (saved) run(true, { utcMs: Date.now() });
}

init();
