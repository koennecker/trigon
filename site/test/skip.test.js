// Tests for skip.js — pure time-stepping arithmetic.
// Run: node --test test/skip.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STEP_DAYS, skipFields } from '../skip.js';
import { jdFromCal, calFromJd } from '../search.js';
import { BCE_MIN_ASTRO } from '../dateapi.js';

const f = (y, mo, d, hh = 12, mi = 0, ss = 0) => ({ y, mo, d, hh, mi, ss });

describe('skipFields', () => {
  it('steps days across month boundaries', () => {
    assert.deepEqual(skipFields(f(2026, 1, 31), 1, 1, 'day'), f(2026, 2, 1, 12, 0, 0));
    assert.deepEqual(skipFields(f(2026, 3, 1), -1, 1, 'day'), f(2026, 2, 28, 12, 0, 0));
  });
  it('steps weeks and hours as JD fractions', () => {
    const r = skipFields(f(2026, 6, 15, 12), 1, 2, 'week');
    assert.deepEqual([r.y, r.mo, r.d], [2026, 6, 29]);
    const h = skipFields(f(2026, 6, 15, 23, 30), 1, 1, 'hour');
    assert.deepEqual([h.y, h.mo, h.d, h.hh, h.mi], [2026, 6, 16, 0, 30]);
  });
  it('rolls months over year ends, clamping the day', () => {
    assert.deepEqual(skipFields(f(2026, 12, 15), 1, 1, 'month'), f(2027, 1, 15, 12, 0, 0));
    const r = skipFields(f(2026, 3, 31), -1, 1, 'month'); // Feb has no 31st
    assert.deepEqual([r.y, r.mo, r.d], [2026, 2, 28]);
  });
  it('steps years across the era boundary without a year zero', () => {
    // 1 CE back one year -> 1 BCE, which dateapi represents as y=0 here?
    // skipFields works in astronomical years (no zero skip needed).
    const r = skipFields(f(1, 6, 15), -1, 1, 'year');
    assert.deepEqual([r.y, r.mo, r.d], [0, 6, 15]);
  });
  it('clamps at the supported range edges', () => {
    const lo = skipFields(f(BCE_MIN_ASTRO, 6, 15), -1, 5, 'year');
    assert.deepEqual([lo.y, lo.mo, lo.d], [BCE_MIN_ASTRO, 1, 1]);
    const hi = skipFields(f(9999, 6, 15), 1, 5, 'year');
    assert.deepEqual([hi.y, hi.mo, hi.d], [9999, 12, 31]);
    assert.equal(hi.hh, 23);
  });
  it('is inverse-consistent for small units', () => {
    const start = f(2026, 9, 29, 14, 30, 45);
    for (const unit of ['second', 'minute', 'hour', 'day']) {
      const fwd = skipFields(start, 1, 7, unit);
      const back = skipFields(fwd, -1, 7, unit);
      assert.deepEqual(back, start, unit);
    }
  });
  it('matches JD arithmetic for day steps', () => {
    const start = f(2024, 2, 28, 6, 0, 0); // leap year
    const r = skipFields(start, 1, 2, 'day');
    const c = calFromJd(jdFromCal(2024, 2, 28, 6) + 2);
    assert.deepEqual([r.y, r.mo, r.d], [c.y, c.mo, c.d]);
  });
});

describe('STEP_DAYS', () => {
  it('covers the picker units', () => {
    assert.deepEqual(Object.keys(STEP_DAYS).sort(),
      ['day', 'hour', 'minute', 'second', 'week']);
    assert.equal(STEP_DAYS.week, 7);
  });
});
