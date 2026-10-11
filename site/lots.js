// lots.js — Hermetic lots (Arabic parts) computed from the chart output.
//
// Pure: takes the 84-double chart output plus the instant and observer, and
// returns the chart sect and each lot's longitude. No DOM, no storage
// (the read/write helpers take an explicit storage object, as in format.js).
//
// The baseline definitions are the Paulus Hermetic set: every lot is
// A + B - C (mod 360) with A = Ascendant, in a day and a night variant
// chosen by whether the Sun is above the horizon.
//
// Optional tradition variants (all default off), verified against the
// primary sources 2026-10-02 (research_notes/hermetic-lot-conditionals):
//   valensMoon      — Nechepso rule transmitted by Valens, Anthology
//                     III.11 (cf. Ps.-Serapion): at night, Fortune is
//                     reversed only while the Moon is above the horizon;
//                     after moonset the day formula applies. Fortune only.
//   ptolemyFortune  — Ptolemy, Tetrabiblos III.10: Fortune is never
//                     reversed, day or night. Subsumes valensMoon.
//   valensBasis     — Valens, Anthology II: Basis is the projection of
//                     the shorter Fortune<->Spirit arc from the Ascendant
//                     (equivalently the member of the mirror pair that
//                     falls below the horizon).
//   valensErosNec   — Valens IV.25 / Dorotheus: Eros and Necessity take
//                     their arcs from Fortune/Spirit, not Venus/Mercury.
import { meanObliquity, eclToEq, lstDeg, unixMsToJd } from './sky-data.js';
import { fmtLon, norm360, SIGNS, csvDownloadButton } from './format.js';
import { LOT_CALCULATIONS, CATALOG_LOTS } from './lots-catalog.js';
import { domicileLord } from './dignities.js';

/**
 * @typedef {{kind:'body', body:string}|{kind:'fixed', lon:number}|{kind:'lot', lot:string}} LotOperand
 * @typedef {{name:string, day:[LotOperand,LotOperand,LotOperand], night:[LotOperand,LotOperand,LotOperand]}} LotDef
 * @typedef {{name:string, lon:number, house:number, formula:string}} LotValue
 * @typedef {{sect:'day'|'night', sunAlt:number, moonAlt:number, notes:string[], values:LotValue[]}} LotsResult
 * @typedef {{valensMoon:boolean, ptolemyFortune:boolean, valensBasis:boolean, valensErosNec:boolean}} LotOptions
 */

// Body name -> index in the 84-double output (longitude at slot 6*i).
const BODY_INDEX = { Sun: 0, Moon: 1, Mercury: 2, Venus: 3, Mars: 4, Jupiter: 5, Saturn: 6 };
// U+FE0E forces text presentation (zodiac/planet glyphs otherwise fall
// back to color emoji on some platforms) — same convention as chart.js.
const BODY_GLYPH = { Asc: 'Asc', Sun: '☉︎', Moon: '☽︎', Mercury: '☿︎', Venus: '♀︎', Mars: '♂︎', Jupiter: '♃︎', Saturn: '♄︎' };

/** @param {string} body @returns {LotOperand} */
const B = body => ({ kind: 'body', body });
/** @param {number} lon @returns {LotOperand} */
const F = lon => ({ kind: 'fixed', lon });
/** @param {string} lot @returns {LotOperand} */
const L = lot => ({ kind: 'lot', lot });
const ASC = B('Asc');

// The 20 file entries collapse to 10 lots x 2 sects. Exaltation's fixed
// points are the Sun's exaltation (19 Aries, day) and the Moon's
// (3 Taurus, night).
/** @type {LotDef[]} */
export const HERMETIC_LOTS = [
  { name: 'Fortune',            day: [ASC, B('Moon'), B('Sun')],       night: [ASC, B('Sun'), B('Moon')] },
  { name: 'Spirit',             day: [ASC, B('Sun'), B('Moon')],       night: [ASC, B('Moon'), B('Sun')] },
  { name: 'Exaltation',         day: [ASC, F(19), B('Sun')],           night: [ASC, F(33), B('Moon')] },
  { name: 'Necessity',          day: [ASC, L('Fortune'), B('Mercury')], night: [ASC, B('Mercury'), L('Fortune')] },
  { name: 'Eros',               day: [ASC, B('Venus'), L('Spirit')],   night: [ASC, L('Spirit'), B('Venus')] },
  { name: 'Courage',            day: [ASC, L('Fortune'), B('Mars')],   night: [ASC, B('Mars'), L('Fortune')] },
  { name: 'Victory',            day: [ASC, B('Jupiter'), L('Spirit')], night: [ASC, L('Spirit'), B('Jupiter')] },
  { name: 'Nemesis',            day: [ASC, L('Fortune'), B('Saturn')],  night: [ASC, B('Saturn'), L('Fortune')] },
  { name: 'Basis',              day: [ASC, L('Fortune'), L('Spirit')], night: [ASC, L('Spirit'), L('Fortune')] },
  { name: 'Illness/Accusation', day: [ASC, B('Mars'), B('Saturn')],    night: [ASC, B('Saturn'), B('Mars')] },
];

