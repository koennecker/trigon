// Tests for ephe.js: epheFile vectors plus integration tests of the full
// JS -> WASM -> .se1 pipeline in node (real swe.wasm, real data files,
// local HTTP server standing in for the CDN, memory store standing in for
// IndexedDB).
// Run: node --test test/ephe.test.js  (from site/)
// Test data: test/data/{seplm06,semom06}.se1 (see test/data/README).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { epheFile, computeChart, ephProvider, createEpheClient, validateEphOut, CANCELLED } from '../ephe.js';

const dataDir = new URL('./data/', import.meta.url);
const wasmUrl = new URL('../swe.wasm', import.meta.url);

async function requireData() {
  for (const n of ['seplm06.se1', 'semom06.se1']) {
    try { await stat(new URL(n, dataDir)); }
    catch { throw new Error(`missing test/data/${n} — see test/data/README`); }
  }
}

describe('epheFile', () => {
  it('ports swi_gen_filename() vectors', () => {
    assert.equal(epheFile('sepl', 2026), 'sepl_18.se1');
    assert.equal(epheFile('semo', 2026), 'semo_18.se1');
    assert.equal(epheFile('sepl', 1800), 'sepl_18.se1'); // exact boundary
    assert.equal(epheFile('sepl', 1799), 'sepl_12.se1');  // just below
    assert.equal(epheFile('sepl', -43), 'seplm06.se1');   // 44 BCE
    assert.equal(epheFile('sepl', -600), 'seplm06.se1');  // exact negative boundary
    assert.equal(epheFile('sepl', -601), 'seplm12.se1');
    assert.equal(epheFile('sepl', -12999), 'seplm132.se1'); // supported floor
  });
});

describe('validateEphOut', () => {
  // Well-formed synthetic output: bodies 0..9 fully populated, nodes with
  // NaN declination/magnitude per the swe_wrap.c contract.
  const good = () => {
    const out = new Array(84).fill(0);
    for (let i = 0; i < 10; i++) {
      const b = 6 * i;
      out[b] = 100 + i; out[b + 1] = 1; out[b + 2] = 1.5; out[b + 3] = 0.9; out[b + 4] = 10; out[b + 5] = 2;
    }
    for (const i of [10, 11]) {
      const b = 6 * i;
      out[b] = 200; out[b + 1] = 0; out[b + 2] = 0; out[b + 3] = -0.05; out[b + 4] = NaN; out[b + 5] = NaN;
    }
    out[72] = 150; out[73] = 210;
    for (let i = 0; i < 10; i++) out[74 + i] = (i % 12) + 1;
    return out;
  };

  it('accepts a well-formed output', () => {
    assert.deepEqual(validateEphOut(good()), []);
  });
  it('rejects wrong length and null', () => {
    assert.ok(validateEphOut(new Array(83).fill(0)).some(e => e.includes('length')));
    assert.ok(validateEphOut(null).some(e => e.includes('length')));
  });
  it('rejects out-of-range longitude and NaN fields', () => {
    const a = good(); a[0] = 360;
    assert.ok(validateEphOut(a).some(e => e.includes('longitude')));
    const b = good(); b[6 * 3 + 5] = NaN;
    assert.ok(validateEphOut(b).some(e => e.includes('magnitude')));
  });
  it('rejects non-positive distance and implausible speed', () => {
    const a = good(); a[6 * 1 + 2] = -0.5;
    assert.ok(validateEphOut(a).some(e => e.includes('distance')));
    const b = good(); b[6 * 1 + 3] = 100;
    assert.ok(validateEphOut(b).some(e => e.includes('speed')));
  });
  it('rejects bad Asc/MC and house numbers', () => {
    const a = good(); a[72] = 400;
    assert.ok(validateEphOut(a).some(e => e.includes('Ascendant')));
    const b = good(); b[74 + 4] = 13;
    assert.ok(validateEphOut(b).some(e => e.includes('house')));
    const c = good(); c[74 + 4] = 2.5;
    assert.ok(validateEphOut(c).some(e => e.includes('house')));
  });
  it('asserts the node NaN contract on declination/magnitude', () => {
    const a = good(); a[6 * 10 + 4] = 5;
    assert.ok(validateEphOut(a).some(e => e.includes('declination should be NaN')));
    const b = good(); b[6 * 11 + 5] = 3;
    assert.ok(validateEphOut(b).some(e => e.includes('magnitude should be NaN')));
  });
});

