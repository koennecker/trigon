// bazi.js — BaZi (Four Pillars) calendar arithmetic, pure.
//
// Verified first in proto/bazi_proto.py against published charts
// (1990-06-15 Hong Kong, 1988-04-12 Taipei, 2000-06-15) and the
// day-cycle anchors 1900-01-01 = Jia Xu, 1949-10-01 = Jia Zi,
// 2000-01-01 = Wu Wu. The view builder (buildBaziHTML) returns a
// string, like lots.js; app.js wires it into the table view.
//
// State management, not ephemeris: the chart already computed the
// Sun's ecliptic longitude (out[0], Swiss or Moshier per the chart's
// engine), so computeBazi takes that longitude as an input and
// recomputes nothing. Year and month are read straight off it:
// the year turns when the Sun reaches 315 deg (Lichun), and the
// month branch advances one step every 30 deg from there, through
// the twelve Jie terms. No term-instant search, no second ephemeris
// path, no disagreement between the chart's Sun and the BaZi month.
// The only astronomical function here, trigSunLongitude, is the
// test mock: integration tests that have no chart output use it to
// synthesize a Sun longitude for a test instant. It is not the live
// path, and live code must not call it.
//
// Rules, stated so they can be challenged:
// - Year pillar: stem = (pillarYear - 4) % 10, branch =
//   (pillarYear - 4) % 12. pillarYear is the calendar year, except
//   in January/February before the Sun reaches 315 deg, where it is
//   the previous year (Lichun has not happened yet that year).
// - Month pillar: segment = floor(((sunLon - 315) mod 360) / 30),
//   branch = (Yin + segment) mod 12, term = the Jie name for that
//   segment; the stem follows the Five Tigers rule from the year
//   stem, i.e. stem = (firstStem + segment) % 10.
// - Day pillar: a continuous 60-day count, index = (JDN + 49) % 60,
//   where JDN is the Julian Day Number of the effective date.
// - Hour pillar: a double-hour, branch = ((hour + 1) // 2) % 12, so
//   23:00-01:00 is Zi; the stem follows the Five Rats rule from
//   the (effective) day stem.
// - Day boundary: the day advances at 23:00, the start of the Zi
//   hour, not at midnight. A 23:30 birth belongs to the next day's
//   pillar, and its hour stem is taken from that next day's stem.
//   The midnight school differs for 23:00-24:00 births only.
// - Time model: the input date/time is wall time (Trigon's tz
//   select; for BCE, local mean time). No true solar time
//   correction: a birth near a double-hour boundary can shift by
//   one hour pillar under a longitude correction, and that is a
//   stated limitation, not a silent choice.
import { jdFromCal } from './search.js';
import { norm360 } from './format.js';
import { isLeapYear, validDate } from './dateapi.js';

/**
 * @typedef {{name:string, char:string, element:string, polarity:string}} BaziStem
 * @typedef {{name:string, char:string, element:string, animal:string}} BaziBranch
 * @typedef {{stem:string, stemChar:string, stemElement:string, stemPolarity:string, branch:string, branchChar:string, branchElement:string, animal:string, hidden:string[], text:string, name:string}} BaziPillar
 * @typedef {{y:number, mo:number, d:number, hh:number, mi?:number}} BaziInput
 * @typedef {{pillars:{year:BaziPillar, month:BaziPillar, day:BaziPillar, hour:BaziPillar}, dayMaster:BaziStem, pillarYear:number, monthTerm:string, sunLon:number}} BaziResult
 */

/** @type {BaziStem[]} */
export const STEMS = [
  { name: 'Jia', char: '甲', element: 'Wood', polarity: 'Yang' },
  { name: 'Yi', char: '乙', element: 'Wood', polarity: 'Yin' },
  { name: 'Bing', char: '丙', element: 'Fire', polarity: 'Yang' },
  { name: 'Ding', char: '丁', element: 'Fire', polarity: 'Yin' },
  { name: 'Wu', char: '戊', element: 'Earth', polarity: 'Yang' },
  { name: 'Ji', char: '己', element: 'Earth', polarity: 'Yin' },
  { name: 'Geng', char: '庚', element: 'Metal', polarity: 'Yang' },
  { name: 'Xin', char: '辛', element: 'Metal', polarity: 'Yin' },
  { name: 'Ren', char: '壬', element: 'Water', polarity: 'Yang' },
  { name: 'Gui', char: '癸', element: 'Water', polarity: 'Yin' },
];

