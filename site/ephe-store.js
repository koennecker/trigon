// ephe-store.js — IndexedDB persistence for .se1 ephemeris files.
// Replaces the earlier Cache API store (swisseph-ephe-v1). On first run a
// best-effort migration moves any files left in the old cache into IndexedDB
// and then deletes that cache, so already-downloaded files are not fetched again.

const DB_NAME = 'swisseph-ephe';
const STORE = 'files';
const OLD_CACHE = 'swisseph-ephe-v1';

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }
  return dbPromise;
}

// Returns the stored ArrayBuffer, or null on miss. Rejects when IndexedDB
// itself is unavailable (e.g. blocked storage in a sandboxed iframe).
export async function epheGet(name) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(name);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
  });
}

export async function ephePut(name, buffer) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(buffer, name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

// One-time migration of the old Cache API entries into IndexedDB.
// Best-effort: never throws.
export async function migrateEpheCache(onStatus) {
  try {
    if (!('caches' in window)) return;
    if (!(await caches.has(OLD_CACHE))) return;
    const cache = await caches.open(OLD_CACHE);
    const reqs = await cache.keys();
    let moved = 0;
    for (const req of reqs) {
      const name = req.url.split('/').pop();
      if (!/\.se1$/.test(name || '')) continue;
      let have = null;
      try { have = await epheGet(name); } catch (e) { return; } // IDB unusable: abort migration
      if (have) continue;
      const resp = await cache.match(req);
      if (!resp) continue;
      await ephePut(name, await resp.arrayBuffer());
      moved++;
    }
    await caches.delete(OLD_CACHE);
    if (moved && onStatus) onStatus(`migrated ${moved} ephemeris file(s) from cache to local database`);
  } catch (e) { /* best-effort only */ }
}
