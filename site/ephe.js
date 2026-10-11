// ephe.js — Swiss Ephemeris WASM boundary.
//
// Pure core (epheFile, computeChart, ephProvider) takes the instantiated
// module explicitly. The stateful pieces (fetchEphe, ensureWasm,
// ensureSearchFiles) are built by createEpheClient with injected
// dependencies — store ({get, put}), ui ({showLoader, isArmed}), loadWasm —
// so tests can substitute a memory store, a local file server, and a
// disk-loaded WASM binary instead of IndexedDB / fetch / the browser.
import SweModule from './swe.js';
import { epheGet, ephePut } from './ephe-store.js';
import { calFromJd } from './search.js';
import { EPH_SLOT, EPH_LON, EPH_LAT, EPH_DIST, EPH_LONSPD, EPH_DEC, EPH_MAG, EPH_ASC, EPH_MC, EPH_HOUSE0 } from './sky-data.js';

export const CANCELLED = { cancelled: true };

// Ephemeris file selection. Each .se1 file covers 600 years starting at
// icty*100, where icty is the century rounded down to a multiple of 6.
// This is a direct port of swi_gen_filename() in swephlib.c.
export function epheFile(kind, year) {
  const sgn = year < 0 ? -1 : 1;
  let icty = Math.trunc(year / 100);
  if (sgn < 0 && year % 100 !== 0) icty -= 1;
  while (icty % 6 !== 0) icty--;
  return kind + (icty < 0 ? 'm' : '_') + String(Math.abs(icty)).padStart(2, '0') + '.se1';
}

const NOUT = 84; // doubles returned by chart_compute

export function computeChart(mod, y, mo, d, hourUT, lat, lon, useSwiss) {
  const outPtr = mod._malloc(NOUT * 8);
  const errPtr = mod._malloc(256);
  try {
    const rc = mod._chart_compute(y, mo, d, hourUT, lat, lon, useSwiss ? 1 : 0, outPtr, errPtr);
    if (rc !== 0) throw new Error(mod.UTF8ToString(errPtr) || 'chart_compute failed');
    return Array.from(mod.HEAPF64.subarray(outPtr / 8, outPtr / 8 + NOUT));
  } finally {
    mod._free(outPtr);
    mod._free(errPtr);
  }
}

// --- WASM output validation ---------------------------------------------------
// Tripwire for the 84-double chart_compute layout (see the EphOut typedef in
// sky-data.js): catches cross-language drift (swe_wrap.c changed without
// updating the JS side) and WASM memory corruption. Runs on every
// calculation; 84 numbers are microseconds. Returns human-readable
// violations, empty when well-formed. Deliberately conservative about the
// nodes: swe_wrap.c writes NaN for their declination/magnitude ("only the
// longitude is meaningful"), so NaN is asserted there rather than
// range-checked.
/**
 * @param {import('./sky-data.js').EphOut} out
 * @returns {string[]} violation descriptions; empty when valid
 */
