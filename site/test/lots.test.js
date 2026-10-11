// Tests for lots.js: Hermetic lots against independently computed
// reference values (Paulus set, A + B - C from the Ascendant) derived
// from the same WASM positions used here.
// Run: node --test test/lots.test.js  (from site/)
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEpheClient, computeChart } from '../ephe.js';
import { computeLots, sunAltitudeDeg, moonAltitudeDeg, pointAltitudeDeg, buildLotsHTML, HERMETIC_LOTS, readLotOptions, writeLotOptions } from '../lots.js';

const LAT = 33.4484, LON = -112.0740; // Phoenix
let mod, dayOut, nightOut, moonDownOut, moonUpOut, basisOut;
const dayMs = Date.UTC(1990, 5, 15, 19);   // 1990-06-15 19:00 UTC (local noon)
const nightMs = Date.UTC(1990, 5, 15, 7);  // 1990-06-15 07:00 UTC (local midnight)
const moonDownMs = Date.UTC(1990, 5, 15, 4);  // night, Moon set (alt -35.7)
const moonUpMs = Date.UTC(1990, 5, 15, 8);    // night, Moon up (alt +12.7)
const basisMs = Date.UTC(1990, 5, 16, 20);   // day chart where Paulus/Valens Basis diverge

before(async () => {
  const client = createEpheClient({
    baseUrl: 'http://127.0.0.1/',
    store: { get: async () => null, put: async () => {} },
    ui: null,
    loadWasm: () => readFile(new URL('../swe.wasm', import.meta.url)),
  });
  mod = await client.ensureWasm(() => {});
  dayOut = computeChart(mod, 1990, 6, 15, 19.0, LAT, LON, 0);
  nightOut = computeChart(mod, 1990, 6, 15, 7.0, LAT, LON, 0);
  moonDownOut = computeChart(mod, 1990, 6, 15, 4.0, LAT, LON, 0);
  moonUpOut = computeChart(mod, 1990, 6, 15, 8.0, LAT, LON, 0);
  basisOut = computeChart(mod, 1990, 6, 16, 20.0, LAT, LON, 0);
});

const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol;

describe('sect and Sun altitude', () => {
  it('sees a day chart at local noon', () => {
    assert.ok(near(sunAltitudeDeg(dayOut, dayMs, LAT, LON), 78.07, 0.5));
    assert.equal(computeLots(dayOut, dayMs, LAT, LON).sect, 'day');
  });
  it('sees a night chart at local midnight', () => {
    assert.ok(near(sunAltitudeDeg(nightOut, nightMs, LAT, LON), -32.84, 0.5));
    assert.equal(computeLots(nightOut, nightMs, LAT, LON).sect, 'night');
  });
});

describe('lot longitudes vs the Python PoC', () => {
  it('matches all ten day-chart values', () => {
    const got = Object.fromEntries(
      computeLots(dayOut, dayMs, LAT, LON).values.map(v => [v.name, v.lon]));
    const exp = {
      Fortune: 73.6251, Spirit: 263.9004, Exaltation: 103.3546,
      Necessity: 176.1947, Eros: 313.9830, Courage: 231.1368,
      Victory: 10.8150, Nemesis: 308.3730, Basis: 338.4874,
      'Illness/Accusation': 245.9989,
    };
    for (const [k, v] of Object.entries(exp))
      assert.ok(near(got[k], v), `${k}: got ${got[k]}, want ${v}`);
  });
  it('matches all ten night-chart values', () => {
    const got = Object.fromEntries(
      computeLots(nightOut, nightMs, LAT, LON).values.map(v => [v.name, v.lon]));
    const exp = {
      Fortune: 80.6031, Spirit: 237.9058, Exaltation: 29.6725,
      Necessity: 323.9856, Eros: 168.6276, Courage: 269.5428,
      Victory: 111.3159, Nemesis: 192.6955, Basis: 136.5571,
      'Illness/Accusation': 262.4071,
    };
    for (const [k, v] of Object.entries(exp))
      assert.ok(near(got[k], v), `${k}: got ${got[k]}, want ${v}`);
  });
});

describe('structure', () => {
  it('defines ten lots with day and night variants', () => {
    assert.equal(HERMETIC_LOTS.length, 10);
    for (const d of HERMETIC_LOTS) {
      assert.equal(d.day.length, 3);
      assert.equal(d.night.length, 3);
    }
  });
  it('reports whole-sign houses from the Ascendant sign', () => {
    const r = computeLots(dayOut, dayMs, LAT, LON);
    const fortune = r.values.find(v => v.name === 'Fortune');
    // Asc 168.76 (Virgo), Fortune 73.63 (Gemini): the 10th whole-sign house.
    assert.equal(fortune.house, 10);
  });
  it('labels the applied formula per sect', () => {
    const day = computeLots(dayOut, dayMs, LAT, LON).values;
    const night = computeLots(nightOut, nightMs, LAT, LON).values;
    assert.equal(day.find(v => v.name === 'Fortune').formula, 'Asc + ☽\uFE0E − ☉\uFE0E');
    assert.equal(night.find(v => v.name === 'Fortune').formula, 'Asc + ☉\uFE0E − ☽\uFE0E');
    assert.equal(night.find(v => v.name === 'Exaltation').formula, 'Asc + 3°♉\uFE0E − ☽\uFE0E');
    assert.equal(day.find(v => v.name === 'Eros').formula, 'Asc + ♀\uFE0E − Spirit');
  });
  it('builds a table naming the sect rule', () => {
    const html = buildLotsHTML(computeLots(nightOut, nightMs, LAT, LON));
    assert.ok(html.includes('Night chart'));
    assert.ok(html.includes('Illness/Accusation'));
    assert.ok(html.includes('>Formula<'));
    assert.ok(html.includes('data-csv-name="trigon-lots.csv"'));
  });
});

