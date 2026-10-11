// Unit tests for search.js pure functions.
// Run: node --test test/search.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrap180, jdFromCal, calFromJd, JD_UNIX_EPOCH,
  bracketSamples, refineRoot, dedupeRoots,
  aspectRoots, stationRoots, stationsAround, syzygiesAround, ingressRoots, ingressGridStep, ingressScanStep,
  evaluateConditions, evaluateCondition, validateConditions, conditionBodies, normalizeConditionGroups,
  signIndexOf, heliacalPhase, SIGN_RULERS,
  retroPeriods, SCAN_STEP, aspectGridStep,
  shadowBounds, boundaryCrossingBefore, boundaryCrossingAfter,
  splitRange, mergeTimedResults,
  explainConditions, conditionEvidence, periodSignSet,
} from '../search.js';

const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('wrap180', () => {
  it('maps into (-180, 180]', () => {
    assert.equal(wrap180(0), 0);
    assert.equal(wrap180(90), 90);
    assert.equal(wrap180(-90), -90);
    assert.equal(wrap180(180), -180); // C-style: ((x+180)%360+360)%360-180
    assert.equal(wrap180(270), -90);
    assert.equal(wrap180(-270), 90);
    assert.equal(wrap180(720 + 45), 45);
    assert.ok(approx(wrap180(359.999), -0.001));
  });
});

describe('jdFromCal / calFromJd', () => {
  it('J2000 anchor: 2000-01-01 12:00 UT = 2451545.0', () => {
    assert.ok(approx(jdFromCal(2000, 1, 1, 12.0), 2451545.0, 1e-9));
  });
  it('Unix epoch anchor: 1970-01-01 00:00 UT = 2440587.5', () => {
    assert.ok(approx(jdFromCal(1970, 1, 1, 0.0), JD_UNIX_EPOCH, 1e-9));
  });
  it('cutover: 1582-10-15 Gregorian = 2299160.5, 1582-10-04 Julian = 2299159.5', () => {
    assert.ok(approx(jdFromCal(1582, 10, 15, 0.0), 2299160.5, 1e-9));
    assert.ok(approx(jdFromCal(1582, 10, 4, 0.0), 2299159.5, 1e-9));
  });
  it('round-trips across the cutover and extremes', () => {
    const dates = [
      [2026, 9, 27, 12.5], [1582, 10, 15, 0.0], [1582, 10, 4, 6.0],
      [1, 1, 1, 0.0], [9999, 12, 31, 23.999], [2000, 2, 29, 18.25],
      [-100, 3, 15, 12.0], [-4712, 1, 1, 12.0],
    ];
    for (const [y, mo, d, h] of dates) {
      const jd = jdFromCal(y, mo, d, h);
      const c = calFromJd(jd);
      assert.equal(c.y, y, `year ${y}`);
      assert.equal(c.mo, mo, `month ${y}`);
      assert.equal(c.d, d, `day ${y}`);
      assert.ok(approx(c.hourUT, h, 1e-6), `hour ${y}: ${c.hourUT} vs ${h}`);
      // And back again: the calendar the wrapper would see reproduces the JD.
      assert.ok(approx(jdFromCal(c.y, c.mo, c.d, c.hourUT), jd, 1e-6), `re-jd ${y}`);
    }
  });
});

describe('bracketSamples', () => {
  it('finds simple sign changes', () => {
    const xs = [0, 1, 2, 3, 4];
    const br = bracketSamples(xs, [1, 0.5, -0.5, -1, 1], false);
    assert.deepEqual(br, [[1, 2], [3, 4]]);
  });
  it('captures exact sample hits (dedupeRoots merges the double capture)', () => {
    const br = bracketSamples([0, 1, 2], [1, 0, -1], false);
    assert.deepEqual(br, [[1, 1], [1, 1]]);
    assert.deepEqual(dedupeRoots(br.map(([a]) => a)), [1]);
  });
  it('wrap guard rejects the angle discontinuity', () => {
    // +179 -> -179 is the wrap at +/-180, not a root.
    const br = bracketSamples([0, 1], [179, -179], true);
    assert.deepEqual(br, []);
    // A genuine fast crossing (+100 -> -100) is also rejected: with the
    // 5-day scan step no real signal moves >180 deg/step, so this can only
    // be a wrap artifact. Without the guard it brackets.
    assert.deepEqual(bracketSamples([0, 1], [100, -100], false), [[0, 1]]);
  });
});