// Valens/Dorotheus Eros and Necessity: arcs from the two primary lots.
// Necessity is Eros's mirror, as in Paulus.
/** @type {{Eros: {day: [LotOperand,LotOperand,LotOperand], night: [LotOperand,LotOperand,LotOperand]}, Necessity: {day: [LotOperand,LotOperand,LotOperand], night: [LotOperand,LotOperand,LotOperand]}}} */
const VALENS_EROS_NEC = {
  Eros:      { day: [ASC, L('Fortune'), L('Spirit')], night: [ASC, L('Spirit'), L('Fortune')] },
  Necessity: { day: [ASC, L('Spirit'), L('Fortune')], night: [ASC, L('Fortune'), L('Spirit')] },
};

/**
 * True altitude (degrees, negative below horizon) of an ecliptic point.
 * @param {number} lonDeg ecliptic longitude
 * @param {number} latDeg ecliptic latitude
 * @param {number} utcMs instant, ms since the Unix epoch (UTC)
 * @param {number} lat observer latitude, degrees (+N)
 * @param {number} lonEast observer longitude, degrees (+E)
 * @returns {number}
 */
export function pointAltitudeDeg(lonDeg, latDeg, utcMs, lat, lonEast) {
  const jd = unixMsToJd(utcMs);
  const eps = meanObliquity(jd);
  const { ra, dec } = eclToEq(lonDeg, latDeg, eps);
  const H = (lstDeg(jd, lonEast) - ra) * Math.PI / 180;
  const phi = lat * Math.PI / 180, del = dec * Math.PI / 180;
  const s = Math.sin(phi) * Math.sin(del) + Math.cos(phi) * Math.cos(del) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI;
}

/**
 * Sun's true altitude in degrees for the chart (negative below horizon).
 * @param {number[]} out 84-double chart output
 * @param {number} utcMs instant, ms since the Unix epoch (UTC)
 * @param {number} lat observer latitude, degrees (+N)
 * @param {number} lonEast observer longitude, degrees (+E)
 * @returns {number}
 */
export function sunAltitudeDeg(out, utcMs, lat, lonEast) {
  return pointAltitudeDeg(out[0], out[1], utcMs, lat, lonEast);
}

/**
 * Moon's true altitude in degrees for the chart. Unlike the Sun, the Moon
 * carries up to ~5 degrees of ecliptic latitude, so its horizon status
 * cannot be read off its longitude alone — hence the full altitude.
 * @param {number[]} out 84-double chart output
 * @param {number} utcMs instant, ms since the Unix epoch (UTC)
 * @param {number} lat observer latitude, degrees (+N)
 * @param {number} lonEast observer longitude, degrees (+E)
 * @returns {number}
 */
export function moonAltitudeDeg(out, utcMs, lat, lonEast) {
  return pointAltitudeDeg(out[6], out[7], utcMs, lat, lonEast);
}

/** @param {LotOperand} op @returns {string} */
function operandLabel(op) {
  if (op.kind === 'body') return BODY_GLYPH[op.body];
  if (op.kind === 'lot') return op.lot;
  const s = Math.floor(norm360(op.lon) / 30);
  return `${Math.floor(norm360(op.lon) - s * 30)}°${String.fromCodePoint(0x2648 + s)}︎`;
}

