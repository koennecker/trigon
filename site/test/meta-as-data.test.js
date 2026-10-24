// Ratchet test for meta-as-data: the session stores the stamp text,
// never markup; the meta line HTML is built in render from the stamp,
// the chart input, and the engine. The live tick patches only the
// visible span, so no markup regex patch may come back.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../store.js', import.meta.url), 'utf8');

describe('meta as data', () => {
  it('the store holds the stamp text, not markup', () => {
    assert.ok(store.includes('metaStamp:'), 'S must carry metaStamp');
    assert.ok(!store.includes('meta:'), 'S must not carry a meta HTML field');
    assert.ok(store.includes('meta line HTML is built in render'), 'typedef must state the contract');
  });
  it('render builds the meta line from stamp, input, and engine', () => {
    const fn = app.slice(app.indexOf('function buildMetaHTML()'));
    for (const frag of [
      '<span id="meta-stamp">UTC ${S.metaStamp}</span>',
      "inp.gregorian ? 'Gregorian' : 'Julian'",
      'local mean time',
      'Swiss Ephemeris (JPL-based .se1 files)',
      'Moshier analytic ephemeris (approximate)',
    ]) assert.ok(fn.includes(frag), `buildMetaHTML must contain: ${frag}`);
    assert.ok(app.includes('${buildMetaHTML()}'), 'renderResults must use buildMetaHTML');
  });
  it('no markup patching of stored meta remains', () => {
    assert.ok(!app.includes('S.meta.replace'), 'the meta regex patch must not remain');
    assert.ok(!/S\.meta(?!Stamp)/.test(app), 'no S.meta reference may remain');
  });
});
