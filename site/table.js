// table.js — pure builders for the results table.
//
// tableRows/out shape: the 84-double array from chart_compute. Bodies 0..10
// (Sun..True Node) occupy slots i*6: [lon, lat, dist, speedLon, ..., dec,
// mag]; out[72]=Asc, out[73]=MC, out[74+i]=house of body i. The True Node
// (index 10) shows dashes for declination/speed/magnitude/house. (The Mean
// Node is not displayed anywhere.)
// No DOM: both functions return strings / row structs and take the angle
// format explicitly, so they import cleanly in node for tests.
import { fmtLon, fmtDec, fmtSpeedDR, motionOf, fmtMag, dash, csvDownloadButton, BODY_GLYPHS, PLANET_COLORS, signColor } from './format.js';
import { speedPercentile, speedZ, speedColor } from './speed-stats.js';
import { magBrightness } from './mag-stats.js';
import { decanLord, egyptianBoundLord, triplicityLords, exaltationLord, d12Lord, d9Lord, domicileLord, pointLords } from './dignities.js';

export const BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
                       'Saturn', 'Uranus', 'Neptune', 'Pluto',
                       'True Node'];

/** @param {string} name @param {boolean} glyphs @returns {string} */
const pName = (name, glyphs) => glyphs && BODY_GLYPHS[name] ? BODY_GLYPHS[name] : name;

/** Longitude text with the sign name/glyph wrapped in its element color. */
function lonHTML(lonDeg, fmt, glyphs) {
  const text = fmtLon(lonDeg, fmt, glyphs);
  if (fmt === 'dec') return text;
  const sp = text.indexOf(' ');
  const sIdx = Math.floor(((lonDeg % 360) + 360) % 360 / 30);
  return `<span style="color:${signColor(sIdx)}">${text.slice(0, sp)}</span>${text.slice(sp)}`;
}

/** Magnitude display: a glow that strengthens as the body outshines its
 * own 1800–2300 norm (brightness percentile from mag-stats). */
function magHTML(bodyIdx, mag) {
  const { pct, z } = magBrightness(bodyIdx, mag);
  const tip = `mag ${mag.toFixed(2)} — brighter than ${pct.toFixed(0)}% of 1800–2300 (z ${z >= 0 ? '+' : ''}${z.toFixed(1)})`;
  if (!(pct > 50)) return `<span title="${tip}">${fmtMag(mag)}</span>`;
  const k = (pct - 50) / 50; // 0..1
  const blur = (4 + 10 * k).toFixed(1);
  const alpha = (0.35 + 0.6 * k).toFixed(2);
  return `<span class="mag-glow" title="${tip}" style="text-shadow:0 0 ${blur}px rgba(255,236,170,${alpha})">${fmtMag(mag)}</span>`;
}

export function tableRows(out, fmt = 'dms', dig = undefined, glyphs = false) {
  const rows = [];
  for (let i = 0; i < 11; i++) {
    const o = i * 6, isNode = i >= 10;
    // Speed percentile indicator: where the current |speed| falls in the
    // body's 500-year distribution (red = slow end/minima, green = fast end/maxima).
    // spdZ is the z-score (in sigmas) behind the percentile.
    let spdPct = null, spdZ = null, spdColor = null, spdTip = null;
    if (!isNode) {
      const absV = Math.abs(out[o + 3]);
      spdPct = speedPercentile(i, absV);
      spdZ = speedZ(i, absV);
      spdColor = speedColor(spdPct);
      spdTip = `|v| ${absV.toPrecision(3)}°/day — faster than ${spdPct.toFixed(0)}% of the time (z ${spdZ >= 0 ? '+' : ''}${spdZ.toFixed(1)})`;
    }
    // Dignity lords for the seven classical planets (pre-modern set);
    // null elsewhere. Requires the dignity options (decan method +
    // day/night), which only the app can supply.
    let dign = null, dignCol = null;
    if (dig && i < 7) {
      const lon = out[o];
      const trip = triplicityLords(lon, dig.isDay);
      const ex = exaltationLord(lon);
      dign = {
        domicile: BODIES[domicileLord(lon)],
        decan: BODIES[decanLord(lon, dig.decan)],
        bound: BODIES[egyptianBoundLord(lon)],
        trip: BODIES[trip[0]],
        tripFull: trip.map(x => BODIES[x]).join(' · '),
        exalt: ex == null ? null : BODIES[ex],
        d12: BODIES[d12Lord(lon)],
        d9: BODIES[d9Lord(lon)],
      };
      dignCol = {
        domicile: PLANET_COLORS[domicileLord(lon)], decan: PLANET_COLORS[decanLord(lon, dig.decan)],
        bound: PLANET_COLORS[egyptianBoundLord(lon)], trip: PLANET_COLORS[trip[0]],
        exalt: ex == null ? null : PLANET_COLORS[ex],
        d12: PLANET_COLORS[d12Lord(lon)], d9: PLANET_COLORS[d9Lord(lon)],
      };
    }
    const spdFull = isNode ? dash : fmtSpeedDR(out[o + 3], fmt);
    rows.push({
      body: pName(BODIES[i], glyphs),
      color: PLANET_COLORS[i],
      ib: i,
      dim: isNode,
      lon: fmtLon(out[o], fmt, glyphs),
      lonHtml: lonHTML(out[o], fmt, glyphs),
      dec: isNode ? dash : fmtDec(out[o + 4], fmt),
      spd: spdFull,
      spdMag: isNode ? dash : spdFull.slice(0, -2),
      spdDir: isNode ? null : spdFull.slice(-1),
      spdPct, spdZ, spdColor, spdTip,
      dign: dign && {
        domicile: pName(dign.domicile, glyphs), decan: pName(dign.decan, glyphs),
        bound: pName(dign.bound, glyphs), trip: pName(dign.trip, glyphs),
        tripFull: dign.tripFull.split(' · ').map(n => pName(n, glyphs)).join(' · '),
        exalt: dign.exalt == null ? null : pName(dign.exalt, glyphs),
        d12: pName(dign.d12, glyphs), d9: pName(dign.d9, glyphs),
      },
      dignCol,
      mot: isNode ? dash : motionOf(out[o + 3]),
      retro: !isNode && out[o + 3] < 0,
      mag: isNode ? dash : fmtMag(out[o + 5]),
      magHtml: isNode ? dash : magHTML(i, out[o + 5]),
      house: isNode ? dash : String(Math.round(out[74 + i])),
    });
  }
  return rows;
}

