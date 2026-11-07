// Tests for persistence.js — profiles, saved charts, and the
// IndexedDB settings record (in-memory backend here; the browser
// backend is the same interface over IndexedDB).
// Run: node --test test/persistence.test.js  (from site/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPersistence, createMemoryBackend, settingsRecordFromStorage,
  validateChart, validateProfileName, DEFAULT_PROFILE_ID, SETTINGS_KEYS,
} from '../persistence.js';

function memStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  };
}

async function fresh(localEntries = {}) {
  const p = createPersistence(createMemoryBackend());
  await p.init(memStorage(localEntries));
  return p;
}

describe('settingsRecordFromStorage', () => {
  it('copies only known settings keys', () => {
    const r = settingsRecordFromStorage(memStorage({
      'astroweb-angle-fmt': 'dec', 'trigon.glyphs.v1': '1', 'unrelated': 'x',
    }));
    assert.deepEqual(r, { 'astroweb-angle-fmt': 'dec', 'trigon.glyphs.v1': '1' });
    assert.equal(Object.keys(r).every(k => SETTINGS_KEYS.includes(k)), true);
  });
  it('returns an empty record when nothing is stored', () => {
    assert.deepEqual(settingsRecordFromStorage(memStorage()), {});
  });
});

describe('migration and no-profile behaviour', () => {
  it('migrates localStorage settings into the default record and removes the keys', async () => {
    const ls = memStorage({ 'astroweb-angle-fmt': 'dec', 'trigon.glyphs.v1': '1' });
    const p = createPersistence(createMemoryBackend());
    await p.init(ls);
    assert.equal(p.prefsStorage.getItem('astroweb-angle-fmt'), 'dec');
    assert.equal(p.prefsStorage.getItem('trigon.glyphs.v1'), '1');
    assert.equal(ls._map.size, 0);
    assert.equal(p.activeProfileId(), DEFAULT_PROFILE_ID);
  });

  it('migration runs once: a later localStorage write is not re-imported', async () => {
    const ls = memStorage({ 'astroweb-angle-fmt': 'dec' });
    const backend = createMemoryBackend();
    const p1 = createPersistence(backend);
    await p1.init(ls);
    ls.setItem('astroweb-angle-fmt', 'dms');
    const p2 = createPersistence(backend);
    await p2.init(ls);
    assert.equal(p2.prefsStorage.getItem('astroweb-angle-fmt'), 'dec');
  });

  it('writes through the storage handle persist to the default record', async () => {
    const p = await fresh();
    p.prefsStorage.setItem('trigon.glyphs.v1', '1');
    await p.flush();
    const p2 = createPersistence(createMemoryBackend());
    // Same backend is not shared here, so re-check via the same layer's record.
    assert.equal(p.settingsRecord()['trigon.glyphs.v1'], '1');
    assert.equal(p2.settingsRecord()['trigon.glyphs.v1'], undefined);
  });
});

describe('profiles', () => {
  it('the first profile carries over the currently active settings', async () => {
    const p = await fresh({ 'astroweb-angle-fmt': 'dec', 'trigon.glyphs.v1': '1' });
    const profile = await p.createProfile('  Work  ');
    assert.equal(profile.name, 'Work');
    assert.equal(p.activeProfileId(), profile.id);
    assert.equal(p.prefsStorage.getItem('astroweb-angle-fmt'), 'dec');
    assert.equal(p.prefsStorage.getItem('trigon.glyphs.v1'), '1');
  });

  it('later profiles copy the then-active profile, and switching restores each profile settings', async () => {
    const p = await fresh();
    const a = await p.createProfile('A');
    p.prefsStorage.setItem('astroweb-angle-fmt', 'dec');
    await p.flush();
    const b = await p.createProfile('B');
    assert.equal(p.prefsStorage.getItem('astroweb-angle-fmt'), 'dec');
    p.prefsStorage.setItem('astroweb-angle-fmt', 'dms');
    await p.flush();
    await p.switchProfile(a.id);
    assert.equal(p.prefsStorage.getItem('astroweb-angle-fmt'), 'dec');
    await p.switchProfile(b.id);
    assert.equal(p.prefsStorage.getItem('astroweb-angle-fmt'), 'dms');
    await p.switchProfile(DEFAULT_PROFILE_ID);
    assert.equal(p.activeProfile(), null);
  });

  it('rejects empty and duplicate profile names', async () => {
    const p = await fresh();
    await assert.rejects(() => p.createProfile('   '), /must not be empty/);
    await p.createProfile('A');
    await assert.rejects(() => p.createProfile('a'), /already exists/);
    await assert.rejects(() => p.switchProfile('nope'), /not found/);
  });

  it('renaming and deleting a profile, with its charts, returns to the default', async () => {
    const p = await fresh();
    const a = await p.createProfile('A');
    await p.saveChart({ name: 'C1', lat: 10, lon: 20, utcMs: 1000 });
    const renamed = await p.renameProfile(a.id, 'Alpha');
    assert.equal(renamed.name, 'Alpha');
    await p.deleteProfile(a.id);
    assert.equal(p.activeProfileId(), DEFAULT_PROFILE_ID);
    assert.deepEqual(p.listProfiles(), []);
    assert.deepEqual(p.listCharts(), []);
    await assert.rejects(() => p.deleteProfile(DEFAULT_PROFILE_ID), /cannot be deleted/);
  });
});

describe('saved charts', () => {
  it('saves a named chart under the active profile, scoped per profile', async () => {
    const p = await fresh();
    const a = await p.createProfile('A');
    const c = await p.saveChart({ name: 'Birth', lat: 33.45, lon: -112.07, utcMs: 1700000000000 });
    assert.equal(c.name, 'Birth');
    assert.equal(c.profileId, a.id);
    assert.equal(p.listCharts().length, 1);
    await p.switchProfile(DEFAULT_PROFILE_ID);
    assert.deepEqual(p.listCharts(), []);
    await p.switchProfile(a.id);
    assert.equal(p.listCharts()[0].name, 'Birth');
  });

  it('validates chart names and coordinates', async () => {
    const p = await fresh();
    await assert.rejects(() => p.saveChart({ name: '', lat: 0, lon: 0, utcMs: 0 }), /must not be empty/);
    await assert.rejects(() => p.saveChart({ name: 'x', lat: 100, lon: 0, utcMs: 0 }), /latitude/);
    await assert.rejects(() => p.saveChart({ name: 'x', lat: 0, lon: 200, utcMs: 0 }), /longitude/);
    assert.throws(() => validateChart({ name: 'x', lat: 0, lon: 0, utcMs: NaN }), /instant/);
    assert.equal(validateProfileName('  A  '), 'A');
  });

  it('renames and deletes a saved chart', async () => {
    const p = await fresh();
    const c = await p.saveChart({ name: 'Old', lat: 0, lon: 0, utcMs: 0 });
    const renamed = await p.renameChart(c.id, 'New');
    assert.equal(renamed.name, 'New');
    assert.equal(p.getChart(c.id).name, 'New');
    await p.deleteChart(c.id);
    assert.equal(p.getChart(c.id), null);
    await assert.rejects(() => p.deleteChart(c.id), /not found/);
  });
});
