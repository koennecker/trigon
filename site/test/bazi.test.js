// BaZi unit tests — mirrors proto/test_bazi_proto.py, so a JS/Python
// drift shows up as a test failure in either suite, not as a silent
// divergence. Published examples and day anchors are checked against
// their sources, not against the implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBazi, solarTermJd, sunLongitude } from '../bazi.js';
import { jdFromCal } from '../search.js';

const names = r => [r.pillars.year.name, r.pillars.month.name, r.pillars.day.name, r.pillars.hour.name];

test('published example: 1990-06-15 10:00 Hong Kong', () => {
  assert.deepEqual(names(computeBazi({ y: 1990, mo: 6, d: 15, hh: 10, offsetMin: 480 })),
    ['Geng Wu', 'Ren Wu', 'Xin Hai', 'Gui Si']);
});

test('published example: 1988-04-12 10:00 Taipei', () => {
  assert.deepEqual(names(computeBazi({ y: 1988, mo: 4, d: 12, hh: 10, offsetMin: 480 })),
    ['Wu Chen', 'Bing Chen', 'Ding You', 'Yi Si']);
});

test('published day chart: 2000-06-15', () => {
  const r = computeBazi({ y: 2000, mo: 6, d: 15, hh: 12 });
  assert.deepEqual(names(r).slice(0, 3), ['Geng Chen', 'Ren Wu', 'Jia Chen']);
  assert.equal(r.dayMaster.name, 'Jia');
});

test('day-cycle anchors', () => {
  assert.equal(computeBazi({ y: 1900, mo: 1, d: 1, hh: 12 }).pillars.day.name, 'Jia Xu');
  assert.equal(computeBazi({ y: 1949, mo: 10, d: 1, hh: 12 }).pillars.day.name, 'Jia Zi');
  assert.equal(computeBazi({ y: 2000, mo: 1, d: 1, hh: 12 }).pillars.day.name, 'Wu Wu');
});

test('pre-Lichun year and month: 2000-01-01', () => {
  const r = computeBazi({ y: 2000, mo: 1, d: 1, hh: 12 });
  assert.equal(r.pillars.year.name, 'Ji Mao');
  assert.equal(r.pillars.month.name, 'Bing Zi');
});

test('Lichun boundary 2025, three hours either side', () => {
  const before = computeBazi({ y: 2025, mo: 2, d: 3, hh: 19, offsetMin: 480 });
  assert.deepEqual(names(before).slice(0, 2), ['Jia Chen', 'Ding Chou']);
  const after = computeBazi({ y: 2025, mo: 2, d: 4, hh: 2, offsetMin: 480 });
  assert.deepEqual(names(after).slice(0, 2), ['Yi Si', 'Wu Yin']);
});

test('Mangzhong boundary 1990', () => {
  assert.equal(computeBazi({ y: 1990, mo: 6, d: 5, hh: 12, offsetMin: 480 }).pillars.month.name, 'Xin Si');
  assert.equal(computeBazi({ y: 1990, mo: 6, d: 7, hh: 12, offsetMin: 480 }).pillars.month.name, 'Ren Wu');
});

test('day advances at 23:00', () => {
  const evening = computeBazi({ y: 1990, mo: 6, d: 15, hh: 22, offsetMin: 480 });
  assert.equal(evening.pillars.day.name, 'Xin Hai');
  assert.equal(evening.pillars.hour.name, 'Ji Hai');
  const late = computeBazi({ y: 1990, mo: 6, d: 15, hh: 23, offsetMin: 480 });
  assert.equal(late.pillars.day.name, 'Ren Zi');
  assert.equal(late.pillars.hour.name, 'Geng Zi');
  const early = computeBazi({ y: 1990, mo: 6, d: 16, hh: 0, mi: 30, offsetMin: 480 });
  assert.equal(early.pillars.day.name, 'Ren Zi');
  assert.equal(early.pillars.hour.name, 'Geng Zi');
  assert.equal(computeBazi({ y: 1990, mo: 6, d: 16, hh: 1, offsetMin: 480 }).pillars.hour.name, 'Xin Chou');
});

test('Lichun solver against known Beijing instants, within 15 minutes', () => {
  const known = {
    2024: jdFromCal(2024, 2, 4, 8 + 27 / 60),
    2025: jdFromCal(2025, 2, 3, 14 + 10 / 60),
    2026: jdFromCal(2026, 2, 3, 20 + 2 / 60),
  };
  for (const [year, want] of Object.entries(known)) {
    const got = solarTermJd(315, jdFromCal(Number(year), 2, 4, 12));
    assert.ok(Math.abs(got - want) * 1440 < 15, `Lichun ${year} off by ${Math.abs(got - want) * 1440} min`);
  }
});

test('solar-term solver converges: longitude at the solved JD is on target', () => {
  for (const lon of [315, 345, 15, 45, 75, 105, 135, 165, 195, 225, 255, 285]) {
    const jd = solarTermJd(lon, jdFromCal(2025, 6, 1, 12));
    const err = Math.abs(((lon - sunLongitude(jd) + 180) % 360 + 360) % 360 - 180);
    assert.ok(err < 0.01, `target ${lon} error ${err} deg`);
  }
});

test('BCE years use positive modulo, not JS sign-preserving %', () => {
  // 44 BCE (astronomical year -43), after Lichun: cycle index
  // (-43 - 4) mod 60 = 13 -> Ding Chou.
  const r = computeBazi({ y: -43, mo: 3, d: 15, hh: 12 });
  assert.equal(r.pillars.year.name, 'Ding Chou');
});

test('invalid inputs throw', () => {
  assert.throws(() => computeBazi({ y: 1990, mo: 6, d: 15, hh: 24 }));
  assert.throws(() => computeBazi({ y: 1990, mo: 13, d: 15, hh: 12 }));
  assert.throws(() => computeBazi({ y: 1582, mo: 10, d: 10, hh: 12 }));
});

test('hidden stems and day master data', () => {
  const r = computeBazi({ y: 1990, mo: 6, d: 15, hh: 10, offsetMin: 480 });
  assert.deepEqual(r.dayMaster, { name: 'Xin', char: '辛', element: 'Metal', polarity: 'Yin' });
  assert.deepEqual(r.pillars.year.hidden, ['Ding', 'Ji']);
  assert.deepEqual(r.pillars.day.hidden, ['Ren', 'Jia']);
  assert.equal(r.pillars.year.animal, 'Horse');
  assert.equal(r.monthTerm, 'Mangzhong');
});