/**
 * Compute every Hermetic lot for a chart.
 * @param {number[]} out 84-double chart output
 * @param {number} utcMs instant, ms since the Unix epoch (UTC)
 * @param {number} lat observer latitude, degrees (+N)
 * @param {number} lonEast observer longitude, degrees (+E)
 * @param {LotOptions} [opts] tradition variants (all off by default)
 * @returns {LotsResult}
 */
export function computeLots(out, utcMs, lat, lonEast, opts) {
  const o = Object.assign(
    { valensMoon: false, ptolemyFortune: false, valensBasis: false, valensErosNec: false }, opts);
  const sunAlt = sunAltitudeDeg(out, utcMs, lat, lonEast);
  const moonAlt = moonAltitudeDeg(out, utcMs, lat, lonEast);
  const sect = sunAlt > 0 ? 'day' : 'night';

  // Which sect's triple Fortune uses, after the Fortune-specific rules.
  // Ptolemy's never-reverse subsumes Valens's moonset proviso.
  let fortuneSect = sect;
  /** @type {null|'ptolemy'|'valens'} */
  let fortuneRule = null;
  if (o.ptolemyFortune && sect === 'night') { fortuneSect = 'day'; fortuneRule = 'ptolemy'; }
  else if (o.valensMoon && sect === 'night' && moonAlt < 0) { fortuneSect = 'day'; fortuneRule = 'valens'; }

  /** @type {string[]} */
  const notes = [];
  if (fortuneRule === 'ptolemy')
    notes.push('Ptolemy (Tetrabiblos III.10): Fortune is never reversed, so the '
      + 'day formula is used in this night chart.');
  else if (fortuneRule === 'valens')
    notes.push(`Nechepso rule (Valens, Anthology III.11): the Moon is ${Math.abs(moonAlt).toFixed(1)}° `
      + 'below the horizon — set — so Fortune uses the day formula. It lands on '
      + 'Spirit\u2019s standard position; Serapio\u2019s parallel passage is an interpretive '
      + 'predominance, not a positional swap, so Spirit is not moved.');
  else if (o.valensMoon && sect === 'night')
    notes.push(`Nechepso/Valens proviso on: the Moon is ${moonAlt.toFixed(1)}° above the `
      + 'horizon, so Fortune keeps the night formula.');

  const defs = HERMETIC_LOTS.map(d =>
    (o.valensErosNec && (d.name === 'Eros' || d.name === 'Necessity'))
      ? { name: d.name, day: VALENS_EROS_NEC[d.name].day, night: VALENS_EROS_NEC[d.name].night }
      : d);
  const bodyLon = name => name === 'Asc' ? out[72] : out[6 * BODY_INDEX[name]];
  /** @type {Map<string, number>} */
  const memo = new Map();
  /** @param {LotOperand} op @returns {number} */
  const operandLon = op =>
    op.kind === 'body' ? bodyLon(op.body) :
    op.kind === 'fixed' ? op.lon : lotLon(op.lot);
  /** @param {string} name @returns {number} */
  function lotLon(name) {
    let v = memo.get(name);
    if (v === undefined) {
      const def = defs.find(d => d.name === name);
      if (!def) throw new Error(`unknown lot ${name}`);
      const [a, b, c] = def[name === 'Fortune' ? fortuneSect : sect];
      v = norm360(operandLon(a) + operandLon(b) - operandLon(c));
      memo.set(name, v);
    }
    return v;
  }
  const ascSign = Math.floor(norm360(out[72]) / 30);
  const values = defs.map(def => {
    let lon = lotLon(def.name);
    let formula;
    if (o.valensBasis && def.name === 'Basis') {
      // The two Fortune<->Spirit projections sum to 2*Asc: mirror points
      // across the Asc-Desc axis. Exactly one is below the horizon
      // (((lon - Asc) mod 360) in (0,180) is the below-horizon arc), and
      // Valens takes that one. Prototype-verified in
      // proto/lots_modifiers_proto.py.
      const p1 = norm360(out[72] + lotLon('Fortune') - lotLon('Spirit'));
      const p2 = norm360(out[72] + lotLon('Spirit') - lotLon('Fortune'));
      lon = norm360(p1 - out[72]) < 180 ? p1 : p2;
      formula = 'Asc ± Fortune↔Spirit (shortest arc)';
    } else {
      const [a, b, c] = def[def.name === 'Fortune' ? fortuneSect : sect];
      formula = `${operandLabel(a)} + ${operandLabel(b)} − ${operandLabel(c)}`;
    }
    return {
      name: def.name,
      lon,
      house: ((Math.floor(lon / 30) - ascSign + 12) % 12) + 1,
      formula,
    };
  });
  return { sect, sunAlt, moonAlt, notes, values };
}