describe('WASM integration (real swe.wasm + real .se1)', () => {
  let server, base, client, mod;
  const memStore = () => {
    const m = new Map();
    return {
      get: async n => (m.has(n) ? m.get(n) : null),
      put: async (n, buf) => { m.set(n, buf); },
    };
  };

  before(async () => {
    await requireData();
    server = createServer(async (req, res) => {
      try {
        const bytes = await readFile(new URL('.' + req.url, dataDir));
        res.writeHead(200, { 'Content-Length': bytes.length });
        res.end(bytes);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/`;
    client = createEpheClient({
      baseUrl: base,
      store: memStore(),
      ui: null,
      loadWasm: () => readFile(wasmUrl),
    });
    const msgs = [];
    mod = await client.ensureWasm(m => msgs.push(m));
    assert.ok(msgs.includes('WebAssembly module ready'));
    // ensureWasm is a singleton: second call reuses the module.
    assert.equal(await client.ensureWasm(() => {}), mod);
  });

  after(() => server.close());

  it('computes the Ides of March reference through the real pipeline', async () => {
    // 44 BCE Mar 15, 12:00 LMT at lon -112.074° -> UT 19.4716h.
    // Recorded reference: Sun in Pisces 22°44′31″ (352.74194°).
    for (const n of ['seplm06.se1', 'semom06.se1'])
      mod.FS.writeFile('/ephe/' + n, await client.fetchEphe(n, () => {}));
    const out = computeChart(mod, -43, 3, 15, 19.4716, 40.0, -112.074, 1);
    assert.equal(out.length, 84);
    assert.ok(Math.abs(out[0] - 352.74194) < 0.005,
      `Sun longitude ${out[0]}, expected ~352.74194`);
    // Sanity on the rest of the shape: Moon longitude in range, Asc/MC set.
    assert.ok(out[6] >= 0 && out[6] < 360);
    assert.ok(out[72] >= 0 && out[72] < 360);
    assert.ok(out[73] >= 0 && out[73] < 360);
    // The validator tripwire accepts real WASM output.
    assert.deepEqual(validateEphOut(out), []);
  });

  it('ephProvider agrees with computeChart on the Sun', async () => {
    const { jdFromCal } = await import('../search.js');
    const jd = jdFromCal(-43, 3, 15, 19.4716);
    const eph = ephProvider(mod, 1, 1); // Sun only
    const a = eph(jd), b = eph(jd);
    assert.equal(a.lon[0], b.lon[0]); // deterministic
    assert.equal(eph.calls(), 2);
    // Independent entry point, same engine+data: sub-arcminute agreement.
    const out = computeChart(mod, -43, 3, 15, 19.4716, 40.0, -112.074, 1);
    const d = Math.abs(a.lon[0] - out[0]);
    assert.ok(Math.min(d, 360 - d) < 1 / 60, `Δ=${d}`);
    eph.free();
  });

  it('fetchEphe caches: download once, local copy after', async () => {
    const msgs = [];
    const bytes1 = await client.fetchEphe('seplm06.se1', m => msgs.push(m));
    assert.ok(bytes1.length > 1e5);
    const msgs2 = [];
    const bytes2 = await client.fetchEphe('seplm06.se1', m => msgs2.push(m));
    assert.ok(msgs2.some(m => m.startsWith('local copy')));
    assert.deepEqual(bytes2, bytes1);
  });

  it('fetchEphe surfaces 404s with file + status', async () => {
    const err = await client.fetchEphe('seplx_99.se1', () => {}).then(
      () => { throw new Error('should have thrown'); },
      e => e);
    assert.equal(err.httpStatus, 404);
    assert.equal(err.file, 'seplx_99.se1');
  });

  it('ensureSearchFiles stages every file a range needs', async () => {
    const { jdFromCal } = await import('../search.js');
    // 44 BCE lives in seplm06/semom06, both present in test/data.
    const jd0 = jdFromCal(-43, 6, 1, 0), jd1 = jdFromCal(-42, 6, 1, 0);
    await client.ensureSearchFiles(mod, 1, jd0, jd1, () => {}, null);
    for (const n of ['seplm06.se1', 'semom06.se1']) {
      const st = mod.FS.analyzePath('/ephe/' + n);
      assert.ok(st.exists, `${n} staged in the module FS`);
    }
  });

  it('ensureSearchFiles honors cancellation', async () => {
    const { jdFromCal } = await import('../search.js');
    const jd = jdFromCal(-43, 3, 15, 0);
    const err = await client.ensureSearchFiles(mod, 1, jd, jd + 10, () => {}, () => true)
      .then(() => { throw new Error('should have thrown'); }, e => e);
    assert.equal(err, CANCELLED);
  });

  it('ensureSearchFiles is a no-op for Moshier', async () => {
    await client.ensureSearchFiles(mod, 0, 0, 10, () => { throw new Error('no fetch expected'); }, null);
  });
});