/** @type {BaziBranch[]} */
export const BRANCHES = [
  { name: 'Zi', char: '子', element: 'Water', animal: 'Rat' },
  { name: 'Chou', char: '丑', element: 'Earth', animal: 'Ox' },
  { name: 'Yin', char: '寅', element: 'Wood', animal: 'Tiger' },
  { name: 'Mao', char: '卯', element: 'Wood', animal: 'Rabbit' },
  { name: 'Chen', char: '辰', element: 'Earth', animal: 'Dragon' },
  { name: 'Si', char: '巳', element: 'Fire', animal: 'Snake' },
  { name: 'Wu', char: '午', element: 'Fire', animal: 'Horse' },
  { name: 'Wei', char: '未', element: 'Earth', animal: 'Goat' },
  { name: 'Shen', char: '申', element: 'Metal', animal: 'Monkey' },
  { name: 'You', char: '酉', element: 'Metal', animal: 'Rooster' },
  { name: 'Xu', char: '戌', element: 'Earth', animal: 'Dog' },
  { name: 'Hai', char: '亥', element: 'Water', animal: 'Pig' },
];

/** Branch -> hidden stems, main first, then middle, then residual. */
/** @type {Record<string, string[]>} */
export const HIDDEN_STEMS = {
  Zi: ['Gui'],
  Chou: ['Ji', 'Gui', 'Xin'],
  Yin: ['Jia', 'Bing', 'Wu'],
  Mao: ['Yi'],
  Chen: ['Wu', 'Yi', 'Gui'],
  Si: ['Bing', 'Geng', 'Wu'],
  Wu: ['Ding', 'Ji'],
  Wei: ['Ji', 'Ding', 'Yi'],
  Shen: ['Geng', 'Ren', 'Wu'],
  You: ['Xin'],
  Xu: ['Wu', 'Xin', 'Ding'],
  Hai: ['Ren', 'Jia'],
};

/** Positive modulo: JS % keeps the sign of the dividend, which would
 * break the stem/branch cycles for BCE (negative) years. */
/** @param {number} n @param {number} m @returns {number} */
const mod = (n, m) => ((n % m) + m) % m;

/** @param {number} stemIdx @param {number} branchIdx @returns {BaziPillar} */
function pillarFor(stemIdx, branchIdx) {
  const s = STEMS[mod(stemIdx, 10)];
  const b = BRANCHES[mod(branchIdx, 12)];
  return {
    stem: s.name, stemChar: s.char, stemElement: s.element, stemPolarity: s.polarity,
    branch: b.name, branchChar: b.char, branchElement: b.element, animal: b.animal,
    hidden: [...HIDDEN_STEMS[b.name]],
    text: s.char + b.char,
    name: `${s.name} ${b.name}`,
  };
}

/** @param {number} y @param {number} mo @param {number} d @returns {number} */
export function julianDayNumber(y, mo, d) {
  return Math.floor(jdFromCal(y, mo, d, 0) + 0.5);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** @param {number} y @param {number} mo @param {number} d @returns {{y:number, mo:number, d:number}} */
function nextDay(y, mo, d) {
  let dim = MONTH_DAYS[mo - 1];
  if (mo === 2 && isLeapYear(y)) dim = 29;
  d += 1;
  if (d > dim) { d = 1; mo += 1; if (mo > 12) { mo = 1; y += 1; } }
  // The Oct 1582 gap never existed: Oct 4 (Julian) is followed by
  // Oct 15 (Gregorian).
  if (y === 1582 && mo === 10 && d >= 5 && d <= 14) d = 15;
  return { y, mo, d };
}

/** Test mock only — apparent ecliptic longitude of the Sun, degrees,
 * Meeus low precision (~0.01 deg). Live code uses the chart's
 * out[0] instead; this exists so tests without a chart output can
 * synthesize a Sun longitude for a test instant. */
/** @param {number} jd @returns {number} */
export function trigSunLongitude(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = norm360(357.52911 + t * (35999.05029 - t * 0.0001537));
  const mr = m * Math.PI / 180;
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + t * 0.000014))
    + Math.sin(2 * mr) * (0.019993 - t * 0.000101)
    + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  return norm360(l0 + c - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180));
}

// Jie (month-starting) term names, in segment order from Lichun:
// segment 0 starts at Sun longitude 315 deg, each segment is 30 deg.
const JIE_NAMES = [
  'Lichun', 'Jingzhe', 'Qingming', 'Lixia', 'Mangzhong', 'Xiaoshu',
  'Liqiu', 'Bailu', 'Hanlu', 'Lidong', 'Daxue', 'Xiaohan',
];

/**
 * Four pillars for a wall datetime and the Sun's ecliptic longitude
 * at that instant (the chart's out[0]). y is the astronomical year
 * (y < 1 is BCE, as in dateapi.js); hh is the wall hour 0-23.
 * @param {BaziInput} input
 * @param {number} sunLonDeg Sun's ecliptic longitude, degrees
 * @returns {BaziResult}
 */
