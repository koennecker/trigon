// Tests for store.js — session updates with dirty keys and
// subscriptions, and preference loading/writing through one path.
// Run: node --test test/store.test.js  (from site/)
// Storage is a Map-backed stub, as in the format/lots tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, update, subscribe, initPrefs, setPref,
  angleFmt, glyphsOn, angleMode, stationTime, lotsOpts, catalogSelection, digOpts,
} from '../store.js';

function stubStorage() {
  const store = new Map();
  return {
    map: store,
    handle: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  };
}

describe('update', () => {
  it('merges a patch and returns the keys that actually changed', () => {
    update({ out: null, metaStamp: '' });
    const changed = update({ out: [1, 2], metaStamp: 'm', useSwiss: true });
    assert.deepEqual(changed.sort(), ['metaStamp', 'out']);
    assert.deepEqual(S.out, [1, 2]);
    assert.equal(S.metaStamp, 'm');
    update({ out: null, metaStamp: '' });
  });
  it('a key written with its current value counts as unchanged', () => {
    update({ useSwiss: true });
    assert.deepEqual(update({ useSwiss: true }), []);
    assert.deepEqual(update({ useSwiss: false }), ['useSwiss']);
    update({ useSwiss: true });
  });
  it('notifies only subscribers of changed keys, synchronously', () => {
    const seen = [];
    const offA = subscribe(['syzygyLon'], (s, changed) => seen.push(['a', s.syzygyLon, changed]));
    const offB = subscribe(['out'], () => seen.push(['b']));
    update({ syzygyLon: 42 });
    assert.deepEqual(seen, [['a', 42, ['syzygyLon']]]);
    update({ syzygyLon: 42 });
    assert.equal(seen.length, 1, 'an unchanged value notifies nobody');
    update({ out: [9] });
    assert.deepEqual(seen[1], ['b']);
    offA();
    offB();
    update({ syzygyLon: 43, out: [10] });
    assert.equal(seen.length, 2, 'unsubscribed listeners stay silent');
    update({ syzygyLon: null, out: null });
  });
});

describe('preferences', () => {
  it('initPrefs loads stored values; setPref writes the binding and persists it together', () => {
    const s = stubStorage();
    s.map.set('astroweb-angle-fmt', 'dec');
    s.map.set('trigon.glyphs.v1', '1');
    s.map.set('trigon.angle-mode.v1', 'compact');
    s.map.set('trigon.station-time.v1', 'relative');
    s.map.set('trigon.lots.selection.v1', JSON.stringify(['hl0']));
    s.map.set('trigon.dignities.v1', JSON.stringify({ decan: 'indian' }));
    initPrefs(s.handle);
    assert.equal(angleFmt, 'dec');
    assert.equal(glyphsOn, true);
    assert.equal(angleMode, 'compact');
    assert.equal(stationTime, 'relative');
    assert.deepEqual(catalogSelection, ['hl0']);
    assert.deepEqual(digOpts, { decan: 'indian' });
    setPref('angleFmt', 'dms');
    assert.equal(angleFmt, 'dms');
    assert.equal(s.map.get('astroweb-angle-fmt'), 'dms');
    setPref('lotsOpts', { valensMoon: true, ptolemyFortune: false, valensBasis: false, valensErosNec: false });
    assert.equal(lotsOpts.valensMoon, true);
    assert.equal(JSON.parse(s.map.get('trigon.lots.v1')).valensMoon, true);
    assert.throws(() => setPref('nope', 1), /unknown preference/);
  });
});
