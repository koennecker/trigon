// BaZi unit tests — mirrors proto/test_bazi_proto.py, so a JS/Python
// drift shows up as a test failure in either suite, not as a silent
// divergence. Published examples and day anchors are checked against
// their sources, not against the implementation.
//
// Sun longitude is an input, not computed here: live code passes the
// chart's out[0]. These tests have no chart output, so they use the
// trig function as the mock Sun provider — mockSun() below converts
// a wall datetime plus offset to the UTC instant and reads the mock
// Sun longitude there. A test that passes an exact longitude
// directly (the segment tests) needs no mock at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBazi, trigSunLongitude } from '../bazi.js';
import { jdFromCal } from '../search.js';

const mockSun = (y, mo, d, hh, mi = 0, offsetMin = 0) =>
  trigSunLongitude(jdFromCal(y, mo, d, hh + mi / 60 - offsetMin / 60));
const bazi = (y, mo, d, hh, mi = 0, offsetMin = 0) =>
  computeBazi({ y, mo, d, hh, mi }, mockSun(y, mo, d, hh, mi, offsetMin));
const names = r => [r.pillars.year.name, r.pillars.month.name, r.pillars.day.name, r.pillars.hour.name];

test('published example: 1990-06-15 10:00 Hong Kong', () => {
  assert.deepEqual(names(bazi(1990, 6, 15, 10, 0, 480)),
    ['Geng Wu', 'Ren Wu', 'Xin Hai', 'Gui Si']);
});

test('published example: 1988-04-12 10:00 Taipei', () => {
  assert.deepEqual(names(bazi(1988, 4, 12, 10, 0, 480)),
    ['Wu Chen', 'Bing Chen', 'Ding You', 'Yi Si']);
});

test('published day chart: 2000-06-15', () => {
  const r = bazi(2000, 6, 15, 12);
  assert.deepEqual(names(r).slice(0, 3), ['Geng Chen', 'Ren Wu', 'Jia Chen']);
  assert.equal(r.dayMaster.name, 'Jia');
});

test('day-cycle anchors', () => {
  assert.equal(bazi(1900, 1, 1, 12).pillars.day.name, 'Jia Xu');
  assert.equal(bazi(1949, 10, 1, 12).pillars.day.name, 'Jia Zi');
  assert.equal(bazi(2000, 1, 1, 12).pillars.day.name, 'Wu Wu');
});

test('pre-Lichun year and month: 2000-01-01', () => {
  const r = bazi(2000, 1, 1, 12);
  assert.equal(r.pillars.year.name, 'Ji Mao');
  assert.equal(r.pillars.month.name, 'Bing Zi');
});

test('Lichun boundary 2025, three hours either side (mock Sun)', () => {
  const before = bazi(2025, 2, 3, 19, 0, 480);
  assert.deepEqual(names(before).slice(0, 2), ['Jia Chen', 'Ding Chou']);
  const after = bazi(2025, 2, 4, 2, 0, 480);
  assert.deepEqual(names(after).slice(0, 2), ['Yi Si', 'Wu Yin']);
});

test('Mangzhong boundary 1990', () => {
  assert.equal(bazi(1990, 6, 5, 12, 0, 480).pillars.month.name, 'Xin Si');
  assert.equal(bazi(1990, 6, 7, 12, 0, 480).pillars.month.name, 'Ren Wu');
});

test('day advances at 23:00', () => {
  const evening = bazi(1990, 6, 15, 22, 0, 480);
  assert.equal(evening.pillars.day.name, 'Xin Hai');
  assert.equal(evening.pillars.hour.name, 'Ji Hai');
  const late = bazi(1990, 6, 15, 23, 0, 480);
  assert.equal(late.pillars.day.name, 'Ren Zi');
  assert.equal(late.pillars.hour.name, 'Geng Zi');
  const early = bazi(1990, 6, 16, 0, 30, 480);
  assert.equal(early.pillars.day.name, 'Ren Zi');
  assert.equal(early.pillars.hour.name, 'Geng Zi');
  assert.equal(bazi(1990, 6, 16, 1, 0, 480).pillars.hour.name, 'Xin Chou');
});

test('month segment boundaries are exact Sun-longitude cuts', () => {
  const at = (sunLon, mo) => computeBazi({ y: 2025, mo, d: 15, hh: 12 }, sunLon);
  // Same Sun longitude, different month: February before Lichun
  // belongs to the previous year, June does not.
  assert.deepEqual([at(314.9, 2).pillars.year.name, at(314.9, 2).pillars.month.name],
    ['Jia Chen', 'Ding Chou']);
  assert.deepEqual([at(314.9, 6).pillars.year.name, at(314.9, 6).pillars.month.name],
    ['Yi Si', 'Ji Chou']);
  assert.equal(at(315.0, 2).pillars.month.name, 'Wu Yin');
  assert.equal(at(344.9, 6).pillars.month.name, 'Wu Yin');
  assert.equal(at(345.0, 6).pillars.month.name, 'Ji Mao');
  assert.equal(at(14.9, 6).pillars.month.name, 'Ji Mao');
  assert.equal(at(15.0, 6).pillars.month.name, 'Geng Chen');
  assert.equal(at(284.9, 12).pillars.month.name, 'Wu Zi');
  assert.equal(at(285.0, 12).pillars.month.name, 'Ji Chou');
});

test('trig mock Sun longitude at published Lichun instants is ~315 deg', () => {
  // Known Beijing-time Lichun instants, as UTC Julian days.
  const known = {
    2024: jdFromCal(2024, 2, 4, 8 + 27 / 60),
    2025: jdFromCal(2025, 2, 3, 14 + 10 / 60),
    2026: jdFromCal(2026, 2, 3, 20 + 2 / 60),
  };
  for (const [year, jd] of Object.entries(known)) {
    const lon = trigSunLongitude(jd);
    const err = Math.abs(((lon - 315 + 180) % 360 + 360) % 360 - 180);
    assert.ok(err < 0.01, `Lichun ${year} mock Sun error ${err} deg`);
  }
});

test('BCE years use positive modulo, not JS sign-preserving %', () => {
  // 44 BCE (astronomical year -43), after Lichun: cycle index
  // (-43 - 4) mod 60 = 13 -> Ding Chou.
  const r = bazi(-43, 3, 15, 12);
  assert.equal(r.pillars.year.name, 'Ding Chou');
});

test('invalid inputs throw', () => {
  assert.throws(() => computeBazi({ y: 1990, mo: 6, d: 15, hh: 24 }, 80));
  assert.throws(() => computeBazi({ y: 1990, mo: 13, d: 15, hh: 12 }, 80));
  assert.throws(() => computeBazi({ y: 1582, mo: 10, d: 10, hh: 12 }, 80));
  assert.throws(() => computeBazi({ y: 1990, mo: 6, d: 15, hh: 12 }, Number.NaN));
});

test('hidden stems and day master data', () => {
  const r = bazi(1990, 6, 15, 10, 0, 480);
  assert.deepEqual(r.dayMaster, { name: 'Xin', char: '辛', element: 'Metal', polarity: 'Yin' });
  assert.deepEqual(r.pillars.year.hidden, ['Ding', 'Ji']);
  assert.deepEqual(r.pillars.day.hidden, ['Ren', 'Jia']);
  assert.equal(r.pillars.year.animal, 'Horse');
  assert.equal(r.monthTerm, 'Mangzhong');
});
