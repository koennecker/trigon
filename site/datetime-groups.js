// datetime-groups.js — hand-rolled date/time field groups.
//
// BCE-capable (the native datetime-local picker cannot represent years
// before 0001). Group `p` is the hidden inputs p-y, p-era, p-mo, p-d,
// p-h, p-mi, plus p-s when the group carries seconds; one unified
// typable text field (datetime.js) sits on top, committing through
// this module. Years are astronomical (y = 0 is 1 BCE).
//
// The factory owns the per-group widget registry and all field
// reads/writes, range-pair enforcement, and picker bounds. Field access
// goes through the injected env so the logic is node-testable.

import {
  BCE_MIN_ASTRO, CE_MAX_YEAR, eraToAstro, astroToEra, checkYearRange,
  validDate, daysInMonth, cmpDate,
} from './dateapi.js';
import { clampDT, cmpDT, dtFloor, dtCeil } from './datetime.js';

export const RANGE_PAIRS = [['asp-start', 'asp-end'], ['stn-start', 'stn-end'], ['ing-start', 'ing-end']];
export const GROUP_PREFIXES = ['dt', 'asp-start', 'asp-end', 'stn-start', 'stn-end', 'ing-start', 'ing-end'];

/**
 * Sanitize a datetime struct into the global range: non-finite fields
 * fall back, fields clamp to their domains, the day clamps to the
 * month, the 1582 cutover gap snaps back to Oct 4, and the result is
 * clamped to [dtFloor, dtCeil]. Pure.
 */
export function sanitizeGroupDT(f, fallbackYear) {
  const v = { ...f };
  v.y = Number.isFinite(v.y) ? Math.trunc(v.y) : fallbackYear;
  v.y = Math.max(BCE_MIN_ASTRO, Math.min(CE_MAX_YEAR, v.y));
  v.mo = Number.isFinite(v.mo) ? Math.max(1, Math.min(12, Math.trunc(v.mo))) : 1;
  v.hh = Number.isFinite(v.hh) ? Math.max(0, Math.min(23, Math.trunc(v.hh))) : 0;
  v.mi = Number.isFinite(v.mi) ? Math.max(0, Math.min(59, Math.trunc(v.mi))) : 0;
  v.ss = Number.isFinite(v.ss) ? Math.max(0, Math.min(59, Math.trunc(v.ss))) : 0;
  v.d = Number.isFinite(v.d) ? Math.trunc(v.d) : 1;
  v.d = Math.max(1, Math.min(v.d, daysInMonth(v.y, v.mo)));
  if (v.y === 1582 && v.mo === 10 && v.d >= 5 && v.d <= 14) v.d = 4;
  return clampDT(v, dtFloor(), dtCeil());
}

/**
 * @param {object} env
 * @param {(id: string) => object|null} env.el  element lookup by id
 * @param {(input: object, opts: object) => void} env.openPicker  popup calendar
 * @param {(input: object, opts: object) => {refresh: Function}} env.attach  unified text input
 * @param {() => Date} [env.now]
 */