/**
 * Ascendant/Descendant/Midheaven/IC rows for the bottom of the table:
 * the angles with their dignity lords (lords apply to any point).
 * @param {number[]} out
 * @param {{decan: 'chaldean'|'indian', isDay: boolean}|undefined} dig
 * @param {string} [fmt]
 * @param {boolean} [glyphs]
 * @returns {{body: string, lon: string, dign: object|null}[]}
 */
export function angleRows(out, dig, fmt = 'dms', glyphs = false) {
  const defs = [
    ['Ascendant', out[72]], ['Descendant', out[72] + 180],
    ['Midheaven', out[73]], ['IC', out[73] + 180],
  ];
  return defs.map(([name, raw]) => {
    const lon = ((raw % 360) + 360) % 360;
    let dign = null, dignCol = null;
    if (dig) {
      const L = pointLords(lon, dig);
      const P = idx => pName(BODIES[idx], glyphs);
      const C = idx => PLANET_COLORS[idx];
      dign = {
        domicile: P(L.domicile), decan: P(L.decan), bound: P(L.bound),
        trip: P(L.triplicity[0]),
        tripFull: L.triplicity.map(P).join(' · '),
        exalt: L.exaltation == null ? null : P(L.exaltation),
        d12: P(L.d12), d9: P(L.d9),
      };
      dignCol = {
        domicile: C(L.domicile), decan: C(L.decan), bound: C(L.bound),
        trip: C(L.triplicity[0]),
        exalt: L.exaltation == null ? null : C(L.exaltation),
        d12: C(L.d12), d9: C(L.d9),
      };
    }
    return { body: name, lon: fmtLon(lon, fmt, glyphs), lonHtml: lonHTML(lon, fmt, glyphs), dign, dignCol };
  });
}

// Percentile-dot markup for a tableRows row ('' when the body has no
// indicator). data-pct/data-z carry the numbers for the CSV export, since
// the dot itself has no text. Exported so app.js's live-cell patcher can
// restore a dot with identical markup instead of duplicating it.
export function speedIndicatorHTML(r) {
  if (!r.spdColor) return '';
  const z = `${r.spdZ >= 0 ? '+' : ''}${r.spdZ.toFixed(2)}`;
  return `<span class="spdind" style="background:${r.spdColor}" title="${r.spdTip}"`
    + ` data-pct="${r.spdPct.toFixed(1)}" data-z="${z}"></span>`;
}