describe('conditional modifiers (vs proto/lots_modifiers_proto.py)', () => {
  const lon = (r, name) => r.values.find(v => v.name === name).lon;

  it('reads the Moon altitude for both proviso branches', () => {
    assert.ok(near(moonAltitudeDeg(moonDownOut, moonDownMs, LAT, LON), -35.71, 0.5));
    assert.ok(near(moonAltitudeDeg(moonUpOut, moonUpMs, LAT, LON), 12.67, 0.5));
  });

  it('Valens proviso fires only after moonset in a night chart', () => {
    const down = computeLots(moonDownOut, moonDownMs, LAT, LON);
    const downV = computeLots(moonDownOut, moonDownMs, LAT, LON, { valensMoon: true });
    assert.ok(near(lon(down, 'Fortune'), 26.7461));
    assert.ok(near(lon(downV, 'Fortune'), 180.9709)); // day formula
    assert.ok(near(lon(downV, 'Fortune'), lon(downV, 'Spirit'))); // they coincide
    assert.ok(downV.notes.some(n => n.includes('Nechepso rule') && n.includes('below the horizon')));
    assert.ok(downV.notes.some(n => n.includes('Serapio') && n.includes('not a positional swap')));
    // Derived lots cascade through the flipped Fortune.
    assert.ok(near(lon(downV, 'Necessity'), 168.0089));
    // Moon up: the proviso gates on, but nothing changes.
    const upV = computeLots(moonUpOut, moonUpMs, LAT, LON, { valensMoon: true });
    assert.ok(near(lon(upV, 'Fortune'), 102.7791));
    assert.ok(upV.notes.some(n => n.includes('keeps the night formula')));
    // Day charts are unconditional (the refuted stronger reading).
    const dayV = computeLots(dayOut, dayMs, LAT, LON, { valensMoon: true });
    assert.ok(near(lon(dayV, 'Fortune'), 73.6251));
  });

  it('Ptolemy: Fortune never reversed, subsumes the proviso', () => {
    const p = computeLots(moonUpOut, moonUpMs, LAT, LON, { ptolemyFortune: true });
    assert.ok(near(lon(p, 'Fortune'), 261.1102)); // day formula at night
    const both = computeLots(moonDownOut, moonDownMs, LAT, LON,
      { ptolemyFortune: true, valensMoon: true });
    assert.ok(both.notes.some(n => n.includes('Ptolemy')));
  });

  it('Valens Basis takes the below-horizon mirror point', () => {
    const std = computeLots(basisOut, basisMs, LAT, LON);
    const val = computeLots(basisOut, basisMs, LAT, LON, { valensBasis: true });
    assert.ok(near(lon(std, 'Basis'), 18.5333));
    assert.ok(near(lon(val, 'Basis'), 346.1294));
    assert.ok(pointAltitudeDeg(lon(val, 'Basis'), 0, basisMs, LAT, LON) < 0);
  });

  it('Valens Eros & Necessity take arcs from Fortune/Spirit', () => {
    const v = computeLots(moonDownOut, moonDownMs, LAT, LON, { valensErosNec: true });
    assert.ok(near(lon(v, 'Eros'), 78.0833));
    assert.ok(near(lon(v, 'Necessity'), 129.6337));
    const f = v.values.find(x => x.name === 'Eros').formula;
    assert.ok(f.includes('Fortune') && f.includes('Spirit'), f);
  });

  it('options persist through a storage round trip', () => {
    const m = new Map();
    const store = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    writeLotOptions(store, { valensMoon: true, ptolemyFortune: false, valensBasis: true, valensErosNec: false });
    assert.deepEqual(readLotOptions(store),
      { valensMoon: true, ptolemyFortune: false, valensBasis: true, valensErosNec: false });
    assert.deepEqual(readLotOptions({ getItem: () => null }),
      { valensMoon: false, ptolemyFortune: false, valensBasis: false, valensErosNec: false });
  });

  it('renders option checkboxes in their persisted state', () => {
    const html = buildLotsHTML(computeLots(nightOut, nightMs, LAT, LON), 'dms',
      { valensMoon: true, ptolemyFortune: false, valensBasis: false, valensErosNec: false });
    assert.ok(html.includes('data-opt="valensMoon" checked'));
    assert.ok(html.includes('Nechepso/Valens; cf. Serapio'));
    assert.ok(html.includes('data-opt="ptolemyFortune">') || html.includes('data-opt="ptolemyFortune"'));
  });
});