export function createDateTimeGroups(env) {
  const now = env.now || (() => new Date());
  const $ = env.el;
  const dtInputs = {}; // p -> attachDateTime api

  function readDateFields(p, seconds) {
    const num = (id, label) => {
      const v = $(id).value.trim();
      if (!/^-?\d+$/.test(v)) throw new Error(`${label} is incomplete`);
      return parseInt(v, 10);
    };
    const y = eraToAstro(num(`${p}-y`, 'year'), $(`${p}-era`).value);
    checkYearRange(y);
    const mo = num(`${p}-mo`, 'month'), d = num(`${p}-d`, 'day');
    const hh = num(`${p}-h`, 'hour'), mi = num(`${p}-mi`, 'minute');
    const ss = seconds ? num(`${p}-s`, 'second') : 0;
    if (mo < 1 || mo > 12) throw new Error('month must be 1-12');
    if (hh < 0 || hh > 23 || mi < 0 || mi > 59 || ss < 0 || ss > 59)
      throw new Error(seconds ? 'time must be 00:00:00-23:59:59' : 'time must be 00:00-23:59');
    if (!validDate(y, mo, d)) {
      // The cutover gap gets its own message: those dates never existed.
      if (y === 1582 && mo === 10 && d >= 5 && d <= 14)
        throw new Error('1582-10-05 through 1582-10-14 never existed (Julian-to-Gregorian cutover)');
      throw new Error('day is out of range for that month');
    }
    return { y, mo, d, hh, mi, ss };
  }

  // Write back; only touches fields whose value actually changed, so the
  // live clock ticking every second doesn't fight the user mid-edit.
  function writeDateFields(p, f, seconds) {
    const { yy, era } = astroToEra(f.y);
    const set = (id, v) => { const el = $(id); v = String(v); if (el.value !== v) el.value = v; };
    set(`${p}-y`, yy);
    const eraEl = $(`${p}-era`);
    if (eraEl.value !== era) eraEl.value = era;
    set(`${p}-mo`, f.mo); set(`${p}-d`, f.d);
    set(`${p}-h`, f.hh); set(`${p}-mi`, f.mi);
    if (seconds) set(`${p}-s`, f.ss);
    refreshDTInput(p);
  }

  // Full {y, mo, d, hh, mi, ss} (astronomical y) from a group's hidden
  // inputs, or null when any field is incomplete.
  function groupValue(p, seconds) {
    const num = id => {
      const v = $(id).value.trim();
      return /^\d+$/.test(v) ? parseInt(v, 10) : null;
    };
    const yy = num(`${p}-y`), mo = num(`${p}-mo`), d = num(`${p}-d`);
    const hh = num(`${p}-h`), mi = num(`${p}-mi`);
    const ss = seconds ? num(`${p}-s`) : 0;
    const era = $(`${p}-era`).value;
    if (yy === null || mo === null || d === null ||
        hh === null || mi === null || ss === null) return null;
    try { return { y: eraToAstro(yy, era), mo, d, hh, mi, ss }; }
    catch (e) { return null; }
  }

  // {y, mo, d} (astronomical y) from a group's hidden inputs, or null.
  function dateGroupValue(p) {
    const num = id => {
      const v = $(id).value.trim();
      return /^\d+$/.test(v) ? parseInt(v, 10) : null;
    };
    const yy = num(`${p}-y`), mo = num(`${p}-mo`), d = num(`${p}-d`);
    const era = $(`${p}-era`).value;
    if (yy === null || mo === null || d === null) return null;
    try { return { y: eraToAstro(yy, era), mo, d }; }
    catch (e) { return null; }
  }

  function refreshDTInput(p) {
    const api = dtInputs[p];
    if (api) api.refresh();
  }

  // Write the canonical hidden inputs, dispatching change on each field
  // that actually changed (drives deriveTimezone and the BCE LMT note).
  function setHiddenDateTime(p, v, seconds) {
    const { yy, era } = astroToEra(v.y);
    const vals = {
      y: String(yy), era, mo: String(v.mo), d: String(v.d),
      h: String(v.hh), mi: String(v.mi),
    };
    if (seconds) vals.s = String(v.ss);
    for (const k of Object.keys(vals)) {
      const el = $(`${p}-${k}`);
      if (!el) continue;
      if (el.value !== vals[k]) {
        el.value = vals[k];
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  // Commit a datetime from the unified input or the popup time steppers:
  // sanitize into the global range, then write through. For search ranges
  // (forward-only) an edit that would cross the paired endpoint is
  // rejected outright — like the popup's disabled days/era option,
  // prevention beats clamping to the boundary.
  function commitGroupDT(p, f, seconds) {
    let v = sanitizeGroupDT(f, now().getFullYear());
    const b = pickerDTBounds(p);
    const crosses = (b.min && cmpDT(v, b.min) < 0) || (b.max && cmpDT(v, b.max) > 0);
    if (crosses) {
      const cur0 = groupValue(p, seconds);
      const wasOk = cur0 &&
        !(b.min && cmpDT(cur0, b.min) < 0) && !(b.max && cmpDT(cur0, b.max) > 0);
      if (wasOk) return; // reject the edit; keep the current value
      v = clampDT(v, b.min, b.max); // already invalid (programmatic): pull back in
    }
    setHiddenDateTime(p, v, seconds);
  }

  // Set a group's date (astronomical y), keeping its time-of-day, and
  // notify the change listeners that the old visible fields used to reach.
  function setGroupDate(p, y, mo, d) {
    const seconds = !!$(`${p}-s`);
    const cur = groupValue(p, seconds) || { hh: 0, mi: 0, ss: 0 };
    setHiddenDateTime(p, { y, mo, d, hh: cur.hh, mi: cur.mi, ss: cur.ss }, seconds);
    refreshDTInput(p);
  }

  // Searches scan forward only: the start date never passes the end date.
  // When one side moves past the other, the other side's date follows
  // (its time-of-day is kept). The pickers additionally clamp navigation
  // to [start, end], so this is the backstop for programmatic changes.
  function enforceRangePair(changed) {
    for (const [sp, ep] of RANGE_PAIRS) {
      if (changed !== sp && changed !== ep) continue;
      const s = dateGroupValue(sp), e = dateGroupValue(ep);
      if (!s || !e || cmpDate(s, e) <= 0) continue;
      const src = changed === sp ? s : e;
      setGroupDate(changed === sp ? ep : sp, src.y, src.mo, src.d);
    }
  }

  function pickerBounds(p) {
    for (const [sp, ep] of RANGE_PAIRS) {
      if (p === sp) return { min: null, max: dateGroupValue(ep) };
      if (p === ep) return { min: dateGroupValue(sp), max: null };
    }
    return { min: null, max: null }; // main chart: the global floor/ceiling
  }

  // Full-datetime bounds for the unified input's capping: the edited side
  // can never cross the paired endpoint's instant.
  function pickerDTBounds(p) {
    for (const [sp, ep] of RANGE_PAIRS) {
      if (p === sp) return { min: null, max: groupValue(ep, false) };
      if (p === ep) return { min: groupValue(sp, false), max: null };
    }
    return { min: null, max: null };
  }

  function openGroupPicker(p) {
    const seconds = p === 'dt';
    const g = groupValue(p, seconds);
    const n = now();
    const cur = g || {
      y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(),
      hh: 0, mi: 0, ss: 0,
    };
    const { min, max } = pickerBounds(p);
    const t = { hh: cur.hh, mi: cur.mi, ss: cur.ss, seconds };
    t.onTime = nt => {
      const gg = groupValue(p, seconds) || cur;
      commitGroupDT(p, { ...gg, hh: nt.hh, mi: nt.mi, ss: nt.ss }, seconds);
      // The commit may have capped at the paired endpoint: write the
      // committed values back so the steppers show the truth.
      const back = groupValue(p, seconds) || gg;
      t.hh = back.hh; t.mi = back.mi; t.ss = back.ss;
      refreshDTInput(p);
    };
    env.openPicker($(`${p}-in`), {
      value: { y: cur.y, mo: cur.mo, d: cur.d }, min, max,
      time: t,
      onPick: date => {
        setGroupDate(p, date.y, date.mo, date.d);
        enforceRangePair(p);
      },
    });
  }

  function initInputs() {
    for (const p of GROUP_PREFIXES) {
      const input = $(`${p}-in`);
      if (!input) continue;
      const seconds = p === 'dt';
      dtInputs[p] = env.attach(input, {
        seconds,
        get: () => groupValue(p, seconds),
        set: (f, seg) => commitGroupDT(p, f, seconds),
        openPicker: () => openGroupPicker(p),
      });
      $(`${p}-cal`).addEventListener('click', () => openGroupPicker(p));
      refreshDTInput(p);
    }
  }

  return {
    readDateFields, writeDateFields, groupValue, dateGroupValue,
    refreshDTInput, setHiddenDateTime, commitGroupDT, setGroupDate,
    enforceRangePair, pickerBounds, pickerDTBounds, openGroupPicker,
    initInputs,
  };
}
