// Contracts the live-tick patch path and the section refreshes rely on.
// The patch path swaps a section only when its builder output string
// changed, and indexes table rows by position (body rows then angle rows),
// so those builder properties are pinned here rather than assumed.
// Run: node --test test/patch-contracts.test.js  (from site/)
// DOM-level behavior (tick patching, visibility gating, scroll/focus
// preservation on catalog refresh, settings re-render) is covered by the
// E2E scripts: e2e/clock_perf_e2e.py, e2e/spdind_fix_e2e.py,
// e2e/settings_modal_e2e.py, e2e/display_toggles_e2e.py,
// e2e/lots_catalog_e2e.py.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tableRows, angleRows, buildTableHTML, speedIndicatorHTML } from '../table.js';
import { computeLots, computeCatalogLots, buildLotsHTML, buildCatalogSelectedHTML } from '../lots.js';
import { CATALOG_LOTS } from '../lots-catalog.js';
import { buildLordshipHTML, buildSyzygyHTML } from '../dignities.js';

// Synthetic chart_compute-shaped output: 84 doubles. Bodies 0..11 at
// slots i*6 ([lon, lat, dist, speedLon, dec, mag]); out[72]=Asc,
// out[73]=MC, out[74+i]=house.
function fakeOut() {
  const out = new Array(84).fill(0);
  const set = (i, lon, spd, dec, mag, house) => {
    const o = i * 6;
    out[o] = lon; out[o + 3] = spd; out[o + 4] = dec; out[o + 5] = mag;
    out[74 + i] = house;
  };
  set(0, 352.74195, 1.0027, -1.5, -26.74, 7);
  set(1, 120.5, 12.5, 5.25, -12.0, 3);
  set(2, 10.0, -0.5, 2.0, 1.5, 8);
  for (let i = 3; i < 10; i++) set(i, i * 30 + 5, 0.1, 0, 2.0, (i % 12) + 1);
  set(10, 200.0, 0, 0, 0, 0);
  set(11, 200.0, 0, 0, 0, 0);
  out[72] = 15.25; out[73] = 300.75;
  return out;
}

const MS = Date.UTC(1990, 5, 15, 19);
const LAT = 33.4484, LON = -112.074;
const LOTS = [{ name: 'Fortune', lon: 40 }, { name: 'Spirit', lon: 350 }];
const DAY = { decan: 'chaldean', isDay: true };

describe('section builders are deterministic', () => {
  it('lots, catalog-selected, lordship, and syzygy builders return identical strings for identical inputs', () => {
    const out = fakeOut();
    const lots = computeLots(out, MS, LAT, LON);
    assert.equal(buildLotsHTML(lots, 'dms'), buildLotsHTML(computeLots(out, MS, LAT, LON), 'dms'));
    const ids = CATALOG_LOTS.slice(0, 2).map(l => l.id);
    const cat = (sel) => computeCatalogLots(out, MS, LAT, LON, undefined, sel, null).values;
    assert.equal(
      buildCatalogSelectedHTML(cat(ids), 'dms'),
      buildCatalogSelectedHTML(cat(ids), 'dms'));
    assert.equal(
      buildLordshipHTML(out, LOTS, DAY),
      buildLordshipHTML(out, LOTS, DAY));
    const syz = { prev: { jd: 2460000.5, kind: 'new', moonLon: 15 },
                  next: { jd: 2460015.5, kind: 'full', moonLon: 195 } };
    assert.equal(buildSyzygyHTML(syz), buildSyzygyHTML(syz));
    assert.equal(buildSyzygyHTML(null), buildSyzygyHTML(null));
  });
});

describe('table patch indexing', () => {
  it('rendered tbody rows are the body rows followed by the angle rows, in order', () => {
    const out = fakeOut();
    const rows = tableRows(out, 'dms');
    const arows = angleRows(out, undefined, 'dms');
    const html = buildTableHTML(out, 'dms');
    const tbody = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    assert.ok(tbody, 'positions table has a tbody');
    const trCount = (tbody[1].match(/<tr/g) || []).length;
    assert.equal(trCount, rows.length + arows.length);
    assert.deepEqual(arows.map(a => a.body),
      ['Ascendant', 'Descendant', 'Midheaven', 'IC']);
  });
  it('speed-dot markup in the full render matches the patch path fallback markup', () => {
    const out = fakeOut();
    const rows = tableRows(out, 'dms');
    const html = buildTableHTML(out, 'dms');
    for (const r of rows) {
      if (r.spdColor) assert.ok(html.includes(speedIndicatorHTML(r)),
        `dot markup for ${r.body} appears in the full render`);
    }
  });
});
