// Tests for outer-wheels.js — outer chart wheel panels + animation target.
// Run: node --test test/outer-wheels.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  msToLocalInputValue, localInputValueToMs, clampAnimTarget,
  outerPanelHTML, createOuterWheels,
} from '../outer-wheels.js';

describe('msToLocalInputValue / localInputValueToMs', () => {
  it('round-trips a UTC instant at minute precision', () => {
    const ms = Date.UTC(2026, 9, 22, 15, 5);
    assert.equal(msToLocalInputValue(ms), '2026-10-22T15:05');
    assert.equal(localInputValueToMs('2026-10-22T15:05'), ms);
  });
  it('zero-pads every field', () => {
    assert.equal(msToLocalInputValue(Date.UTC(2001, 0, 2, 3, 4)), '2001-01-02T03:04');
  });
  it('empty and garbage values parse to NaN', () => {
    assert.ok(Number.isNaN(localInputValueToMs('')));
    assert.ok(Number.isNaN(localInputValueToMs('not-a-date')));
  });
});

describe('clampAnimTarget', () => {
  it('keeps targets within the wheels that exist', () => {
    assert.equal(clampAnimTarget(0, 0), 0);
    assert.equal(clampAnimTarget(2, 3), 2);
    assert.equal(clampAnimTarget(3, 2), 0);
    assert.equal(clampAnimTarget(1, 0), 0);
  });
});

describe('outerPanelHTML', () => {
  it('renders datetime, label, and remove button for the wheel index', () => {
    const h = outerPanelHTML(1, { utcMs: Date.UTC(2026, 0, 15, 8, 30), label: 'Transits' });
    assert.match(h, /Outer wheel 2/);
    assert.ok(h.includes('value="2026-01-15T08:30"'));
    assert.ok(h.includes('value="Transits"'));
    assert.ok(h.includes('data-idx="1"'));
  });
  it('escapes quotes in the label', () => {
    const h = outerPanelHTML(0, { utcMs: 0, label: 'a"b' });
    assert.ok(h.includes('value="a&quot;b"'));
    assert.ok(!h.includes('value="a"b"'));
  });
});

describe('createOuterWheels state', () => {
  // el: () => null makes the DOM renders no-ops; state paths still run.
  const api = () => createOuterWheels({
    el: () => null, rootInstantMs: () => null,
    panels: () => [], panelInput: () => null, rootRadio: () => null,
  });
  it('setWheels/list round-trips with label defaults', () => {
    const o = api();
    o.setWheels([{ utcMs: 1000, label: 'A' }, { utcMs: 2000 }]);
    assert.deepEqual(o.list(), [{ utcMs: 1000, label: 'A' }, { utcMs: 2000, label: '' }]);
  });
  it('list returns copies, not live state', () => {
    const o = api();
    o.setWheels([{ utcMs: 1000, label: 'A' }]);
    o.list()[0].utcMs = -1;
    assert.equal(o.list()[0].utcMs, 1000);
  });
  it('setWheelMs updates state and ignores unknown indexes', () => {
    const o = api();
    o.setWheels([{ utcMs: 1000, label: '' }]);
    o.setWheelMs(0, 5000);
    assert.equal(o.list()[0].utcMs, 5000);
    o.setWheelMs(9, 1); // no throw, no change
    assert.equal(o.list().length, 1);
  });
  it('the target starts at the root chart', () => {
    assert.equal(api().getTarget(), 0);
  });
});

describe('readPanels (via env panels)', () => {
  const fakePanel = (idx, dt, label) => ({
    dataset: { idx: String(idx) },
    querySelector: sel => (sel === '.outer-dt' ? { value: dt } : { value: label }),
  });
  it('scrapes datetimes and labels, defaulting blank labels', () => {
    const o = createOuterWheels({
      el: () => null, rootInstantMs: () => null,
      panels: () => [fakePanel(0, '2026-01-15T08:30', ' Transits '), fakePanel(1, '2026-02-01T00:00', '')],
      panelInput: () => null, rootRadio: () => null,
    });
    assert.deepEqual(o.readPanels(), [
      { utcMs: Date.UTC(2026, 0, 15, 8, 30), label: 'Transits' },
      { utcMs: Date.UTC(2026, 1, 1, 0, 0), label: 'Wheel 2' },
    ]);
  });
  it('throws on an invalid datetime', () => {
    const o = createOuterWheels({
      el: () => null, rootInstantMs: () => null,
      panels: () => [fakePanel(0, '', 'x')],
      panelInput: () => null, rootRadio: () => null,
    });
    assert.throws(() => o.readPanels(), /outer wheel 1: invalid date\/time/);
  });
});
