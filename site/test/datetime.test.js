// Unit tests for datetime.js (unified date+time input segment logic).
// Run: node --test test/datetime.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DT_SEGS, shownSegs, formatDT, segSpans, segAtOffset,
  stepSeg, applyDigits, matchMonth, matchMonths, setEraSeg,
  cmpDT, clampDT, dtFloor, dtCeil, parseDTText,
} from '../datetime.js';

const F = (y, mo, d, hh = 0, mi = 0, ss = 0) => ({ y, mo, d, hh, mi, ss });

describe('formatDT', () => {
  it('formats CE with seconds', () => {
    assert.equal(formatDT(F(2026, 9, 28, 14, 30, 5), true), '28 Sep 2026 CE 14:30:05');
  });
  it('formats CE without seconds', () => {
    assert.equal(formatDT(F(2026, 9, 28, 14, 30), false), '28 Sep 2026 CE 14:30');
  });
  it('formats BCE (astronomical -43 -> 44 BCE)', () => {
    assert.equal(formatDT(F(-43, 3, 15, 12, 0, 0), true), '15 Mar 44 BCE 12:00:00');
  });
  it('formats 1 BCE (astronomical 0)', () => {
    assert.equal(formatDT(F(0, 1, 1), false), '1 Jan 1 BCE 00:00');
  });
  it('supports an in-progress segment override (shown, not committed)', () => {
    const f = F(2026, 10, 1, 2, 8);
    assert.equal(formatDT(f, false, { seg: 'y', text: '203' }), '1 Oct 203 CE 02:08');
    assert.equal(formatDT(f, false, { seg: 'hh', text: '2' }), '1 Oct 2026 CE 2:08');
    // no override: unchanged
    assert.equal(formatDT(f, false), '1 Oct 2026 CE 02:08');
  });
});

describe('segSpans / segAtOffset', () => {
  const f = F(2026, 9, 28, 14, 30, 5);
  it('spans cover each segment exactly', () => {
    const spans = segSpans(f, true);
    const s = formatDT(f, true);
    assert.deepEqual(spans.map(x => s.slice(x.start, x.end)),
      ['28', 'Sep', '2026', 'CE', '14', '30', '05']);
    assert.deepEqual(spans.map(x => x.seg), DT_SEGS);
  });
  it('drops the seconds segment when seconds=false', () => {
    assert.deepEqual(shownSegs(false), ['d', 'mo', 'y', 'era', 'hh', 'mi']);
    assert.equal(segSpans(f, false).length, 6);
  });
  it('spans track an in-progress segment override', () => {
    const g = F(2026, 10, 1, 2, 8);
    const spans = segSpans(g, false, { seg: 'y', text: '203' });
    const s = formatDT(g, false, { seg: 'y', text: '203' });
    assert.equal(s.slice(spans[2].start, spans[2].end), '203');
    assert.deepEqual([spans[2].start, spans[2].end], [6, 9]);
  });
  it('maps offsets to segments, separators to the right', () => {
    // "28 Sep 2026 CE 14:30:05": offset 2 is the space -> month
    assert.equal(segAtOffset(f, true, 0), 0);
    assert.equal(segAtOffset(f, true, 1), 0);
    assert.equal(segAtOffset(f, true, 2), 1);
    assert.equal(segAtOffset(f, true, 3), 1);
    assert.equal(segAtOffset(f, true, 6), 2); // start of "2026"
    assert.equal(segAtOffset(f, true, 999), 6); // past end -> last
  });
});

describe('stepSeg', () => {
  it('wraps the day within the month', () => {
    assert.equal(stepSeg(F(2026, 1, 31), 'd', 1).d, 1);
    assert.equal(stepSeg(F(2026, 1, 1), 'd', -1).d, 31);
  });
  it('cycles the month and clamps the day', () => {
    const f = stepSeg(F(2026, 1, 31, 10), 'mo', 1);
    assert.equal(f.mo, 2);
    assert.equal(f.d, 28); // 2026 not a leap year
    assert.equal(f.hh, 10); // time untouched
    const g = stepSeg(F(2024, 1, 31), 'mo', 1);
    assert.equal(g.d, 29); // 2024 is a leap year
  });
  it('skips the 1582 cutover gap in both directions', () => {
    assert.equal(stepSeg(F(1582, 10, 4), 'd', 1).d, 15);
    assert.equal(stepSeg(F(1582, 10, 15), 'd', -1).d, 4);
  });
  it('steps the year with no year zero', () => {
    assert.equal(stepSeg(F(1, 6, 15), 'y', -1).y, 0); // 1 CE -> 1 BCE
    assert.equal(stepSeg(F(0, 6, 15), 'y', 1).y, 1);  // 1 BCE -> 1 CE
  });
  it('clamps the year at the range ends', () => {
    assert.equal(stepSeg(F(9999, 1, 1), 'y', 1).y, 9999);
    assert.equal(stepSeg(F(-12998, 1, 1), 'y', -1).y, -12998);
  });
  it('toggles the era keeping the year number', () => {
    assert.equal(stepSeg(F(2026, 3, 1), 'era', 1).y, -2025); // 2026 BCE
    assert.equal(stepSeg(F(-43, 3, 15), 'era', -1).y, 44);   // 44 CE
  });
  it('clamps the era toggle at the range ends', () => {
    assert.equal(stepSeg(F(-12998, 1, 1), 'era', 1).y, 9999); // 12999 BCE -> 9999 CE
  });
  it('wraps the time segments', () => {
    assert.equal(stepSeg(F(2026, 1, 1, 23), 'hh', 1).hh, 0);
    assert.equal(stepSeg(F(2026, 1, 1, 0), 'hh', -1).hh, 23);
    assert.equal(stepSeg(F(2026, 1, 1, 0, 59), 'mi', 1).mi, 0);
    assert.equal(stepSeg(F(2026, 1, 1, 0, 0, 0), 'ss', -1).ss, 59);
  });
});

