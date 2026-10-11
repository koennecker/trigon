// search-worker.js — parallel search worker.
//
// Runs one time-slice of an aspect or ingress search on its own WASM
// instance (own ephemeris files, loaded from the shared IndexedDB cache),
// so N workers scan N slices of the range on N cores. The main thread
// splits the range with splitRange(), aggregates progress, and merges
// with mergeTimedResults(). The pure scan cores (search.js) are shared
// verbatim with the main-thread path; root refinement converges to the
// same values from any bracket, and the bracket-detection guarantee is
// grid-phase independent, so slicing changes nothing semantically.
//
// Message in:  { id, kind: 'aspects'|'ingresses', gridFrom, fromExclusive,
//                jd1, stepDays, mask, useSwiss, bodies, targetDegs, conds }
// Message out: { type: 'progress', id, f }
//              { type: 'done', id, results, totalFound, calls }
//              { type: 'error', id, message, httpStatus }
import { createEpheClient, ephProvider, eclipseAtSyzygy } from './ephe.js';
import { aspectRoots, ingressRoots, evaluateConditions, explainConditions } from './search.js';

self.onmessage = async e => {
  const m = e.data;
  const post = o => self.postMessage(o);
  try {
    const client = createEpheClient({});
    const mod = await client.ensureWasm(() => {});
    await client.ensureSearchFiles(mod, m.useSwiss, m.gridFrom, m.jd1, () => {}, null);
    const eph = ephProvider(mod, m.useSwiss, m.mask);

    // Coarse grid over this worker's slice (seeded one step early by the
    // caller for non-first chunks; roots at or before fromExclusive are
    // the previous chunk's property and are dropped below).
    const n = Math.max(1, Math.ceil((m.jd1 - m.gridFrom) / m.stepDays));
    const grid = [];
    let lastF = -1;
    const prog = f => {
      if (f - lastF >= 0.05 || f >= 1) { lastF = f; post({ type: 'progress', id: m.id, f }); }
    };
    for (let k = 0; k <= n; k++) {
      const jd = k === n ? m.jd1 : m.gridFrom + k * m.stepDays;
      const s = eph(jd);
      grid.push({ jd, lon: s.lon, spd: s.spd });
      prog(0.85 * k / n);
    }

    let results = [];
    let totalFound = 0;
    if (m.kind === 'aspects') {
      const pairs = [];
      for (let i = 0; i < m.bodies.length; i++)
        for (let j = i + 1; j < m.bodies.length; j++) pairs.push([m.bodies[i], m.bodies[j]]);
      const total = Math.max(1, pairs.length * m.targetDegs.length);
      let done = 0;
      for (const [ia, ib] of pairs) {
        for (const deg of m.targetDegs) {
          for (const jd of aspectRoots(grid, eph, ia, ib, deg)) {
            if (jd <= m.fromExclusive) continue;
            const s = eph(jd);
            totalFound++;
            if (m.conds.length && !evaluateConditions(m.conds, s, ia, ib)) continue;
            const r = { jd, ia, ib, deg, lonA: s.lon[ia], lonB: s.lon[ib] };
            if (m.conds.length) r.condText = explainConditions(m.conds, s, ia, ib);
            if (ia === 0 && ib === 1 && (deg === 0 || deg === 180))
              r.eclipse = eclipseAtSyzygy(mod, jd, deg === 180, m.useSwiss);
            results.push(r);
          }
          done++;
          prog(0.85 + 0.15 * done / total);
        }
      }
    } else if (m.kind === 'ingresses') {
      const total = Math.max(1, m.bodies.length);
      for (let p = 0; p < m.bodies.length; p++) {
        results.push(...ingressRoots(grid, eph, m.bodies[p])
          .filter(r => r.jd > m.fromExclusive));
        prog(0.85 + 0.15 * (p + 1) / total);
      }
    }
    const calls = eph.calls();
    eph.free();
    post({ type: 'done', id: m.id, results, totalFound, calls });
  } catch (err) {
    post({
      type: 'error', id: m.id,
      message: String((err && err.message) || err),
      httpStatus: (err && err.httpStatus) || undefined,
    });
  }
};
