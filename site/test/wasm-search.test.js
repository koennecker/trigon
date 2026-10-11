// Differential test: the new search_compute WASM entry point must return
// bit-identical longitudes/speeds to chart_compute's ecliptic pass for the
// same instant and engine. Run: node --test test/wasm-search.test.js (from site/)
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import SweModule from '../swe.js';

const NOUT = 84; // chart_compute output layout (see swe_wrap.c)

// Exact port of swe_julday (src_repo/swedate.c) so the test feeds
// search_compute the identical tjd_ut that chart_compute derives internally.
function sweJulday(year, month, day, hour, greg) {
  let u = year;
  if (month < 3) u -= 1;
  const u0 = u + 4712.0;
  let u1 = month + 1.0;
  if (u1 < 4) u1 += 12.0;
  let jd = Math.floor(u0 * 365.25) + Math.floor(30.6 * u1 + 0.000001) + day + hour / 24.0 - 63.5;
  if (greg) {
    let u2 = Math.floor(Math.abs(u) / 100) - Math.floor(Math.abs(u) / 400);
    if (u < 0.0) u2 = -u2;
    jd = jd - u2 + 2;
    if (u < 0.0 && u / 100 === Math.floor(u / 100) && u / 400 !== Math.floor(u / 400)) jd -= 1;
  }
  return jd;
}
const isGreg = (y, m, d) => y > 1582 || (y === 1582 && (m > 10 || (m === 10 && d >= 15)));

let mod;
before(async () => { mod = await SweModule(); });

function chartCompute(y, mo, d, h, useSwiss) {
  const outPtr = mod._malloc(NOUT * 8), errPtr = mod._malloc(256);
  try {
    const rc = mod._chart_compute(y, mo, d, h, 0, 0, useSwiss ? 1 : 0, outPtr, errPtr);
    const err = mod.UTF8ToString(errPtr);
    const out = Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + NOUT));
    return { rc, err, out };
  } finally { mod._free(outPtr); mod._free(errPtr); }
}

function searchCompute(tjd, mask, useSwiss, sentinel) {
  const outPtr = mod._malloc(22 * 8), errPtr = mod._malloc(256);
  try {
    if (sentinel !== undefined) mod.HEAPF64.fill(sentinel, outPtr / 8, outPtr / 8 + 22);
    const rc = mod._search_compute(tjd, useSwiss ? 1 : 0, mask, outPtr, errPtr);
    const err = mod.UTF8ToString(errPtr);
    const out = Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + 22));
    return { rc, err, out };
  } finally { mod._free(outPtr); mod._free(errPtr); }
}

// Instants spanning leap days, the Gregorian cutover, and the .se1 edges.
// Note: 1800-01-01 00:00:00 UT is exactly the start of the .se1 coverage;
// light-time correction evaluates just before file start there, which is
// upstream-defined fallback behavior (chart_compute itself returns -1).
// The differential instants stay clear of that singular instant; error
// parity there is covered by a dedicated test below.
const INSTANTS = [
  [2025, 1, 1, 0], [2025, 6, 15, 12.5], [2000, 2, 29, 23.999],
  [1800, 1, 2, 12], [2400, 12, 31, 12], [1582, 10, 4, 6], [1582, 10, 15, 6],
];

function checkAll(useSwiss) {
  for (const [y, mo, d, h] of INSTANTS) {
    const tjd = sweJulday(y, mo, d, h, isGreg(y, mo, d));
    const c = chartCompute(y, mo, d, h, useSwiss);
    assert.equal(c.rc, 0, `chart_compute failed @ ${y}-${mo}-${d}: ${c.err}`);
    const s = searchCompute(tjd, 0x7ff, useSwiss);
    assert.equal(s.rc, 0, `search_compute failed @ ${y}-${mo}-${d}: ${s.err}`);
    for (let i = 0; i < 11; i++) {
      assert.equal(s.out[2 * i], c.out[6 * i], `lon body ${i} @ ${y}-${mo}-${d}`);
      assert.equal(s.out[2 * i + 1], c.out[6 * i + 3], `spd body ${i} @ ${y}-${mo}-${d}`);
    }
  }
}