export function buildTableHTML(out, fmt = 'dms', dig = undefined, opts = {}) {
  const glyphs = !!opts.glyphs;
  const angleMode = opts.angleMode === 'compact' ? 'compact' : 'full';
  let html = `<div class="results-head"><div class="seg" role="group" aria-label="Angle format">`
    + `<button type="button" data-fmt="dms" aria-pressed="${fmt !== 'dec'}">12°34′56″</button>`
    + `<button type="button" data-fmt="dec" aria-pressed="${fmt === 'dec'}">12.5822°</button>`
    + `</div>`
    + `<button type="button" id="size-toggle" class="ghost" aria-pressed="${angleMode === 'compact'}" title="Angle size: full (12°34′56″) or compact (leading pair only: 12°34′, or 5′10″ when degrees are leading zeroes). Display only; calculations always use precise decimals.">◐ ${angleMode}</button>`
    + `<button type="button" id="glyph-toggle" class="ghost" aria-pressed="${glyphs}" title="Show sign and planet glyphs instead of names">♍ ${glyphs ? 'glyphs' : 'names'}</button>`
    + `<button id="share" class="ghost" type="button" title="Copy a link to this chart">Share</button></div>`;
  html += `<div class="angles"><div><span class="k">Ascendant</span><span class="v" data-asc>${fmtLon(out[72], fmt)}</span></div>`
        + `<div><span class="k">Midheaven</span><span class="v" data-mc>${fmtLon(out[73], fmt)}</span></div></div>`;
  html += `<div class="csv-block">${csvDownloadButton('trigon-positions.csv')}<div class="tbl-scroll"><table><thead><tr><th>Body</th><th>Ecliptic longitude</th><th>Declination</th>`
        + `<th>Speed</th><th>Magnitude</th><th>House</th>`
        + `<th>Prev station</th><th>Next station</th><th>Domicile</th><th>Decan</th><th>Bound</th>`
        + `<th>Triplicity</th><th>Exaltation</th><th>D12</th><th>D9</th></tr></thead><tbody>`;
  const dignCells = (d, dc) => d
    ? `<td class="num" style="color:${dc.domicile}">${d.domicile}</td><td class="num" style="color:${dc.decan}">${d.decan}</td><td class="num" style="color:${dc.bound}">${d.bound}</td>`
      + `<td class="num" style="color:${dc.trip}" title="Triplicity lords: ${d.tripFull}">${d.trip}</td>`
      + `<td class="num"${dc.exalt ? ` style="color:${dc.exalt}"` : ''}>${d.exalt || dash}</td><td class="num" style="color:${dc.d12}">${d.d12}</td><td class="num" style="color:${dc.d9}">${d.d9}</td>`
    : `<td class="num dim">${dash}</td>`.repeat(7);
  const dirSpan = r => r.spdDir
    ? ` <span class="${r.spdDir === 'R' ? 'retro' : 'direct'}">${r.spdDir}</span>` : '';
  for (const r of tableRows(out, fmt, dig, glyphs)) {
    const cell = 'num' + (r.dim ? ' dim' : '');
    const spdInd = speedIndicatorHTML(r);
    // Station cells are filled asynchronously by the app (they need an
    // ephemeris scan around the instant); Mercury..Pluto only.
    const stn = r.ib >= 2 && r.ib <= 9
      ? `<td class="num stn-prev" data-ib="${r.ib}">…</td><td class="num stn-next" data-ib="${r.ib}">…</td>`
      : `<td class="num dim">${dash}</td><td class="num dim">${dash}</td>`;
    html += `<tr><td class="body" style="color:${r.color}">${r.body}</td><td class="${cell}">${r.lonHtml}</td><td class="${cell}">${r.dec}</td>`
          + `<td class="${cell}">${spdInd}<span class="spd-txt">${r.spdMag}</span>${dirSpan(r)}</td>`
          + `<td class="${cell}">${r.magHtml}</td><td class="${cell}">${r.house}</td>${stn}${dignCells(r.dign, r.dignCol || {})}</tr>`;
  }
  // The four angles close the table, with their dignity lords.
  for (const a of angleRows(out, dig, fmt, glyphs)) {
    html += `<tr class="angle-row"><td class="body">${a.body}</td><td class="num">${a.lonHtml}</td>`
      + `<td class="num dim">${dash}</td>`.repeat(6)
      + `${dignCells(a.dign, a.dignCol || {})}</tr>`;
  }
  html += '</tbody></table></div></div>';
  // Mobile cards: 7-column table doesn't fit narrow viewports. Each planet
  // becomes a scannable card (CSS shows this, hides the table, <=640px).
  html += '<div class="planet-cards" aria-hidden="false">';
  for (const r of tableRows(out, fmt, dig, glyphs)) {
    const motCls = r.dim ? 'dim' : (r.retro ? 'retro' : 'direct');
    const spdInd = speedIndicatorHTML(r);
    html += `<div class="planet-card">`
      + `<div class="pc-head"><span class="pc-body" style="color:${r.color}">${r.body}</span>`
      + `<span class="${motCls} pc-mot">${r.mot}</span></div>`
      + `<div class="pc-lon${r.dim ? ' dim' : ''}">${r.lonHtml}</div>`
      + `<div class="pc-meta"><span>House ${r.house}</span>`
      + `<span>${spdInd}<span class="spd-txt">${r.spdMag}</span>${r.spdDir ? ` <span class="${r.spdDir === 'R' ? 'retro' : 'direct'}">${r.spdDir}</span>` : ''}</span><span>${r.dec}</span><span>Mag ${r.magHtml}</span></div>`
      + (r.dign ? `<div class="pc-meta"><span>Domicile ${r.dign.domicile}</span><span>Decan ${r.dign.decan}</span><span>Bound ${r.dign.bound}</span>`
        + `<span>D12 ${r.dign.d12}</span><span>D9 ${r.dign.d9}</span></div>` : '')
      + `</div>`;
  }
  html += '</div>';
  return html;
}
