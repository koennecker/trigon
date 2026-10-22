// Tests for datetime-groups.js — date/time field groups.
// Run: node --test test/datetime-groups.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RANGE_PAIRS, GROUP_PREFIXES, sanitizeGroupDT, createDateTimeGroups,
} from '../datetime-groups.js';

// Fake field store: Map of id -> {value, events, dispatchEvent}.
function fakeFields() {
  const m = new Map();
  const el = id => {
    if (!m.has(id)) m.set(id, {
      value: '', events: [],
      dispatchEvent(e) { this.events.push(e.type); return true; },
      addEventListener() {},
    });
    return m.get(id);
  };
  const set = (p, f) => {
    el(`${p}-y`).value = String(f.yy);
    el(`${p}-era`).value = f.era || 'ce';
    el(`${p}-mo`).value = String(f.mo);
    el(`${p}-d`).value = String(f.d);
    el(`${p}-h`).value = String(f.hh || 0);
    el(`${p}-mi`).value = String(f.mi || 0);
    if (f.ss != null) el(`${p}-s`).value = String(f.ss);
  };
  return { el, set, raw: m };
}

const api = (fields, extra = {}) => createDateTimeGroups({
  el: fields.el,
  openPicker: extra.openPicker || (() => {}),
  attach: extra.attach || (() => ({ refresh() {} })),
  now: () => new Date(2026, 5, 15, 12, 0, 0),
});

describe('sanitizeGroupDT', () => {
  it('clamps fields to their domains and the day to the month', () => {
    const v = sanitizeGroupDT({ y: 2026, mo: 13, d: 40, hh: 25, mi: 99, ss: -3 }, 2000);
    assert.deepEqual(v, { y: 2026, mo: 12, d: 31, hh: 23, mi: 59, ss: 0 });
  });
  it('Feb 29 clamps to Feb 28 in a non-leap year', () => {
    assert.equal(sanitizeGroupDT({ y: 2025, mo: 2, d: 29, hh: 0, mi: 0, ss: 0 }, 2000).d, 28);
    assert.equal(sanitizeGroupDT({ y: 2024, mo: 2, d: 29, hh: 0, mi: 0, ss: 0 }, 2000).d, 29);
  });
  it('the cutover gap snaps back to Oct 4', () => {
    assert.equal(sanitizeGroupDT({ y: 1582, mo: 10, d: 10, hh: 0, mi: 0, ss: 0 }, 2000).d, 4);
  });
  it('non-finite fields fall back', () => {
    const v = sanitizeGroupDT({ y: NaN, mo: NaN, d: NaN, hh: NaN, mi: NaN, ss: NaN }, 1999);
    assert.deepEqual(v, { y: 1999, mo: 1, d: 1, hh: 0, mi: 0, ss: 0 });
  });
  it('clamps the year to the supported range', () => {
    assert.equal(sanitizeGroupDT({ y: 99999, mo: 1, d: 1, hh: 0, mi: 0, ss: 0 }, 2000).y, 9999);
    assert.equal(sanitizeGroupDT({ y: -99999, mo: 1, d: 1, hh: 0, mi: 0, ss: 0 }, 2000).y, -12998);
  });
});

describe('readDateFields', () => {
  it('reads a CE group with seconds', () => {
    const f = fakeFields();
    f.set('dt', { yy: 2026, mo: 9, d: 28, hh: 14, mi: 30, ss: 5 });
    assert.deepEqual(api(f).readDateFields('dt', true),
      { y: 2026, mo: 9, d: 28, hh: 14, mi: 30, ss: 5 });
  });
  it('converts BCE years to astronomical years', () => {
    const f = fakeFields();
    f.set('dt', { yy: 63, era: 'bce', mo: 9, d: 23, hh: 5, mi: 40, ss: 0 });
    assert.equal(api(f).readDateFields('dt', true).y, -62);
  });
  it('rejects incomplete fields, bad months, and the cutover gap', () => {
    const f = fakeFields();
    const g = api(f);
    f.set('dt', { yy: '', mo: 9, d: 28, hh: 0, mi: 0, ss: 0 });
    assert.throws(() => g.readDateFields('dt', true), /year is incomplete/);
    f.set('dt', { yy: 2026, mo: 13, d: 1, hh: 0, mi: 0, ss: 0 });
    assert.throws(() => g.readDateFields('dt', true), /month must be 1-12/);
    f.set('dt', { yy: 1582, mo: 10, d: 10, hh: 0, mi: 0, ss: 0 });
    assert.throws(() => g.readDateFields('dt', true), /never existed/);
    f.set('dt', { yy: 2026, mo: 2, d: 30, hh: 0, mi: 0, ss: 0 });
    assert.throws(() => g.readDateFields('dt', true), /day is out of range/);
  });
});

