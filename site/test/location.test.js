// Tests for location.js pure pieces.
// Run: node --test test/location.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOC_KEY, saveLocation, loadSavedLocation, deriveZoneFor,
} from '../location.js';

const memStore = () => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _raw: (k, v) => m.set(k, v),
  };
};

describe('saveLocation/loadSavedLocation', () => {
  it('round-trips a location with a city', () => {
    const s = memStore();
    saveLocation(s, 41.9028, 12.4964, 'Nearest city: Rome, Italy — 41.9028° N, 12.4964° E', 'Rome');
    const back = loadSavedLocation(s);
    assert.equal(back.lat, 41.9028);
    assert.equal(back.lon, 12.4964);
    assert.equal(back.city, 'Rome');
    assert.match(back.label, /Rome/);
  });
  it('stores city as null when absent', () => {
    const s = memStore();
    saveLocation(s, 0, 0, 'Manual', null);
    assert.equal(loadSavedLocation(s).city, null);
  });
  it('returns null for missing, corrupt, or non-finite data', () => {
    assert.equal(loadSavedLocation(memStore()), null);
    const bad = memStore(); bad._raw(LOC_KEY, 'not json');
    assert.equal(loadSavedLocation(bad), null);
    const nan = memStore(); nan._raw(LOC_KEY, '{"lat":"x","lon":0}');
    assert.equal(loadSavedLocation(nan), null);
  });
  it('survives throwing storage', () => {
    const t = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.doesNotThrow(() => saveLocation(t, 0, 0, 'x', null));
    assert.equal(loadSavedLocation(t), null);
  });
});

describe('deriveZoneFor (integration with format.js zone math)', () => {
  const dt = { y: 2026, mo: 7, d: 15, hh: 12, mi: 0 };
  const lookup = (lat, lon) => (lon < -30 ? 'America/New_York' : 'Europe/Rome');

  it('derives zone and offset via the injected lookup', () => {
    const r = deriveZoneFor(40.7, -74, dt, lookup);
    assert.equal(r.zone, 'America/New_York');
    assert.equal(r.off, -240); // July: EDT
    const winter = deriveZoneFor(40.7, -74, { ...dt, mo: 1 }, lookup);
    assert.equal(winter.off, -300); // January: EST
  });
  it('returns null for bad coordinates or missing lookup', () => {
    assert.equal(deriveZoneFor(NaN, -74, dt, lookup), null);
    assert.equal(deriveZoneFor(40.7, -74, dt, null), null);
    assert.equal(deriveZoneFor(40.7, -74, dt, undefined), null);
  });
  it('returns null when the lookup throws', () => {
    assert.equal(deriveZoneFor(40.7, -74, dt, () => { throw new Error('no data'); }), null);
  });
});
