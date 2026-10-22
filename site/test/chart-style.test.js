// Tests for chart-style.js — Customize-chart panel + persisted overrides.
// Run: node --test test/chart-style.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CSTYLE_KEY, styleParam, parseStyleNum, buildChartStyleHTML,
  applyStyleOverride, createChartStyle,
} from '../chart-style.js';
import { CHART_STYLE_SECTIONS, defaultChartStyle, resolveChartStyle } from '../chart.js';

const memStore = () => {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: (k, v) => m.set(k, v),
  };
};

describe('styleParam', () => {
  it('finds descriptors and misses cleanly', () => {
    const sec = CHART_STYLE_SECTIONS[0];
    assert.equal(styleParam(sec.id, sec.params[0].key), sec.params[0]);
    assert.equal(styleParam('nope', 'x'), undefined);
    assert.equal(styleParam(sec.id, 'nope'), undefined);
  });
});

describe('parseStyleNum', () => {
  it('accepts positive finite numbers', () => {
    assert.equal(parseStyleNum('12.5', false), 12.5);
    assert.equal(parseStyleNum('3', true), 3);
  });
  it('rejects zero, negatives, and non-numbers unless allowZero', () => {
    assert.equal(parseStyleNum('0', false), null);
    assert.equal(parseStyleNum('0', true), 0);
    assert.equal(parseStyleNum('-2', true), null);
    assert.equal(parseStyleNum('abc', false), null);
    assert.equal(parseStyleNum('', false), null);
    assert.equal(parseStyleNum('Infinity', false), null);
  });
});

describe('buildChartStyleHTML', () => {
  it('renders one input per parameter with resolved values', () => {
    const style = resolveChartStyle({});
    const h = buildChartStyleHTML(style);
    const nParams = CHART_STYLE_SECTIONS.reduce((n, s) => n + s.params.length, 0);
    assert.equal((h.match(/<input type="number"/g) || []).length, nParams);
    assert.match(h, /id="cs-reset"/);
    const sec = CHART_STYLE_SECTIONS[0], p = sec.params[0];
    assert.ok(h.includes(`value="${style[sec.id][p.key]}" data-sec="${sec.id}" data-key="${p.key}"`));
  });
  it('shows overridden values', () => {
    const sec = CHART_STYLE_SECTIONS[0], p = sec.params[0];
    const style = resolveChartStyle({ [sec.id]: { [p.key]: 999 } });
    assert.ok(buildChartStyleHTML(style).includes(`value="999" data-sec="${sec.id}" data-key="${p.key}"`));
  });
});

describe('applyStyleOverride', () => {
  const sec = CHART_STYLE_SECTIONS[0], p = sec.params[0];
  it('sets, prunes on return to default, and prunes empty sections', () => {
    const o = {};
    applyStyleOverride(o, sec.id, p.key, 999);
    assert.equal(o[sec.id][p.key], 999);
    applyStyleOverride(o, sec.id, p.key, defaultChartStyle()[sec.id][p.key]);
    assert.deepEqual(o, {});
  });
  it('returning to default with no section present is a no-op', () => {
    const o = {};
    applyStyleOverride(o, sec.id, p.key, defaultChartStyle()[sec.id][p.key]);
    assert.deepEqual(o, {});
  });
});

describe('createChartStyle', () => {
  it('loads persisted overrides, set persists, reset clears', () => {
    const store = memStore();
    const sec = CHART_STYLE_SECTIONS[0], p = sec.params[0];
    store._raw(CSTYLE_KEY, JSON.stringify({ [sec.id]: { [p.key]: 999 } }));
    let changes = 0;
    const api = createChartStyle({ storage: store, onChange: () => changes++ });
    assert.equal(api.style()[sec.id][p.key], 999);
    api.set(sec.id, p.key, 123);
    assert.equal(JSON.parse(store.getItem(CSTYLE_KEY))[sec.id][p.key], 123);
    assert.equal(changes, 1);
    api.reset();
    assert.equal(store.getItem(CSTYLE_KEY), null);
    assert.deepEqual(api.style(), defaultChartStyle());
    assert.equal(changes, 2);
  });
  it('survives corrupt persisted JSON', () => {
    const store = memStore();
    store._raw(CSTYLE_KEY, '{bad');
    const api = createChartStyle({ storage: store, onChange: () => {} });
    assert.deepEqual(api.style(), defaultChartStyle());
  });
  it('html reflects the current resolved style', () => {
    const api = createChartStyle({ storage: memStore(), onChange: () => {} });
    assert.match(api.html(), /class="chart-style"/);
  });
});
