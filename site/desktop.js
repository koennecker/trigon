// desktop.js — Trigon running under the Tauri desktop wrapper
// (desktop/ in this repo).
//
// This module is the only frontend file that knows about Tauri. It is
// imported by app.js and ephe-store.js, and it is safe to import on
// the web: every Tauri access goes through window.__TAURI__
// (enabled by withGlobalTauri in desktop/src-tauri/tauri.conf.json)
// and is only touched when isDesktop() is true.
//
// The Rust side owns two things and nothing else:
//   - a SQLite database (one kv table: store, key, value as JSON text)
//     exposed as the kv_get / kv_put / kv_delete / kv_get_all commands;
//   - an ephe/ directory under the app data dir, exposed as
//     ephe_get / ephe_put (base64, since Tauri invoke is JSON).
//
// No ephemeris runs in Rust. The Swiss Ephemeris stays in WASM
// (swe.wasm), and searches keep their Web Worker parallelization:
// that is the speedup, and a second, language-specific ephemeris
// would be a second source of truth for no non-trivial gain.
//
// The backend shape here matches persistence.js exactly
// (get/put/delete/getAll over the stores settings/profiles/charts/meta),
// so createPersistence() works unchanged over SQLite.

/** @returns {boolean} true when running inside the Tauri webview */
export function isDesktop() {
  return typeof window !== 'undefined' && !!/** @type {any} */ (window).__TAURI__;
}

/**
 * @param {string} cmd Tauri command name
 * @param {object} args command arguments
 * @returns {Promise<*>}
 */
function invoke(cmd, args) {
  if (!isDesktop()) throw new Error('not running under Tauri');
  return /** @type {any} */ (window).__TAURI__.core.invoke(cmd, args);
}

/**
 * SQLite backend for createPersistence(), over the Rust kv commands.
 * Values are JSON-encoded at this layer; the table stores text.
 * @returns {object} backend with async get/put/delete/getAll
 */
export function createTauriBackend() {
  return {
    /** @param {string} s @param {string} k @returns {Promise<*>} */
    async get(s, k) {
      const raw = await invoke('kv_get', { store: s, key: k });
      return raw == null ? null : JSON.parse(raw);
    },
    /** @param {string} s @param {string} k @param {*} v @returns {Promise<void>} */
    async put(s, k, v) {
      await invoke('kv_put', { store: s, key: k, value: JSON.stringify(v) });
    },
    /** @param {string} s @param {string} k @returns {Promise<void>} */
    async delete(s, k) {
      await invoke('kv_delete', { store: s, key: k });
    },
    /** @param {string} s @returns {Promise<Array<{key: string, value: *}>>} */
    async getAll(s) {
      const rows = await invoke('kv_get_all', { store: s });
      return (rows || []).map(r => ({ key: r.key, value: JSON.parse(r.value) }));
    },
  };
}

/**
 * Read a .se1 file from the desktop ephe directory.
 * @param {string} name file name, e.g. sepl18.se1
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function epheGetDesktop(name) {
  const b64 = await invoke('ephe_get', { name });
  if (b64 == null) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Write a .se1 file to the desktop ephe directory.
 * @param {string} name file name
 * @param {ArrayBuffer} buffer file contents
 * @returns {Promise<void>}
 */
export async function ephePutDesktop(name, buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  await invoke('ephe_put', { name, data: btoa(bin) });
}