describe('search_compute', () => {
  it('matches chart_compute bit-for-bit (Moshier)', () => { checkAll(false); });

  it('respects the body mask and leaves other slots untouched', () => {
    const [y, mo, d, h] = [2025, 3, 2, 0.6];
    const tjd = sweJulday(y, mo, d, h, true);
    const s = searchCompute(tjd, (1 << 5) | (1 << 6), false, -999); // Jupiter+Saturn only
    assert.equal(s.rc, 0, s.err);
    const c = chartCompute(y, mo, d, h, false);
    assert.equal(c.rc, 0, c.err);
    for (let i = 0; i < 11; i++) {
      if (i === 5 || i === 6) {
        assert.equal(s.out[2 * i], c.out[6 * i]);
        assert.equal(s.out[2 * i + 1], c.out[6 * i + 3]);
      } else {
        assert.equal(s.out[2 * i], -999, `slot ${i} lon untouched`);
        assert.equal(s.out[2 * i + 1], -999, `slot ${i} spd untouched`);
      }
    }
  });

  it('partial masks compose to the full mask', () => {
    const tjd = sweJulday(2026, 9, 27, 20.5, true);
    const full = searchCompute(tjd, 0x7ff, false);
    const lo = searchCompute(tjd, 0x01f, false);  // Sun..Mars
    const hi = searchCompute(tjd, 0x7e0, false);  // Jupiter..Node
    assert.equal(full.rc, 0, full.err);
    assert.equal(lo.rc, 0, lo.err);
    assert.equal(hi.rc, 0, hi.err);
    for (let i = 0; i < 11; i++) {
      const part = i < 5 ? lo : hi;
      assert.equal(part.out[2 * i], full.out[2 * i]);
      assert.equal(part.out[2 * i + 1], full.out[2 * i + 1]);
    }
  });

  it('matches chart_compute bit-for-bit (Swiss .se1)', { skip: !process.env.SE1_DIR }, () => {
    const dir = process.env.SE1_DIR;
    try { mod.FS.mkdir('/ephe'); } catch (e) { /* exists */ }
    for (const n of ['sepl_18.se1', 'semo_18.se1'])
      mod.FS.writeFile('/ephe/' + n, new Uint8Array(fs.readFileSync(dir + '/' + n)));
    mod.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']);
    checkAll(true);
  });

  it('search_compute survives the file-start boundary via Moshier fallback', { skip: !process.env.SE1_DIR }, () => {
    // 1800-01-01 00:00 UT is exactly tfstart; planetary light-time reaches
    // before file start, so sepl_18.se1 lookups fall back to Moshier.
    // chart_compute ALSO runs swe_pheno_ut there, which propagates the
    // missing-file error (pre-existing upstream behavior, fails in native
    // builds too). search_compute is ecliptic-only, so it must succeed with
    // Moshier-fallback values for the planets and Swiss values for the Moon
    // (semo_18.se1 is present and unaffected).
    const dir = process.env.SE1_DIR;
    try { mod.FS.mkdir('/ephe'); } catch (e) { /* exists */ }
    for (const n of ['sepl_18.se1', 'semo_18.se1'])
      mod.FS.writeFile('/ephe/' + n, new Uint8Array(fs.readFileSync(dir + '/' + n)));
    mod.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']);
    const tjd = sweJulday(1800, 1, 1, 0, isGreg(1800, 1, 1));
    const s = searchCompute(tjd, 0x7ff, true);
    assert.equal(s.rc, 0, s.err);
    const m = searchCompute(tjd, 0x7ff, false); // pure Moshier reference
    assert.equal(m.rc, 0, m.err);
    for (let i = 0; i < 11; i++) {
      assert.ok(Number.isFinite(s.out[2 * i]), `lon ${i} finite`);
      assert.ok(Number.isFinite(s.out[2 * i + 1]), `spd ${i} finite`);
      if (i === 1 || i === 10) continue; // Moon and nodes stay Swiss (semo_18.se1 present)
      // Sun and Mercury..Pluto fall back to Moshier (sepl light-time dips before tfstart).
      // Fallback-path Moshier can differ from direct-path Moshier by ~1e-9 deg
      // (different iteration seed), so compare with tolerance, not bit-exact.
      assert.ok(Math.abs(s.out[2 * i] - m.out[2 * i]) < 1e-6, `lon body ${i} ~= Moshier`);
      assert.ok(Math.abs(s.out[2 * i + 1] - m.out[2 * i + 1]) < 1e-6, `spd body ${i} ~= Moshier`);
    }
  });
});