// ---------------------------------------------------------------------------
// Hellenistic catalog (lots-catalog.js): 181 attested names tied to 86
// calculations. Points resolve against the chart plus the Hermetic
// Fortune/Spirit (so tradition modifiers cascade consistently) and the
// prenatal syzygy longitude, which the app supplies from its lunation
// scan (null until known — dependent lots then report null).

/**
 * @typedef {{id: string, name: string, lon: number|null, altLon: number|null, house: number|null, formula: string, source: string, note: string}} CatalogValue
 * @typedef {{fortune: number, spirit: number, syzygy: number|null}} CatalogContext
 */

const TOKEN_LABEL = {
  Asc: 'Asc', MC: 'MC', IC: 'IC', Dsc: 'Dsc', h2: '2nd', h8: '8th', h9: '9th',
  Fortune: 'Fortune', Spirit: 'Spirit', Syzygy: 'Syzygy',
  rulerAsc: 'Ruler Asc', ruler2: 'Ruler 2nd', ruler9: 'Ruler 9th',
  rulerIC: 'Ruler IC', rulerSyzygy: 'Ruler Syzygy',
};

/** @param {*} tok @returns {string} */
function tokenLabel(tok) {
  if (Array.isArray(tok)) {
    const s = Math.floor(norm360(tok[1]) / 30);
    return `${Math.floor(norm360(tok[1]) - s * 30)}°${String.fromCodePoint(0x2648 + s)}︎`;
  }
  if (tok && typeof tok === 'object') return 'sect pair';
  if (BODY_GLYPH[tok]) return BODY_GLYPH[tok];
  return TOKEN_LABEL[tok] || tok;
}

/** Canonical label of a calculation, for grouping: "Asc + ☽ − ☉ · reverse at night".
 * @param {{pp: *, sig: *, trig: *, rev: string}} c @returns {string} */
export function calcLabel(c) {
  const rule = {
    reverse: ' · reverse at night', fixed: '', horizon: ' · always below horizon',
    both: ' · use both directions', dayOnly: ' · day charts', nightOnly: ' · night charts',
    sectPair: '',
  }[c.rev] || '';
  if (c.sig && typeof c.sig === 'object' && !Array.isArray(c.sig)) {
    return `${tokenLabel(c.pp)} + ${tokenLabel(c.sig.day[0])} − ${tokenLabel(c.sig.day[1])} (day) / `
      + `${tokenLabel(c.sig.night[0])} − ${tokenLabel(c.sig.night[1])} (night)`;
  }
  return `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)}${rule}`;
}

/**
 * Resolve one operand token to a longitude (null when a prerequisite
 * such as the syzygy is unknown).
 * @param {*} tok
 * @param {{lon: Object<string, number>, asc: number, mc: number, fortune: number, spirit: number, syzygy: number|null}} ctx
 * @returns {number|null}
 */
function resolveToken(tok, ctx) {
  if (Array.isArray(tok)) return tok[1];
  switch (tok) {
    case 'Asc': return ctx.asc;
    case 'MC': return ctx.mc;
    case 'IC': return norm360(ctx.mc + 180);
    case 'Dsc': return norm360(ctx.asc + 180);
    case 'h2': return norm360(ctx.asc + 30);
    case 'h8': return norm360(ctx.asc + 210);
    case 'h9': return norm360(ctx.asc + 240);
    case 'Fortune': return ctx.fortune;
    case 'Spirit': return ctx.spirit;
    case 'Syzygy': return ctx.syzygy;
    case 'rulerAsc': case 'ruler2': case 'ruler9': case 'rulerIC': case 'rulerSyzygy': {
      const base = { rulerAsc: 'Asc', ruler2: 'h2', ruler9: 'h9', rulerIC: 'IC', rulerSyzygy: 'Syzygy' }[tok];
      const lon = resolveToken(base, ctx);
      if (lon == null) return null;
      const lord = domicileLord(lon); // body index 0..6
      return ctx.lon[['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'][lord]];
    }
    default: return ctx.lon[tok] ?? null;
  }
}

