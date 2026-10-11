// Prototype: compare grid-step schemes for aspect search.
// A: fixed 5-day (validated baseline)
// B: fixed 45/max-pair-speed (current aspectGridStep)
// C: user's proposal, naive d/|v_rel| per pair (d = dist to target)
// D: per-step accel-bounded: |v|*s + 0.5*a*s^2 = 45, min over pairs
import SweModule from '../site/swe.js';
import { aspectRoots, wrap180 } from '../site/search.js';

const mod = await SweModule();
let calls = 0;
const MASK11 = 0b11111111111;
function eph(jd) {
  calls++;
  const outPtr = mod._malloc(22 * 8), errPtr = mod._malloc(256);
  mod._search_compute(jd, 0, MASK11, outPtr, errPtr);
  const o = Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + 22));
  mod._free(outPtr); mod._free(errPtr);
  return { lon: o.filter((_, i) => i % 2 === 0), spd: o.filter((_, i) => i % 2 === 1) };
}

// accel bounds: measured max|dv/dt| over 2000-2026 x1.5 margin
const ACC = [0.0011, 0.77, 0.30, 0.064, 0.023, 0.0053, 0.0053, 0.0017, 0.0062, 0.012, 0.088];
const VMAX = [1.1, 16, 2.5, 1.5, 1.0, 0.3, 0.15, 0.08, 0.06, 0.06, 0.3]; // current code bounds

function gridFixed(jd0, jd1, step) {
  const g = [];
  for (let jd = jd0; jd < jd1; jd += step) { const s = eph(jd); g.push({ jd, lon: s.lon, spd: s.spd }); }
  const s = eph(jd1); g.push({ jd: jd1, lon: s.lon, spd: s.spd });
  return g;
}
// C: naive d/|v_rel|, per pair, single target
function gridNaiveDV(jd0, jd1, ia, ib, target) {
  const g = [];
  let jd = jd0;
  while (jd < jd1) {
    const s = eph(jd); g.push({ jd, lon: s.lon, spd: s.spd });
    const d = Math.abs(wrap180(s.lon[ia] - s.lon[ib] - target));
    const v = Math.abs(s.spd[ia] - s.spd[ib]);
    jd += Math.min(120, Math.max(0.5, d / Math.max(v, 1e-9)));
  }
  const s = eph(jd1); g.push({ jd: jd1, lon: s.lon, spd: s.spd });
  return g;
}
// D: per-step accel-bounded shared step, min over pairs
function gridAccel(jd0, jd1, bodies) {
  const g = [];
  let jd = jd0;
  const pairs = [];
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) pairs.push([bodies[i], bodies[j]]);
  while (jd < jd1) {
    const s = eph(jd); g.push({ jd, lon: s.lon, spd: s.spd });
    let step = 120;
    for (const [ia, ib] of pairs) {
      const v = Math.abs(s.spd[ia] - s.spd[ib]);
      const a = ACC[ia] + ACC[ib];
      const sk = (-v + Math.sqrt(v * v + 90 * a)) / a; // v*s+0.5*a*s^2=45
      if (sk < step) step = sk;
    }
    jd += Math.min(120, Math.max(5, step));
  }
  const s = eph(jd1); g.push({ jd: jd1, lon: s.lon, spd: s.spd });
  return g;
}

function rootsOf(grid, ia, ib, target) {
  calls = 0;
  const r = aspectRoots(grid, eph, ia, ib, target);
  return { roots: r, refineCalls: calls };
}
const eq = (r1, r2, tol = 2e-4) => {
  if (r1.length !== r2.length) return false;
  return r1.every((x, i) => Math.abs(x - r2[i]) < tol);
};

const JD0 = 2460000.5 + (new Date(Date.UTC(2030, 0, 1)) - new Date(Date.UTC(2029, 4, 19))) / 864e5;
const JD2030 = 2460904.5; // 2030-01-01
for (const [label, ia, ib, span] of [['Jupiter-Saturn', 5, 6, 1461], ['Mercury-Venus', 2, 3, 731]]) {
  const jd0 = 2465424.5, jd1 = 2465424.5 + span; // 2038-01-01 + span
  console.log(`\n=== ${label} conjunction ${span / 365.25}yr ===`);
  calls = 0; const gA = gridFixed(jd0, jd1, 5); const nA = calls;
  const rA = rootsOf(gA, ia, ib, 0);
  let w = 0;
  for (let i = 0; i < 11; i++) for (let j = i + 1; j < 11; j++) { if ((i === ia || i === ib) && true) {} }
  w = VMAX[ia] + VMAX[ib];
  calls = 0; const gB = gridFixed(jd0, jd1, Math.min(120, Math.max(5, 45 / w))); const nB = calls;
  const rB = rootsOf(gB, ia, ib, 0);
  calls = 0; const gC = gridNaiveDV(jd0, jd1, ia, ib, 0); const nC = calls;
  const rC = rootsOf(gC, ia, ib, 0);
  calls = 0; const gD = gridAccel(jd0, jd1, [ia, ib]); const nD = calls;
  const rD = rootsOf(gD, ia, ib, 0);
  console.log(`baseline roots: ${rA.roots.length}`);
  for (const [nm, n, r] of [['B fixed45/vmax', nB, rB], ['C naive d/v', nC, rC], ['D accel-step', nD, rD]]) {
    const miss = rA.roots.filter(x => !r.roots.some(y => Math.abs(x - y) < 2e-4)).length;
    const extra = r.roots.filter(x => !rA.roots.some(y => Math.abs(x - y) < 2e-4)).length;
    console.log(`  ${nm}: grid evals=${n} (x${(nA / n).toFixed(1)} fewer), roots=${r.roots.length}, missed=${miss}, extra=${extra}, match=${eq(rA.roots, r.roots)}`);
  }
  console.log(`  baseline grid evals: ${nA}`);
}
