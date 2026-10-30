// Ratchet test for meta-as-data: the session stores the stamp text,
// never markup; the meta line HTML is built in render from the stamp,
// the chart input, and the engine. The live tick patches only the
// visible span, so no markup regex patch may come back.
//
// The builder itself lives in meta.js and is executed here (the
// previous version only sliced app.js source, which never ran it);
// the jsdom rendering tests in ui-meta.test.js cover its visible output.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMetaHTML } from '../meta.js';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store.js', import.meta.url), 'utf8');
const inp = { gregorian: true, lat: 33.4484, lon: -112.074, bce: false };

describe('meta as data', () => {
  it('the store holds the stamp text, not markup', () => {
    assert.ok(store.includes('metaStamp:'), 'S must carry metaStamp');
    assert.ok(!store.includes('meta:'), 'S must not carry a meta HTML field');
    assert.ok(store.includes('meta line HTML is built in render'), 'typedef must state the contract');
  });
  it('render builds the meta line from stamp, input, and engine', () => {
    const h = buildMetaHTML({ metaStamp: '2026-01-01 12:00', inp, useSwiss: true });
    assert.ok(h.includes('<span id="meta-stamp">UTC 2026-01-01 12:00</span>'));
    assert.ok(h.includes('Gregorian calendar'));
    assert.ok(h.includes('Swiss Ephemeris (JPL-based .se1 files)'));
    assert.ok(buildMetaHTML({ metaStamp: 'x', inp: { ...inp, gregorian: false, bce: true }, useSwiss: false })
      .includes('Moshier analytic ephemeris (approximate)'));
    assert.ok(app.includes('buildMetaHTMLForRender()'), 'renderResults must use the meta builder');
    assert.ok(app.includes("from './meta.js'"), 'app.js must import the meta builder');
  });
  it('no markup patching of stored meta remains', () => {
    assert.ok(!app.includes('S.meta.replace'), 'the meta regex patch must not remain');
    assert.ok(!/S\.meta(?!Stamp)/.test(app), 'no S.meta reference may remain');
  });
});
