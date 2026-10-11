// One-off: hourly position dumps around 1990-06-15 (Phoenix) so the Python
// modifier prototype can pick night charts with the Moon up and down.
// Run from site/: node ../proto/dump_scan.mjs
import { readFile } from 'node:fs/promises';
import { createEpheClient, computeChart } from '../site/ephe.js';

const client = createEpheClient({
  baseUrl: 'http://127.0.0.1/',
  store: { get: async () => null, put: async () => {} },
  ui: null,
  loadWasm: () => readFile(new URL('../site/swe.wasm', import.meta.url)),
});
const mod = await client.ensureWasm(() => {});

const LAT = 33.4484, LON = -112.0740;
const recs = [];
for (let h = 0; h <= 48; h += 2) {
  const ms = Date.UTC(1990, 5, 15) + h * 3600000;
  const d = new Date(ms);
  const hourUT = d.getUTCHours() + d.getUTCMinutes() / 60;
  const o = computeChart(mod, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hourUT, LAT, LON, 0);
  const L = i => [o[i * 6], o[i * 6 + 1]];
  recs.push({ utcMs: ms, lat: LAT, lon: LON, asc: o[72],
    sun: L(0), moon: L(1), mercury: L(2)[0], venus: L(3)[0],
    mars: L(4)[0], jupiter: L(5)[0], saturn: L(6)[0] });
}
console.log(JSON.stringify(recs));