export function validateEphOut(out) {
  const errs = [];
  if (!out || typeof out.length !== 'number' || out.length !== 84) {
    errs.push(`length ${out && out.length}, want 84`);
    return errs;
  }
  const lonOk = v => Number.isFinite(v) && v >= 0 && v < 360;
  const latOk = v => Number.isFinite(v) && v >= -90 && v <= 90;
  for (let i = 0; i < 12; i++) {
    const b = EPH_SLOT(i);
    if (!lonOk(out[b + EPH_LON])) errs.push(`body ${i}: longitude ${out[b + EPH_LON]} not in [0,360)`);
    if (i < 10) {
      if (!latOk(out[b + EPH_LAT])) errs.push(`body ${i}: latitude ${out[b + EPH_LAT]} not in [-90,90]`);
      const dist = out[b + EPH_DIST];
      if (!(dist > 0 && Number.isFinite(dist))) errs.push(`body ${i}: distance ${dist} not positive finite`);
      const spd = out[b + EPH_LONSPD];
      // Generous: the Moon peaks near 15.4°/day; anything past 30 is corruption.
      if (!Number.isFinite(spd) || Math.abs(spd) > 30) errs.push(`body ${i}: speed ${spd} implausible`);
      if (!latOk(out[b + EPH_DEC])) errs.push(`body ${i}: declination ${out[b + EPH_DEC]} not in [-90,90]`);
      if (!Number.isFinite(out[b + EPH_MAG])) errs.push(`body ${i}: magnitude ${out[b + EPH_MAG]} not finite`);
    } else {
      // Nodes: swe_calc_ut fills longitude/latitude/distance/speed; the C
      // wrapper leaves declination and magnitude as NaN by contract.
      for (const f of [EPH_LAT, EPH_DIST, EPH_LONSPD])
        if (!Number.isFinite(out[b + f])) errs.push(`node ${i}: field ${f} not finite`);
      if (!Number.isNaN(out[b + EPH_DEC])) errs.push(`node ${i}: declination should be NaN`);
      if (!Number.isNaN(out[b + EPH_MAG])) errs.push(`node ${i}: magnitude should be NaN`);
    }
  }
  if (!lonOk(out[EPH_ASC])) errs.push(`Ascendant ${out[EPH_ASC]} not in [0,360)`);
  if (!lonOk(out[EPH_MC])) errs.push(`MC ${out[EPH_MC]} not in [0,360)`);
  for (let i = 0; i < 10; i++) {
    const h = out[EPH_HOUSE0 + i];
    if (!Number.isInteger(h) || h < 1 || h > 12) errs.push(`house of body ${i}: ${h} not an integer 1..12`);
  }
  return errs;
}

// Evaluate search-relevant bodies at a Julian day through the WASM
// _search_compute entry point: longitude + longitude speed only (no
// equatorial pass, magnitude, houses, or Ascendant/MC — the search needs
// neither). bodyMask selects which of the 11 bodies (Sun..True Node) to
// compute; unmasked slots are left untouched. The 22-double WASM buffer is
// allocated once per provider, not per evaluation. Counts its own calls so
// the UI can report how many ephemeris evaluations a scan cost. Call
// .free() when done to release the WASM buffers.
export function ephProvider(mod, useSwiss, bodyMask) {
  let calls = 0;
  const outPtr = mod._malloc(22 * 8), errPtr = mod._malloc(256);
  const eph = jd => {
    calls++;
    const rc = mod._search_compute(jd, useSwiss ? 1 : 0, bodyMask, outPtr, errPtr);
    if (rc !== 0) throw new Error(mod.UTF8ToString(errPtr) || 'ephemeris error');
    const h = mod.HEAPF64, b = outPtr / 8;
    const lon = new Array(11), spd = new Array(11);
    for (let i = 0; i < 11; i++) { lon[i] = h[b + 2 * i]; spd[i] = h[b + 2 * i + 1]; }
    return { lon, spd };
  };
  eph.calls = () => calls;
  eph.free = () => { mod._free(outPtr); mod._free(errPtr); };
  return eph;
}

// Idiosyncratic eclipse check for the Aspects search: was the Sun-Moon
// syzygy (conjunction = new moon, opposition = full moon) at jd an
// eclipse? Thin wrapper over the WASM _eclipse_at_syzygy entry point.
// Returns { eclipse: bool, type: SE_ECL_* bitmask, jdMax: JD of maximum }.
export function eclipseAtSyzygy(mod, jd, isFullMoon, useSwiss) {
  const outPtr = mod._malloc(3 * 8), errPtr = mod._malloc(256);
  try {
    const rc = mod._eclipse_at_syzygy(jd, isFullMoon ? 1 : 0, useSwiss ? 1 : 0, outPtr, errPtr);
    if (rc !== 0) throw new Error(mod.UTF8ToString(errPtr) || 'eclipse check failed');
    const h = mod.HEAPF64, b = outPtr / 8;
    return { eclipse: h[b] === 1, type: h[b + 1] | 0, jdMax: h[b + 2] };
  } finally {
    mod._free(outPtr);
    mod._free(errPtr);
  }
}

