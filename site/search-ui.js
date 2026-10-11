// search-ui.js — Aspects + Stations search tabs.
//
// The pure pieces (aspectSigns, readRangeValues, renderAspectHTML,
// renderRetrogradeHTML) take explicit arguments and return values, so they
// unit-test in node. The async runners are DOM- and WASM-bound; they live
// in createSearchUI(env), which injects the app-shell dependencies
// (element lookup, date fields, the ephemeris client, loader-arm flag).
import {
  SEARCH_BODIES, ASPECTS, STATION_PLANETS, SCAN_STEP, aspectGridStep,
  jdFromCal, calFromJd, JD_UNIX_EPOCH,
  aspectRoots, stationRoots, ingressRoots, ingressScanStep, retroPeriods,
  shadowBounds, boundaryCrossingBefore, boundaryCrossingAfter,
  eclipseKind, syzygyName, splitRange, mergeTimedResults,
  evaluateConditions, validateConditions, conditionBodies, normalizeConditionGroups,
  explainConditions, periodSignSet,
  SIGN_ELEMENT_NAMES, SIGN_QUAD_NAMES,
} from './search.js';
import { signOf, fmtUTC, fmtLon, fmtSignPos, SIGNS, csvDownloadButton, gotoButtonHTML } from './format.js';
import { ephProvider, eclipseAtSyzygy, CANCELLED } from './ephe.js';

export const SEARCH_SHOW_MAX = 10000; // rows rendered

// Sign + position display for an aspect: shared sign once for conjunctions,
// "A / B" otherwise, in body order. fmt is the app's angle-format toggle.
export function aspectSigns(r, fmt = 'dms') {
  const sA = signOf(r.lonA), sB = signOf(r.lonB);
  const pA = fmtSignPos(r.lonA, fmt), pB = fmtSignPos(r.lonB, fmt);
  return sA === sB ? pA : `${pA} / ${pB}`;
}

// Eclipse-only filter predicate: a result kept by the "Eclipses only"
// option is a Sun-Moon syzygy the idiosyncratic check classified as an
// eclipse. Results without an eclipse verdict never pass.
export function isEclipseResult(r) { return !!(r.eclipse && r.eclipse.eclipse); }

// Pure range parsing: two {y, mo, d, hh, mi} field structs -> {jd0, jd1}.
// Throws when the range is not forward.
export function readRangeValues(f0, f1) {
  const jd0 = jdFromCal(f0.y, f0.mo, f0.d, f0.hh + f0.mi / 60);
  const jd1 = jdFromCal(f1.y, f1.mo, f1.d, f1.hh + f1.mi / 60);
  if (!(jd1 > jd0)) throw new Error('end must be after start');
  return { jd0, jd1 };
}

// Aspect cell content. Sun-Moon conjunctions/oppositions render as
// New/Full Moon with the idiosyncratic eclipse verdict (whether or not
// the lunation was an eclipse); everything else keeps the generic label.
function aspectCell(r) {
  const a = ASPECTS.find(x => x.deg === r.deg);
  const name = syzygyName(r.ia, r.ib, r.deg) || `${a.name} (${r.deg}°)`;
  if (!r.eclipse) return name;
  const verdict = r.eclipse.eclipse
    ? `<span class="ecl">${eclipseKind(r.eclipse.type, r.deg === 180)}</span>`
    : `<span class="dim">no eclipse</span>`;
  return `${name} · ${verdict}`;
}

// Clickable UTC date cell: sets the main chart datetime to this instant.
function gotoBtn(jd) {
  return gotoButtonHTML(jd, fmtUTC(jd));
}

export function renderAspectHTML(results, calls, angleFmt = 'dms', noun = 'perfecting', totalFound = undefined, condGroups = 0) {
  const shown = results.slice(0, SEARCH_SHOW_MAX);
  let html;
  if (totalFound !== undefined && totalFound !== results.length) {
    html = `<div class="search-status">${results.length} of ${totalFound} ${noun}${totalFound === 1 ? '' : 's'}`
      + ` matched the conditions (${calls} ephemeris evaluations)`;
  } else {
    html = `<div class="search-status">${results.length} ${noun}${results.length === 1 ? '' : 's'}`
      + ` found (${calls} ephemeris evaluations)`;
  }
  if (results.length > shown.length) html += ` — showing first ${shown.length}`;
  html += '</div>';
  if (!results.length) return html;
  const condHead = condGroups ? Array.from({ length: condGroups }, (_, g) => `<th>Filter ${g + 1}</th>`).join('') : '';
  const condCells = r => condGroups
    ? Array.from({ length: condGroups }, (_, g) => `<td>${(r.condText && r.condText[g]) || '—'}</td>`).join('')
    : '';
  html += `<div class="csv-block">${csvDownloadButton('trigon-aspects.csv')}<table><thead><tr><th>Date/Time (UTC)</th><th>Bodies</th><th>Aspect</th>${condHead}</tr></thead><tbody>`;
  for (const r of shown) {
    const a = ASPECTS.find(x => x.deg === r.deg);
    const signs = aspectSigns(r, angleFmt);
    html += `<tr><td class="num">${gotoBtn(r.jd)}</td>`
      + `<td class="body">${SEARCH_BODIES[r.ia]} ${a.glyph} ${SEARCH_BODIES[r.ib]}`
      + ` <span class="dim">(${signs})</span></td>`
      + `<td>${aspectCell(r)}</td>${condCells(r)}</tr>`;
  }
  html += '</tbody></table></div>';
  // Mobile cards: the 3-column table is cramped at 393px.
  html += '<div class="asp-cards">';
  for (const r of shown) {
    const a = ASPECTS.find(x => x.deg === r.deg);
    html += `<div class="asp-card"><div class="ac-date num">${gotoBtn(r.jd)}</div>`
      + `<div class="ac-line"><span class="body">${SEARCH_BODIES[r.ia]} ${a.glyph} ${SEARCH_BODIES[r.ib]}</span>`
      + `<span class="dim">(${aspectSigns(r, angleFmt)})</span>`
      + `<span>${aspectCell(r)}</span></div>`
      + (condGroups ? `<div class="ac-line dim">${r.condText ? r.condText.filter(Boolean).join(' · ') : ''}</div>` : '')
      + `</div>`;
  }
  html += '</div>';
  return html;
}

/**
 * Enrichment for one retrograde period, computed by the stations runner
 * (ephemeris-bound; renderRetrogradeHTML itself stays pure). Keyed in a Map
 * by `${ib}|${start}`.
 * @typedef {Object} PeriodExtra
 * @property {number|null} ingress  JD the planet enters the period's span
 * @property {number|null} egress   JD it finally leaves the span
 * @property {number} [bIn]         boundary longitude crossed at ingress
 * @property {number} [bOut]        boundary longitude crossed at egress
 * @property {number|null} sunJd    inferior conjunction (Mercury/Venus) or
 *                                  opposition (the rest) inside the loop
 */

