// dateapi.js — hand-rolled calendar API for the BCE/CE date inputs.
//
// JavaScript's Date cannot represent BCE dates for practical purposes
// (Date.UTC/Date.parse reject negative years; years 0-99 map to 1900+y;
// toISOString is proleptic Gregorian while the engine is Julian before
// 1582-10-15). So all calendar work here is done by hand on top of the
// jdFromCal/calFromJd ports in search.js. Date is never consulted.
//
// Year numbering is astronomical throughout: y = 0 is 1 BCE, y = -43 is
// 44 BCE. The UI shows "44 BCE" and converts once, at the boundary.

import { jdFromCal, calFromJd } from './search.js';

// 12999 BCE: deepest clean year boundary inside the Swiss .se1 back-catalog.
// seplm132.se1's data starts 13000 BCE Aug 10 (Ephemeris Time); Delta-T is
// ~+8.4 days there, so 12999 BCE Jan 1 clears it with ~150 days of margin.
export const BCE_MIN_ASTRO = -12998;
export const CE_MAX_YEAR = 9999;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad2 = n => String(n).padStart(2, '0');

// "44 BCE" <-> -43. The era toggle means year 0 is never typed.
export function eraToAstro(yy, era) {
  if (!Number.isInteger(yy) || yy < 1)
    throw new Error('year must be a positive whole number');
  if (era !== 'bce' && era !== 'ce')
    throw new Error('era must be BCE or CE');
  return era === 'bce' ? 1 - yy : yy;
}

export function astroToEra(y) {
  if (!Number.isInteger(y)) throw new Error('year must be a whole number');
  return y < 1 ? { yy: 1 - y, era: 'bce' } : { yy: y, era: 'ce' };
}

export function checkYearRange(y) {
  if (y < BCE_MIN_ASTRO)
    throw new Error('years before 12999 BCE are outside the Swiss Ephemeris range');
  if (y > CE_MAX_YEAR)
    throw new Error('year must be 9999 or earlier');
}

// Leap rule follows the engine's calendar cutover: Julian (proleptic)
// before 1582, Gregorian on/after. For February the year rule suffices.
export function isLeapYear(y) {
  if (y < 1582) return y % 4 === 0;
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(y, mo) {
  if (!Number.isInteger(mo) || mo < 1 || mo > 12)
    throw new Error('month must be 1-12');
  if (mo === 2) return isLeapYear(y) ? 29 : 28;
  return MONTH_DAYS[mo - 1];
}

// The 1582-10-04 (Julian) -> 1582-10-15 (Gregorian) cutover: Oct 5-14
// never existed.
export function validDate(y, mo, d) {
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d))
    return false;
  if (mo < 1 || mo > 12 || d < 1) return false;
  if (y === 1582 && mo === 10) return d <= 4 || (d >= 15 && d <= 31);
  return d <= daysInMonth(y, mo);
}

// "2026-09-28" for CE, "15 Mar 44 BCE" for BCE.
export function fmtCalendar(y, mo, d) {
  if (y >= 1) return `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}`;
  const { yy } = astroToEra(y);
  return `${d} ${MONTHS[mo - 1]} ${yy} BCE`;
}

// Instant formatting. Truncates (never rounds) to the shown precision,
// matching the old toISOString().slice() behavior for CE dates.
// (JD days start at noon: the civil day containing `jd` is [k-0.5, k+0.5)
// with k = floor(jd + 0.5), and midnight is dayFrac 0.)
export function fmtInstant(jd, withSeconds = false) {
  const k = Math.floor(jd + 0.5);
  const dayFrac = jd + 0.5 - k;
  // +1e-3: jdFromCal/calFromJd round-trips carry ~1e-5 s of float error,
  // which would otherwise flip truncation at exact minute boundaries.
  let s = Math.floor(dayFrac * 86400 + 1e-3);
  if (s < 0) s = 0;
  if (s > 86399) s = 86399;
  const hh = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), ss = s % 60;
  const c = calFromJd(k); // k is the noon JD of the civil day
  const t = withSeconds ? `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}`
                        : `${pad2(hh)}:${pad2(mi)}`;
  return `${fmtCalendar(c.y, c.mo, c.d)} ${t}`;
}

// Local mean time: wall time at longitude lon (degrees, +E) runs
// UT + lon/15 h. Time zones are meaningless before they existed, so BCE
// inputs are read as LMT at the site longitude.
export function lmtOffsetHours(lon) {
  return lon / 15;
}

// "UTC-07:28" / "UTC+05:30"-style label for an LMT offset.
export function fmtLmtOffset(lon) {
  const totalMin = Math.round(lon * 4); // 1 deg = 4 min
  const sign = totalMin < 0 ? '-' : '+';
  const a = Math.abs(totalMin);
  return `UTC${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`;
}

// Wall-clock fields -> Julian day. hourFrac may lie outside [0, 24);
// jdFromCal is linear in the hour, so LMT offsets just work.
export function jdFromWall(y, mo, d, hourFrac) {
  return jdFromCal(y, mo, d, hourFrac);
}

// Weekday of a calendar date: 0 = Sunday .. 6 = Saturday. JD 2451545.0
// (2000-01-01 12:00 UT) was a Saturday, and the calendar here is Julian
// before 1582-10-15, so the weekday follows the same cutover as the date.
export function weekdayOf(y, mo, d) {
  const jd = jdFromWall(y, mo, d, 12);
  return (((Math.floor(jd + 1.5) % 7) + 7) % 7);
}

// Shift a (year, month) by delta months, skipping the nonexistent year 0:
// Dec 1 BCE -> Jan 1 CE and back. Pure; used by the date-picker popup.
export function shiftMonth(y, mo, delta) {
  const mi = (y < 1 ? y * 12 - 12 : (y - 1) * 12) + (mo - 1) + delta;
  const yy = Math.floor(mi / 12) + 1;
  const mm = mi - (yy - 1) * 12;
  return { y: yy, mo: mm + 1 };
}

// Compare {y, mo, d} triples (astronomical year): -1, 0, or 1.
export function cmpDate(a, b) {
  return (a.y - b.y) || (a.mo - b.mo) || (a.d - b.d);
}

// Clamp a {y, mo, d} triple into [lo, hi]; either bound may be null.
export function clampDate(v, lo, hi) {
  if (lo && cmpDate(v, lo) < 0) return { ...lo };
  if (hi && cmpDate(v, hi) > 0) return { ...hi };
  return { ...v };
}

// Short label for the date-picker button: "28 Sep 2026 CE", "15 Mar 44 BCE".
export function fmtDateShort(y, mo, d) {
  const { yy, era } = astroToEra(y);
  return `${d} ${MONTHS[mo - 1]} ${yy} ${era.toUpperCase()}`;
}
