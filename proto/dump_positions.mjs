// One-off: dump chart positions (Moshier) for the Hermetic-lots PoC.
// Run from site/: node ../proto/dump_positions.mjs
import { readFile } from 'node:fs/promises';
import { createEpheClient, computeChart } from '../site/ephe.js';

const client = createEpheClient({
  baseUrl: 'http://127.0.0.1/',
  store: { get: async () => null, put: async () => {} },
  ui: null,
  loadWasm: () => readFile(new URL('../site/swe.wasm', import.meta.url)),
});
const mod = await client.ensureWasm(() => {});

const charts = [
  { tag: 'day',   y: 1990, mo: 6, d: 15, hourUT: 19.0, lat: 33.4484, lon: -112.0740 },
  { tag: 'night', y: 1990, mo: 6, d: 15, hourUT: 7.0,  lat: 33.4484, lon: -112.0740 },
];
const out = {};
for (const c of charts) {
  const o = computeChart(mod, c.y, c.mo, c.d, c.hourUT, c.lat, c.lon, 0);
  const L = i => o[i * 6];
  out[c.tag] = {
    utcMs: Date.UTC(c.y, c.mo - 1, c.d) + c.hourUT * 3600000,
    lat: c.lat, lon: c.lon,
    asc: o[72],
    sun: [o[0], o[1]], moon: L(1), mercury: L(2), venus: L(3),
    mars: L(4), jupiter: L(5), saturn: L(6),
  };
}
console.log(JSON.stringify(out, null, 1));
