// test_wasm.mjs — cross-check the WASM build against ref.json (pyswisseph reference).
// Usage: node test_wasm.mjs   (run from ~/workspace/swisseph-wasm, after build.sh)
import SweModule from './site/swe.mjs';
import fs from 'node:fs';

const EPHE_DIR = './ephe';
const NOUT = 84;

function epheFile(kind, year) {
  const sgn = year < 0 ? -1 : 1;
  let icty = Math.trunc(year / 100);
  if (sgn < 0 && year % 100 !== 0) icty -= 1;
  while (icty % 6 !== 0) icty--;
  return kind + (icty < 0 ? 'm' : '_') + String(Math.abs(icty)).padStart(2, '0') + '.se1';
}

const mod = await SweModule();
try { mod.FS.mkdir('/ephe'); } catch (e) {}
mod.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']);

function compute(y, mo, d, hourUT, lat, lon) {
  const outPtr = mod._malloc(NOUT * 8);
  const errPtr = mod._malloc(256);
  try {
    const rc = mod._chart_compute(y, mo, d, hourUT, lat, lon, 1, outPtr, errPtr);
    if (rc !== 0) throw new Error(mod.UTF8ToString(errPtr));
    return Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + NOUT));
  } finally { mod._free(outPtr); mod._free(errPtr); }
}

const cases = JSON.parse(fs.readFileSync('./ref.json', 'utf8'));
let worst = 0, failures = 0;

for (const c of cases) {
  const [y, mo, d, h] = c.date;
  for (const kind of ['sepl', 'semo']) {
    const name = epheFile(kind, y);
    mod.FS.writeFile('/ephe/' + name, new Uint8Array(fs.readFileSync(`${EPHE_DIR}/${name}`)));
  }
  const out = compute(y, mo, d, h, c.lat, c.lon);

  // expected vector in the same layout as chart_compute
  const exp = new Array(NOUT).fill(NaN);
  c.bodies.forEach((b, i) => {
    exp[6*i] = b.lon; exp[6*i+1] = b.lat; exp[6*i+2] = b.dist;
    exp[6*i+3] = b.speed; exp[6*i+4] = b.decl; exp[6*i+5] = b.mag ?? NaN;
  });
  exp[72] = c.asc; exp[73] = c.mc;
  c.houses.forEach((hh, i) => { exp[74+i] = hh; });

  for (let k = 0; k < NOUT; k++) {
    const bodyIdx = Math.floor(k / 6);
    if (bodyIdx >= 10 && bodyIdx < 12 && k % 6 !== 0) continue; // nodes: longitude only
    const a = out[k], e = exp[k];
    if (Number.isNaN(e) && Number.isNaN(a)) continue;
    const diff = Math.abs(a - e);
    // angular quantities: allow wraparound
    const circ = (k % 6 === 0 || k === 72 || k === 73) ? Math.min(diff, 360 - diff) : diff;
    worst = Math.max(worst, circ);
    if (!(circ < 1e-7)) { // 1e-7 deg = 0.4 milliarcsec; covers houses() vs houses_ex() path diffs
      failures++;
      console.log(`MISMATCH case ${c.date} idx ${k}: wasm=${a} ref=${e} diff=${circ}`);
    }
  }
  console.log(`case ${c.date}: ok`);
}

console.log(`worst abs diff: ${worst}`);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