/**
 * Compute the selected catalog lots for a chart.
 * @param {number[]} out 84-double chart output
 * @param {number} utcMs
 * @param {number} lat
 * @param {number} lonEast
 * @param {LotOptions|undefined} opts Hermetic options (for Fortune/Spirit resolution)
 * @param {string[]} selectedIds catalog lot ids to compute
 * @param {number|null} syzygyLon prenatal lunation longitude, if known
 * @returns {{sect: 'day'|'night', values: CatalogValue[]}}
 */
export function computeCatalogLots(out, utcMs, lat, lonEast, opts, selectedIds, syzygyLon) {
  const herm = computeLots(out, utcMs, lat, lonEast, opts);
  const byName = Object.fromEntries(herm.values.map(v => [v.name, v.lon]));
  const ctx = {
    lon: Object.fromEntries(Object.keys(BODY_INDEX).map(n => [n, out[6 * BODY_INDEX[n]]])),
    asc: out[72], mc: out[73],
    fortune: byName.Fortune, spirit: byName.Spirit,
    syzygy: syzygyLon,
  };
  const sect = herm.sect;
  const ascSign = Math.floor(norm360(out[72]) / 30);
  const houseOf = lon => ((Math.floor(lon / 30) - ascSign + 12) % 12) + 1;
  const sel = new Set(selectedIds);
  /** @type {CatalogValue[]} */
  const values = [];
  for (const entry of CATALOG_LOTS) {
    if (!sel.has(entry.id)) continue;
    const c = LOT_CALCULATIONS[entry.calc];
    const pp = resolveToken(c.pp, ctx);
    let lon = null, altLon = null, formula;
    if (c.sig && typeof c.sig === 'object' && !Array.isArray(c.sig)) {
      const [s, t] = c.sig[sect];
      const sv = resolveToken(s, ctx), tv = resolveToken(t, ctx);
      if (pp != null && sv != null && tv != null) lon = norm360(pp + sv - tv);
      formula = `${tokenLabel(c.pp)} + ${tokenLabel(s)} − ${tokenLabel(t)}`;
    } else {
      const sv = resolveToken(c.sig, ctx), tv = resolveToken(c.trig, ctx);
      const fwd = pp != null && sv != null && tv != null ? norm360(pp + sv - tv) : null;
      const rev = pp != null && sv != null && tv != null ? norm360(pp + tv - sv) : null;
      switch (c.rev) {
        case 'fixed': lon = fwd; formula = `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)}`; break;
        case 'reverse':
          lon = sect === 'day' ? fwd : rev;
          formula = sect === 'day'
            ? `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)}`
            : `${tokenLabel(c.pp)} + ${tokenLabel(c.trig)} − ${tokenLabel(c.sig)} (night reversal)`;
          break;
        case 'dayOnly':
          lon = sect === 'day' ? fwd : null;
          formula = `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)} (day charts)`;
          break;
        case 'nightOnly':
          lon = sect === 'night' ? fwd : null;
          formula = `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)} (night charts)`;
          break;
        case 'horizon':
          lon = fwd != null ? (norm360(fwd - ctx.asc) < 180 ? fwd : rev) : null;
          formula = `${tokenLabel(c.pp)} ± ${tokenLabel(c.sig)}↔${tokenLabel(c.trig)} (below horizon)`;
          break;
        case 'both':
          lon = fwd; altLon = rev;
          formula = `${tokenLabel(c.pp)} + ${tokenLabel(c.sig)} − ${tokenLabel(c.trig)} (both directions used)`;
          break;
        default: formula = calcLabel(c);
      }
    }
    values.push({
      id: entry.id, name: entry.name, lon, altLon,
      house: lon != null ? houseOf(lon) : null,
      formula,
      source: entry.sec ? `${entry.prim}; also ${entry.sec}` : entry.prim,
      note: entry.note,
    });
  }
  values.sort((a, b) => a.name.localeCompare(b.name));
  return { sect, values };
}

// Catalog selection persistence (ids of chosen name entries).
export const CATALOG_SEL_KEY = 'trigon.lots.selection.v1';

