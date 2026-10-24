// Tests for dom-patch.js — guarded writes and swap guards.
// Run: node --test test/dom-patch.test.js  (from site/)
// Fakes need only the three fields the module touches; a counting
// setter per field records whether a write happened.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setText, setHTML, createSwapGuard } from '../dom-patch.js';

function fakeEl() {
  let text = '', html = '', outer = '';
  const counts = { text: 0, html: 0, outer: 0 };
  const el = {};
  Object.defineProperty(el, 'textContent', {
    get: () => text, set: (v) => { text = v; counts.text++; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => html, set: (v) => { html = v; counts.html++; },
  });
  Object.defineProperty(el, 'outerHTML', {
    get: () => outer, set: (v) => { outer = v; counts.outer++; },
  });
  return { el, counts, get: () => ({ text, html, outer }) };
}

describe('setText', () => {
  it('writes on change, skips when equal, tolerates null', () => {
    const f = fakeEl();
    setText(f.el, 'a');
    assert.equal(f.get().text, 'a');
    assert.equal(f.counts.text, 1);
    setText(f.el, 'a');
    assert.equal(f.counts.text, 1);
    setText(f.el, 'b');
    assert.equal(f.counts.text, 2);
    assert.equal(f.get().text, 'b');
    setText(null, 'c');
  });
});

describe('setHTML', () => {
  it('writes on change, skips when equal, caches per element, tolerates null', () => {
    const a = fakeEl(), b = fakeEl();
    setHTML(a.el, '<i>x</i>');
    setHTML(a.el, '<i>x</i>');
    assert.equal(a.counts.html, 1);
    setHTML(b.el, '<i>x</i>');
    assert.equal(b.counts.html, 1, 'a second element has its own empty cache');
    setHTML(a.el, '<i>y</i>');
    assert.equal(a.counts.html, 2);
    assert.equal(a.get().html, '<i>y</i>');
    setHTML(null, '<i>z</i>');
  });
});

describe('createSwapGuard', () => {
  it('starts empty, so the first value counts as changed', () => {
    const g = createSwapGuard();
    assert.equal(g.changed('x'), true);
    assert.equal(g.changed(''), false);
  });
  it('applyInner swaps only on change and reports whether it swapped', () => {
    const f = fakeEl();
    const g = createSwapGuard();
    assert.equal(g.applyInner(f.el, '<p>1</p>'), true);
    assert.equal(f.counts.html, 1);
    assert.equal(g.applyInner(f.el, '<p>1</p>'), false);
    assert.equal(f.counts.html, 1);
    assert.equal(g.applyInner(f.el, '<p>2</p>'), true);
    assert.equal(f.counts.html, 2);
  });
  it('applyOuter swaps only on change; a null element never swaps or records', () => {
    const f = fakeEl();
    const g = createSwapGuard();
    assert.equal(g.applyOuter(null, '<p>1</p>'), false);
    assert.equal(g.changed('<p>1</p>'), true, 'the null attempt recorded nothing');
    assert.equal(g.applyOuter(f.el, '<p>1</p>'), true);
    assert.equal(f.counts.outer, 1);
    assert.equal(g.applyOuter(f.el, '<p>1</p>'), false);
    assert.equal(f.counts.outer, 1);
  });
  it('mark records without writing, so a wholesale rebuild is not re-swapped', () => {
    const f = fakeEl();
    const g = createSwapGuard();
    g.mark('<p>9</p>');
    assert.equal(g.changed('<p>9</p>'), false);
    assert.equal(g.applyInner(f.el, '<p>9</p>'), false);
    assert.equal(f.counts.html, 0);
  });
});