export function computeBazi(input, sunLonDeg) {
  const { y, mo, d } = input;
  const hh = input.hh;
  const mi = input.mi ?? 0;
  if (!validDate(y, mo, d)) throw new Error('invalid BaZi date');
  if (!Number.isInteger(hh) || hh < 0 || hh > 23) throw new Error('hour must be 0-23');
  if (!Number.isInteger(mi) || mi < 0 || mi > 59) throw new Error('minute must be 0-59');
  if (!Number.isFinite(sunLonDeg)) throw new Error('Sun longitude is required');
  const sunLon = norm360(sunLonDeg);
  // Year pillar: Lichun is in February, so only a January/February
  // date with the Sun still short of 315 deg belongs to the previous
  // year. Every other month is already past that year's Lichun.
  const pillarYear = (mo <= 2 && sunLon < 315) ? y - 1 : y;
  const yearStem = mod(pillarYear - 4, 10);
  const yearBranch = mod(pillarYear - 4, 12);
  // Month pillar: 30-deg segments from Lichun. Segment 0 is Yin, so
  // branch = (2 + segment) % 12 and the Five Tigers stem advances
  // one per segment from the Yin month's stem.
  const segment = Math.floor(mod(sunLon - 315, 360) / 30);
  const monthBranch = mod(2 + segment, 12);
  const monthTerm = JIE_NAMES[segment];
  const firstStem = mod(2 * yearStem + 2, 10);
  const monthStem = mod(firstStem + segment, 10);
  // Day pillar: the day advances at 23:00, so 23:00-24:00 belongs
  // to the next calendar day.
  let eff = { y, mo, d };
  if (hh >= 23) eff = nextDay(y, mo, d);
  const dayIdx = mod(julianDayNumber(eff.y, eff.mo, eff.d) + 49, 60);
  const dayStem = mod(dayIdx, 10);
  const dayBranch = mod(dayIdx, 12);
  // Hour pillar: double-hour branch from the wall hour, stem from
  // the (effective) day stem.
  const hourBranch = Math.floor((hh + 1) / 2) % 12;
  const hourStem = mod(2 * dayStem + hourBranch, 10);
  return {
    pillars: {
      year: pillarFor(yearStem, yearBranch),
      month: pillarFor(monthStem, monthBranch),
      day: pillarFor(dayStem, dayBranch),
      hour: pillarFor(hourStem, hourBranch),
    },
    dayMaster: STEMS[dayStem],
    pillarYear,
    monthTerm,
    sunLon,
  };
}

const STEM_CELL = p => `${p.stemChar} ${p.stem} · ${p.stemElement} ${p.stemPolarity}`;
const BRANCH_CELL = p => `${p.branchChar} ${p.branch} · ${p.branchElement} ${p.animal}`;
const HIDDEN_CELL = p => p.hidden.map(h => {
  const s = STEMS.find(x => x.name === h);
  return `${s.char} ${s.name}`;
}).join(' · ');

/**
 * Subtable HTML for a computed BaZi result, in the lots-section style:
 * one row per pillar, stem and branch with element/polarity/animal,
 * and the branch's hidden stems. All strings come from fixed tables.
 * @param {BaziResult} result
 * @returns {string}
 */
export function buildBaziHTML(result) {
  const { pillars, dayMaster } = result;
  const rows = [
    ['Year', pillars.year],
    ['Month', pillars.month],
    ['Day', pillars.day],
    ['Hour', pillars.hour],
  ];
  let html = `<div class="lots" id="bazi-section"><h3>BaZi — Four Pillars</h3>`
    + `<p class="lots-note">Day Master: ${dayMaster.char} ${dayMaster.name} `
    + `(${dayMaster.element} ${dayMaster.polarity}) — the day stem, the self. `
    + `Month term: ${result.monthTerm}.</p>`
    + `<p class="lots-note">Year and month are read from the chart's Sun longitude: `
    + `year turns at 315° (Lichun), month advances every 30° from there; `
    + `day advances at 23:00, the start of the Zi hour. Times are the chart's `
    + `wall time as entered, with no true solar time correction.</p>`
    + `<div class="tbl-scroll"><table class="lots-table"><thead><tr>`
    + `<th>Pillar</th><th>Stem</th><th>Branch</th><th>Hidden stems</th></tr></thead><tbody>`;
  for (const [label, p] of rows) {
    html += `<tr><td class="body">${label}</td><td class="num">${STEM_CELL(p)}</td>`
      + `<td class="num">${BRANCH_CELL(p)}</td><td class="num">${HIDDEN_CELL(p)}</td></tr>`;
  }
  return html + '</tbody></table></div></div>';
}