/** @param {{getItem: (k: string) => string|null}} storage @returns {string[]} */
export function readCatalogSelection(storage) {
  try {
    const raw = storage.getItem(CATALOG_SEL_KEY);
    if (!raw) return [];
    const ids = new Set(CATALOG_LOTS.map(l => l.id));
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter(id => ids.has(id)) : [];
  } catch (e) { return []; }
}

/** @param {{setItem: (k: string, v: string) => void}} storage @param {string[]} sel */
export function writeCatalogSelection(storage, sel) {
  try { storage.setItem(CATALOG_SEL_KEY, JSON.stringify(sel)); } catch (e) { /* unavailable */ }
}
export const LOTS_OPTS_KEY = 'trigon.lots.v1';
/** @type {LotOptions} */
export const DEFAULT_LOT_OPTIONS = { valensMoon: false, ptolemyFortune: false, valensBasis: false, valensErosNec: false };

/**
 * @param {{getItem: (k: string) => string|null}} storage
 * @returns {LotOptions}
 */
export function readLotOptions(storage) {
  try {
    const raw = storage.getItem(LOTS_OPTS_KEY);
    if (!raw) return { ...DEFAULT_LOT_OPTIONS };
    const p = JSON.parse(raw);
    return {
      valensMoon: !!p.valensMoon, ptolemyFortune: !!p.ptolemyFortune,
      valensBasis: !!p.valensBasis, valensErosNec: !!p.valensErosNec,
    };
  } catch (e) { return { ...DEFAULT_LOT_OPTIONS }; }
}

/**
 * @param {{setItem: (k: string, v: string) => void}} storage
 * @param {LotOptions} opts
 */
export function writeLotOptions(storage, opts) {
  try { storage.setItem(LOTS_OPTS_KEY, JSON.stringify(opts)); } catch (e) { /* unavailable */ }
}

// Checkbox definitions for the options row: [key, label].
/** @type {[keyof LotOptions, string][]} */
const OPTION_DEFS = [
  ['valensMoon', 'Fortune unreversed after moonset (Nechepso/Valens; cf. Serapio)'],
  ['ptolemyFortune', 'Fortune never reversed (Ptolemy)'],
  ['valensBasis', 'Basis by shortest arc (Valens)'],
  ['valensErosNec', 'Eros & Necessity from Fortune/Spirit (Valens)'],
];

/**
 * HTML for the lots section of the Table tab (pure string builder).
 * @param {LotsResult} result
 * @param {string} [fmt] angle format ('dms' or 'dec')
 * @param {LotOptions} [opts] current option states (checkbox rendering)
 * @returns {string}
 */
export function buildLotsHTML(result, fmt = 'dms', opts) {
  const o = Object.assign({ ...DEFAULT_LOT_OPTIONS }, opts);
  const { sect, sunAlt, values } = result;
  const note = sect === 'day'
    ? `Day chart — Sun ${Math.abs(sunAlt).toFixed(1)}° above the horizon, so the day formulas apply.`
    : `Night chart — Sun ${Math.abs(sunAlt).toFixed(1)}° below the horizon, so the night formulas apply.`;
  let html = `<div class="lots" id="lots-section"><h3>Hermetic lots</h3>`
    + `<div class="lots-opts">`
    + OPTION_DEFS.map(([k, label]) =>
        `<label><input type="checkbox" class="lots-opt" data-opt="${k}"${o[k] ? ' checked' : ''}> ${label}</label>`).join('')
    + `</div>`
    + `<p class="lots-note">${note} Each lot is A + B − C measured from the Ascendant.</p>`;
  for (const n of result.notes) html += `<p class="lots-note">${n}</p>`;
  html += `<div class="csv-block">${csvDownloadButton('trigon-lots.csv')}<div class="tbl-scroll"><table class="lots-table"><thead><tr>`
    + `<th>Lot</th><th>Position</th><th>House</th><th>Formula</th></tr></thead><tbody>`;
  for (const v of values) {
    html += `<tr><td class="body">${v.name}</td><td class="num">${fmtLon(v.lon, fmt)}</td>`
      + `<td class="num">${v.house}</td><td class="formula">${v.formula}</td></tr>`;
  }
  return html + '</tbody></table></div></div></div>';
}

/** @param {*} s @returns {string} */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * Selected-lots table HTML (rebuilt on selection/chart changes; kept
 * separate from the browser so checkbox focus and scroll survive).
 * @param {CatalogValue[]} values computed selected lots
 * @param {string} [fmt] angle format
 * @returns {string}
 */
