// Tests for site/desktop.js — the Tauri SQLite backend adapter.
// The Rust side is mocked as an in-memory kv/ephe store behind
// window.__TAURI__.core.invoke, so these run in node with no Tauri.
// Run: ./test.sh (from the repo root)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isDesktop, createTauriBackend, epheGetDesktop, ephePutDesktop } from '../desktop.js';
import { createPersistence } from '../persistence.js';

function mockTauri() {
  const kv = new Map(); // "store\0key" -> string
  const ephe = new Map(); // name -> base64
  const calls = [];
  globalThis.window = {
    __TAURI__: {
      core: {
        async invoke(cmd, args) {
          calls.push([cmd, args]);
          if (cmd === 'kv_get') return kv.has(`${args.store}\0${args.key}`) ? kv.get(`${args.store}\0${args.key}`) : null;
          if (cmd === 'kv_put') { kv.set(`${args.store}\0${args.key}`, args.value); return; }
          if (cmd === 'kv_delete') { kv.delete(`${args.store}\0${args.key}`); return; }
          if (cmd === 'kv_get_all') {
            return [...kv.entries()]
              .filter(([k]) => k.startsWith(`${args.store}\0`))
              .map(([k, value]) => ({ key: k.slice(args.store.length + 1), value }));
          }
          if (cmd === 'ephe_get') return ephe.has(args.name) ? ephe.get(args.name) : null;
          if (cmd === 'ephe_put') { ephe.set(args.name, args.data); return; }
          throw new Error(`unknown command ${cmd}`);
        },
      },
    },
  };
  return { kv, ephe, calls };
}

describe('isDesktop', () => {
  it('is false without __TAURI__ and true with it', () => {
    delete globalThis.window;
    assert.equal(isDesktop(), false);
    mockTauri();
    assert.equal(isDesktop(), true);
  });
});

describe('createTauriBackend', () => {
  let backend;
  beforeEach(() => { mockTauri(); backend = createTauriBackend(); });

  it('round-trips values, returns null on miss, deletes', async () => {
    assert.equal(await backend.get('settings', 'default'), null);
    await backend.put('settings', 'default', { 'astroweb-angle-fmt': 'dec' });
    assert.deepEqual(await backend.get('settings', 'default'), { 'astroweb-angle-fmt': 'dec' });
    await backend.delete('settings', 'default');
    assert.equal(await backend.get('settings', 'default'), null);
  });

  it('getAll returns key/value pairs per store', async () => {
    await backend.put('charts', 'a', { name: 'A' });
    await backend.put('charts', 'b', { name: 'B' });
    await backend.put('profiles', 'a', { name: 'P' });
    const rows = await backend.getAll('charts');
    assert.deepEqual(rows.map(r => r.key).sort(), ['a', 'b']);
    assert.equal(rows.find(r => r.key === 'a').value.name, 'A');
  });
});

describe('ephe over Tauri', () => {
  it('round-trips binary data, null on miss', async () => {
    mockTauri();
    assert.equal(await epheGetDesktop('sepl18.se1'), null);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]).buffer;
    await ephePutDesktop('sepl18.se1', bytes);
    const back = await epheGetDesktop('sepl18.se1');
    assert.deepEqual(new Uint8Array(back), new Uint8Array([0, 1, 2, 250, 255]));
  });
});

describe('createPersistence over the Tauri backend', () => {
  it('profiles and saved charts persist through the mocked invoke layer', async () => {
    const { calls } = mockTauri();
    const p = createPersistence(createTauriBackend());
    await p.init(null);
    const profile = await p.createProfile('Work');
    await p.saveChart({ name: 'Birth', lat: 33.45, lon: -112.07, utcMs: 1700000000000 });
    assert.equal(p.listCharts().length, 1);
    assert.equal(p.listCharts()[0].profileId, profile.id);
    // The settings flush and the chart write both went over invoke.
    assert.ok(calls.some(([c]) => c === 'kv_put'));
    assert.ok(calls.some(([c, a]) => c === 'kv_put' && a.store === 'charts'));
  });
});