// Group stations into retrograde periods (sorted by start) plus notes for
// periods cut off by the search-range edges. Shared by the renderer and
// the runner (which enriches the same periods before rendering).
function derivePeriods(stations) {
  const byPlanet = new Map();
  for (const s of stations) {
    if (!byPlanet.has(s.ib)) byPlanet.set(s.ib, []);
    byPlanet.get(s.ib).push(s);
  }
  const periods = [];
  for (const [ib, list] of byPlanet)
    for (const pr of retroPeriods(list))
      if (pr.start !== null && pr.end !== null) periods.push({ ib, ...pr });
  periods.sort((a, b) => a.start - b.start);
  const dangling = [];
  for (const [ib, list] of byPlanet) {
    const first = list[0], last = list[list.length - 1];
    if (last.type === 'R' && !periods.some(p => p.ib === ib && p.end === last.jd))
      dangling.push(`${SEARCH_BODIES[ib]} was still retrograde at the end of the range`);
    if (first.type === 'D' && !periods.some(p => p.ib === ib && p.start === first.jd))
      dangling.push(`${SEARCH_BODIES[ib]} was already retrograde at the start of the range`);
  }
  return { periods, dangling };
}

export function renderRetrogradeHTML(periods, calls, angleFmt = 'dms', extra = null, meta = {}) {
  const flon = v => fmtLon(v, angleFmt);
  const total = meta.total != null ? meta.total : periods.length;
  let html;
  if (meta.filtered && total !== periods.length) {
    html = `<div class="search-status">${periods.length} of ${total} retrograde periods`
      + ` in the selected signs (${calls} ephemeris evaluations)`;
  } else {
    html = `<div class="search-status">${periods.length} retrograde period${periods.length === 1 ? '' : 's'}`
      + ` found (${calls} ephemeris evaluations)`;
  }
  if (periods.length > SEARCH_SHOW_MAX) html += ` — showing first ${SEARCH_SHOW_MAX}`;
  html += '</div>';
  if (periods.length) {
    // Attach the runner's extended-period enrichment (shadow ingress/
    // egress + Sun event). Without it a period falls back to its
    // station-to-station span.
    const pv = periods.slice(0, SEARCH_SHOW_MAX).map(p => {
      const x = extra ? extra.get(p.ib + '|' + p.start) : null;
      const span = !!(x && x.ingress != null && x.egress != null);
      const aStart = span ? x.ingress : p.start, aEnd = span ? x.egress : p.end;
      return { p, x, span, aStart, aEnd, days: aEnd - aStart };
    });
    const animBtn = v => `<button type="button" class="ghost stn-anim" data-anim-period data-ib="${v.p.ib}"`
      + ` data-start="${v.aStart}" data-end="${v.aEnd}"`
      + ` title="Animate this retrograde period in the sky view, camera tracking ${SEARCH_BODIES[v.p.ib]}"`
      + ` aria-label="Animate the ${SEARCH_BODIES[v.p.ib]} retrograde period in the sky view">▶</button>`;
    const sunCell = v => v.x && v.x.sunJd != null
      ? `${gotoBtn(v.x.sunJd)} <span class="dim">${v.p.ib <= 3 ? '☌ inferior' : '☍ opposition'}</span>`
      : '<span class="dim">—</span>';
    html += `<div class="csv-block">${csvDownloadButton('trigon-retrograde-periods.csv')}<div class="tbl-scroll"><table><thead><tr><th>Planet</th><th>Ingress</th><th>Stations retrograde</th><th>At</th>`
      + '<th>Sun event</th><th>Goes direct</th><th>At</th><th>Egress</th><th>Days</th><th>Animate</th></tr></thead><tbody>';
    for (const v of pv) {
      const p = v.p;
      html += `<tr><td class="body">${SEARCH_BODIES[p.ib]}</td>`
        + `<td class="num">${v.span ? `${gotoBtn(v.x.ingress)} <span class="dim num">${flon(v.x.bIn)}</span>` : '<span class="dim">—</span>'}</td>`
        + `<td class="num">${gotoBtn(p.start)}</td><td class="num">${flon(p.startLon)}</td>`
        + `<td class="num">${sunCell(v)}</td>`
        + `<td class="num">${gotoBtn(p.end)}</td><td class="num">${flon(p.endLon)}</td>`
        + `<td class="num">${v.span ? `${gotoBtn(v.x.egress)} <span class="dim num">${flon(v.x.bOut)}</span>` : '<span class="dim">—</span>'}</td>`
        + `<td class="num" title="${v.span ? 'ingress to egress' : 'station to station'}">${v.days.toFixed(1)}</td>`
        + `<td>${animBtn(v)}</td></tr>`;
    }
    html += '</tbody></table></div></div>';
    // Mobile cards: the 10-column table cannot fit 393px.
    html += '<div class="stn-period-cards">';
    for (const v of pv) {
      const p = v.p;
      html += `<div class="sp-card"><div class="sp-head"><span class="body">${SEARCH_BODIES[p.ib]}</span>`
        + `<span class="dim num">${v.days.toFixed(1)} days</span>`
        + `${animBtn(v)}</div>`
        + (v.span ? `<div class="sp-line"><span class="sp-k dim">ingress</span>`
          + `<span class="num">${gotoBtn(v.x.ingress)}</span>`
          + `<span class="dim num">${flon(v.x.bIn)}</span></div>` : '')
        + `<div class="sp-line"><span class="retro">retrograde</span>`
          + `<span class="num">${gotoBtn(p.start)}</span>`
          + `<span class="dim num">${flon(p.startLon)}</span></div>`
        + (v.x && v.x.sunJd != null ? `<div class="sp-line"><span class="sp-k dim">${p.ib <= 3 ? 'inferior ☌' : 'opposition ☍'}</span>`
          + `<span class="num">${gotoBtn(v.x.sunJd)}</span></div>` : '')
        + `<div class="sp-line"><span class="direct">direct</span>`
          + `<span class="num">${gotoBtn(p.end)}</span>`
          + `<span class="dim num">${flon(p.endLon)}</span></div>`
        + (v.span ? `<div class="sp-line"><span class="sp-k dim">egress</span>`
          + `<span class="num">${gotoBtn(v.x.egress)}</span>`
          + `<span class="dim num">${flon(v.x.bOut)}</span></div>` : '')
        + `</div>`;
    }
    html += '</div>';
  }
  if (meta.dangling && meta.dangling.length)
    html += '<div class="search-status">' + meta.dangling.join('; ') + '.</div>';
  return html;
}