describe('refineRoot', () => {
  it('secant finds sqrt(2)', () => {
    const r = refineRoot(t => t * t - 2, 1, 2);
    assert.ok(approx(r, Math.SQRT2, 1e-9), r);
  });
  it('handles a decreasing crossing', () => {
    const r = refineRoot(t => 10 - t, 0, 20);
    assert.ok(approx(r, 10, 1e-9), r);
  });
  it('bisection fallback rescues a stalled secant', () => {
    // Flat plateau then steep: secant divides by ~zero slope and stalls,
    // bisection on the surviving bracket recovers the root at t=10.
    const f = t => (t < 9 ? -1 : t - 10);
    const r = refineRoot(f, 0, 20);
    assert.ok(approx(r, 10, 1e-6), r);
  });
  it('degenerate bracket returns the point', () => {
    assert.equal(refineRoot(t => t, 3, 3), 3);
  });
});

describe('dedupeRoots', () => {
  it('merges grid-point duplicates only', () => {
    assert.deepEqual(dedupeRoots([1.0, 1.0 + 1e-6, 5.0]), [1.0, 5.0]);
  });
});

// Fake ephemeris: body 0 moves 1 deg/day, body 1 moves 0.2 deg/day,
// body 2 has speed cos(2*pi*(t-100)/200) deg/day (stations every 100 d).
function fakeEph() {
  return jd => ({
    lon: [jd * 1.0, jd * 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    spd: [1.0, 0.2, Math.cos(2 * Math.PI * (jd - 100) / 200), 0, 0, 0, 0, 0, 0, 0, 0],
  });
}
function fakeGrid(jd0, jd1) {
  const eph = fakeEph(), grid = [];
  for (let jd = jd0; jd <= jd1 + 1e-9; jd += SCAN_STEP) grid.push({ jd, ...eph(jd) });
  return grid;
}

describe('aspectRoots', () => {
  it('finds conjunctions of 1.0 vs 0.2 deg/day at t = 0, 450, 900', () => {
    const eph = fakeEph();
    const roots = aspectRoots(fakeGrid(0, 1000), eph, 0, 1, 0);
    assert.equal(roots.length, 3);
    roots.forEach((r, i) => assert.ok(approx(r, i * 450, 1e-4), `root ${i}: ${r}`));
  });
  it('finds both trine directions (120 and 240)', () => {
    // 0.8 t = 120 + 360k -> t = 150, 600 ; 0.8 t = 240 + 360k -> t = 300, 750
    const eph = fakeEph();
    const roots = aspectRoots(fakeGrid(0, 1000), eph, 0, 1, 120);
    assert.deepEqual(roots.map(r => Math.round(r)), [150, 300, 600, 750]);
  });
  it('opposition via the single self-symmetric function', () => {
    // 0.8 t = 180 + 360k -> t = 225, 675
    const eph = fakeEph();
    const roots = aspectRoots(fakeGrid(0, 1000), eph, 0, 1, 180);
    assert.deepEqual(roots.map(r => Math.round(r)), [225, 675]);
  });
});

describe('stationRoots', () => {
  it('finds cosine-speed zeros with correct R/D typing', () => {
    const eph = fakeEph();
    const st = stationRoots(fakeGrid(0, 1000), eph, 2);
    // cos(pi*(t-100)/100) = 0 at t = 50 + 100k -> 10 stations in [0, 1000]
    assert.equal(st.length, 10);
    st.forEach((s, i) => {
      assert.ok(approx(s.jd, 50 + i * 100, 1e-4), `station ${i}: ${s.jd}`);
      // before t=50 the speed is negative (cos(-pi) = -1), so t=50 is a
      // direct station; types then alternate D, R, D, R, ...
      assert.equal(s.type, i % 2 === 0 ? 'D' : 'R');
    });
  });
});

describe('stationsAround / syzygiesAround', () => {
  it('brackets the target instant with typed stations + longitudes', () => {
    const eph = fakeEph();
    const { prev, next } = stationsAround(fakeGrid(0, 1000), eph, 2, 175);
    assert.ok(approx(prev.jd, 150, 1e-4) && prev.type === 'R');
    assert.ok(approx(next.jd, 250, 1e-4) && next.type === 'D');
    assert.ok(Number.isFinite(prev.lon) && Number.isFinite(next.lon));
    const edge = stationsAround(fakeGrid(0, 1000), eph, 2, 10);
    assert.equal(edge.prev, null);
    assert.ok(approx(edge.next.jd, 50, 1e-4));
  });
  it('brackets with new/full moons from a circling Moon', () => {
    // Sun fixed at 0; Moon laps it every 28.8 d: conjunctions at 28.8k,
    // oppositions at 14.4 + 28.8k.
    const eph = jd => {
      const lon = new Array(11).fill(0), spd = new Array(11).fill(0.5);
      lon[1] = (jd * 12.5) % 360;
      return { lon, spd };
    };
    const grid = [];
    for (let jd = 0; jd <= 60; jd += 1) grid.push({ jd, ...eph(jd) });
    const { prev, next } = syzygiesAround(grid, eph, 30);
    assert.equal(prev.kind, 'new');
    assert.ok(approx(prev.jd, 28.8, 0.05), `prev ${prev.jd}`);
    assert.equal(next.kind, 'full');
    assert.ok(approx(next.jd, 43.2, 0.05), `next ${next.jd}`);
  });
});

describe('retroPeriods', () => {
  it('pairs R->D into periods with longitudes', () => {
    const periods = retroPeriods([
      { jd: 10, type: 'R', lon: 100 }, { jd: 30, type: 'D', lon: 95 },
      { jd: 50, type: 'R', lon: 150 }, { jd: 90, type: 'D', lon: 140 },
      { jd: 120, type: 'R', lon: 160 }, // dangling: dropped
    ]);
    assert.equal(periods.length, 2);
    assert.equal(periods[0].start, 10);
    assert.equal(periods[0].end, 30);
    assert.equal(periods[0].startLon, 100);
    assert.equal(periods[0].endLon, 95);
    assert.equal(periods[1].start, 50);
    assert.equal(periods[1].end, 90);
  });
  it('ignores a leading D with no R in range', () => {
    const periods = retroPeriods([{ jd: 5, type: 'D', lon: 1 }, { jd: 10, type: 'R', lon: 2 }]);
    assert.equal(periods.length, 0);
  });
});

describe('shadowBounds', () => {
  it('uses the sign span for Mercury/Venus/Mars', () => {
    // Venus: SRx Scorpio 8.49, SD Libra 22.86 -> Libra..Scorpio.
    assert.deepEqual(shadowBounds(3, 218.49, 202.86), { bIn: 180, bOut: 240, signBased: true });
    // Single-sign Mercury loop inside Scorpio.
    assert.deepEqual(shadowBounds(2, 230.98, 215.03), { bIn: 210, bOut: 240, signBased: true });
    // Mars loop Leo 6.17 back to Cancer 17.01 -> Cancer..Leo.
    assert.deepEqual(shadowBounds(4, 126.17, 107.01), { bIn: 90, bOut: 150, signBased: true });
  });
  it('uses the degree span (classical shadow) for Jupiter and beyond', () => {
    // Jupiter: SRx Cancer 25.15, SD Cancer 15.09.
    const b = shadowBounds(5, 115.15, 105.09);
    assert.equal(b.signBased, false);
    assert.ok(approx(b.bIn, 105.09, 1e-12) && approx(b.bOut, 115.15, 1e-12));
  });
  it('unwraps a loop crossing 0 Aries', () => {
    // SD at 355, SRx at 10: sign span Pisces + Aries -> 330..390 unwrapped.
    assert.deepEqual(shadowBounds(2, 10, 355), { bIn: 330, bOut: 390, signBased: true });
    const d = shadowBounds(9, 10, 355);
    assert.equal(d.bIn, 355);
    assert.ok(approx(d.bOut, 370, 1e-12));
  });
});

describe('boundaryCrossingBefore/After', () => {
  const jd0 = 2460000.5;
  const mkEph = lonFn => jd => {
    const lon = new Array(11).fill(0), spd = new Array(11).fill(0);
    lon[4] = lonFn(jd);
    return { lon, spd };
  };
  it('finds the exact crossing for a steadily direct body', () => {
    const eph = mkEph(jd => ((100 + 0.5 * (jd - jd0)) % 360 + 360) % 360);
    // lon = 130 at jd0+60; the 120 crossing is at jd0+40.
    assert.ok(approx(boundaryCrossingBefore(eph, 4, 120, jd0 + 60), jd0 + 40, 1e-6));
    assert.ok(approx(boundaryCrossingAfter(eph, 4, 120, jd0), jd0 + 40, 1e-6));
  });
  it('finds the crossing adjacent to the station on a looping body', () => {
    // lon oscillates 175..225 with a 100-day period, peaking at jd0+25.
    const eph = mkEph(jd => 200 + 25 * Math.sin(2 * Math.PI * (jd - jd0) / 100));
    const rise = jd0 + 100 * Math.asin(0.4) / (2 * Math.PI); // lon = 210, rising
    // From the peak, walking back meets the rising crossing of 210.
    assert.ok(approx(boundaryCrossingBefore(eph, 4, 210, jd0 + 25), rise, 1e-6));
    // From below the boundary (the post-station posture), walking forward
    // meets the next rising crossing one cycle later.
    assert.ok(approx(boundaryCrossingAfter(eph, 4, 210, jd0 + 80), rise + 100, 1e-6));
  });
  it('throws when the boundary is never crossed', () => {
    const parked = mkEph(() => 100);
    assert.throws(() => boundaryCrossingBefore(parked, 4, 200, jd0), /no boundary crossing/);
    assert.throws(() => boundaryCrossingAfter(parked, 4, 200, jd0), /no boundary crossing/);
  });
});

describe('aspectGridStep', () => {
  it('uses the validated 5-day step when the Moon is involved', () => {
    assert.equal(aspectGridStep([0, 1]), SCAN_STEP);
    assert.equal(aspectGridStep([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), SCAN_STEP);
  });
  it('goes coarser for slow outer-planet pairs (45° bound)', () => {
    // Jupiter+Saturn: 45 / (0.3+0.15) = 100 days
    assert.ok(Math.abs(aspectGridStep([5, 6]) - 100) < 1e-9);
    // Never coarser than 120 days
    assert.ok(aspectGridStep([8, 9]) <= 120);
  });
  it('is bounded between SCAN_STEP and 120 days', () => {
    for (const bodies of [[0, 2], [2, 3, 4], [5, 6, 7, 8], [10, 5]]) {
      const s = aspectGridStep(bodies);
      assert.ok(s >= SCAN_STEP && s <= 120, `${bodies} -> ${s}`);
    }
  });
});

describe('aspect conditions', () => {
  const snap = (lonMap, spdMap = {}) => {
    const lon = new Array(11).fill(0), spd = new Array(11).fill(0.01);
    for (const [k, v] of Object.entries(lonMap)) lon[k] = v;
    for (const [k, v] of Object.entries(spdMap)) spd[k] = v;
    return { lon, spd };
  };
  // 15 May 578 BCE (Trigon WASM): Uranus/Neptune/Pluto all in Taurus.
  const bce = snap({ 7: 34.62, 8: 39.16, 9: 39.15 });

  it('evaluates sign filters: sign, ruler, element, quad, co-presence', () => {
    assert.equal(SIGN_RULERS[signIndexOf(0)], 4);   // Aries ruled by Mars
    assert.equal(SIGN_RULERS[signIndexOf(95)], 1);  // Cancer ruled by Moon
    assert.ok(evaluateConditions([{ type: 'sign', who: 7, mode: 'same', value: 'a' }], bce, 8, 9));
    assert.ok(evaluateConditions([{ type: 'sign', who: 'a', mode: 'sign', value: 1 }], bce, 8, 9));
    assert.ok(evaluateConditions([{ type: 'sign', who: 'a', mode: 'element', value: 1 }], bce, 8, 9));
    assert.ok(evaluateConditions([{ type: 'sign', who: 'a', mode: 'quad', value: 1 }], bce, 8, 9));
    assert.ok(evaluateConditions([{ type: 'sign', who: 'a', mode: 'ruler', value: 3 }], bce, 8, 9));
    assert.ok(!evaluateConditions([{ type: 'sign', who: 'a', mode: 'sign', value: 2 }], bce, 8, 9));
  });

  it('evaluates aspect conditions by orb and by whole sign', () => {
    const s = snap({ 4: 10, 5: 128 }); // Mars Aries, Jupiter Leo: 118 deg apart
    assert.ok(evaluateCondition({ type: 'aspect', from: 4, to: 5, deg: 120, mode: 'orb', orb: 3 }, s, 0, 1));
    assert.ok(!evaluateCondition({ type: 'aspect', from: 4, to: 5, deg: 120, mode: 'orb', orb: 1 }, s, 0, 1));
    assert.ok(evaluateCondition({ type: 'aspect', from: 4, to: 5, deg: 120, mode: 'signbased' }, s, 0, 1));
    const s2 = snap({ 4: 10, 5: 100 });
    assert.ok(evaluateCondition({ type: 'aspect', from: 4, to: 5, deg: 90, mode: 'signbased' }, s2, 0, 1));
    assert.ok(!evaluateCondition({ type: 'aspect', from: 4, to: 5, deg: 120, mode: 'signbased' }, s2, 0, 1));
    // 'a'/'b' references resolve against the base pair.
    assert.ok(evaluateCondition({ type: 'aspect', from: 'a', to: 5, deg: 120, mode: 'signbased' }, s, 4, 1));
  });

  it('evaluates motion and speed-percentile conditions', () => {
    const s = snap({}, { 2: -0.5 });
    assert.ok(evaluateCondition({ type: 'motion', body: 2, dir: 'retrograde' }, s, 0, 1));
    assert.ok(!evaluateCondition({ type: 'motion', body: 2, dir: 'direct' }, s, 0, 1));
    // |spd| 0.5 for Mercury sits mid-distribution: inside 10..90, outside 60..100.
    assert.ok(evaluateCondition({ type: 'speed', body: 2, min: 10, max: 90 }, s, 0, 1));
    assert.ok(!evaluateCondition({ type: 'speed', body: 2, min: 60, max: null }, s, 0, 1));
    // North Node has no statistics: never matches.
    assert.ok(!evaluateCondition({ type: 'speed', body: 10, min: 0, max: 100 }, s, 0, 1));
  });

  it('classifies heliacal phase by signed solar elongation', () => {
    assert.equal(heliacalPhase(105, 100), 'combust');
    assert.equal(heliacalPhase(112, 100), 'beams');
    assert.equal(heliacalPhase(60, 100), 'morning');
    assert.equal(heliacalPhase(140, 100), 'evening');
    assert.equal(heliacalPhase(290, 100), 'morning'); // wraps to -170
    const s = snap({ 0: 100, 3: 60 });
    assert.ok(evaluateCondition({ type: 'phase', body: 3, phase: 'morning' }, s, 0, 1));
  });

  it('ORs within a group and ANDs across groups', () => {
    const grp = [[
      { type: 'sign', who: 7, mode: 'same', value: 'b' },
      { type: 'aspect', from: 7, to: 'b', deg: 180, mode: 'signbased' },
    ]];
    assert.ok(evaluateConditions(grp, bce, 8, 9)); // Uranus co-present with Pluto
    const opp = snap({ 7: 220, 9: 39.15 });
    assert.ok(evaluateConditions(grp, opp, 8, 9)); // sign-based opposition branch
    const neither = snap({ 7: 130, 9: 39.15 });
    assert.ok(!evaluateConditions(grp, neither, 8, 9));
    // A failing second group sinks the whole set.
    assert.ok(!evaluateConditions([...grp,
      [{ type: 'sign', who: 'a', mode: 'sign', value: 2 }]], bce, 8, 9));
    // Legacy flat conditions normalize to singleton groups.
    assert.deepEqual(normalizeConditionGroups([{ type: 'sign', who: 'a', mode: 'sign', value: 1 }]),
      [[{ type: 'sign', who: 'a', mode: 'sign', value: 1 }]]);
    assert.deepEqual(normalizeConditionGroups([]), []);
    assert.ok(evaluateConditions(
      [{ type: 'sign', who: 'a', mode: 'sign', value: 1 }], bce, 8, 9));
    // Grouped validation names group.subcondition positions.
    assert.match(validateConditions([[{ type: 'sign', who: 'a', mode: 'sign', value: 1 },
      { type: 'motion', body: 0, dir: 'retrograde' }]]), /^condition 1\.2: /);
  });

  it('collects referenced bodies for the ephemeris mask', () => {
    const bodies = conditionBodies([
      { type: 'sign', who: 7, mode: 'same', value: 'a' },
      { type: 'aspect', from: 'a', to: 5, deg: 120, mode: 'orb', orb: 3 },
      { type: 'phase', body: 3, phase: 'morning' },
      { type: 'motion', body: 2, dir: 'direct' },
    ]);
    assert.deepEqual([...bodies].sort((x, y) => x - y), [0, 2, 3, 5, 7]); // Sun added by phase
  });

  it('validates conditions with readable errors', () => {
    assert.equal(validateConditions([]), null);
    assert.equal(validateConditions([{ type: 'sign', who: 'a', mode: 'sign', value: 1 }]), null);
    assert.match(validateConditions([{ type: 'motion', body: 1, dir: 'retrograde' }]), /never retrograde/);
    assert.match(validateConditions([{ type: 'speed', body: 10, min: 0, max: 100 }]), /North Node/);
    assert.match(validateConditions([{ type: 'speed', body: 2, min: null, max: null }]), /at least one/);
    assert.match(validateConditions([{ type: 'speed', body: 2, min: 80, max: 20 }]), /minimum exceeds/);
    assert.match(validateConditions([{ type: 'phase', body: 0, phase: 'morning' }]), /Sun has no heliacal phase/);
    assert.match(validateConditions([{ type: 'aspect', from: 2, to: 2, deg: 0, mode: 'orb', orb: 3 }]), /itself/);
    assert.match(validateConditions([
      { type: 'sign', who: 'a', mode: 'sign', value: 1 },
      { type: 'motion', body: 0, dir: 'retrograde' },
    ]), /^condition 2: /);
  });
});

describe('ingressRoots', () => {
  const mkGrid = (eph, jd0, jd1, step) => {
    const grid = [];
    for (let jd = jd0; jd <= jd1 + 1e-9; jd += step) grid.push({ jd, ...eph(jd) });
    return grid;
  };
  it('finds direct ingresses for a steadily moving body', () => {
    const eph = fakeEph(); // body 0: lon = jd (1 deg/day)
    const roots = ingressRoots(fakeGrid(0, 365), eph, 0);
    assert.equal(roots.length, 12);
    roots.forEach((r, i) => {
      assert.ok(approx(r.jd, (i + 1) * 30, 1e-4), `ingress ${i}: ${r.jd}`);
      assert.equal(r.fromSign, i % 12);
      assert.equal(r.toSign, (i + 1) % 12);
      assert.equal(r.lon, ((i + 1) * 30) % 360);
      assert.equal(r.retro, false);
    });
  });
  it('keeps up with a Moon-speed body on the ingress grid step', () => {
    const eph = jd => {
      const lon = new Array(11).fill(0), spd = new Array(11).fill(0);
      lon[1] = ((350 + 13.2 * jd) % 360 + 360) % 360;
      spd[1] = 13.2;
      return { lon, spd };
    };
    // ingressGridStep uses conservative MAX_DAILY_MOTION (Moon: 16 deg/day).
    assert.ok(ingressGridStep(1) < 1);
    assert.ok(ingressScanStep([1, 5]) === ingressGridStep(1));
    const roots = ingressRoots(mkGrid(eph, 0, 60, ingressGridStep(1)), eph, 1);
    assert.equal(roots.length, 27);
    assert.equal(roots[0].fromSign, 11); // Pisces
    assert.equal(roots[0].toSign, 0);    // Aries
    assert.ok(approx(roots[0].jd, 10 / 13.2, 1e-3), roots[0].jd);
  });
  it('finds retrograde re-entries on a looping body', () => {
    const ib = 4;
    const eph = jd => {
      const lon = new Array(11).fill(0), spd = new Array(11).fill(0);
      const ph = 2 * Math.PI * jd / 100;
      lon[ib] = ((200 + 25 * Math.sin(ph)) % 360 + 360) % 360;
      spd[ib] = 25 * (2 * Math.PI / 100) * Math.cos(ph);
      return { lon, spd };
    };
    const roots = ingressRoots(mkGrid(eph, 0, 300, ingressGridStep(ib)), eph, ib);
    assert.equal(roots.length, 12);
    assert.ok(roots.some(r => r.retro));
    assert.ok(roots.some(r => !r.retro));
    for (const r of roots) {
      assert.equal((r.fromSign + (r.retro ? 11 : 1)) % 12, r.toSign, `sign step at ${r.jd}`);
      assert.ok([180, 210].includes(r.lon), `boundary ${r.lon}`);
    }
  });
});

// ------------------------------------------------------------- workers ---
describe('worker range splitting and merging', () => {
  it('splitRange edges are exact and contiguous', () => {
    const e = splitRange(100, 200, 4);
    assert.deepEqual(e, [100, 125, 150, 175, 200]);
    assert.deepEqual(splitRange(0, 10, 1), [0, 10]);
  });
  it('mergeTimedResults sorts and dedupes by key', () => {
    const a = [{ jd: 3, ib: 1 }, { jd: 1, ib: 2 }];
    const b = [{ jd: 2, ib: 1 }, { jd: 3, ib: 1 }];
    const m = mergeTimedResults([a, b], r => `${r.jd}|${r.ib}`);
    assert.deepEqual(m.map(r => r.jd), [1, 2, 3]);
  });
});

describe('chunked (worker-style) scanning matches monolithic scanning', () => {
  // Constant-speed two-body eph: conjunctions of body0/body1 every
  // 360/0.9 days; body1 crosses sign boundaries every 30/0.1 days.
  const eph = jd => ({
    lon: [(jd * 1.0) % 360, (jd * 0.1) % 360, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    spd: [1.0, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  const gridOver = (from, to, step) => {
    const g = [];
    const n = Math.ceil((to - from) / step);
    for (let k = 0; k <= n; k++) {
      const jd = k === n ? to : from + k * step;
      const s = eph(jd);
      g.push({ jd, lon: s.lon, spd: s.spd });
    }
    return g;
  };
  it('aspect roots identical across 3 chunks', () => {
    const jd0 = 1000, jd1 = 3000, step = 40;
    const whole = aspectRoots(gridOver(jd0, jd1, step), eph, 0, 1, 0);
    const edges = splitRange(jd0, jd1, 3);
    const parts = edges.slice(0, 3).map((edge, w) => {
      const g = gridOver(w === 0 ? jd0 : edge - step, edges[w + 1], step);
      return aspectRoots(g, eph, 0, 1, 0)
        .filter(jd => jd > (w === 0 ? jd0 - 1 : edge))
        .map(jd => ({ jd }));
    });
    const merged = mergeTimedResults(parts, r => r.jd.toFixed(6));
    assert.equal(merged.length, whole.length);
    merged.forEach((r, i) => approx(r.jd, whole[i], 1e-6));
  });
  it('ingress roots identical across 3 chunks', () => {
    const jd0 = 1000, jd1 = 3000, step = 100;
    const whole = ingressRoots(gridOver(jd0, jd1, step), eph, 1);
    const edges = splitRange(jd0, jd1, 3);
    const parts = edges.slice(0, 3).map((edge, w) => {
      const g = gridOver(w === 0 ? jd0 : edge - step, edges[w + 1], step);
      return ingressRoots(g, eph, 1)
        .filter(r => r.jd > (w === 0 ? jd0 - 1 : edge));
    });
    const merged = mergeTimedResults(parts, r => `${r.jd.toFixed(6)}|${r.ib}`);
    assert.equal(merged.length, whole.length);
    merged.forEach((r, i) => approx(r.jd, whole[i].jd, 1e-6));
  });
});

describe('condition evidence and period sign sets', () => {
  // Sun 10 Aries, Moon 40 (10 Taurus), Venus 12 (12 Aries), Mars 355 (25 Pisces).
  const snap = { lon: [10, 40, 0, 12, 355, 0, 0, 0, 0, 0, 0],
    spd: [1, 13, 0, 1.2, -0.5, 0, 0, 0, 0, 0, 0] };
  it('explains the matched subcondition per OR group', () => {
    const txt = explainConditions([
      [{ type: 'sign', who: 'b', mode: 'element', value: 1 },
       { type: 'sign', who: 'b', mode: 'sign', value: 0 }],
      [{ type: 'motion', body: 4, dir: 'retrograde' }],
    ], snap, 0, 1);
    assert.match(txt[0], /Moon in Taurus — earth sign/);
    assert.match(txt[1], /Mars retrograde/);
  });
  it('returns null for an unmatched group', () => {
    const txt = explainConditions([[{ type: 'sign', who: 'a', mode: 'sign', value: 5 }]], snap, 0, 1);
    assert.equal(txt[0], null);
  });
  it('periodSignSet is the two station signs only', () => {
    // Case: both stations in Taurus, shadow egress into Gemini
    // must not put the period in Gemini.
    const taurus = periodSignSet(55, 48);
    assert.equal(taurus.size, 1); assert.ok(taurus.has(1));
    // Stations straddling a boundary match both signs; wrap works.
    const span = periodSignSet(58, 63);
    assert.ok(span.has(1) && span.has(2) && span.size === 2);
    const wrap = periodSignSet(355, 5);
    assert.ok(wrap.has(11) && wrap.has(0) && wrap.size === 2);
  });
});
