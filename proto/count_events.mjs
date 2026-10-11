// Count all aspect brackets + station brackets over a century.
// 1-day shared grid (Moon pairs need <= ~1.4d for the 45deg bound; 1d is fine).
import SweModule from '../site/swe.js';
import { wrap180 } from '../site/search.js';

const mod = await SweModule();
const MASK = 0b11111111111;
function eph(jd) {
  const o = mod._malloc(22 * 8), e = mod._malloc(256);
  mod._search_compute(jd, 0, MASK, o, e);
  const a = Array.from(mod.HEAPF64.subarray(o / 8, o / 8 + 22));
  mod._free(o); mod._free(e);
  return { lon: a.filter((_, i) => i % 2 === 0), spd: a.filter((_, i) => i % 2 === 1) };
}
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;

const jd0 = 2460904.5, jd1 = jd0 + 36525; // 2030-01-01 + 100y
const N = Math.floor(jd1 - jd0) + 1;
console.log(`building ${N}-sample grid...`);
const lon = Array.from({ length: 11 }, () => new Float64Array(N));
const spd = Array.from({ length: 11 }, () => new Float64Array(N));
for (let k = 0; k < N; k++) {
  const s = eph(jd0 + k);
  for (let b = 0; b < 11; b++) { lon[b][k] = s.lon[b]; spd[b][k] = s.spd[b]; }
  if (k % 10000 === 0) process.stdout.write(`\r  ${k}/${N}`);
}
console.log('\rgrid done.');

let aspects = 0;
const perPair = new Array(55).fill(0);
let pi = 0;
for (let ia = 0; ia < 11; ia++) for (let ib = ia + 1; ib < 11; ib++, pi++) {
  for (const t of [0, 60, 90, 120, 180]) {
    for (const s of (t === 0 || t === 180) ? [1] : [1, -1]) {
      let prev = wrap180(lon[ia][0] - lon[ib][0] - s * t), ps = sgn(prev);
      for (let k = 1; k < N; k++) {
        const f = wrap180(lon[ia][k] - lon[ib][k] - s * t), fs = sgn(f);
        if (fs === 0 || ps === 0) { aspects++; perPair[pi]++; }
        else if (fs !== ps && Math.abs(f - prev) < 180) { aspects++; perPair[pi]++; }
        prev = f; ps = fs;
      }
    }
  }
}
let stations = 0;
const perPlanet = new Array(8).fill(0);
for (let p = 0; p < 8; p++) {
  const ib = 2 + p;
  let ps = sgn(spd[ib][0]);
  for (let k = 1; k < N; k++) {
    const fs = sgn(spd[ib][k]);
    if (fs !== ps && fs !== 0 && ps !== 0) { stations++; perPlanet[p]++; }
    if (fs !== 0) ps = fs;
  }
}
const NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Node'];
console.log(`\naspects/century: ${aspects}`);
console.log(`stations/century: ${stations} (retro periods ~${stations / 2})`);
// top pairs
const pairs = [];
pi = 0;
for (let ia = 0; ia < 11; ia++) for (let ib = ia + 1; ib < 11; ib++, pi++)
  pairs.push([NAMES[ia] + '-' + NAMES[ib], perPair[pi]]);
pairs.sort((a, b) => b[1] - a[1]);
console.log('top 8 pairs:', pairs.slice(0, 8).map(p => `${p[0]}=${p[1]}`).join(' '));
console.log('bottom 3 pairs:', pairs.slice(-3).map(p => `${p[0]}=${p[1]}`).join(' '));
console.log('stations per planet:', perPlanet.map((c, p) => `${NAMES[2 + p]}=${c}`).join(' '));
