// Prototype v2: extended retrograde periods, two-rule shadow bounds.
// Mercury/Venus/Mars: sign span. Jupiter+: degree span (classical shadow).
// Verifies against reference examples (Venus/Mercury Oct-Nov 2026, Jupiter
// Nov 2025-Mar 2026) using the real swe.wasm (Moshier engine).
import SweModule from '../site/swe.js';
import { ephProvider } from '../site/ephe.js';
import {
  SCAN_STEP, MAX_DAILY_MOTION, stationRoots, retroPeriods, aspectRoots,
  jdFromCal, calFromJd, wrap180, refineRoot,
} from '../site/search.js';

const mod = await SweModule();
const eph = ephProvider(mod, false, 0b1111111111); // Sun..Pluto slots

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const p2 = n => String(n).padStart(2, '0');
const fmtJD = jd => {
  const c = calFromJd(jd);
  const s = Math.floor(c.hourUT * 3600);
  return `${c.y}-${p2(c.mo)}-${p2(c.d)} ${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}`;
};
const fmtLon = lon => {
  const l = ((lon % 360) + 360) % 360;
  const s = SIGNS[Math.floor(l / 30)], r = l % 30;
  const d = Math.floor(r), m = Math.floor((r - d) * 60), sec = Math.floor(((r - d) * 60 - m) * 60);
  return `${s} ${d}°${p2(m)}′${p2(sec)}″`;
};

// --- draft of the production algorithm -------------------------------------
function shadowBounds(ib, startLon, endLon) {
  const uD = endLon;
  const uR = uD + (((startLon - endLon) % 360) + 360) % 360;
  if (ib === 2 || ib === 3 || ib === 4)
    return { bIn: 30 * Math.floor(uD / 30), bOut: 30 * (Math.floor(uR / 30) + 1), signBased: true };
  return { bIn: uD, bOut: uR, signBased: false };
}
function crossingBefore(ib, B, t0) {
  const g = t => wrap180(eph(t).lon[ib] - B);
  const step = Math.min(90, Math.max(1, 5 / MAX_DAILY_MOTION[ib]));
  let hi = t0, ghi = g(hi);
  for (let n = 0; n < 20000; n++) {
    const lo = hi - step, glo = g(lo);
    if (glo === 0) return lo;
    if (glo < 0 && ghi > 0) return refineRoot(g, lo, hi);
    hi = lo; ghi = glo;
  }
  throw new Error('crossingBefore: not found');
}
function crossingAfter(ib, B, t1) {
  const g = t => wrap180(eph(t).lon[ib] - B);
  const step = Math.min(90, Math.max(1, 5 / MAX_DAILY_MOTION[ib]));
  let lo = t1, glo = g(lo);
  for (let n = 0; n < 20000; n++) {
    const hi = lo + step, ghi = g(hi);
    if (ghi === 0) return hi;
    if (glo < 0 && ghi > 0) return refineRoot(g, lo, hi);
    lo = hi; glo = ghi;
  }
  throw new Error('crossingAfter: not found');
}
// --- end draft ---------------------------------------------------------------

function buildGrid(jd0, jd1) {
  const n = Math.ceil((jd1 - jd0) / SCAN_STEP);
  const grid = [];
  for (let k = 0; k <= n; k++) {
    const jd = k === n ? jd1 : jd0 + k * SCAN_STEP;
    const s = eph(jd);
    grid.push({ jd, lon: s.lon, spd: s.spd });
  }
  return grid;
}

function analyze(ib, jdA, jdB) {
  const grid = buildGrid(jdA, jdB);
  const stations = stationRoots(grid, eph, ib)
    .map(s => ({ ...s, lon: eph(s.jd).lon[ib] }));
  for (const p of retroPeriods(stations)) {
    const b = shadowBounds(ib, p.startLon, p.endLon);
    const ingress = crossingBefore(ib, b.bIn, p.start);
    const egress = crossingAfter(ib, b.bOut, p.end);
    const isInferior = ib === 2 || ib === 3;
    const ev = aspectRoots(grid, eph, ib, 0, isInferior ? 0 : 180)
      .find(jd => jd > p.start && jd < p.end);
    console.log(`\n${NAMES[ib]}  ${b.signBased ? 'SIGN' : 'DEGREE'} span`);
    console.log(`  ingress ${fmtJD(ingress)}  (crosses ${fmtLon(b.bIn)})`);
    console.log(`  SRx     ${fmtJD(p.start)}  ${fmtLon(p.startLon)}`);
    console.log(`  ${isInferior ? 'infConj' : 'opposit'} ${ev ? fmtJD(ev) : 'NOT FOUND'}`);
    console.log(`  SD      ${fmtJD(p.end)}  ${fmtLon(p.endLon)}`);
    console.log(`  egress  ${fmtJD(egress)}  (crosses ${fmtLon(b.bOut)})`);
    console.log(`  loop ${(p.end - p.start).toFixed(1)} d   extended ${(egress - ingress).toFixed(1)} d`);
  }
}

analyze(3, jdFromCal(2026, 1, 1, 0), jdFromCal(2027, 1, 1, 0));
analyze(2, jdFromCal(2026, 9, 1, 0), jdFromCal(2026, 12, 31, 0));
analyze(5, jdFromCal(2025, 6, 1, 0), jdFromCal(2026, 12, 31, 0)); // Jupiter example
analyze(9, jdFromCal(2026, 1, 1, 0), jdFromCal(2027, 1, 1, 0));
analyze(4, jdFromCal(2024, 6, 1, 0), jdFromCal(2025, 12, 31, 0)); // Mars Dec 2024 loop
eph.free();
