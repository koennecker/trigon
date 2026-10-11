// proto/sample_magnitudes.mjs — sample apparent magnitudes for bodies 0..9
// (Sun..Pluto) over 1800-01-01..2300-12-31 (the sepl_18/semo_18 reference
// frame) every 10 days via the real swe.wasm (_chart_compute, Moshier
// fallback so no .se1 files are needed). Magnitude is output slot 6i+5.
// Writes proto/mag_samples.json. Run: node proto/sample_magnitudes.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createEpheClient, computeChart } from '../site/ephe.js';
import { jdFromCal, calFromJd } from '../site/search.js';

const wasmUrl = new URL('../site/swe.wasm', import.meta.url);
const store = new Map();
const client = createEpheClient({
  baseUrl: '',
  store: {
    get: async n => (store.has(n) ? store.get(n) : null),
    put: async (n, buf) => { store.set(n, buf); },
  },
  ui: null,
  loadWasm: () => readFile(wasmUrl),
});
const mod = await client.ensureWasm(() => {});

const jd0 = jdFromCal(1800, 1, 1, 0);
const jd1 = jdFromCal(2300, 12, 31, 0);
const STEP = 10; // days
const samples = Array.from({ length: 10 }, () => []);
let n = 0;
for (let jd = jd0; jd <= jd1; jd += STEP, n++) {
  const c = calFromJd(jd);
  const out = computeChart(mod, c.y, c.mo, c.d, c.hourUT, 33.4484, -112.074, 0);
  for (let i = 0; i < 10; i++) samples[i].push(out[i * 6 + 5]);
}
await writeFile(new URL('./mag_samples.json', import.meta.url),
  JSON.stringify(samples));
console.log(`sampled ${n} epochs x 10 bodies`);
