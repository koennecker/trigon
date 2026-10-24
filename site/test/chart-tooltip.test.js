// Tests for chart-tooltip.js — tooltip display mechanics.
// Run: node --test test/chart-tooltip.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escHTML, tipPosition, tooltipHTML } from '../chart-tooltip.js';

describe('escHTML', () => {
  it('escapes the five HTML-significant characters', () => {
    assert.equal(escHTML('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
  it('passes plain text and stringifies non-strings', () => {
    assert.equal(escHTML('Leo 3°15′'), 'Leo 3°15′');
    assert.equal(escHTML(42), '42');
  });
});

describe('tipPosition', () => {
  // Panel 800x600 at rect origin (100, 50); tooltip 200x100.
  const pos = (cx, cy) => tipPosition(cx, cy, 100, 50, 200, 100, 800, 600);
  it('offsets down-right from the cursor when it fits', () => {
    assert.deepEqual(pos(200, 150), { x: 114, y: 114 });
  });
  it('flips left when the tooltip would overflow the right edge', () => {
    // x would be 714; 714+200 > 796 -> flip to 710-200-10 = 500... in panel coords:
    const p = pos(810, 150); // clientX-rel = 710 -> flipped: 710-200-10
    assert.equal(p.x, 500);
    assert.equal(p.y, 114);
  });
  it('flips up when the tooltip would overflow the bottom edge', () => {
    const p = pos(200, 620); // rel y = 570+14=584; 584+100 > 596 -> 570-100-10
    assert.equal(p.y, 460);
  });
  it('never positions negative', () => {
    const p = tipPosition(0, 0, 500, 500, 200, 100, 800, 600);
    assert.ok(p.x >= 0 && p.y >= 0);
  });
});

describe('tooltipHTML', () => {
  const data = {
    name: 'Mercury', color: '#79c0ff', wheel: 0,
    fields: [
      { label: 'Longitude', value: 'Libra 5°00′' },
      { label: 'Domicile', value: 'Venus', color: '#e3b341' },
    ],
  };
  it('renders the colored head and field rows', () => {
    const h = tooltipHTML(data);
    assert.ok(h.includes('<div class="ct-head" style="color:#79c0ff">Mercury</div>'));
    assert.ok(h.includes('<span class="ct-k">Longitude</span><span class="ct-v">Libra 5°00′</span>'));
    assert.ok(h.includes('<span class="ct-v" style="color:#e3b341">Venus</span>'));
  });
  it('outer wheels get the wheel suffix in the head', () => {
    assert.match(tooltipHTML({ ...data, wheel: 2 }), />Mercury · wheel 2</);
  });
  it('escapes names, labels, and values', () => {
    const h = tooltipHTML({ name: '<X>', color: '#fff', wheel: 0, fields: [{ label: 'a<b', value: 'c>d' }] });
    assert.ok(!h.includes('<X>'));
    assert.ok(h.includes('&lt;X&gt;'));
    assert.ok(h.includes('a&lt;b'));
    assert.ok(h.includes('c&gt;d'));
  });
});

describe('tooltipHTML aspects section', () => {
  const base = {
    name: 'Sun', color: '#58a6ff', wheel: 0,
    fields: [{ label: 'Longitude', value: 'Aries 0°00′' }],
  };
  it('lists aspects at the bottom when present', () => {
    const h = tooltipHTML({ ...base, aspects: [
      { glyph: '☍', partner: 'Moon', color: '#ff7b72', name: 'opposition', orb: 1.234 },
    ] });
    assert.ok(h.includes('<div class="ct-aspects">'));
    assert.ok(h.includes('☍ Moon'));
    assert.ok(h.includes('opposition · orb 1.23°'));
    assert.ok(h.indexOf('ct-aspects') > h.indexOf('Longitude'));
  });

  it('omits the section when there are no aspects', () => {
    assert.ok(!tooltipHTML(base).includes('ct-aspects'));
    assert.ok(!tooltipHTML({ ...base, aspects: [] }).includes('ct-aspects'));
  });

  it('escapes aspect partner names', () => {
    const h = tooltipHTML({ ...base, aspects: [
      { glyph: '☌', partner: '<X>', color: '#fff', name: 'conjunction', orb: 0 },
    ] });
    assert.ok(!h.includes('<X>'));
    assert.ok(h.includes('&lt;X&gt;'));
  });
});
