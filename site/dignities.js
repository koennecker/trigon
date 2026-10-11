// dignities.js — traditional dignity/lordship math for the seven
// classical planets: decan lords (Chaldean modulo order, or the Indian
// triplicity-domicile sequence), Egyptian bounds, Dorothean triplicity
// lords, exaltation lords, Dodecatemoria (D12) and Novenaria (D9)
// sub-lords, whole-sign house lords, and the per-planet lordship
// breakdown ("deep dive"). Pure: no DOM, no storage except through an
// injected storage object. Prototype: proto/dignities_proto.py.
import { SIGN_RULERS } from './search.js';
import { fmtLon, fmtSignPos, fmtUTC, gotoButtonHTML } from './format.js';

// Body names for the classical planets (index = body id). Local copy so
// this module stays free of import cycles with table.js.
const NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

/** @typedef {{ decan: 'chaldean'|'indian', isDay: boolean }} DignityOpts */

/** Body indices of the seven classical planets (Sun..Saturn). */
export const CLASSICAL = [0, 1, 2, 3, 4, 5, 6];

// Chaldean order, slowest to fastest: Saturn, Jupiter, Mars, Sun, Venus,
// Mercury, Moon (body indices).
const CHALDEAN = [6, 5, 4, 0, 3, 2, 1];

// Egyptian bounds by sign: [upper degree limit, lord body index].
// Ported 1:1 from the Egyptian bounds reference table.
const BOUNDS = [
  [[6, 5], [12, 3], [20, 2], [25, 4], [30, 6]],   // Aries
  [[8, 3], [14, 2], [22, 5], [27, 6], [30, 4]],   // Taurus
  [[6, 2], [12, 5], [17, 3], [24, 4], [30, 6]],   // Gemini
  [[7, 4], [13, 3], [19, 2], [26, 5], [30, 6]],   // Cancer
  [[6, 5], [11, 3], [18, 6], [24, 2], [30, 4]],   // Leo
  [[7, 2], [17, 3], [21, 5], [28, 4], [30, 6]],   // Virgo
  [[6, 6], [14, 2], [21, 5], [28, 3], [30, 4]],   // Libra
  [[7, 4], [11, 3], [19, 2], [24, 5], [30, 6]],   // Scorpio
  [[12, 5], [17, 3], [21, 2], [26, 6], [30, 4]],  // Sagittarius
  [[7, 2], [14, 5], [22, 3], [26, 6], [30, 4]],   // Capricorn
  [[7, 2], [13, 3], [20, 5], [25, 4], [30, 6]],   // Aquarius
  [[12, 3], [16, 5], [19, 2], [28, 4], [30, 6]],  // Pisces
];

// Dorothean triplicities by element (sign % 4 = fire, earth, air,
// water): [day lord, night lord, participating lord].
const TRIPLICITY = [[0, 5, 6], [3, 1, 4], [6, 2, 5], [3, 4, 1]];

// Exaltation lord by sign index (-1 where no classical exaltation).
const EXALTATION = [0, 1, -1, 5, -1, 2, 6, -1, -1, 4, -1, 3];

export function signIndexOf(lon) {
  return Math.floor(((lon % 360) + 360) % 360 / 30);
}

/** Domicile lord (body index) of the sign holding lon. */
export function domicileLord(lon) { return SIGN_RULERS[signIndexOf(lon)]; }

/**
 * Decan lord (body index). 'chaldean': the 36 decans cycle the Chaldean
 * order continuously from Mars at Aries I (Mars repeats across the
 * Pisces→Aries wrap, as in the traditional table). 'indian' (drekkana):
 * lords of the sign itself, the 5th sign, and the 9th sign.
 * @param {number} lon @param {'chaldean'|'indian'} method @returns {number}
 */
export function decanLord(lon, method) {
  const l = ((lon % 360) + 360) % 360;
  if (method === 'indian') {
    const s = Math.floor(l / 30), d = Math.floor((l % 30) / 10);
    return SIGN_RULERS[(s + 4 * d) % 12];
  }
  return CHALDEAN[(2 + Math.floor(l / 10)) % 7];
}

/** Egyptian bound (term) lord (body index) of lon. */
export function egyptianBoundLord(lon) {
  const l = ((lon % 360) + 360) % 360;
  const s = Math.floor(l / 30), deg = l % 30;
  for (const [upper, lord] of BOUNDS[s]) if (deg < upper) return lord;
  return BOUNDS[s][BOUNDS[s].length - 1][1];
}

/**
 * Dorothean triplicity lords of lon as [primary, secondary, tertiary]:
 * primary is the sect lord, secondary the other sect lord, tertiary the
 * participating lord. @param {number} lon @param {boolean} isDay
 * @returns {number[]}
 */
export function triplicityLords(lon, isDay) {
  const [day, night, part] = TRIPLICITY[signIndexOf(lon) % 4];
  return isDay ? [day, night, part] : [night, day, part];
}

/** Exaltation lord (body index) of the sign holding lon, or null. */
export function exaltationLord(lon) {
  const v = EXALTATION[signIndexOf(lon)];
  return v < 0 ? null : v;
}

