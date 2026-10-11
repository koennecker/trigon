// Tests for the idiosyncratic Sun-Moon eclipse check.
//
// Integration: real swe.wasm (_eclipse_at_syzygy) + real .se1 files,
// driving the same aspectRoots -> eclipseAtSyzygy path the Aspects tab
// uses. Census over 2024-2025: every new/full moon is classified, exactly
// the 8 known eclipses of those two years are found with exact types, and
// every other lunation is explicitly not an eclipse (this also proves the
// 1.7° latitude pre-filter has no false negatives).
//
// Pure unit tests for eclipseKind/syzygyName are at the bottom.
//
// Run: node --test test/eclipse.test.js  (from site/)
// Test data: test/data/{sepl_18,semo_18}.se1 (see test/data/README).
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import SweModule from '../swe.js';
import { eclipseAtSyzygy, ephProvider } from '../ephe.js';
import {
  eclipseKind, syzygyName, aspectRoots, aspectGridStep,
  jdFromCal, ECL_TOTAL, ECL_PARTIAL, ECL_ANNULAR, ECL_PENUMBRAL,
} from '../search.js';

const dataDir = new URL('./data/', import.meta.url);
const wasmUrl = new URL('../swe.wasm', import.meta.url);

// [UTC date of maximum, isFullMoon, expected label]. The 8 eclipses of
// 2024-2025 (NASA eclipse catalog).
const KNOWN = [
  ['2024-03-25', true,  'Penumbral lunar eclipse'],
  ['2024-04-08', false, 'Total solar eclipse'],
  ['2024-09-18', true,  'Partial lunar eclipse'],
  ['2024-10-02', false, 'Annular solar eclipse'],
  ['2025-03-14', true,  'Total lunar eclipse'],
  ['2025-03-29', false, 'Partial solar eclipse'],
  ['2025-09-07', true,  'Total lunar eclipse'],
  ['2025-09-21', false, 'Partial solar eclipse'],
];

function jdOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return jdFromCal(y, m, d, 12.0); // noon UTC on the calendar date
}

describe('eclipseKind / syzygyName (pure)', () => {
  it('labels solar types', () => {
    assert.equal(eclipseKind(ECL_TOTAL, false), 'Total solar eclipse');
    assert.equal(eclipseKind(ECL_ANNULAR, false), 'Annular solar eclipse');
    assert.equal(eclipseKind(ECL_PARTIAL, false), 'Partial solar eclipse');
    assert.equal(eclipseKind(32, false), 'Hybrid solar eclipse');
    // central/noncentral bits ride along with the type
    assert.equal(eclipseKind(ECL_TOTAL | 1, false), 'Total solar eclipse');
  });
  it('labels lunar types', () => {
    assert.equal(eclipseKind(ECL_TOTAL, true), 'Total lunar eclipse');
    assert.equal(eclipseKind(ECL_PARTIAL, true), 'Partial lunar eclipse');
    assert.equal(eclipseKind(ECL_PENUMBRAL, true), 'Penumbral lunar eclipse');
  });
  it('names syzygies', () => {
    assert.equal(syzygyName(0, 1, 0), 'New Moon');
    assert.equal(syzygyName(0, 1, 180), 'Full Moon');
    assert.equal(syzygyName(0, 2, 0), null);
    assert.equal(syzygyName(0, 1, 90), null);
  });
});

describe('eclipse census 2024-2025 (real WASM + .se1)', () => {
  let mod, eph;
  // [{ jd, isFull, check: { eclipse, type, jdMax } }]
  let syzygies = [];

  before(async () => {
    const bytes = await readFile(wasmUrl);
    mod = await SweModule({
      instantiateWasm: (imports, onSuccess) =>
        WebAssembly.instantiate(bytes, imports).then(({ instance }) => onSuccess(instance)),
    });
    try { mod.FS.mkdir('/ephe'); } catch (e) { /* exists */ }
    mod.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']);
    for (const n of ['sepl_18.se1', 'semo_18.se1'])
      mod.FS.writeFile('/ephe/' + n, await readFile(new URL(n, dataDir)));

    eph = ephProvider(mod, true, 0b11); // Sun + Moon, Swiss
    const jd0 = jdFromCal(2024, 1, 1, 0.0), jd1 = jdFromCal(2026, 1, 1, 0.0);
    const step = aspectGridStep([0, 1]);
    const n = Math.ceil((jd1 - jd0) / step);
    const grid = [];
    for (let k = 0; k <= n; k++)
      grid.push({ jd: k === n ? jd1 : jd0 + k * step, ...eph(k === n ? jd1 : jd0 + k * step) });
    for (const [target, isFull] of [[0, false], [180, true]]) {
      for (const jd of aspectRoots(grid, eph, 0, 1, target))
        syzygies.push({ jd, isFull, check: eclipseAtSyzygy(mod, jd, isFull, true) });
    }
    syzygies.sort((a, b) => a.jd - b.jd);
  });

  it('finds ~25 new moons and ~25 full moons per year', () => {
    const news = syzygies.filter(s => !s.isFull).length;
    const fulls = syzygies.filter(s => s.isFull).length;
    assert.ok(news >= 24 && news <= 26, `new moons: ${news}`);
    assert.ok(fulls >= 24 && fulls <= 26, `full moons: ${fulls}`);
  });

  it('flags exactly the 8 known eclipses with exact types', () => {
    const found = syzygies.filter(s => s.check.eclipse);
    assert.equal(found.length, KNOWN.length,
      `expected ${KNOWN.length} eclipses, got ${found.length}: ` +
      found.map(s => jdOfStr(s.jd)).join(', '));
    for (const [date, isFull, label] of KNOWN) {
      const jd = jdOf(date);
      const hit = found.find(s => s.isFull === isFull && Math.abs(s.jd - jd) < 1.2);
      assert.ok(hit, `missing ${label} near ${date}`);
      assert.equal(eclipseKind(hit.check.type, isFull), label);
      // maximum within a day of the syzygy instant
      assert.ok(Math.abs(hit.check.jdMax - hit.jd) < 1.0,
        `${label}: jdMax ${hit.check.jdMax} vs syzygy ${hit.jd}`);
    }
  });

  it('marks every other lunation explicitly not an eclipse', () => {
    const plain = syzygies.filter(s => !s.check.eclipse);
    assert.equal(plain.length, syzygies.length - KNOWN.length);
  });

  it('returns a sane type bitmask for a total solar eclipse', () => {
    const hit = syzygies.find(s => !s.isFull && s.check.eclipse && (s.check.type & ECL_TOTAL));
    assert.ok(hit, 'no total solar eclipse in census');
    assert.ok(Math.abs(hit.jd - jdOf('2024-04-08')) < 1.2);
  });
});

// Weekday-free calendar formatting for failure messages.
function jdOfStr(jd) {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  let a = z;
  if (z >= 2299161) { const al = Math.floor((z - 1867216.25) / 36524.25); a = z + 1 + al - Math.floor(al / 4); }
  const b = a + 1524, c = Math.floor((b - 122.1) / 365.25),
        d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const mo = e < 14 ? e - 1 : e - 13, y = mo > 2 ? c - 4716 : c - 4715;
  return `${y}-${String(mo).padStart(2, '0')}-${String(Math.floor(day)).padStart(2, '0')}`;
}
