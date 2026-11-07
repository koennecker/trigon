// persistence.js — profiles, saved charts, and settings in IndexedDB.
//
// Local-first, device-only, no auth and no sync (the cloud backend is
// still undecided; this layer is the local source of truth either way).
//
// One record per profile holds every setting/preference as the same
// string values the localStorage keys used to hold, so the existing
// per-key readers and writers (format.js, lots.js, dignities.js,
// chart-style.js, sky.js, search-ui.js) keep working unchanged: they
// read and write through a StorageHandle whose backing store is now
// an in-memory copy of the active profile's record, flushed to
// IndexedDB asynchronously.
//
//   - No profiles: the active profile is 'default'. Its record is the
//     settings as they were under localStorage, migrated once on first
//     run and then read from IndexedDB. Behaviour is unchanged.
//   - First profile created: the new profile starts as a copy of the
//     settings currently active (the ones the user is looking at), and
//     becomes active. Later profiles copy the then-active profile.
//   - Switching a profile swaps the in-memory record; the app re-reads
//     preferences from it and re-renders the settings UI, chart style,
//     sky options, and search conditions.
//
// Stores (DB 'trigon-data', version 1):
//   settings: profileId -> {key: string} (one record per profile)
//   profiles: profileId -> {id, name, createdAt, updatedAt}
//   charts:   chartId -> {id, profileId, name, lat, lon, utcMs, createdAt, updatedAt}
//   meta:     'activeProfileId' | 'migratedFromLocalStorage'
//
// The backend is injectable: the browser uses IndexedDB, node/jsdom
// tests use the in-memory backend. Nothing in this module touches
// localStorage or indexedDB at import time.

/** @typedef {Record<string, string>} SettingsRecord */
/** @typedef {{id: string, name: string, createdAt: number, updatedAt: number}} Profile */
/** @typedef {{id: string, profileId: string, name: string, lat: number, lon: number, utcMs: number, createdAt: number, updatedAt: number}} SavedChart */
/** @typedef {{getItem: (key: string) => (string|null), setItem: (key: string, value: string) => void, removeItem: (key: string) => void}} StorageHandle */

export const DB_NAME = 'trigon-data';
export const DB_VERSION = 1;
export const DEFAULT_PROFILE_ID = 'default';
export const DEFAULT_PROFILE_NAME = 'Default';

/** Every localStorage key that is a setting or preference, and that migrates to IndexedDB. */
export const SETTINGS_KEYS = [
  'astroweb-angle-fmt',
  'trigon.glyphs.v1',
  'trigon.seconds.v1',
  'trigon.angle-mode.v1',
  'trigon.station-time.v1',
  'trigon.lots.v1',
  'trigon.lots.selection.v1',
  'trigon.dignities.v1',
  'astroweb-chart-style',
  'trigon.sky.v1',
  'trigon.aspconds.v1',
];