export function buildCatalogSelectedHTML(values, fmt = 'dms') {
  if (!values.length) return '';
  let html = `<div class="csv-block">${csvDownloadButton('trigon-lots-catalog.csv')}<div class="tbl-scroll">`
    + `<table class="lots-table" id="catalog-table"><thead><tr><th>Lot</th><th>Position</th><th>House</th>`
    + `<th>Formula</th><th>Source</th></tr></thead><tbody>`;
  for (const v of values) {
    const pos = v.lon != null
      ? fmtLon(v.lon, fmt) + (v.altLon != null ? ` · ${fmtLon(v.altLon, fmt)}` : '')
      : '…';
    html += `<tr data-cid="${v.id}"${v.note ? ` title="${escHtml(v.note)}"` : ''}><td class="body">${escHtml(v.name)}</td>`
      + `<td class="num cat-pos">${pos}</td><td class="num cat-house">${v.house ?? '—'}</td>`
      + `<td class="formula">${escHtml(v.formula)}</td><td class="formula dim">${escHtml(v.source)}</td></tr>`;
  }
  return html + '</tbody></table></div></div>';
}

/**
 * HTML for the catalog section: intro, the selected table container, and
 * the full browser, grouped by CALCULATION with every attested name.
 * @param {CatalogValue[]} values computed selected lots
 * @param {string[]} selectedIds current selection
 * @param {string} [fmt] angle format
 * @returns {string}
 */
export function buildCatalogHTML(values, selectedIds, fmt = 'dms') {
  const sel = new Set(selectedIds);
  let html = `<div class="lots" id="catalog-section"><h3>Hellenistic lots catalog</h3>`
    + `<p class="lots-note">${CATALOG_LOTS.length} attested names over ${LOT_CALCULATIONS.length} calculations. `
    + `Names sharing a calculation are one point under several attestations; a name with several calculations `
    + `is a family of variants — check the ones to display. Fortune and Spirit resolve through the Hermetic `
    + `set above (modifiers included); Syzygy is the prenatal lunation.</p>`
    + `<div id="catalog-selected">${buildCatalogSelectedHTML(values, fmt)}</div>`;
  // Browser: group name entries under their calculation.
  /** @type {Map<number, typeof CATALOG_LOTS>} */
  const groups = new Map();
  for (const l of CATALOG_LOTS) {
    if (!groups.has(l.calc)) groups.set(l.calc, []);
    groups.get(l.calc).push(l);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    calcLabel(LOT_CALCULATIONS[a[0]]).localeCompare(calcLabel(LOT_CALCULATIONS[b[0]])));
  html += `<input type="search" class="cat-filter" placeholder="Filter by name, alternative, or source (e.g. Valens, Marriage, Saturn)…" `
    + `aria-label="Filter the lots catalog">`
    + `<div class="cat-browser" id="cat-browser">`;
  for (const [ci, entries] of ordered) {
    const c = LOT_CALCULATIONS[ci];
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const search = entries.map(e => `${e.name} ${e.alts.join(' ')} ${e.prim} ${e.sec} ${e.cat}`).join(' ').toLowerCase();
    html += `<div class="cat-group" data-search="${escHtml(search)}">`
      + `<div class="cat-calc">${escHtml(calcLabel(c))}</div>`;
    for (const e of entries) {
      const rowSearch = `${e.name} ${e.alts.join(' ')} ${e.prim} ${e.sec} ${e.cat}`.toLowerCase();
      html += `<label class="cat-row" data-search="${escHtml(rowSearch)}"><input type="checkbox" class="cat-sel" data-id="${e.id}"${sel.has(e.id) ? ' checked' : ''}> `
        + `<span class="cat-name">${escHtml(e.name)}</span>`
        + (e.alts.length ? ` <span class="dim">(${escHtml(e.alts.join('; '))})</span>` : '')
        + ` <span class="cat-src">${escHtml(e.sec ? `${e.prim}; also ${e.sec}` : e.prim)}</span>`
        + (e.note ? ` <span class="cat-note" title="${escHtml(e.note)}">ⓘ</span>` : '')
        + `</label>`;
    }
    html += '</div>';
  }
  return html + '</div></div>';
}
