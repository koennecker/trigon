// skip.js — pure core of time stepping.
//
// skipFields(f, dir, n, unit) shifts wall-clock fields {y, mo, d, hh, mi,
// ss} by n units in the picker's own frame (pure calendar math — no Date,
// so BCE works). Month/year use calendar rollover; smaller units add JD
// fractions. Clamped to the supported range instead of erroring at edges.
// The DOM wrapper (reading/writing the picker, re-deriving the timezone,
// recalculating) stays in app.js.
import { jdFromCal, calFromJd } from './search.js';
import { validDate, BCE_MIN_ASTRO } from './dateapi.js';

export const STEP_DAYS = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7 };

export function skipFields(f, dir, n, unit) {
  let { y, mo, d } = f;
  let secOfDay = f.hh * 3600 + f.mi * 60 + f.ss;
  if (unit === 'month' || unit === 'year') {
    if (unit === 'month') {
      const t = (y * 12 + (mo - 1)) + dir * n;
      y = Math.floor(t / 12); mo = ((t % 12) + 12) % 12 + 1;
    } else {
      y += dir * n; // astronomical years: no year-zero skip needed
    }
    d = Math.min(d, 31);
    while (!validDate(y, mo, d)) d--;
  } else {
    const c = calFromJd(jdFromCal(y, mo, d, secOfDay / 3600) + dir * n * STEP_DAYS[unit]);
    y = c.y; mo = c.mo; d = c.d;
    secOfDay = Math.floor(c.hourUT * 3600 + 1e-3);
    if (secOfDay >= 86400) secOfDay = 86399;
  }
  if (y < BCE_MIN_ASTRO) { y = BCE_MIN_ASTRO; mo = 1; d = 1; secOfDay = 0; }
  if (y > 9999) { y = 9999; mo = 12; d = 31; secOfDay = 86399; }
  return {
    y, mo, d,
    hh: Math.floor(secOfDay / 3600),
    mi: Math.floor((secOfDay % 3600) / 60),
    ss: secOfDay % 60,
  };
}