export function createEpheClient({ baseUrl, store, ui, loadWasm } = {}) {
  const _store = store || { get: epheGet, put: ephePut };
  const _base = baseUrl
    || 'https://raw.githubusercontent.com/aloistr/swisseph/master/ephe/';
  const _loadWasm = loadWasm || (() =>
    fetch(new URL('./swe.wasm', import.meta.url)).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} loading swe.wasm`);
      return r.arrayBuffer();
    }));
  let wasmPromise = null;

  // Fetch with persistence. In the browser the store is IndexedDB and the
  // loader animation shows while uncached data downloads.
  async function fetchEphe(name, onStatus) {
    const hit = await _store.get(name).catch(() => null);
    if (hit) {
      onStatus(`local copy: ${name}`);
      return new Uint8Array(hit);
    }
    onStatus(`downloading ${name} ...`);
    if (ui && ui.isArmed()) ui.showLoader('Downloading ephemeris data…');
    const resp = await fetch(_base + name);
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status} fetching ${name}`);
      err.file = name;
      err.httpStatus = resp.status;
      throw err;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    try {
      await _store.put(name, bytes.buffer);
      onStatus(`stored ${name} (${(bytes.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      onStatus(`downloaded ${name} (local store failed: ${e.message})`);
    }
    return bytes;
  }

  // WASM module singleton. The WASM binary is instantiated ourselves
  // instead of Emscripten's WebAssembly.instantiateStreaming: the static
  // host serves .wasm as application/octet-stream, which makes streaming
  // compilation throw (then fall back noisily to ArrayBuffer
  // instantiation). The manual path has no MIME requirement and logs no
  // console error.
  function ensureWasm(onStatus) {
    if (!wasmPromise) {
      wasmPromise = (async () => {
        onStatus('loading WebAssembly module ...');
        if (ui && ui.isArmed()) ui.showLoader('Loading ephemeris engine…');
        const bytes = await _loadWasm();
        const mod = await new Promise((resolve, reject) => {
          SweModule({
            instantiateWasm: (imports, onSuccess) => {
              WebAssembly.instantiate(bytes, imports)
                .then(({ instance }) => onSuccess(instance))
                .catch(reject);
            },
          }).then(resolve, reject);
        });
        try { mod.FS.mkdir('/ephe'); } catch (e) { /* exists */ }
        mod.ccall('swe_set_ephe_path', null, ['string'], ['/ephe']);
        onStatus('WebAssembly module ready');
        return mod;
      })();
    }
    return wasmPromise;
  }

  // Files already written into this module's FS: re-writing them every
  // live-clock tick (the old behavior) meant two IndexedDB reads and two
  // multi-megabyte buffer copies per second for data that only changes
  // when the century changes. The FS lives as long as the module does.
  const writtenFiles = new Set();

  /** Write the two single-chart ephemeris files if not already present. */
  async function ensureChartFiles(mod, fpl, fmo, onStatus) {
    for (const n of [fpl, fmo]) {
      if (writtenFiles.has(n)) continue;
      const bytes = await fetchEphe(n, onStatus);
      mod.FS.writeFile('/ephe/' + n, bytes);
      writtenFiles.add(n);
    }
  }

  // The ephemeris file needed for a Swiss date is epheFile('sepl'|'semo',
  // year); a range can span several .se1 files, so every required file is
  // fetched and cached before the scan starts.
  async function ensureSearchFiles(mod, useSwiss, jd0, jd1, onStatus, isCancelled) {
    if (!useSwiss) return;
    const names = new Set();
    for (let jd = jd0; jd <= jd1; jd += 100) {
      const { y } = calFromJd(jd);
      names.add(epheFile('sepl', y)); names.add(epheFile('semo', y));
    }
    const jl = calFromJd(jd1);
    names.add(epheFile('sepl', jl.y)); names.add(epheFile('semo', jl.y));
    for (const n of names) {
      if (isCancelled && isCancelled()) throw CANCELLED;
      const bytes = await fetchEphe(n, onStatus);
      if (isCancelled && isCancelled()) throw CANCELLED;
      mod.FS.writeFile('/ephe/' + n, bytes);
      writtenFiles.add(n);
    }
  }

  return { fetchEphe, ensureWasm, ensureChartFiles, ensureSearchFiles };
}