/** Dodecatemoria (D12) sub-lord: 2.5° parts counting forward from the
 * sign itself; the sub-sign's domicile lord. */
export function d12Lord(lon) {
  const l = ((lon % 360) + 360) % 360;
  const s = Math.floor(l / 30), part = Math.floor((l % 30) / 2.5);
  return SIGN_RULERS[(s + part) % 12];
}

/** Novenaria (D9) sub-lord: 3°20′ parts. Cardinal signs count from
 * themselves, fixed from the 9th sign, mutable from the 5th; the
 * sub-sign's domicile lord. Arcminute math avoids float undershoot at
 * exact part boundaries (proto-verified). */
export function d9Lord(lon) {
  const l = ((lon % 360) + 360) % 360;
  const s = Math.floor(l / 30);
  const part = Math.floor((l % 30) * 60 / 200);
  const start = [s, (s + 8) % 12, (s + 4) % 12][s % 3];
  return SIGN_RULERS[(start + part) % 12];
}

/** Whole-sign house (1..12) of lon given the Ascendant longitude. */
export function wholeSignHouse(lon, ascLon) {
  return ((signIndexOf(lon) - signIndexOf(ascLon)) % 12 + 12) % 12 + 1;
}

/**
 * All lords of one point.
 * @param {number} lon @param {DignityOpts} opts
 * @returns {{domicile:number, exaltation:number|null, decan:number,
 *   bound:number, triplicity:number[], d12:number, d9:number}}
 */
export function pointLords(lon, opts) {
  return {
    domicile: domicileLord(lon),
    exaltation: exaltationLord(lon),
    decan: decanLord(lon, opts.decan),
    bound: egyptianBoundLord(lon),
    triplicity: triplicityLords(lon, opts.isDay),
    d12: d12Lord(lon),
    d9: d9Lord(lon),
  };
}

const DIMENSIONS = ['domicile', 'exaltation', 'decan', 'bound', 'triplicity', 'd12', 'd9'];

/**
 * The lordship breakdown. Points are the seven classical planets, the
 * Ascendant, MC, IC, and the lots. For each classical planet: the lords
 * over it (`under`), the planets/points it lords over per dimension
 * (`over`, triplicity by primary lord; secondary/tertiary appearances in
 * `overRoles`), the whole-sign houses it rules, and a total = number of
 * (planet/point, dimension) lordship relations across the seven
 * dimensions (houses ruled are not counted in the total). A planet
 * counts as lord over itself: in the classical model, occupying its own
 * domicile/decan/bound/etc. is a testimony of strength, not a null.
 * @param {number[]} out 84-double chart output
 * @param {{name:string, lon:number}[]} lots lot positions (may be [])
 * @param {DignityOpts} opts
 */