export function renderIngressHTML(results, calls, angleFmt = 'dms', totalFound = undefined) {
  const shown = results.slice(0, SEARCH_SHOW_MAX);
  let html = totalFound !== undefined && totalFound !== results.length
    ? `<div class="search-status">${results.length} of ${totalFound} ingresses`
      + ` into the selected signs (${calls} ephemeris evaluations)`
    : `<div class="search-status">${results.length} ingress${results.length === 1 ? '' : 'es'}`
      + ` found (${calls} ephemeris evaluations)`;
  if (results.length > shown.length) html += ` — showing first ${shown.length}`;
  html += '</div>';
  if (!results.length) return html;
  html += `<div class="csv-block">${csvDownloadButton('trigon-ingresses.csv')}<table><thead><tr><th>Date/Time (UTC)</th><th>Body</th><th>Ingress</th><th>Longitude</th></tr></thead><tbody>`;
  for (const r of shown) {
    const move = `${SIGNS[r.fromSign]} → ${SIGNS[r.toSign]}${r.retro ? ' <span class="retro">(retrograde)</span>' : ''}`;
    html += `<tr><td class="num">${gotoBtn(r.jd)}</td><td class="body">${SEARCH_BODIES[r.ib]}</td>`
      + `<td>${move}</td><td class="num">${fmtLon(r.lon, angleFmt)}</td></tr>`;
  }
  html += '</tbody></table></div>';
  // Mobile cards: the 4-column table is cramped at 393px.
  html += '<div class="ing-cards">';
  for (const r of shown) {
    const move = `${SIGNS[r.fromSign]} → ${SIGNS[r.toSign]}${r.retro ? ' <span class="retro">(retrograde)</span>' : ''}`;
    html += `<div class="ing-card"><div class="ac-date num">${gotoBtn(r.jd)}</div>`
      + `<div class="ac-line"><span class="body">${SEARCH_BODIES[r.ib]}</span>`
      + `<span>${move}</span><span class="dim num">${fmtLon(r.lon, angleFmt)}</span></div></div>`;
  }
  html += '</div>';
  return html;
}

// Yield to the event loop so progress paints and Cancel stays responsive.
const searchTick = () => new Promise(r => setTimeout(r, 0));
// Time-boxed chunking: run ~12 ms of work between yields instead of a
// fixed step count. A chained setTimeout(0) costs >=4 ms under the HTML
// timer-nesting clamp, so fixed small chunks spent most of their wall
// time paying that toll (duty cycles of 19-60% measured); a 12 ms budget
// amortizes it while staying under the 16.7 ms frame budget, so paints
// and Cancel clicks still land between chunks.
const CHUNK_MS = 12;

// Parallel scan driver: splits the range across Web Workers (each with
// its own WASM instance and ephemeris files), aggregates their progress,
// and merges results. Returns { results, totalFound, calls }, or null
// when a worker fails in a way the inline path can retry; genuine HTTP
// coverage errors and cancellation propagate. Chunk w owns roots in
// (edges[w], edges[w+1]]; non-first chunks seed their grid one step
// before their start so boundary brackets are whole.
async function runParallelScan(spec, ctl, onProgress) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const W = Math.max(2, Math.min(6, cores));
  const edges = splitRange(spec.jd0, spec.jd1, W);
  const workers = [];
  let cancelTimer = null;
  try {
    const all = Promise.all(edges.slice(0, W).map((edge, w) => new Promise((resolve, reject) => {
      const wk = new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' });
      workers.push(wk);
      wk.onmessage = e => {
        const o = e.data;
        if (o.type === 'progress') onProgress(w, o.f, W);
        else if (o.type === 'done') resolve(o);
        else if (o.type === 'error') {
          const err = new Error(o.message);
          if (o.httpStatus) err.httpStatus = o.httpStatus;
          reject(err);
        }
      };
      wk.onerror = e2 => reject(new Error('search worker failed: ' + (e2.message || 'unknown')));
      wk.postMessage({
        id: w, kind: spec.kind,
        gridFrom: w === 0 ? spec.jd0 : edge - spec.stepDays,
        fromExclusive: w === 0 ? spec.jd0 - 1 : edge,
        jd1: edges[w + 1], stepDays: spec.stepDays, mask: spec.mask,
        useSwiss: spec.useSwiss, bodies: spec.bodies,
        targetDegs: spec.targetDegs || [], conds: spec.conds || [],
      });
    })));
    const cancelled = new Promise((_, reject) => {
      cancelTimer = setInterval(() => { if (ctl.cancelled) reject(CANCELLED); }, 120);
    });
    const parts = await Promise.race([all, cancelled]);
    return {
      results: mergeTimedResults(parts.map(p => p.results), spec.keyOf),
      totalFound: parts.reduce((a, p) => a + p.totalFound, 0),
      calls: parts.reduce((a, p) => a + p.calls, 0),
    };
  } catch (e) {
    if (e === CANCELLED || (e && e.httpStatus)) throw e;
    return null; // worker infrastructure failure: caller retries inline
  } finally {
    if (cancelTimer) clearInterval(cancelTimer);
    for (const wk of workers) wk.terminate();
  }
}

// Workers pay their own startup (WASM + file loads), so they only earn
// their keep on long scans.
function parallelWorthIt(nSteps) {
  return nSteps >= 1500 && typeof Worker !== 'undefined'
    && ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) >= 2;
}

