// store.js — chart session state and persisted preferences: the single
// home for both, and the single write path for both.
//
// Two state kinds live here:
//   - S, the chart session: the last computation and its inputs.
//     Written by run() and its render path through update(); every other
//     module reads. update() merges a patch, records which keys actually
//     changed, and notifies subscribers of those keys synchronously, so
//     a section that depends on one key (the catalog on syzygyLon)
//     refreshes from the dependency, not from an imperative call at the
//     producer. Render calls themselves stay explicit: run() renders
//     once at the end, never per write, so a half-written session is
//     never rendered.
//   - Preferences (angle format, glyphs, angle size, station-time mode,
//     lot options, catalog selection, decan method): exported live
//     bindings, loaded once by initPrefs(storage) and written only by
//     setPref(), which writes the binding and persists it together, so
//     the two can never drift apart. Readers import the bindings and
//     see every write; writers cannot assign them directly (an imported
//     binding is read-only outside this module).
// Factory-owned state (search tabs, outer wheels, chart style, datetime
// groups, location, clock, animation, loader) stays in its factory; the
// sky view keeps its own loop and reads the session only through the
// getEphemeris callback.

import {
  readAngleFmt, writeAngleFmt, readGlyphsPref, writeGlyphsPref,
  readAngleMode, writeAngleMode, readStationTime, writeStationTime,
} from './format.js';
import {
  readLotOptions, writeLotOptions, readCatalogSelection, writeCatalogSelection,
} from './lots.js';
import { readDignityOpts, writeDignityOpts } from './dignities.js';

/**
 * The chart session: one computation and its inputs.
 * @typedef {object} SessionState
 * @property {number[]|null} out last computed ephemeris output (null before the first run)
 * @property {string} metaStamp chart stamp text (fmtInstant output, without the 'UTC ' prefix); the meta line HTML is built in render from this plus inp and useSwiss
 * @property {number|null} instantMs chart instant, ms since the Unix epoch (UTC)
 * @property {object|null} inp last chart input ({y, mo, d, hourUT, lat, lon, utcMs, bce, gregorian})
 * @property {Array<{out: number[], utcMs: number, label: string}>} outerOuts computed outer wheels
 * @property {object|null} mod loaded ephemeris module handle
 * @property {boolean} useSwiss engine of the last run (true = Swiss files, false = Moshier)
 * @property {number|null} syzygyLon prenatal syzygy longitude, degrees
 */

/** @type {SessionState} */
export const S = {
  out: null, metaStamp: '', instantMs: null, inp: null, outerOuts: [],
  mod: null, useSwiss: true, syzygyLon: null,
};

/**
 * @callback StoreSubscriber
 * @param {SessionState} state the session after the patch
 * @param {string[]} changed keys that actually changed
 * @returns {void}
 */

/** @type {Array<{keys: Set<string>, fn: StoreSubscriber}>} */
const subscribers = [];

/**
 * Call fn synchronously whenever any of keys changes. Returns an
 * unsubscribe function.
 * @param {string[]} keys session keys to watch
 * @param {StoreSubscriber} fn subscriber
 * @returns {() => void} unsubscribe
 */
export function subscribe(keys, fn) {
  const sub = { keys: new Set(keys), fn };
  subscribers.push(sub);
  return () => {
    const i = subscribers.indexOf(sub);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

/**
 * Merge patch into S and notify subscribers of the keys that actually
 * changed (identity comparison). A key written with its current value
 * counts as unchanged and notifies nobody. Returns the changed keys.
 * @param {Partial<SessionState>} patch fields to write
 * @returns {string[]} keys that changed
 */
export function update(patch) {
  const changed = [];
  for (const k of Object.keys(patch)) {
    if (S[k] !== patch[k]) {
      S[k] = patch[k];
      changed.push(k);
    }
  }
  if (!changed.length) return changed;
  for (const sub of subscribers) {
    if (changed.some(k => sub.keys.has(k))) sub.fn(S, changed);
  }
  return changed;
}

/**
 * Storage handle shape the preference readers/writers accept.
 * @typedef {object} StorageHandle
 * @property {(key: string) => (string|null)} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/** @type {StorageHandle|null} */
let prefStorage = null;

/** Angle display format: 'dms' (12°34′56″) or 'dec' (12.5822°). @type {'dms'|'dec'} */
export let angleFmt = 'dms';
/** Table display: glyphs instead of names. @type {boolean} */
export let glyphsOn = false;
/** Angle size: full or compact. @type {'full'|'compact'} */
export let angleMode = 'full';
/** Station time display: absolute datetime or relative to the chart instant. @type {'absolute'|'relative'} */
export let stationTime = 'absolute';
/** Hermetic-lot tradition variants. @type {import('./lots.js').LotOptions} */
export let lotsOpts = { valensMoon: false, ptolemyFortune: false, valensBasis: false, valensErosNec: false };
/** Hellenistic catalog: displayed attested-name ids. @type {string[]} */
export let catalogSelection = [];
/** Decan method for dignity columns and the lordship deep dive. @type {{decan: 'chaldean'|'indian'}} */
export let digOpts = { decan: 'chaldean' };

/**
 * Load every preference from storage. Called once, before any reader
 * runs; the exported bindings carry the loaded values from then on.
 * @param {StorageHandle} storage storage handle (localStorage in the browser)
 * @returns {void}
 */
export function initPrefs(storage) {
  prefStorage = storage;
  angleFmt = readAngleFmt(storage);
  glyphsOn = readGlyphsPref(storage);
  angleMode = readAngleMode(storage);
  stationTime = readStationTime(storage);
  lotsOpts = readLotOptions(storage);
  catalogSelection = readCatalogSelection(storage);
  // readDignityOpts coerces to 'chaldean' unless the stored value is
  // exactly 'indian', so its inferred string return is this union.
  digOpts = /** @type {{decan: 'chaldean'|'indian'}} */ (readDignityOpts(storage));
}

/**
 * Preference keys and the value each takes: angleFmt 'dms'|'dec';
 * angleMode 'full'|'compact'; glyphsOn boolean; stationTime
 * 'absolute'|'relative'; lotsOpts LotOptions; catalogSelection
 * string[]; digOpts {decan}. The single write path for preferences:
 * writes the binding and persists it together. Callers still choose
 * the refresh explicitly (full render, section refresh, or none),
 * because the right refresh differs per preference. Values are not
 * validated here; callers validate before writing, as before.
 * @typedef {'angleFmt'|'angleMode'|'glyphsOn'|'stationTime'|'lotsOpts'|'catalogSelection'|'digOpts'} PrefKey
 * @param {PrefKey} key preference to write
 * @param {*} value new value for the key
 * @returns {void}
 */
export function setPref(key, value) {
  if (!prefStorage) throw new Error('setPref before initPrefs');
  switch (key) {
    case 'angleFmt': angleFmt = value; writeAngleFmt(prefStorage, value); break;
    case 'angleMode': angleMode = value; writeAngleMode(prefStorage, value); break;
    case 'glyphsOn': glyphsOn = value; writeGlyphsPref(prefStorage, value); break;
    case 'stationTime': stationTime = value; writeStationTime(prefStorage, value); break;
    case 'lotsOpts': lotsOpts = value; writeLotOptions(prefStorage, value); break;
    case 'catalogSelection': catalogSelection = value; writeCatalogSelection(prefStorage, value); break;
    case 'digOpts': digOpts = value; writeDignityOpts(prefStorage, value); break;
    default: throw new Error(`unknown preference: ${key}`);
  }
}