describe('Hellenistic catalog', () => {
  it('registry: 181 names over 86 calculations, all references valid', async () => {
    const { LOT_CALCULATIONS, CATALOG_LOTS } = await import('../lots-catalog.js');
    assert.equal(CATALOG_LOTS.length, 181);
    assert.equal(LOT_CALCULATIONS.length, 86);
    for (const l of CATALOG_LOTS) {
      assert.ok(LOT_CALCULATIONS[l.calc], `${l.name} calc index`);
      assert.ok(l.prim, `${l.name} has a primary source`);
    }
    // The most-shared calculation: Asc + Venus - Jupiter (reverse).
    const shared = CATALOG_LOTS.filter(l => {
      const c = LOT_CALCULATIONS[l.calc];
      return c.pp === 'Asc' && c.sig === 'Venus' && c.trig === 'Jupiter';
    }).map(l => l.name);
    assert.ok(shared.includes('Fame') && shared.includes('Marriage (Valens)'));
  });

  it('computes selected lots: reversal, Death, syzygy gating, day-only', async () => {
    const { CATALOG_LOTS } = await import('../lots-catalog.js');
    const { computeCatalogLots } = await import('../lots.js');
    const id = n => CATALOG_LOTS.find(l => l.name === n).id;
    const sel = [id('Fortune'), id('Eros (Valens)'), id('Death'), id('Releaser'),
      id('Exaltation (Day)'), id('Indecency and Lust')];
    const day = computeCatalogLots(dayOut, dayMs, LAT, LON, undefined, sel, null);
    const byName = Object.fromEntries(day.values.map(v => [v.name, v]));
    // Catalog Fortune equals the Hermetic Fortune on the same chart.
    const herm = Object.fromEntries(computeLots(dayOut, dayMs, LAT, LON).values.map(v => [v.name, v.lon]));
    assert.ok(near(byName.Fortune.lon, herm.Fortune));
    // Death: Saturn + 8th - Moon (fixed).
    const asc = dayOut[72];
    const exp = ((dayOut[36] + ((asc + 210) % 360) - dayOut[6]) % 360 + 360) % 360;
    assert.ok(near(byName.Death.lon, exp, 0.001));
    // Releaser needs the syzygy: null without, computed with.
    assert.equal(byName.Releaser.lon, null);
    const syz = computeCatalogLots(dayOut, dayMs, LAT, LON, undefined, sel, 100);
    const rel = syz.values.find(v => v.name === 'Releaser');
    assert.ok(near(rel.lon, ((asc + dayOut[6] - 100) % 360 + 360) % 360, 0.001));
    // Exaltation (Day) resolves by day; Indecency carries both directions.
    assert.ok(byName['Exaltation (Day)'].lon != null);
    assert.ok(byName['Indecency and Lust'].altLon != null);
    const night = computeCatalogLots(nightOut, nightMs, LAT, LON, undefined, sel, null);
    const nb = Object.fromEntries(night.values.map(v => [v.name, v]));
    assert.equal(nb['Exaltation (Day)'].lon, null);
    // Night reversal: Eros (Valens) = Asc + Fortune - Spirit at night.
    const nherm = Object.fromEntries(computeLots(nightOut, nightMs, LAT, LON).values.map(v => [v.name, v.lon]));
    const expEros = ((nightOut[72] + nherm.Fortune - nherm.Spirit) % 360 + 360) % 360;
    assert.ok(near(nb['Eros (Valens)'].lon, expEros, 0.001));
  });

  it('selection persists and unknown ids are dropped', async () => {
    const { readCatalogSelection, writeCatalogSelection, CATALOG_LOTS } =
      await import('../lots.js').then(m => ({ ...m, CATALOG_LOTS: null })).catch(() => ({}));
    const lots = await import('../lots.js');
    const cat = await import('../lots-catalog.js');
    const m = new Map();
    const store = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
    lots.writeCatalogSelection(store, [cat.CATALOG_LOTS[0].id, 'bogus']);
    assert.deepEqual(lots.readCatalogSelection(store), [cat.CATALOG_LOTS[0].id]);
  });

  it('browser groups names under calculations with source labels', async () => {
    const { computeCatalogLots, buildCatalogHTML } = await import('../lots.js');
    const { CATALOG_LOTS } = await import('../lots-catalog.js');
    const sel = [CATALOG_LOTS.find(l => l.name === 'Fame').id];
    const res = computeCatalogLots(dayOut, dayMs, LAT, LON, undefined, sel, null);
    const html = buildCatalogHTML(res.values, sel);
    assert.ok(html.includes('Hellenistic lots catalog'));
    assert.ok(html.includes('Fame'));
    assert.ok(html.includes('O2'));
    assert.ok(html.includes('data-cid="' + sel[0] + '"'));
    assert.ok(html.includes('cat-browser'));
  });
});
