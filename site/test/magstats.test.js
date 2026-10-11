// site/test/magstats.test.js — brightness percentile/z from the 1800–2300
// magnitude sampling (site/mag-stats.js).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAG_STATS, magBrightness } from '../mag-stats.js';

describe('magBrightness', () => {
  it('has stats for Sun..Pluto with 101 quantiles each', () => {
    assert.equal(MAG_STATS.length, 10);
    for (const s of MAG_STATS) assert.equal(s.q.length, 101);
  });
  it('brightest Venus ever sits near percentile 100 with positive z', () => {
    const b = magBrightness(3, -4.92); // sampled minimum
    assert.ok(b.pct > 99);
    assert.ok(b.z > 2);
  });
  it('faintest Venus sits near percentile 0 with negative z', () => {
    const b = magBrightness(3, -3.24); // sampled maximum
    assert.ok(b.pct < 1);
    assert.ok(b.z < -2);
  });
  it('mean magnitude is percentile ~50 / z 0', () => {
    const b = magBrightness(8, MAG_STATS[8].mean); // Neptune: tight, near-symmetric
    assert.ok(Math.abs(b.pct - 50) < 8);
    assert.ok(Math.abs(b.z) < 0.01);
  });
  it('bad input yields NaN', () => {
    assert.ok(Number.isNaN(magBrightness(99, 0).pct));
    assert.ok(Number.isNaN(magBrightness(3, NaN).z));
  });
});
