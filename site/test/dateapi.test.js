// Unit tests for dateapi.js (hand-rolled BCE/CE calendar).
// Run: node --test test/dateapi.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BCE_MIN_ASTRO, eraToAstro, astroToEra, checkYearRange,
  isLeapYear, daysInMonth, validDate,
  fmtCalendar, fmtInstant, lmtOffsetHours, fmtLmtOffset, jdFromWall,
  weekdayOf, shiftMonth, cmpDate, clampDate, fmtDateShort,
} from '../dateapi.js';
import { jdFromCal } from '../search.js';

describe('era conversion', () => {
  it('maps 1 BCE to astronomical 0 (no year zero typed)', () => {
    assert.equal(eraToAstro(1, 'bce'), 0);
  });
  it('maps 44 BCE to -43', () => {
    assert.equal(eraToAstro(44, 'bce'), -43);
  });
  it('maps 12999 BCE to -12998', () => {
    assert.equal(eraToAstro(12999, 'bce'), BCE_MIN_ASTRO);
  });
  it('CE passes through', () => {
    assert.equal(eraToAstro(2026, 'ce'), 2026);
    assert.equal(eraToAstro(1, 'ce'), 1);
  });
  it('round-trips through astroToEra', () => {
    assert.deepEqual(astroToEra(-43), { yy: 44, era: 'bce' });
    assert.deepEqual(astroToEra(0), { yy: 1, era: 'bce' });
    assert.deepEqual(astroToEra(2026), { yy: 2026, era: 'ce' });
  });
  it('rejects non-positive years and bad eras', () => {
    assert.throws(() => eraToAstro(0, 'ce'), /positive/);
    assert.throws(() => eraToAstro(-5, 'bce'), /positive/);
    assert.throws(() => eraToAstro(44, 'bc'), /era/);
  });
  it('enforces the Swiss range floor', () => {
    assert.throws(() => checkYearRange(-12999), /12999 BCE/);
    checkYearRange(-12998);
    checkYearRange(9999);
    assert.throws(() => checkYearRange(10000), /9999/);
  });
});

describe('leap years and validation', () => {
  it('Julian rule before 1582, incl. BCE', () => {
    assert.equal(isLeapYear(2024), true);   // Gregorian
    assert.equal(isLeapYear(1900), false);  // Gregorian century
    assert.equal(isLeapYear(2000), true);
    assert.equal(isLeapYear(1500), true);   // Julian century: leap
    assert.equal(isLeapYear(-4), true);     // 5 BCE: -4 % 4 === 0
    assert.equal(isLeapYear(-100), true);   // 101 BCE: Julian century leap
    assert.equal(isLeapYear(-1), false);    // 2 BCE
  });
  it('daysInMonth handles February in both calendars', () => {
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2023, 2), 28);
    assert.equal(daysInMonth(-4, 2), 29);   // 5 BCE, Julian
    assert.equal(daysInMonth(-1, 2), 28);   // 2 BCE
  });
  it('rejects the missing days of Oct 1582', () => {
    assert.equal(validDate(1582, 10, 4), true);
    assert.equal(validDate(1582, 10, 5), false);
    assert.equal(validDate(1582, 10, 14), false);
    assert.equal(validDate(1582, 10, 15), true);
  });
  it('rejects Feb 30 etc.', () => {
    assert.equal(validDate(-43, 2, 30), false);
    assert.equal(validDate(-43, 2, 29), false); // 44 BCE not leap
    assert.equal(validDate(-4, 2, 29), true);   // 5 BCE leap
    assert.equal(validDate(2026, 4, 31), false);
  });
});

describe('formatting', () => {
  it('formats CE as ISO-like', () => {
    assert.equal(fmtCalendar(2026, 9, 28), '2026-09-28');
    assert.equal(fmtCalendar(1, 1, 1), '0001-01-01');
  });
  it('formats BCE with era label', () => {
    assert.equal(fmtCalendar(-43, 3, 15), '15 Mar 44 BCE');
    assert.equal(fmtCalendar(0, 1, 1), '1 Jan 1 BCE');
  });
  it('fmtInstant anchors on JD 0', () => {
    // JD 0 = 4713-01-01 BCE 12:00 UT (Julian proleptic)
    assert.equal(fmtInstant(0), '1 Jan 4713 BCE 12:00');
    assert.equal(fmtInstant(0, true), '1 Jan 4713 BCE 12:00:00');
  });
  it('fmtInstant matches the old toISOString slice for a CE date', () => {
    const jd = jdFromCal(2026, 9, 28, 5 + 31 / 60);
    assert.equal(fmtInstant(jd), '2026-09-28 05:31');
    const jd2 = jdFromCal(2026, 9, 28, 5 + 31 / 60 + 45 / 3600);
    assert.equal(fmtInstant(jd2, true), '2026-09-28 05:31:45');
  });
  it('fmtInstant truncates rather than rounds', () => {
    const jd = jdFromCal(2026, 9, 28, 5 + 31 / 60 + 59.9 / 3600);
    assert.equal(fmtInstant(jd), '2026-09-28 05:31');
  });
});