// env: {
//   el(id), readDateFields(p, seconds), writeDateFields(p, fields, seconds),
//   ensureWasm(onStatus), ensureSearchFiles(mod, useSwiss, jd0, jd1, onStatus, isCancelled),
//   JD_1CE, getLoaderArmed(), setLoaderArmed(bool)
// }
export function createSearchUI(env) {
  const { el, readDateFields, writeDateFields, ensureWasm, ensureSearchFiles, JD_1CE } = env;

  const readRange = prefix => readRangeValues(
    readDateFields(prefix + '-start', false), readDateFields(prefix + '-end', false));

  function searchUI(prefix) {
    const status = el(prefix + '-status'), prog = el(prefix + '-prog');
    const bar = prog.querySelector('.bar'), go = el(prefix + '-go'), cancel = el(prefix + '-cancel');
    // Progress repaints are throttled to 5% steps (20 updates per search):
    // the bar/status textContent + layout per update was a measurable
    // share of long-search wall time. The f=0 loading phase (file
    // downloads) always shows, as does the terminal state.
    let lastShown = -1;
    return {
      status,
      begin() {
        lastShown = -1;
        status.classList.remove('err'); status.textContent = '';
        el(prefix + '-results').innerHTML = '';
        prog.hidden = false; bar.style.width = '0%';
        go.disabled = true; cancel.disabled = false;
      },
      progress(f, msg) {
        const show = f <= 0 || f >= 1 || lastShown < 0
          || Math.floor(f / 0.05) > Math.floor(lastShown / 0.05);
        if (!show) return;
        lastShown = f;
        bar.style.width = (100 * Math.min(1, Math.max(0, f))).toFixed(1) + '%';
        if (msg !== undefined) status.textContent = msg;
      },
      end() { prog.hidden = true; go.disabled = false; cancel.disabled = true; },
      fail(e) {
        status.classList.add('err');
        status.textContent = 'Error: ' + (e && e.message ? e.message : String(e));
      },
    };
  }

  // Offer a one-click retry with the built-in ephemeris when Swiss data is
  // missing (e.g. years beyond the downloadable range).
  function moshierFallback(prefix, statusEl) {
    const br = document.createElement('br');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'ghost'; btn.style.marginTop = '8px';
    btn.textContent = 'Retry with built-in Moshier ephemeris';
    btn.addEventListener('click', () => {
      el(prefix + '-engine').value = 'moshier';
      statusEl.textContent = '';
      (prefix === 'asp' ? runAspectSearch : prefix === 'ing' ? runIngressSearch : runStationSearch)();
    });
    statusEl.appendChild(br);
    statusEl.appendChild(btn);
  }

  // One search at a time per tab; the other tab keeps its own results.
  let aspCtl = null, stnCtl = null, ingCtl = null;

  // ---- Aspect conditions (optional ANDed modifiers) ----------------------
  const COND_KEY = 'trigon.aspconds.v1';
  const refOpts = sel => [['a', 'A (first of pair)'], ['b', 'B (second of pair)'],
    ...SEARCH_BODIES.map((b, i) => [String(i), b])]
    .map(([v, l]) => `<option value="${v}"${String(sel) === v ? ' selected' : ''}>${l}</option>`).join('');
  const bodyOpts = (sel, max = 10) => SEARCH_BODIES.slice(0, max + 1)
    .map((b, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${b}</option>`).join('');
  const numOpts = (list, sel) => list
    .map(([v, l]) => `<option value="${v}"${sel === v ? ' selected' : ''}>${l}</option>`).join('');
  const SIGN_VALUE_OPTS = {
    sign: SIGNS.map((s, i) => [i, s]),
    ruler: [[0, 'Sun'], [1, 'Moon'], [2, 'Mercury'], [3, 'Venus'], [4, 'Mars'], [5, 'Jupiter'], [6, 'Saturn']],
    element: SIGN_ELEMENT_NAMES.map((s, i) => [i, s]),
    quad: SIGN_QUAD_NAMES.map((s, i) => [i, s]),
    same: [['a', 'same sign as A'], ['b', 'same sign as B']],
  };

  function condFieldsHTML(c) {
    switch (c.type) {
      case 'aspect':
        return `<select class="f-from" aria-label="From body">${refOpts(c.from ?? 'a')}</select>`
          + `<select class="f-deg" aria-label="Aspect">${ASPECTS.map(a =>
            `<option value="${a.deg}"${c.deg === a.deg ? ' selected' : ''}>${a.glyph} ${a.name} ${a.deg}°</option>`).join('')}</select>`
          + `<select class="f-to" aria-label="To body">${refOpts(c.to ?? 'b')}</select>`
          + `<select class="f-amode" aria-label="Aspect mode">`
          + `<option value="orb"${c.mode !== 'signbased' ? ' selected' : ''}>within orb</option>`
          + `<option value="signbased"${c.mode === 'signbased' ? ' selected' : ''}>by sign (no orb)</option></select>`
          + `<input class="f-orb" type="number" min="0" max="30" step="0.5" value="${c.orb ?? 3}"`
          + ` aria-label="Orb in degrees"${c.mode === 'signbased' ? ' disabled' : ''}>`;
      case 'motion':
        return `<select class="f-body" aria-label="Body">${bodyOpts(c.body ?? 2)}</select>`
          + `<select class="f-dir" aria-label="Direction">`
          + `<option value="direct"${c.dir !== 'retrograde' ? ' selected' : ''}>is direct</option>`
          + `<option value="retrograde"${c.dir === 'retrograde' ? ' selected' : ''}>is retrograde</option></select>`;
      case 'speed':
        return `<select class="f-body" aria-label="Body">${bodyOpts(c.body ?? 2, 9)}</select>`
          + `<span class="dim">speed percentile</span>`
          + `<input class="f-min" type="number" min="0" max="100" step="1" placeholder="min" value="${c.min ?? ''}" aria-label="Minimum percentile">`
          + `<span class="dim">to</span>`
          + `<input class="f-max" type="number" min="0" max="100" step="1" placeholder="max" value="${c.max ?? ''}" aria-label="Maximum percentile">`;
      case 'phase':
        return `<select class="f-body" aria-label="Body">${bodyOpts(c.body ?? 3, 10).replace('value="0"', 'value="0" disabled')}</select>`
          + `<select class="f-phase" aria-label="Phase">`
          + [['morning', 'morning (oriental)'], ['evening', 'evening (occidental)'],
             ['combust', 'combust (≤8.5° from Sun)'], ['beams', 'under the beams (≤15°)']]
            .map(([v, l]) => `<option value="${v}"${c.phase === v ? ' selected' : ''}>${l}</option>`).join('') + '</select>';
      default: // sign
        return `<select class="f-who" aria-label="Whose sign">${refOpts(c.who ?? 'a')}</select>`
          + `<select class="f-mode" aria-label="Sign filter">`
          + [['sign', 'is in sign'], ['ruler', 'is in a sign ruled by'], ['element', 'is in element'],
             ['quad', 'is in quadruplicity'], ['same', 'is co-present with']]
            .map(([v, l]) => `<option value="${v}"${(c.mode ?? 'sign') === v ? ' selected' : ''}>${l}</option>`).join('')
          + `</select>`
          + `<select class="f-value" aria-label="Sign filter value">${numOpts(SIGN_VALUE_OPTS[c.mode ?? 'sign'], c.value ?? 0)}</select>`;
    }
  }

  function condRowHTML(c) {
    return `<div class="cond-row">`
      + `<select class="cond-type" aria-label="Condition type">`
      + [['sign', 'Sign'], ['aspect', 'Aspect'], ['motion', 'Motion'], ['speed', 'Speed'], ['phase', 'Heliacal phase']]
        .map(([v, l]) => `<option value="${v}"${c.type === v ? ' selected' : ''}>${l}</option>`).join('') + '</select>'
      + `<span class="cond-fields">${condFieldsHTML(c)}</span>`
      + `<button type="button" class="mini ghost cond-remove">remove</button></div>`;
  }

  const parseRef = v => (v === 'a' || v === 'b') ? v : parseInt(v, 10);
  const numOrNull = v => v === '' ? null : parseFloat(v);

  function readConditionRow(row) {
    const q = s => row.querySelector(s);
    const type = q('.cond-type').value;
    // When the type select was just changed, the row still carries the
    // previous type's fields: fall back to that type's default spec.
    switch (type) {
      case 'aspect':
        if (!q('.f-from')) return { type, from: 'a', to: 'b', deg: 0, mode: 'orb', orb: 3 };
        return { type, from: parseRef(q('.f-from').value), to: parseRef(q('.f-to').value),
          deg: parseInt(q('.f-deg').value, 10), mode: q('.f-amode').value, orb: parseFloat(q('.f-orb').value) };
      case 'motion':
        if (!q('.f-dir')) return { type, body: 2, dir: 'direct' };
        return { type, body: parseInt(q('.f-body').value, 10), dir: q('.f-dir').value };
      case 'speed':
        if (!q('.f-min')) return { type, body: 2, min: null, max: null };
        return { type, body: parseInt(q('.f-body').value, 10),
          min: numOrNull(q('.f-min').value), max: numOrNull(q('.f-max').value) };
      case 'phase':
        if (!q('.f-phase')) return { type, body: 3, phase: 'morning' };
        return { type, body: parseInt(q('.f-body').value, 10), phase: q('.f-phase').value };
      default: {
        if (!q('.f-who')) return { type: 'sign', who: 'a', mode: 'sign', value: 0 };
        const mode = q('.f-mode').value;
        const raw = q('.f-value').value;
        return { type: 'sign', who: parseRef(q('.f-who').value), mode,
          value: mode === 'same' ? raw : parseInt(raw, 10) };
      }
    }
  }

  function readConditionGroups() {
    return [...el('asp-conds').querySelectorAll('.cond-group')]
      .map(g => [...g.querySelectorAll('.cond-row')].map(readConditionRow))
      .filter(g => g.length);
  }

  function saveConditions() {
    try { localStorage.setItem(COND_KEY, JSON.stringify(readConditionGroups())); } catch { /* storage unavailable */ }
  }

  const defaultCond = () => ({ type: 'sign', who: 'a', mode: 'sign', value: 0 });

  function condGroupHTML(group, gi) {
    const subs = group.map((c, ci) =>
      (ci ? '<div class="cond-or">OR</div>' : '') + condRowHTML(c)).join('');
    return `<div class="cond-group"><div class="cond-group-head"><span>Group ${gi + 1} — any of (OR)</span>`
      + `<button type="button" class="mini ghost cond-group-remove">remove group</button></div>`
      + `<div class="cond-subs">${subs}</div>`
      + `<button type="button" class="mini ghost cond-add-or">add OR condition</button></div>`;
  }

  function renderConditions(groups) {
    el('asp-conds').innerHTML = groups.map(condGroupHTML).join('');
  }

  function loadConditions() {
    let groups = [];
    try {
      const raw = localStorage.getItem(COND_KEY);
      // Older saves were a flat list of conditions; normalizeConditionGroups
      // wraps each into its own group (same meaning under AND).
      if (raw) { const p = JSON.parse(raw); if (Array.isArray(p)) groups = normalizeConditionGroups(p); }
    } catch { groups = []; }
    renderConditions(groups);
  }

  // Read + validate the condition groups for a search run.
  function readConditions() {
    const groups = readConditionGroups();
    const err = validateConditions(groups);
    if (err) throw new Error(err);
    saveConditions();
    return groups;
  }

  async function runAspectSearch() {
    if (aspCtl) return;
    const ctl = aspCtl = { cancelled: false };
    const ui = searchUI('asp');
    const prevArmed = env.getLoaderArmed(); env.setLoaderArmed(false);
    let eph = null, jd0 = Infinity;
    try {
      const range = readRange('asp');
      jd0 = range.jd0;
      const jd1 = range.jd1;
      const eclipsesOnly = el('asp-eclipses').checked;
      // "Eclipses only" scopes the search to Sun-Moon syzygies (new and full
      // moons); the eclipse verdict is computed for every one of them anyway.
      const targets = eclipsesOnly
        ? ASPECTS.filter(a => a.deg === 0 || a.deg === 180)
        : ASPECTS.filter(a => el('asp-t' + a.deg).checked);
      const bodies = eclipsesOnly ? [0, 1]
        : SEARCH_BODIES.map((_, i) => i).filter(i => el('asp-b' + i).checked);
      if (!targets.length) throw new Error('pick at least one aspect');
      if (bodies.length < 2) throw new Error('pick at least two bodies');
      const conds = readConditions();
      const useSwiss = el('asp-engine').value === 'swiss';
      // BCE ranges require the Swiss data files (Moshier degrades far from
      // the present).
      if (jd0 < JD_1CE && !useSwiss)
        throw new Error('BCE ranges require the Swiss Ephemeris data files (Moshier is not accurate this far back).');
      ui.begin();
      // Phase 1 step: adapts to the fastest selected pair (provable 45°
      // bound); long scans fan out to Web Workers, one slice per core.
      const stepDays = aspectGridStep(bodies);
      const n = Math.ceil((jd1 - jd0) / stepDays);
      let results = null, totalFound = 0, callCount = 0;
      if (parallelWorthIt(n)) {
        const mask = [...new Set([...bodies, ...conditionBodies(conds)])]
          .reduce((mm, i) => mm | (1 << i), 0);
        const fracs = [];
        const par = await runParallelScan({
          kind: 'aspects', jd0, jd1, stepDays, mask, useSwiss, bodies,
          targetDegs: targets.map(t => t.deg), conds,
          keyOf: r => `${r.jd.toFixed(6)}|${r.ia}|${r.ib}|${r.deg}`,
        }, ctl, (w, f, W) => {
          fracs[w] = f;
          const mean = fracs.reduce((a, x) => a + (x || 0), 0) / W;
          ui.progress(mean, `Scanning (${W} workers)…`);
        });
        if (par) { results = par.results; totalFound = par.totalFound; callCount = par.calls; }
      }
      if (!results) {
      const mod = await ensureWasm(msg => ui.progress(0, msg));
      if (ctl.cancelled) throw CANCELLED;
      await ensureSearchFiles(mod, useSwiss, jd0, jd1, msg => ui.progress(0, msg), () => ctl.cancelled);
      if (ctl.cancelled) throw CANCELLED;
      eph = ephProvider(mod, useSwiss,
        [...new Set([...bodies, ...conditionBodies(conds)])].reduce((m, i) => m | (1 << i), 0));
      const guard = jd => { if (ctl.cancelled) throw CANCELLED; return eph(jd); };
      const grid = [];
      let cs = performance.now();
      for (let k = 0; k <= n; k++) {
        const jd = k === n ? jd1 : jd0 + k * stepDays;
        const s = guard(jd);
        grid.push({ jd, lon: s.lon, spd: s.spd });
        if (performance.now() - cs >= CHUNK_MS) {
          ui.progress(0.85 * k / n, `Scanning ${k}/${n} steps…`);
          await searchTick(); cs = performance.now();
        }
      }
      ui.progress(0.85, `Scanning ${n}/${n} steps…`);
      // Phase 2: bracket + refine per pair/target.
      const pairs = [];
      for (let i = 0; i < bodies.length; i++)
        for (let j = i + 1; j < bodies.length; j++) pairs.push([bodies[i], bodies[j]]);
      const total = pairs.length * targets.length;
      results = [];
      let done = 0;
      for (const [ia, ib] of pairs) {
        for (const t of targets) {
          for (const jd of aspectRoots(grid, guard, ia, ib, t.deg)) {
            const s = guard(jd);  // snapshot at the exact moment
            totalFound++;
            if (conds.length && !evaluateConditions(conds, s, ia, ib)) continue;
            const r = { jd, ia, ib, deg: t.deg, lonA: s.lon[ia], lonB: s.lon[ib] };
            if (conds.length) r.condText = explainConditions(conds, s, ia, ib);
            // Idiosyncratic check: Sun-Moon conjunctions/oppositions are
            // lunations (pairs are built with ia < ib, so Sun-Moon is (0,1)).
            if (ia === 0 && ib === 1 && (t.deg === 0 || t.deg === 180))
              r.eclipse = eclipseAtSyzygy(mod, jd, t.deg === 180, useSwiss);
            results.push(r);
          }
          done++;
          if (performance.now() - cs >= CHUNK_MS) {
            ui.progress(0.85 + 0.15 * done / total, `Refining ${done}/${total}…`);
            await searchTick(); cs = performance.now();
          }
        }
      }
      callCount = eph.calls();
      }
      if (ctl.cancelled) throw CANCELLED;
      results.sort((a, b) => a.jd - b.jd);
      const shown = eclipsesOnly ? results.filter(isEclipseResult) : results;
      ui.status.textContent = '';
      el('asp-results').innerHTML =
        renderAspectHTML(shown, callCount, env.getAngleFmt(), eclipsesOnly ? 'eclipse' : 'perfecting',
          conds.length ? totalFound : undefined, conds.length);
    } catch (e) {
      if (e === CANCELLED || (e && e.cancelled)) ui.progress(1, 'Cancelled.');
      else if (e && e.httpStatus === 404) {
        ui.fail(new Error('Swiss ephemeris data is not downloadable for part of this range.'));
        // BCE ranges require the Swiss data files (Moshier degrades far from
        // the present), so no fallback is offered for them.
        if (jd0 >= JD_1CE) moshierFallback('asp', ui.status);
      } else ui.fail(e);
    } finally {
      if (eph) eph.free();
      env.setLoaderArmed(prevArmed); ui.end(); aspCtl = null;
    }
  }

  // Checked sign filters (stn/ing panels); empty selection = no filter.
  function readSignSelection(prefix) {
    const sel = [];
    for (let i = 0; i < 12; i++) {
      const cb = el(prefix + '-s' + i);
      if (cb && cb.checked) sel.push(i);
    }
    return sel;
  }

  async function runStationSearch() {
    if (stnCtl) return;
    const ctl = stnCtl = { cancelled: false };
    const ui = searchUI('stn');
    const prevArmed = env.getLoaderArmed(); env.setLoaderArmed(false);
    let eph = null, jd0 = Infinity;
    try {
      const range = readRange('stn');
      jd0 = range.jd0;
      const jd1 = range.jd1;
      const planets = STATION_PLANETS.map((_, k) => k + 2).filter(ib => el('stn-p' + ib).checked);
      if (!planets.length) throw new Error('pick at least one planet');
      const useSwiss = el('stn-engine').value === 'swiss';
      // BCE ranges require the Swiss data files (Moshier degrades far from
      // the present).
      if (jd0 < JD_1CE && !useSwiss)
        throw new Error('BCE ranges require the Swiss Ephemeris data files (Moshier is not accurate this far back).');
      ui.begin();
      const mod = await ensureWasm(msg => ui.progress(0, msg));
      if (ctl.cancelled) throw CANCELLED;
      await ensureSearchFiles(mod, useSwiss, jd0, jd1, msg => ui.progress(0, msg), () => ctl.cancelled);
      if (ctl.cancelled) throw CANCELLED;
      // Bit 0 (the Sun) rides along: the Sun-event search needs it.
      eph = ephProvider(mod, useSwiss, planets.reduce((m, ib) => m | (1 << ib), 0) | 1);
      const guard = jd => { if (ctl.cancelled) throw CANCELLED; return eph(jd); };
      // Phase 1: coarse grid.
      const n = Math.ceil((jd1 - jd0) / SCAN_STEP);
      const grid = [];
      let cs = performance.now();
      for (let k = 0; k <= n; k++) {
        const jd = k === n ? jd1 : jd0 + k * SCAN_STEP;
        const s = guard(jd);
        grid.push({ jd, lon: s.lon, spd: s.spd });
        if (performance.now() - cs >= CHUNK_MS) {
          ui.progress(0.85 * k / n, `Scanning ${k}/${n} steps…`);
          await searchTick(); cs = performance.now();
        }
      }
      ui.progress(0.85, `Scanning ${n}/${n} steps…`);
      // Phase 2: station roots per planet.
      const stations = [];
      for (let p = 0; p < planets.length; p++) {
        const ib = planets[p];
        for (const s of stationRoots(grid, guard, ib)) {
          s.lon = guard(s.jd).lon[ib];
          stations.push({ ib, ...s });
        }
        ui.progress(0.85 + 0.15 * (p + 1) / planets.length, `Refining ${p + 1}/${planets.length}…`);
        if (performance.now() - cs >= CHUNK_MS) { await searchTick(); cs = performance.now(); }
      }
      if (ctl.cancelled) throw CANCELLED;
      stations.sort((a, b) => a.jd - b.jd);
      // Extended periods: shadow ingress/egress around each loop plus the
      // Sun event inside it (inferior conjunction for Mercury/Venus,
      // opposition for the rest). Best-effort per period: the shadow
      // reaches outside the searched range, where the ephemeris may have
      // no data (Swiss files are fetched for the range only) — a missing
      // shadow must not sink the station results.
      const extra = new Map();
      const { periods, dangling } = derivePeriods(stations);
      {
        const sunRootsByPlanet = new Map();
        for (const p of periods) {
          if (!sunRootsByPlanet.has(p.ib))
            sunRootsByPlanet.set(p.ib, aspectRoots(grid, guard, p.ib, 0, p.ib <= 3 ? 0 : 180));
          const x = { ingress: null, egress: null, sunJd: null };
          const sr = sunRootsByPlanet.get(p.ib).find(jd => jd > p.start && jd < p.end);
          if (sr !== undefined) x.sunJd = sr;
          try {
            const b = shadowBounds(p.ib, p.startLon, p.endLon);
            x.ingress = boundaryCrossingBefore(guard, p.ib, b.bIn, p.start);
            x.egress = boundaryCrossingAfter(guard, p.ib, b.bOut, p.end);
            x.bIn = b.bIn; x.bOut = b.bOut;
          } catch (e) {
            if (e === CANCELLED || ctl.cancelled) throw CANCELLED;
            x.ingress = x.egress = null;
          }
          extra.set(p.ib + '|' + p.start, x);
        }
      }
      if (ctl.cancelled) throw CANCELLED;
      // Sign filter: a period matches when either station falls in a
      // selected sign (shadow ingress/egress are NOT considered).
      const signSel = readSignSelection('stn');
      const shownPeriods = signSel.length
        ? periods.filter(p => {
            const signs = periodSignSet(p.startLon, p.endLon);
            return signSel.some(sg => signs.has(sg));
          })
        : periods;
      ui.status.textContent = '';
      el('stn-results').innerHTML = renderRetrogradeHTML(shownPeriods,
        eph.calls(), env.getAngleFmt(), extra,
        { total: periods.length, dangling, filtered: signSel.length > 0 });
    } catch (e) {
      if (e === CANCELLED || (e && e.cancelled)) ui.progress(1, 'Cancelled.');
      else if (e && e.httpStatus === 404) {
        ui.fail(new Error('Swiss ephemeris data is not downloadable for part of this range.'));
        // BCE ranges require the Swiss data files (Moshier degrades far from
        // the present), so no fallback is offered for them.
        if (jd0 >= JD_1CE) moshierFallback('stn', ui.status);
      } else ui.fail(e);
    } finally {
      if (eph) eph.free();
      env.setLoaderArmed(prevArmed); ui.end(); stnCtl = null;
    }
  }

  async function runIngressSearch() {
    if (ingCtl) return;
    const ctl = ingCtl = { cancelled: false };
    const ui = searchUI('ing');
    const prevArmed = env.getLoaderArmed(); env.setLoaderArmed(false);
    let eph = null, jd0 = Infinity;
    try {
      const range = readRange('ing');
      jd0 = range.jd0;
      const jd1 = range.jd1;
      const bodies = SEARCH_BODIES.map((_, i) => i).filter(i => el('ing-b' + i).checked);
      if (!bodies.length) throw new Error('pick at least one body');
      const useSwiss = el('ing-engine').value === 'swiss';
      // BCE ranges require the Swiss data files (Moshier degrades far from
      // the present).
      if (jd0 < JD_1CE && !useSwiss)
        throw new Error('BCE ranges require the Swiss Ephemeris data files (Moshier is not accurate this far back).');
      ui.begin();
      // The step follows the fastest selected body (under ~15° of motion
      // per step), so no sign boundary is skipped. Long scans fan out to
      // Web Workers, one slice per core.
      const stepDays = ingressScanStep(bodies);
      const n = Math.ceil((jd1 - jd0) / stepDays);
      let results = null, callCount = 0;
      if (parallelWorthIt(n)) {
        const mask = bodies.reduce((mm, i) => mm | (1 << i), 0);
        const fracs = [];
        const par = await runParallelScan({
          kind: 'ingresses', jd0, jd1, stepDays, mask, useSwiss, bodies,
          keyOf: r => `${r.jd.toFixed(6)}|${r.ib}`,
        }, ctl, (w, f, W) => {
          fracs[w] = f;
          const mean = fracs.reduce((a, x) => a + (x || 0), 0) / W;
          ui.progress(mean, `Scanning (${W} workers)…`);
        });
        if (par) { results = par.results; callCount = par.calls; }
      }
      if (!results) {
      const mod = await ensureWasm(msg => ui.progress(0, msg));
      if (ctl.cancelled) throw CANCELLED;
      await ensureSearchFiles(mod, useSwiss, jd0, jd1, msg => ui.progress(0, msg), () => ctl.cancelled);
      if (ctl.cancelled) throw CANCELLED;
      eph = ephProvider(mod, useSwiss, bodies.reduce((m, i) => m | (1 << i), 0));
      const guard = jd => { if (ctl.cancelled) throw CANCELLED; return eph(jd); };
      const grid = [];
      let cs = performance.now();
      for (let k = 0; k <= n; k++) {
        const jd = k === n ? jd1 : jd0 + k * stepDays;
        const s = guard(jd);
        grid.push({ jd, lon: s.lon, spd: s.spd });
        if (performance.now() - cs >= CHUNK_MS) {
          ui.progress(0.85 * k / n, `Scanning ${k}/${n} steps…`);
          await searchTick(); cs = performance.now();
        }
      }
      ui.progress(0.85, `Scanning ${n}/${n} steps…`);
      // Phase 2: bracket + refine per body.
      results = [];
      for (let p = 0; p < bodies.length; p++) {
        results.push(...ingressRoots(grid, guard, bodies[p]));
        ui.progress(0.85 + 0.15 * (p + 1) / bodies.length, `Refining ${p + 1}/${bodies.length}…`);
        if (performance.now() - cs >= CHUNK_MS) { await searchTick(); cs = performance.now(); }
      }
      callCount = eph.calls();
      }
      if (ctl.cancelled) throw CANCELLED;
      results.sort((a, b) => a.jd - b.jd);
      // Sign filter: keep ingresses into the selected signs.
      const signSel = readSignSelection('ing');
      const totalIng = results.length;
      if (signSel.length) results = results.filter(r => signSel.includes(r.toSign));
      ui.status.textContent = '';
      el('ing-results').innerHTML = renderIngressHTML(results, callCount, env.getAngleFmt(),
        signSel.length ? totalIng : undefined);
    } catch (e) {
      if (e === CANCELLED || (e && e.cancelled)) ui.progress(1, 'Cancelled.');
      else if (e && e.httpStatus === 404) {
        ui.fail(new Error('Swiss ephemeris data is not downloadable for part of this range.'));
        if (jd0 >= JD_1CE) moshierFallback('ing', ui.status);
      } else ui.fail(e);
    } finally {
      if (eph) eph.free();
      env.setLoaderArmed(prevArmed); ui.end(); ingCtl = null;
    }
  }

  // Default a search range (UTC) from an epoch-ms instant. Search ranges are
  // not tied to a chart location, so they stay in UTC for both eras.
  function writeFieldsFromMs(prefix, ms) {
    const c = calFromJd(ms / 86400000 + JD_UNIX_EPOCH);
    const s = Math.min(86399, Math.floor(c.hourUT * 3600 + 1e-3));
    writeDateFields(prefix, {
      y: c.y, mo: c.mo, d: c.d,
      hh: Math.floor(s / 3600), mi: Math.floor((s % 3600) / 60),
    }, false);
  }

  function buildSearchCheckboxes() {
    el('asp-aspects').innerHTML = ASPECTS.map(a =>
      `<label><input type="checkbox" id="asp-t${a.deg}" checked><span class="gl">${a.glyph}</span> ${a.name} ${a.deg}°</label>`
    ).join('');
    el('asp-bodies').innerHTML = SEARCH_BODIES.map((b, i) =>
      `<label><input type="checkbox" id="asp-b${i}" checked>${b}</label>`
    ).join('');
    el('stn-planets').innerHTML = STATION_PLANETS.map((b, k) =>
      `<label><input type="checkbox" id="stn-p${k + 2}" checked>${SEARCH_BODIES[b]}</label>`
    ).join('');
    el('ing-bodies').innerHTML = SEARCH_BODIES.map((b, i) =>
      `<label><input type="checkbox" id="ing-b${i}" checked>${b}</label>`
    ).join('');
    el('stn-signs').innerHTML = SIGNS.map((g, i) =>
      `<label><input type="checkbox" id="stn-s${i}">${g}</label>`
    ).join('');
    el('ing-signs').innerHTML = SIGNS.map((g, i) =>
      `<label><input type="checkbox" id="ing-s${i}">${g}</label>`
    ).join('');
    const wire = (allId, noneId, sel) => {
      el(allId).addEventListener('click', () => document.querySelectorAll(sel).forEach(c => c.checked = true));
      el(noneId).addEventListener('click', () => document.querySelectorAll(sel).forEach(c => c.checked = false));
    };
    wire('stn-sall', 'stn-snone', '#stn-signs input');
    wire('ing-sall', 'ing-snone', '#ing-signs input');
    wire('asp-tall', 'asp-tnone', '#asp-aspects input');
    wire('asp-ball', 'asp-bnone', '#asp-bodies input');
    wire('stn-pall', 'stn-pnone', '#stn-planets input');
    wire('ing-ball', 'ing-bnone', '#ing-bodies input');
  }

  function initSearchTabs() {
    buildSearchCheckboxes();
    const now = Date.now();
    writeFieldsFromMs('asp-start', now);
    writeFieldsFromMs('asp-end', now + 365 * 86400000);
    writeFieldsFromMs('stn-start', now);
    writeFieldsFromMs('stn-end', now + 365 * 86400000);
    writeFieldsFromMs('ing-start', now);
    writeFieldsFromMs('ing-end', now + 365 * 86400000);
    el('asp-go').addEventListener('click', runAspectSearch);
    el('asp-cancel').addEventListener('click', () => { if (aspCtl) aspCtl.cancelled = true; });
    // "Eclipses only" takes over the aspect/body pickers (Sun-Moon syzygies);
    // disable them while it is checked so the override is visible.
    el('asp-eclipses').addEventListener('change', () => {
      const dis = el('asp-eclipses').checked;
      document.querySelectorAll('#asp-aspects input, #asp-bodies input, #asp-tall, #asp-tnone, #asp-ball, #asp-bnone')
        .forEach(c => c.disabled = dis);
    });
    loadConditions();
    el('asp-cond-add').addEventListener('click', () => {
      renderConditions([...readConditionGroups(), [defaultCond()]]);
      saveConditions();
    });
    el('asp-conds').addEventListener('click', e => {
      const groups = readConditionGroups();
      const groupEls = [...el('asp-conds').querySelectorAll('.cond-group')];
      const addOr = e.target.closest('.cond-add-or');
      const rmRow = e.target.closest('.cond-remove');
      const rmGrp = e.target.closest('.cond-group-remove');
      if (addOr) {
        const gi = groupEls.indexOf(addOr.closest('.cond-group'));
        if (gi >= 0 && groups[gi]) groups[gi].push(defaultCond());
      } else if (rmRow) {
        const gi = groupEls.indexOf(rmRow.closest('.cond-group'));
        const rowEls = [...rmRow.closest('.cond-group').querySelectorAll('.cond-row')];
        const ci = rowEls.indexOf(rmRow.closest('.cond-row'));
        if (gi >= 0 && groups[gi]) groups[gi].splice(ci, 1);
      } else if (rmGrp) {
        const gi = groupEls.indexOf(rmGrp.closest('.cond-group'));
        if (gi >= 0) groups.splice(gi, 1);
      } else return;
      renderConditions(groups.filter(g => g.length));
      saveConditions();
    });
    el('asp-conds').addEventListener('change', e => {
      // Type/mode changes swap the dependent controls: rebuild the groups
      // from their current values, then persist.
      if (e.target.classList.contains('cond-type') || e.target.classList.contains('f-mode')
        || e.target.classList.contains('f-amode'))
        renderConditions(readConditionGroups());
      saveConditions();
    });
    el('stn-go').addEventListener('click', runStationSearch);
    el('stn-cancel').addEventListener('click', () => { if (stnCtl) stnCtl.cancelled = true; });
    el('ing-go').addEventListener('click', runIngressSearch);
    el('ing-cancel').addEventListener('click', () => { if (ingCtl) ingCtl.cancelled = true; });
    // "Animate" buttons on retrograde periods: play the period in the sky
    // view with the camera tracking the planet. Event delegation survives
    // the results innerHTML rebuilds.
    el('stn-results').addEventListener('click', e => {
      const b = e.target.closest('button[data-anim-period]');
      if (!b || typeof env.animateRetrogradePeriod !== 'function') return;
      env.animateRetrogradePeriod({
        ib: parseInt(b.dataset.ib, 10),
        startJd: parseFloat(b.dataset.start),
        endJd: parseFloat(b.dataset.end),
      });
    });
    // Date cells: click sets the main chart datetime to that instant.
    // Delegation covers the desktop tables and the mobile cards alike.
    for (const id of ['asp-results', 'stn-results', 'ing-results']) {
      el(id).addEventListener('click', e => {
        const b = e.target.closest('button[data-goto-jd]');
        if (!b || typeof env.gotoSearchInstant !== 'function') return;
        env.gotoSearchInstant(parseFloat(b.dataset.gotoJd));
      });
    }
  }

  return { initSearchTabs, runAspectSearch, runStationSearch, runIngressSearch };
}