describe('applyDigits', () => {
  it('sets the day and clamps to the month', () => {
    assert.equal(applyDigits(F(2026, 2, 1), 'd', '30').d, 28);
    assert.equal(applyDigits(F(2024, 2, 1), 'd', '30').d, 29);
    assert.equal(applyDigits(F(2026, 9, 1), 'd', '3').d, 3);
  });
  it('snaps forward out of the cutover gap', () => {
    assert.equal(applyDigits(F(1582, 10, 1), 'd', '10').d, 15);
    assert.equal(applyDigits(F(1582, 10, 1), 'd', '05').d, 15);
    assert.equal(applyDigits(F(1582, 10, 1), 'd', '15').d, 15);
  });
  it('clamps the hour and minute', () => {
    assert.equal(applyDigits(F(2026, 1, 1), 'hh', '29').hh, 23);
    assert.equal(applyDigits(F(2026, 1, 1), 'mi', '75').mi, 59);
  });
  it('clamps the year to the era maximum', () => {
    assert.equal(applyDigits(F(2026, 1, 1), 'y', '12345').y, 9999);
    assert.equal(applyDigits(F(-43, 1, 1), 'y', '14000').y, -12998); // 12999 BCE
  });
  it('ignores non-numeric runs', () => {
    assert.deepEqual(applyDigits(F(2026, 1, 1), 'd', ''), F(2026, 1, 1));
  });
});

describe('matchMonth', () => {
  it('matches the first month starting with the prefix', () => {
    assert.equal(matchMonth(F(2026, 9, 1), 'm').mo, 3); // Sep -> wraps to Mar
  });
  it('cycles past the current month', () => {
    assert.equal(matchMonth(F(2026, 1, 1), 'j').mo, 6);  // Jan -> Jun
    assert.equal(matchMonth(F(2026, 6, 1), 'j').mo, 7);  // Jun -> Jul
    assert.equal(matchMonth(F(2026, 7, 1), 'j').mo, 1);  // Jul -> Jan
  });
  it('extends the prefix', () => {
    assert.equal(matchMonth(F(2026, 1, 1), 'ma').mo, 3); // Mar before May
    assert.equal(matchMonth(F(2026, 3, 1), 'ma').mo, 5); // Mar -> May
  });
  it('returns null on no match and clamps the day', () => {
    assert.equal(matchMonth(F(2026, 1, 1), 'x'), null);
    assert.equal(matchMonth(F(2026, 1, 31), 'f').d, 28);
  });
});

describe('matchMonths', () => {
  it('lists every month starting with the prefix', () => {
    assert.deepEqual(matchMonths('j'), [1, 6, 7]);
    assert.deepEqual(matchMonths('ma'), [3, 5]);
    assert.deepEqual(matchMonths('s'), [9]);
  });
  it('is case-insensitive and empty on no match', () => {
    assert.deepEqual(matchMonths('J'), [1, 6, 7]);
    assert.deepEqual(matchMonths('x'), []);
    assert.deepEqual(matchMonths('b'), []);
  });
});

describe('setEraSeg', () => {
  it('sets CE/BCE keeping the year number', () => {
    assert.equal(setEraSeg(F(2026, 1, 1), 'bce').y, -2025);
    assert.equal(setEraSeg(F(-43, 3, 15), 'ce').y, 44);
  });
});

describe('cmpDT / clampDT', () => {
  const a = F(2026, 1, 10, 12, 0, 0), b = F(2026, 1, 10, 13, 0, 0);
  it('orders by time-of-day within the same date', () => {
    assert.ok(cmpDT(a, b) < 0);
    assert.ok(cmpDT(b, a) > 0);
    assert.equal(cmpDT(a, a), 0);
  });
  it('clamps to either bound', () => {
    assert.deepEqual(clampDT(F(2025, 1, 1), a, b), a);
    assert.deepEqual(clampDT(F(2027, 1, 1), a, b), b);
    assert.deepEqual(clampDT(a, a, b), a);
  });
  it('tolerates null bounds', () => {
    assert.deepEqual(clampDT(F(2025, 1, 1), null, b), F(2025, 1, 1));
  });
  it('global floor and ceiling', () => {
    assert.deepEqual(dtFloor(), { y: -12998, mo: 1, d: 1, hh: 0, mi: 0, ss: 0 });
    assert.deepEqual(dtCeil(), { y: 9999, mo: 12, d: 31, hh: 23, mi: 59, ss: 59 });
  });
});

describe('parseDTText', () => {
  it('parses the canonical format', () => {
    assert.deepEqual(parseDTText('15 Mar 44 BCE 12:00:00', true),
      { y: -43, mo: 3, d: 15, hh: 12, mi: 0, ss: 0 });
    assert.deepEqual(parseDTText('28 Sep 2026 CE 14:30', false),
      { y: 2026, mo: 9, d: 28, hh: 14, mi: 30, ss: 0 });
  });
  it('rejects invalid dates', () => {
    assert.equal(parseDTText('30 Feb 2026 CE 00:00', false), null);
    assert.equal(parseDTText('10 Oct 1582 CE 00:00', false), null); // cutover gap
    assert.equal(parseDTText('28 Sep 2026 CE 25:00', false), null);
    assert.equal(parseDTText('not a date', false), null);
    assert.equal(parseDTText('28 Foo 2026 CE 00:00', false), null);
  });
});