describe('local mean time', () => {
  it('is longitude / 15', () => {
    assert.ok(Math.abs(lmtOffsetHours(-112.07) - (-7.471333)) < 1e-6);
    assert.equal(lmtOffsetHours(0), 0);
  });
  it('formats the offset label', () => {
    assert.equal(fmtLmtOffset(-112.07), 'UTC-07:28');
    assert.equal(fmtLmtOffset(0), 'UTC+00:00');
    assert.equal(fmtLmtOffset(139.69), 'UTC+09:19');
  });
  it('jdFromWall accepts out-of-range hours (LMT shifts)', () => {
    // 12:00 LMT at lon -180 == 24:00 UT == next day 00:00 UT.
    const a = jdFromWall(-43, 3, 15, 12 - (-180) / 15);
    const b = jdFromCal(-43, 3, 16, 0);
    assert.ok(Math.abs(a - b) < 1e-9);
  });
});

describe('weekdayOf', () => {
  it('matches known anchors (0 = Sunday)', () => {
    assert.equal(weekdayOf(2026, 9, 28), 1); // Monday
    assert.equal(weekdayOf(2000, 1, 1), 6);  // Saturday
    assert.equal(weekdayOf(1969, 7, 20), 0); // Sunday
  });
  it('follows the Julian/Gregorian cutover', () => {
    assert.equal(weekdayOf(1582, 10, 4), 4);  // Thursday (Julian)
    assert.equal(weekdayOf(1582, 10, 15), 5); // Friday (Gregorian)
  });
  it('works for BCE dates (proleptic Julian)', () => {
    const w = weekdayOf(-43, 3, 15);
    assert.ok(w >= 0 && w <= 6);
    // consecutive days advance the weekday by one
    assert.equal(weekdayOf(-43, 3, 16), (w + 1) % 7);
  });
});

describe('shiftMonth', () => {
  it('shifts within a year', () => {
    assert.deepEqual(shiftMonth(2026, 9, 0), { y: 2026, mo: 9 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { y: 2025, mo: 12 });
    assert.deepEqual(shiftMonth(1582, 10, 1), { y: 1582, mo: 11 });
  });
  it('skips the nonexistent year zero in both directions', () => {
    assert.deepEqual(shiftMonth(1, 1, -1), { y: 0, mo: 12 });  // Dec 1 BCE
    assert.deepEqual(shiftMonth(0, 12, 1), { y: 1, mo: 1 });   // Jan 1 CE
    assert.deepEqual(shiftMonth(1, 1, -13), { y: -1, mo: 12 }); // Dec 2 BCE
    assert.deepEqual(shiftMonth(-1, 12, 13), { y: 1, mo: 1 });
  });
  it('round-trips across the full supported range', () => {
    for (let y = -12998; y <= 9999; y += 733)
      for (let mo = 1; mo <= 12; mo += 5)
        for (const dl of [-25, -1, 0, 1, 37]) {
          const r = shiftMonth(y, mo, dl);
          assert.deepEqual(shiftMonth(r.y, r.mo, -dl), { y, mo });
        }
  });
});

describe('cmpDate / clampDate', () => {
  it('orders across the era boundary', () => {
    assert.equal(cmpDate({ y: 0, mo: 12, d: 31 }, { y: 1, mo: 1, d: 1 }), -1);
    assert.equal(cmpDate({ y: 1, mo: 1, d: 1 }, { y: 1, mo: 1, d: 1 }), 0);
    assert.equal(cmpDate({ y: 2026, mo: 9, d: 28 }, { y: 2026, mo: 9, d: 27 }), 1);
  });
  it('clamps into [lo, hi], tolerating null bounds', () => {
    const lo = { y: -1, mo: 1, d: 1 }, hi = { y: 1, mo: 12, d: 31 };
    assert.deepEqual(clampDate({ y: -5, mo: 3, d: 3 }, lo, null), lo);
    assert.deepEqual(clampDate({ y: 5, mo: 3, d: 3 }, null, hi), hi);
    const v = { y: 0, mo: 1, d: 1 };
    assert.deepEqual(clampDate(v, lo, hi), v);
    assert.notEqual(clampDate(v, lo, hi), v); // copies, never aliases
  });
});

describe('fmtDateShort', () => {
  it('labels both eras unambiguously', () => {
    assert.equal(fmtDateShort(2026, 9, 28), '28 Sep 2026 CE');
    assert.equal(fmtDateShort(-43, 3, 15), '15 Mar 44 BCE');
    assert.equal(fmtDateShort(0, 1, 1), '1 Jan 1 BCE');
  });
});
