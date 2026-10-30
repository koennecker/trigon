// BaZi live-path test: the Sun longitude comes from the chart
// output, not from the trig mock. A real swe.wasm chart (Moshier
// fallback, so no .se1 files are needed) supplies out[0], and
// computeBazi with that longitude must give the published pillars.
// The trig mock is only compared against the live longitude here,
// to show how close the mock is — it is not the source of truth.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEpheClient, computeChart } from '../ephe.js';
import { computeBazi, trigSunLongitude } from '../bazi.js';
import { jdFromCal } from '../search.js';

let mod;
before(async () => {
  const client = createEpheClient({
    baseUrl: 'http://127.0.0.1/',
    store: { get: async () => null, put: async () => {} },
    ui: null,
    loadWasm: () => readFile(new URL('../swe.wasm', import.meta.url)),
  });
  mod = await client.ensureWasm(() => {});
});

// Wall datetime + offset -> chart hourUT, then chart Sun longitude.
function liveSun(y, mo, d, hh, mi, offsetMin, lat, lon) {
  const out = computeChart(mod, y, mo, d, hh + mi / 60 - offsetMin / 60, lat, lon, 0);
  return out[0];
}

describe('live path: chart out[0] as Sun longitude', () => {
  it('gives the published Hong Kong chart', () => {
    const sun = liveSun(1990, 6, 15, 10, 0, 480, 22.3193, 114.1694);
    const r = computeBazi({ y: 1990, mo: 6, d: 15, hh: 10 }, sun);
    assert.deepEqual(
      [r.pillars.year.name, r.pillars.month.name, r.pillars.day.name, r.pillars.hour.name],
      ['Geng Wu', 'Ren Wu', 'Xin Hai', 'Gui Si']);
  });

  it('gives the published Taipei chart', () => {
    const sun = liveSun(1988, 4, 12, 10, 0, 480, 25.0329, 121.5654);
    const r = computeBazi({ y: 1988, mo: 4, d: 12, hh: 10 }, sun);
    assert.deepEqual(
      [r.pillars.year.name, r.pillars.month.name, r.pillars.day.name, r.pillars.hour.name],
      ['Wu Chen', 'Bing Chen', 'Ding You', 'Yi Si']);
  });

  it('trig mock Sun longitude is within 0.01 deg of the live longitude', () => {
    const jd = jdFromCal(1990, 6, 15, 2);
    const live = liveSun(1990, 6, 15, 10, 0, 480, 22.3193, 114.1694);
    const mock = trigSunLongitude(jd);
    const err = Math.abs(((live - mock + 180) % 360 + 360) % 360 - 180);
    assert.ok(err < 0.01, `mock error ${err} deg`);
  });
});
