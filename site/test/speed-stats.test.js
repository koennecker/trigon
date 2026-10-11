// Tests for speed-stats.js: the long-term |speed| distributions and the
// percentile/color mapping used by the table's speed indicator.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SPEED_STATS, speedPercentile, speedZ, speedColor } from '../speed-stats.js';
import { tableRows } from '../table.js';

const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

describe('SPEED_STATS', () => {
  it('covers bodies 0..9 with mean/std/101 quantiles', () => {
    assert.equal(SPEED_STATS.length, 10);
    for (const st of SPEED_STATS) {
      assert.ok(st.mean > 0 && Number.isFinite(st.std) && st.std > 0);
      assert.equal(st.q.length, 101);
      for (let k = 0; k < 100; k++) assert.ok(st.q[k] <= st.q[k + 1]);
    }
  });
  it('matches known anchors (Sun/Moon mean motion)', () => {
    assert.ok(approx(SPEED_STATS[0].mean, 0.9856, 1e-3));   // Sun
    assert.ok(approx(SPEED_STATS[1].mean, 13.1764, 1e-3));  // Moon
    assert.ok(SPEED_STATS[2].mean > 0.9856);                // Mercury mean|v| >= mean signed
  });
});

describe('speedPercentile', () => {
  it('returns 0/100 at the extremes and ~50 at the median', () => {
    assert.equal(speedPercentile(0, 0), 0);
    assert.equal(speedPercentile(0, 99), 100);
    const p50 = speedPercentile(1, SPEED_STATS[1].q[50]);
    assert.ok(Math.abs(p50 - 50) < 1, `p50=${p50}`);
  });
  it('is monotone in |v|', () => {
    let prev = -1;
    for (let v = 0; v <= 20; v += 0.25) {
      const p = speedPercentile(1, v);
      assert.ok(p >= prev, `v=${v} broke monotonicity`);
      prev = p;
    }
  });
  it('puts a stationary Mercury near percentile 0', () => {
    assert.ok(speedPercentile(2, 0.001) < 2);
  });
});

describe('speedZ', () => {
  it('is ~0 at the mean and scales with std', () => {
    assert.ok(approx(speedZ(0, SPEED_STATS[0].mean), 0, 1e-9));
    assert.ok(approx(speedZ(0, SPEED_STATS[0].mean + SPEED_STATS[0].std), 1, 1e-9));
  });
});

describe('speedColor', () => {
  it('maps 0->red (minima), 50->yellow, 100->green (maxima)', () => {
    assert.equal(speedColor(0), 'rgb(248,81,73)');
    assert.equal(speedColor(50), 'rgb(210,153,34)');
    assert.equal(speedColor(100), 'rgb(63,185,80)');
  });
  it('clamps out-of-range percentiles', () => {
    assert.equal(speedColor(-5), speedColor(0));
    assert.equal(speedColor(250), speedColor(100));
  });
});

describe('table speed indicator', () => {
  const fakeOut = () => {
    const out = new Array(84).fill(0);
    for (let i = 0; i < 10; i++) {
      const o = 6 * i;
      out[o] = 100 + i; out[o + 3] = SPEED_STATS[i].mean; out[o + 4] = 5; out[o + 5] = 2;
      out[74 + i] = 1;
    }
    out[72] = 150; out[73] = 200;
    return out;
  };
  it('adds percentile/color/tip to planet rows, nulls to nodes', () => {
    const rows = tableRows(fakeOut());
    for (let i = 0; i < 10; i++) {
      assert.ok(rows[i].spdPct >= 0 && rows[i].spdPct <= 100);
      assert.match(rows[i].spdColor, /^rgb\(\d+,\d+,\d+\)$/);
      assert.ok(rows[i].spdTip.includes('percentile') || rows[i].spdTip.includes('%'));
    }
    assert.equal(rows[10].spdColor, null);
    assert.equal(rows[10].spdTip, null);
  });
  it('colors a stationary planet red and a fast one green', () => {
    const out = fakeOut();
    out[2 * 6 + 3] = 0.001;                       // Mercury stationary
    out[1 * 6 + 3] = SPEED_STATS[1].q[100];        // Moon at max
    const rows = tableRows(out);
    assert.ok(rows[2].spdPct < 5, `pct=${rows[2].spdPct}`);   // red end
    assert.ok(rows[1].spdPct > 95 && rows[1].spdColor === 'rgb(63,185,80)');
  });
});
