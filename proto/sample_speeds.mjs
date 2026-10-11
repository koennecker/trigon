// proto/sample_speeds.mjs — sample apparent longitude speeds for bodies 0..9
// (Sun..Pluto) over a 500-year span via the real swe.wasm (_search_compute,
// Moshier fallback so no .se1 files are needed). Writes one JSON array per
// body of |speed| in deg/day: proto/speed_samples.json
// Run: node proto/sample_speeds.mjs  (from repo root)
import { readFile, writeFile } from 'node:fs/promises';
import { createEpheClient, ephProvider } from '../site/ephe.js';
import { jdFromCal } from '../site/search.js';

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
const eph = ephProvider(mod, 0, (1 << 10) - 1); // Moshier, bodies 0..9

const jd0 = jdFromCal(1800, 1, 1, 0);
const jd1 = jdFromCal(2300, 12, 31, 0);
const STEP = 10; // days
const samples = Array.from({ length: 10 }, () => []);
let n = 0;
for (let jd = jd0; jd <= jd1; jd += STEP, n++) {
  const { spd } = eph(jd);
  for (let i = 0; i < 10; i++) samples[i].push(Math.abs(spd[i]));
}
eph.free();
await writeFile(new URL('./speed_samples.json', import.meta.url),
  JSON.stringify(samples));
console.log(`sampled ${n} epochs x 10 bodies`);
