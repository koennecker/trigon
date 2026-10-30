// meta.js — the results-head meta line, as a pure builder.
//
// The stamp text lives in the session store (store.js metaStamp);
// the markup is built in render from that stamp, the chart input,
// and the engine, never stored as markup. This module holds that
// builder so it executes in node/jsdom tests; app.js renders
// through it unchanged.
export function buildMetaHTML({ metaStamp, inp, useSwiss } = {}) {
  if (!inp) return '';
  return `<span id="meta-stamp">UTC ${metaStamp}</span> \u00B7 `
    + `${inp.gregorian ? 'Gregorian' : 'Julian'} calendar \u00B7 `
    + `${inp.lat.toFixed(4)}\u00B0 ${inp.lat >= 0 ? 'N' : 'S'}, ${Math.abs(inp.lon).toFixed(4)}\u00B0 ${inp.lon >= 0 ? 'E' : 'W'} \u00B7 `
    + (inp.bce ? 'local mean time \u00B7 ' : '')
    + (useSwiss ? 'Swiss Ephemeris (JPL-based .se1 files)' : 'Moshier analytic ephemeris (approximate)');
}