/** @returns {string} a new profile/chart id */
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(16)}`;
}

/**
 * Validate a profile name. Returns the trimmed name, or throws.
 * @param {string} name
 * @returns {string}
 */
export function validateProfileName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!n) throw new Error('profile name must not be empty');
  if (n.length > 80) throw new Error('profile name must be at most 80 characters');
  return n;
}

/**
 * Validate a saved chart. Returns a normalized copy (without id/profileId), or throws.
 * @param {object} chart
 * @returns {{name: string, lat: number, lon: number, utcMs: number}}
 */
export function validateChart(chart) {
  const name = validateProfileName(chart && chart.name);
  const lat = chart && chart.lat, lon = chart && chart.lon, utcMs = chart && chart.utcMs;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('chart latitude must be -90..90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('chart longitude must be -180..180');
  if (!Number.isFinite(utcMs)) throw new Error('chart instant must be a number');
  return { name, lat, lon, utcMs };
}

/**
 * Build a settings record from a localStorage-like handle, for the
 * one-time migration. Only known keys are copied.
 * @param {StorageHandle} storage
 * @returns {SettingsRecord}
 */
export function settingsRecordFromStorage(storage) {
  /** @type {SettingsRecord} */
  const record = {};
  for (const k of SETTINGS_KEYS) {
    let v = null;
    try { v = storage.getItem(k); } catch (e) { v = null; }
    if (v != null) record[k] = String(v);
  }
  return record;
}

/**
 * In-memory backend (tests, and any context without IndexedDB).
 * @returns {object} backend with async get/put/delete/getAll
 */
export function createMemoryBackend() {
  /** @type {Map<string, Map<string, *>>} */
  const stores = new Map();
  const store = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  return {
    /** @param {string} s @param {string} k @returns {Promise<*>} */
    async get(s, k) { return store(s).has(k) ? store(s).get(k) : null; },
    /** @param {string} s @param {string} k @param {*} v @returns {Promise<void>} */
    async put(s, k, v) { store(s).set(k, v); },
    /** @param {string} s @param {string} k @returns {Promise<void>} */
    async delete(s, k) { store(s).delete(k); },
    /** @param {string} s @returns {Promise<Array<{key: string, value: *}>>} */
    async getAll(s) { return [...store(s).entries()].map(([key, value]) => ({ key, value })); },
  };
}

/**
 * IndexedDB backend for the browser. Opening is deferred to first use;
 * open() rejects when IndexedDB is unavailable.
 * @returns {object} backend with async get/put/delete/getAll
 */
export function createIndexedDBBackend() {
  let dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          for (const name of ['settings', 'profiles', 'charts', 'meta']) {
            if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      });
    }
    return dbPromise;
  }
  function run(storeName, mode, fn) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    }));
  }
  return {
    /** @param {string} s @param {string} k @returns {Promise<*>} */
    get(s, k) { return run(s, 'readonly', st => st.get(k)).then(v => v == null ? null : v); },
    /** @param {string} s @param {string} k @param {*} v @returns {Promise<void>} */
    put(s, k, v) { return run(s, 'readwrite', st => st.put(v, k)).then(() => undefined); },
    /** @param {string} s @param {string} k @returns {Promise<void>} */
    delete(s, k) { return run(s, 'readwrite', st => st.delete(k)).then(() => undefined); },
    /** @param {string} s @returns {Promise<Array<{key: string, value: *}>>} */
    getAll(s) {
      return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(s, 'readonly');
        const req = tx.objectStore(s).getAll();
        const keyReq = tx.objectStore(s).getAllKeys();
        req.onsuccess = () => resolve((req.result || []).map((value, i) => ({ key: keyReq.result[i], value })));
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      }));
    },
  };
}

/**
 * Create a persistence layer over a backend. Call init(localStorage)
 * once before use: it migrates settings from localStorage (once),
 * loads the active profile, and returns the layer.
 * @param {object} backend
 * @returns {object} persistence layer (see init)
 */
export function createPersistence(backend) {
  /** @type {SettingsRecord} */
  let record = {};
  let activeProfileId = DEFAULT_PROFILE_ID;
  /** @type {Profile[]} */
  let profiles = [];
  /** @type {SavedChart[]} */
  let charts = [];
  let flushTimer = null;
  let flushPromise = Promise.resolve();

  function scheduleFlush() {
    if (flushTimer != null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPromise = flushPromise.then(() => backend.put('settings', activeProfileId, { ...record }));
    }, 0);
  }

  /** StorageHandle over the active profile's record (sync cache, async flush). */
  const prefsStorage = {
    /** @param {string} k @returns {string|null} */
    getItem(k) { return Object.prototype.hasOwnProperty.call(record, k) ? record[k] : null; },
    /** @param {string} k @param {string} v @returns {void} */
    setItem(k, v) { record[k] = String(v); scheduleFlush(); },
    /** @param {string} k @returns {void} */
    removeItem(k) { delete record[k]; scheduleFlush(); },
  };

  return {
    prefsStorage,
    /** @returns {string} the active profile id ('default' when no profile is active) */
    activeProfileId: () => activeProfileId,
    /** @returns {SettingsRecord} a copy of the active settings record */
    settingsRecord: () => ({ ...record }),
    /** @returns {Promise<void>} wait for any scheduled settings flush */
    flush: () => new Promise(resolve => setTimeout(() => { flushPromise.then(resolve); }, 0)),

    /**
     * Migrate from localStorage (once) and load the active profile.
     * @param {StorageHandle|null} localStorageHandle localStorage, or null when unavailable
     * @returns {Promise<void>}
     */
    async init(localStorageHandle) {
      const migrated = await backend.get('meta', 'migratedFromLocalStorage');
      if (!migrated && localStorageHandle) {
        const fromLocal = settingsRecordFromStorage(localStorageHandle);
        if (Object.keys(fromLocal).length) {
          const existing = await backend.get('settings', DEFAULT_PROFILE_ID);
          await backend.put('settings', DEFAULT_PROFILE_ID, { ...(existing || {}), ...fromLocal });
        }
        await backend.put('meta', 'migratedFromLocalStorage', true);
        for (const k of SETTINGS_KEYS) {
          try { localStorageHandle.removeItem(k); } catch (e) { /* best effort */ }
        }
      }
      const storedActive = await backend.get('meta', 'activeProfileId');
      activeProfileId = typeof storedActive === 'string' && storedActive ? storedActive : DEFAULT_PROFILE_ID;
      const storedProfiles = await backend.getAll('profiles');
      profiles = storedProfiles.map(e => e.value).sort((a, b) => a.createdAt - b.createdAt);
      if (activeProfileId !== DEFAULT_PROFILE_ID && !profiles.some(p => p.id === activeProfileId)) {
        activeProfileId = DEFAULT_PROFILE_ID;
        await backend.put('meta', 'activeProfileId', DEFAULT_PROFILE_ID);
      }
      record = (await backend.get('settings', activeProfileId)) || {};
      const storedCharts = await backend.getAll('charts');
      charts = storedCharts.map(e => e.value).sort((a, b) => a.createdAt - b.createdAt);
    },

    /** @returns {Profile[]} user-created profiles, oldest first (the default profile is implicit, not listed) */
    listProfiles: () => profiles.map(p => ({ ...p })),
    /** @returns {Profile|null} the active user profile, or null when on the default */
    activeProfile: () => profiles.find(p => p.id === activeProfileId) || null,

    /**
     * Create a profile carrying over the currently active settings,
     * and make it active. The first profile created on a device
     * therefore inherits exactly what the user is looking at.
     * @param {string} name
     * @returns {Promise<Profile>}
     */
    async createProfile(name) {
      const n = validateProfileName(name);
      if (profiles.some(p => p.name.toLowerCase() === n.toLowerCase())) {
        throw new Error(`a profile named "${n}" already exists`);
      }
      const now = Date.now();
      const profile = { id: newId(), name: n, createdAt: now, updatedAt: now };
      await backend.put('settings', profile.id, { ...record });
      await backend.put('profiles', profile.id, profile);
      profiles.push(profile);
      activeProfileId = profile.id;
      await backend.put('meta', 'activeProfileId', profile.id);
      return { ...profile };
    },

    /**
     * Rename a user profile.
     * @param {string} id @param {string} name @returns {Promise<Profile>}
     */
    async renameProfile(id, name) {
      const n = validateProfileName(name);
      const profile = profiles.find(p => p.id === id);
      if (!profile) throw new Error('profile not found');
      if (profiles.some(p => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) {
        throw new Error(`a profile named "${n}" already exists`);
      }
      profile.name = n;
      profile.updatedAt = Date.now();
      await backend.put('profiles', id, { ...profile });
      return { ...profile };
    },

    /**
     * Delete a user profile and all its saved charts. The default
     * profile cannot be deleted. Deleting the active profile returns
     * to the default.
     * @param {string} id @returns {Promise<void>}
     */
    async deleteProfile(id) {
      if (id === DEFAULT_PROFILE_ID) throw new Error('the default profile cannot be deleted');
      const profile = profiles.find(p => p.id === id);
      if (!profile) throw new Error('profile not found');
      await backend.delete('profiles', id);
      await backend.delete('settings', id);
      for (const c of charts.filter(c => c.profileId === id)) {
        await backend.delete('charts', c.id);
      }
      charts = charts.filter(c => c.profileId !== id);
      profiles = profiles.filter(p => p.id !== id);
      if (activeProfileId === id) {
        activeProfileId = DEFAULT_PROFILE_ID;
        await backend.put('meta', 'activeProfileId', DEFAULT_PROFILE_ID);
        record = (await backend.get('settings', DEFAULT_PROFILE_ID)) || {};
      }
    },

    /**
     * Switch the active profile, loading its settings record.
     * @param {string} id 'default' or a user profile id
     * @returns {Promise<SettingsRecord>} the newly active record
     */
    async switchProfile(id) {
      if (id !== DEFAULT_PROFILE_ID && !profiles.some(p => p.id === id)) {
        throw new Error('profile not found');
      }
      await backend.put('meta', 'activeProfileId', id);
      activeProfileId = id;
      record = (await backend.get('settings', id)) || {};
      return { ...record };
    },

    /**
     * Save the current chart under the active profile.
     * @param {{name: string, lat: number, lon: number, utcMs: number}} chart
     * @returns {Promise<SavedChart>}
     */
    async saveChart(chart) {
      const v = validateChart(chart);
      const now = Date.now();
      const saved = { id: newId(), profileId: activeProfileId, ...v, createdAt: now, updatedAt: now };
      await backend.put('charts', saved.id, saved);
      charts.push(saved);
      return { ...saved };
    },

    /** @param {string} [profileId] @returns {SavedChart[]} saved charts for a profile (default: active), oldest first */
    listCharts: (profileId = activeProfileId) =>
      charts.filter(c => c.profileId === profileId).map(c => ({ ...c })),

    /** @param {string} id @returns {SavedChart|null} */
    getChart: id => { const c = charts.find(c => c.id === id); return c ? { ...c } : null; },

    /**
     * Rename a saved chart.
     * @param {string} id @param {string} name @returns {Promise<SavedChart>}
     */
    async renameChart(id, name) {
      const n = validateProfileName(name);
      const chart = charts.find(c => c.id === id);
      if (!chart) throw new Error('chart not found');
      chart.name = n;
      chart.updatedAt = Date.now();
      await backend.put('charts', id, { ...chart });
      return { ...chart };
    },

    /**
     * Delete a saved chart.
     * @param {string} id @returns {Promise<void>}
     */
    async deleteChart(id) {
      if (!charts.some(c => c.id === id)) throw new Error('chart not found');
      await backend.delete('charts', id);
      charts = charts.filter(c => c.id !== id);
    },
  };
}