describe('groupValue / writeDateFields round-trip', () => {
  it('write then read returns the same struct', () => {
    const f = fakeFields();
    // Pre-create the seconds field so writeDateFields sees the group shape.
    f.el('dt-s');
    const g = api(f);
    g.writeDateFields('dt', { y: -62, mo: 9, d: 23, hh: 5, mi: 40, ss: 4 }, true);
    assert.deepEqual(g.groupValue('dt', true), { y: -62, mo: 9, d: 23, hh: 5, mi: 40, ss: 4 });
    assert.equal(f.el('dt-era').value, 'bce');
    assert.equal(f.el('dt-y').value, '63');
  });
  it('groupValue returns null on incomplete fields', () => {
    const f = fakeFields();
    f.set('dt', { yy: 2026, mo: '', d: 1, hh: 0, mi: 0, ss: 0 });
    assert.equal(api(f).groupValue('dt', true), null);
  });
});

describe('commitGroupDT range enforcement', () => {
  const setup = () => {
    const f = fakeFields();
    f.set('asp-start', { yy: 2026, mo: 1, d: 1, hh: 0, mi: 0 });
    f.set('asp-end', { yy: 2026, mo: 6, d: 1, hh: 0, mi: 0 });
    return { f, g: api(f) };
  };
  it('a start edit crossing the end is rejected, keeping the current value', () => {
    const { f, g } = setup();
    g.commitGroupDT('asp-start', { y: 2026, mo: 7, d: 1, hh: 0, mi: 0, ss: 0 }, false);
    assert.deepEqual(g.dateGroupValue('asp-start'), { y: 2026, mo: 1, d: 1 });
    assert.equal(f.el('asp-start-mo').events.length, 0);
  });
  it('an in-range edit commits and dispatches change', () => {
    const { f, g } = setup();
    g.commitGroupDT('asp-start', { y: 2026, mo: 3, d: 1, hh: 0, mi: 0, ss: 0 }, false);
    assert.deepEqual(g.dateGroupValue('asp-start'), { y: 2026, mo: 3, d: 1 });
    assert.ok(f.el('asp-start-mo').events.includes('change'));
  });
  it('an already-invalid group is pulled back into range instead', () => {
    const { f, g } = setup();
    f.set('asp-start', { yy: 2026, mo: 9, d: 1, hh: 0, mi: 0 }); // start past end already
    g.commitGroupDT('asp-start', { y: 2026, mo: 10, d: 1, hh: 0, mi: 0, ss: 0 }, false);
    assert.deepEqual(g.dateGroupValue('asp-start'), { y: 2026, mo: 6, d: 1 }); // clamped to end
  });
});

describe('enforceRangePair', () => {
  it('the other side follows when start passes end', () => {
    const f = fakeFields();
    f.set('stn-start', { yy: 2026, mo: 5, d: 1, hh: 0, mi: 0 });
    f.set('stn-end', { yy: 2026, mo: 3, d: 1, hh: 0, mi: 0 });
    api(f).enforceRangePair('stn-start');
    assert.deepEqual(api(f).dateGroupValue('stn-end'), { y: 2026, mo: 5, d: 1 });
  });
  it('leaves ordered and unrelated groups alone', () => {
    const f = fakeFields();
    f.set('ing-start', { yy: 2026, mo: 1, d: 1, hh: 0, mi: 0 });
    f.set('ing-end', { yy: 2026, mo: 3, d: 1, hh: 0, mi: 0 });
    const g = api(f);
    g.enforceRangePair('ing-start');
    assert.deepEqual(g.dateGroupValue('ing-end'), { y: 2026, mo: 3, d: 1 });
    assert.equal(RANGE_PAIRS.length, 3);
    assert.equal(GROUP_PREFIXES.length, 7);
  });
});

describe('pickerBounds', () => {
  it('start is bounded above by end, end below by start, dt unbounded', () => {
    const f = fakeFields();
    f.set('asp-start', { yy: 2026, mo: 1, d: 1, hh: 0, mi: 0 });
    f.set('asp-end', { yy: 2026, mo: 6, d: 1, hh: 0, mi: 0 });
    const g = api(f);
    assert.deepEqual(g.pickerBounds('asp-start'), { min: null, max: { y: 2026, mo: 6, d: 1 } });
    assert.deepEqual(g.pickerBounds('asp-end'), { min: { y: 2026, mo: 1, d: 1 }, max: null });
    assert.deepEqual(g.pickerBounds('dt'), { min: null, max: null });
  });
});