export function computeLordships(out, lots, opts) {
  const ascLon = out[72], mcLon = out[73];
  const points = [];
  for (const ib of CLASSICAL) {
    points.push({ name: NAMES[ib], lon: out[ib * 6], planet: ib });
  }
  points.push({ name: 'Ascendant', lon: ascLon, planet: null });
  points.push({ name: 'MC', lon: mcLon, planet: null });
  points.push({ name: 'IC', lon: (mcLon + 180) % 360, planet: null });
  for (const v of lots || []) points.push({ name: v.name, lon: v.lon, planet: null });
  for (const p of points) {
    p.house = wholeSignHouse(p.lon, ascLon);
    p.lords = pointLords(p.lon, opts);
  }
  const ascSign = signIndexOf(ascLon);
  const planets = CLASSICAL.map(ib => {
    const me = points.find(p => p.planet === ib);
    const over = { domicile: [], exaltation: [], decan: [], bound: [], triplicity: [], d12: [], d9: [] };
    const overRoles = []; // secondary/tertiary triplicity appearances
    for (const p of points) {
      for (const dim of DIMENSIONS) {
        if (dim === 'triplicity') {
          if (p.lords.triplicity[0] === ib) over.triplicity.push(p.name);
          else if (p.lords.triplicity[1] === ib) overRoles.push(`${p.name} (2°)`);
          else if (p.lords.triplicity[2] === ib) overRoles.push(`${p.name} (3°)`);
        } else if (p.lords[dim] === ib) over[dim].push(p.name);
      }
    }
    const housesRuled = [];
    for (let h = 1; h <= 12; h++) {
      if (SIGN_RULERS[(ascSign + h - 1) % 12] === ib) housesRuled.push(h);
    }
    const total = DIMENSIONS.reduce((n, d) => n + over[d].length, 0);
    return { ib, name: NAMES[ib], lon: me.lon, house: me.house, under: me.lords, over, overRoles, housesRuled, total };
  });
  return { points, planets };
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lordName = ib => (ib == null ? '—' : NAMES[ib]);

/** Placeholder + results HTML for the lunation (syzygy) section. */
export function buildSyzygyHTML(syz) {
  const line = (label, s) => s
    ? `<div><span class="k">${label}</span><span class="v">${s.kind === 'new' ? 'New Moon' : 'Full Moon'} · Moon at ${fmtSignPos(s.moonLon)} · ${gotoButtonHTML(s.jd, fmtUTC(s.jd))} UTC</span></div>`
    : `<div><span class="k">${label}</span><span class="v">—</span></div>`;
  return `<div class="lots" id="syzygy-section"><h3>Lunations</h3><div class="angles">`
    + line('Previous', syz && syz.prev) + line('Next', syz && syz.next)
    + `</div></div>`;
}

export const DIGNITY_OPTS_KEY = 'trigon.dignities.v1';
export function readDignityOpts(storage) {
  try {
    const o = JSON.parse(storage.getItem(DIGNITY_OPTS_KEY) || '{}');
    return { decan: o.decan === 'indian' ? 'indian' : 'chaldean' };
  } catch (e) { return { decan: 'chaldean' }; }
}
export function writeDignityOpts(storage, opts) {
  try { storage.setItem(DIGNITY_OPTS_KEY, JSON.stringify({ decan: opts.decan })); } catch (e) { /* unavailable */ }
}

/**
 * Deep-dive section HTML: a summary matrix (counts per dimension) plus a
 * card per classical planet with both directions of lordship.
 * @param {number[]} out @param {{name:string, lon:number}[]} lots
 * @param {DignityOpts & {decan:'chaldean'|'indian'}} opts
 */
export function buildLordshipHTML(out, lots, opts) {
  const { planets } = computeLordships(out, lots, opts);
  const sect = opts.isDay ? 'day' : 'night';
  let html = `<div class="lords" id="lords-section"><h3>Lordship deep dive</h3>`
    + `<div class="lords-opts"><label>Decan method <select class="decan-method">`
    + `<option value="chaldean"${opts.decan === 'chaldean' ? ' selected' : ''}>Chaldean order (modulo)</option>`
    + `<option value="indian"${opts.decan === 'indian' ? ' selected' : ''}>Indian (triplicity domicile sequence)</option>`
    + `</select></label></div>`
    + `<p class="lots-note">${opts.isDay ? 'Day' : 'Night'} chart — Dorothean triplicity primaries follow the ${sect} lord. `
    + `Counts are planets/points lorded per dimension (triplicity by primary lord only; a planet counts as lord `
    + `over itself — its own domicile, decan, bound and so on are strength, not a null); `
    + `houses ruled are whole-sign and listed separately, not counted in the total.</p>`;
  // Summary matrix.
  html += `<div class="tbl-scroll"><table class="lords-table"><thead><tr><th>Planet</th>`
    + `<th>Domicile</th><th>Exaltation</th><th>Decan</th><th>Bound</th><th>Triplicity</th>`
    + `<th>D12</th><th>D9</th><th>Houses ruled</th><th>Total</th></tr></thead><tbody>`;
  for (const p of planets) {
    const cell = names => names.length
      ? `<td class="num" title="${esc(names.join(', '))}">${names.length}</td>` : '<td class="num">0</td>';
    html += `<tr><td class="body">${p.name}</td>`
      + cell(p.over.domicile) + cell(p.over.exaltation) + cell(p.over.decan)
      + cell(p.over.bound) + cell(p.over.triplicity) + cell(p.over.d12) + cell(p.over.d9)
      + `<td class="num">${p.housesRuled.join(', ') || '—'}</td><td class="num">${p.total}</td></tr>`;
  }
  html += '</tbody></table></div>';
  // Per-planet cards: lords over it, and what it rules.
  html += '<div class="lord-cards">';
  for (const p of planets) {
    const u = p.under;
    const list = names => (names.length ? esc(names.join(', ')) : '—');
    html += `<div class="lord-card"><h4>${p.name} — ${fmtLon(p.lon)} · house ${p.house}</h4>`
      + `<div class="lord-cols"><div><h5>Lords over ${p.name}</h5><ul>`
      + `<li>Domicile: ${lordName(u.domicile)}</li>`
      + `<li>Exaltation: ${lordName(u.exaltation)}</li>`
      + `<li>Decan: ${lordName(u.decan)}</li>`
      + `<li>Bound: ${lordName(u.bound)}</li>`
      + `<li>Triplicity: ${u.triplicity.map(lordName).join(' · ')}</li>`
      + `<li>D12: ${lordName(u.d12)} · D9: ${lordName(u.d9)}</li>`
      + `</ul></div><div><h5>${p.name} rules</h5><ul>`
      + `<li>Houses: ${p.housesRuled.join(', ') || '—'}</li>`
      + `<li>Domicile lord of: ${list(p.over.domicile)}</li>`
      + `<li>Exaltation lord of: ${list(p.over.exaltation)}</li>`
      + `<li>Decan lord of: ${list(p.over.decan)}</li>`
      + `<li>Bound lord of: ${list(p.over.bound)}</li>`
      + `<li>Triplicity lord of: ${list(p.over.triplicity)}</li>`
      + (p.overRoles.length ? `<li>Triplicity 2°/3° lord of: ${list(p.overRoles)}</li>` : '')
      + `<li>D12 lord of: ${list(p.over.d12)}</li>`
      + `<li>D9 lord of: ${list(p.over.d9)}</li>`
      + `</ul></div></div></div>`;
  }
  html += '</div></div>';
  return html;
}
