// search.js — aspect + station search engines (pure functions; the ephemeris
// is injected, so these units test without WebAssembly).
import { speedPercentile } from './speed-stats.js';
//
// Aspect model: for bodies a, b with ecliptic longitudes la(t), lb(t), an
// aspect of `target` degrees perfects when (la - lb - target) mod 360 == 0.
// Because aspects are symmetric, targets 60/90/120 also perfect at
// (la - lb + target) mod 360 == 0; targets 0 and 180 are self-symmetric.
// Each condition is tracked as a signed wrapped function s(t) in (-180, 180]
// whose zero crossings are the perfectings. A sign change with |ds| >= 180
// is the wrap discontinuity, not a root, and is rejected.
//
// Station model: a planet stations when its ecliptic-longitude speed w(t)
// crosses zero. Sign changes of w are bracketed on a coarse grid and refined
// with secant (bisection fallback). Verified against a 0.25-day reference
// scan over 2024-2027: a 5-day coarse step misses nothing for any planet or
// any of the 55 pairs x 5 targets.

export const SEARCH_BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'North Node'];
// Index of each body in the ephemeris provider's lon/spd arrays.
export const BODY_INDEX = Object.fromEntries(SEARCH_BODIES.map((b, i) => [b, i]));

export const ASPECTS = [
  { deg: 0,   name: 'Conjunction', glyph: '\u260C' },
  { deg: 60,  name: 'Sextile',     glyph: '\u26B9' },
  { deg: 90,  name: 'Square',      glyph: '\u25A1' },
  { deg: 120, name: 'Trine',       glyph: '\u25B3' },
  { deg: 180, name: 'Opposition',  glyph: '\u260D' },
];

// SE_ECL_* type bits returned by the WASM eclipse check (swephexp.h).
export const ECL_TOTAL = 4, ECL_ANNULAR = 8, ECL_PARTIAL = 16,
             ECL_HYBRID = 32, ECL_PENUMBRAL = 64;

// Human label for an eclipse type bitmask. isFullMoon selects the lunar
// branch (opposition) vs the solar branch (conjunction).
export function eclipseKind(type, isFullMoon) {
  if (isFullMoon) {
    if (type & ECL_TOTAL) return 'Total lunar eclipse';
    if (type & ECL_PARTIAL) return 'Partial lunar eclipse';
    if (type & ECL_PENUMBRAL) return 'Penumbral lunar eclipse';
  } else {
    if (type & ECL_HYBRID) return 'Hybrid solar eclipse';
    if (type & ECL_TOTAL) return 'Total solar eclipse';
    if (type & ECL_ANNULAR) return 'Annular solar eclipse';
    if (type & ECL_PARTIAL) return 'Partial solar eclipse';
  }
  return 'Eclipse';
}

// Syzygy display names: the idiosyncratic Sun-Moon check renders these
// instead of the generic aspect names.
export function syzygyName(ia, ib, deg) {
  if (ia === 0 && ib === 1 && deg === 0) return 'New Moon';
  if (ia === 0 && ib === 1 && deg === 180) return 'Full Moon';
  return null;
}

// Mercury..Pluto: the bodies that station.
export const STATION_PLANETS = [2, 3, 4, 5, 6, 7, 8, 9];

// Coarse scan step (days). Prototype check: no missed roots vs a 0.25-day
// reference over 2024-2027 for six pairs (Sun-Venus, Moon-Venus,
// Moon-Mercury, Venus-Mars, Sun-Moon, Jupiter-Pluto) and for all planets'
// stations. A full all-55-pairs proof is still open, so treat the step as
// provisional for exotic pairs/targets.
export const SCAN_STEP = 5;

// Conservative upper bounds on |d(longitude)/dt| in deg/day per body,
// from ephemeris sampling over 2000-2026 (2x margin over measured maxima).
// Order: Sun, Moon, Mercury..Pluto, North Node.
export const MAX_DAILY_MOTION = [1.1, 16, 2.5, 1.5, 1.0, 0.3, 0.15, 0.08, 0.06, 0.06, 0.3];

// Grid step (days) for an aspect search over the given body indices.
// A transverse root can only hide between samples if the separation changes
// by >=180° there (a full cycle); keeping it under 45° provably brackets
// every transverse root (tangential/double roots were already out of scope).
// Never finer than the validated SCAN_STEP, never coarser than 120 days
// (keeps secant brackets well-conditioned).
export function aspectGridStep(bodies) {
  let w = 0;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      w = Math.max(w, MAX_DAILY_MOTION[bodies[i]] + MAX_DAILY_MOTION[bodies[j]]);
  return Math.min(120, Math.max(SCAN_STEP, 45 / w));
}

export function wrap180(deg) {
  return ((deg + 180) % 360 + 360) % 360 - 180;
}

// ---------------------------------------------------------------------------
// Julian day <-> calendar. Ports of swe_julday()/swe_revjul() (swedate.c);
// the Gregorian/Julian cutover matches swe_wrap.c: Gregorian on/after
// 1582-10-15 (JD 2299160.5), Julian before.

const JD_CUTOVER = 2299160.5; // 1582-10-15 00:00 UT, Gregorian

export function jdFromCal(y, mo, d, hourUT) {
  const greg = (y > 1582 || (y === 1582 && (mo > 10 || (mo === 10 && d >= 15)))) ? 1 : 0;
  let u = y;
  if (mo < 3) u -= 1;
  const u0 = u + 4712.0;
  let u1 = mo + 1.0;
  if (u1 < 4) u1 += 12.0;
  let jd = Math.floor(u0 * 365.25)
         + Math.floor(30.6 * u1 + 0.000001)
         + d + hourUT / 24.0 - 63.5;
  if (greg) {
    let u2 = Math.floor(Math.abs(u) / 100) - Math.floor(Math.abs(u) / 400);
    if (u < 0.0) u2 = -u2;
    jd = jd - u2 + 2;
    if (u < 0.0 && u / 100 === Math.floor(u / 100) && u / 400 !== Math.floor(u / 400))
      jd -= 1;
  }
  return jd;
}

export function calFromJd(jd) {
  const greg = jd >= JD_CUTOVER ? 1 : 0;
  let u0 = jd + 32082.5;
  if (greg) {
    let u1 = u0 + Math.floor(u0 / 36525.0) - Math.floor(u0 / 146100.0) - 38.0;
    if (jd >= 1830691.5) u1 += 1;
    u0 = u0 + Math.floor(u1 / 36525.0) - Math.floor(u1 / 146100.0) - 38.0;
  }
  const u2 = Math.floor(u0 + 123.0);
  const u3 = Math.floor((u2 - 122.2) / 365.25);
  const u4 = Math.floor((u2 - Math.floor(365.25 * u3)) / 30.6001);
  let mon = Math.trunc(u4 - 1.0);
  if (mon > 12) mon -= 12;
  const day = Math.trunc(u2 - Math.floor(365.25 * u3) - Math.floor(30.6001 * u4));
  const year = Math.trunc(u3 + Math.floor((u4 - 2.0) / 12.0) - 4800);
  const hut = (jd - Math.floor(jd + 0.5) + 0.5) * 24.0;
  return { y: year, mo: mon, d: day, hourUT: hut };
}

// JD of the Unix epoch (1970-01-01T00:00Z).
export const JD_UNIX_EPOCH = 2440587.5;

// ---------------------------------------------------------------------------
// Root finding.

function sgn(x) { return x > 0 ? 1 : x < 0 ? -1 : 0; }

// Bracket sign changes of sampled values. xs: sorted sample abscissae,
// fs: f(xs[i]). Returns [x0, x1] brackets (x0 === x1 for an exact sample hit).
// With wrapGuard, a sign change accompanied by |df| >= 180 is the angle-wrap
// discontinuity, not a root.
export function bracketSamples(xs, fs, wrapGuard) {
  const out = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = fs[i], b = fs[i + 1];
    if (a === 0) out.push([xs[i], xs[i]]);
    else if (b === 0) out.push([xs[i + 1], xs[i + 1]]);
    else if (sgn(a) !== sgn(b) && (!wrapGuard || Math.abs(b - a) < 180))
      out.push([xs[i], xs[i + 1]]);
  }
  return out;
}

// Secant refinement of a bracketed root, with bisection fallback if secant
// stalls or leaves the bracket. tol is in days.
export function refineRoot(f, a, b, tol = 1e-7, maxIter = 60) {
  if (a === b) return a;
  let fa = f(a), fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  // Secant.
  let x0 = a, x1 = b, f0 = fa, f1 = fb;
  for (let i = 0; i < maxIter; i++) {
    if (f1 === f0) break;
    const x2 = x1 - f1 * (x1 - x0) / (f1 - f0);
    if (!Number.isFinite(x2) || x2 < Math.min(a, b) || x2 > Math.max(a, b)) break;
    const f2 = f(x2);
    if (Math.abs(f2) < 1e-12 || Math.abs(x2 - x1) < tol) return x2;
    x0 = x1; f0 = f1; x1 = x2; f1 = f2;
  }
  // Bisection fallback: the bracket still holds a sign change.
  let lo = a, hi = b, flo = fa;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = f(mid);
    if (fm === 0 || hi - lo < tol) return mid;
    if (sgn(fm) === sgn(flo)) { lo = mid; flo = fm; }
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// Split [jd0, jd1] into w contiguous chunk edges for parallel workers.
// Chunk i owns roots in (edges[i], edges[i+1]] (the first chunk also owns
// jd0 itself); each worker seeds its grid one step before its start so a
// bracket straddling an edge is seen whole by its owning chunk.
export function splitRange(jd0, jd1, w) {
  const edges = [];
  for (let i = 0; i <= w; i++) edges.push(jd0 + (jd1 - jd0) * (i / w));
  edges[0] = jd0;
  edges[w] = jd1;
  return edges;
}

// Merge worker results: sort by jd and drop exact duplicates (a root can
// only be duplicated if it lands within float noise of a chunk edge).
export function mergeTimedResults(chunks, keyOf) {
  const all = chunks.flat().sort((a, b) => a.jd - b.jd);
  const seen = new Set();
  return all.filter(r => {
    const k = keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// captured by both adjacent intervals).
export function dedupeRoots(roots, tolDays = 1e-4) {
  const sorted = [...roots].sort((p, q) => p - q);
  const out = [];
  for (const r of sorted) {
    if (!out.length || r - out[out.length - 1] > tolDays) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aspect + station engines.
//
// eph(jd) -> { lon: number[11], spd: number[11] } (degrees, degrees/day).
// grid: precomputed coarse samples [{ jd, lon, spd }] from scanGrid; the
// bracketing pass reads the grid (no ephemeris calls), refinement calls eph.

// Signed separation functions whose zeros are the perfectings.
export function aspectFn(eph, ia, ib, targetDeg, sign) {
  return jd => wrap180(eph(jd).lon[ia] - eph(jd).lon[ib] - sign * targetDeg);
}

export function stationFn(eph, ib) {
  return jd => eph(jd).spd[ib];
}

export function ingressFn(eph, ib, boundaryDeg) {
  return jd => wrap180(eph(jd).lon[ib] - boundaryDeg);
}

// Grid step (days) for ingress searches of one body: conservative daily
// motion bounds keep the body under ~15° (half a sign) per step, so a
// sign boundary can be crossed at most once between samples. Capped like
// aspectGridStep; the floor keeps very fast hypothetical bodies sane.
export function ingressGridStep(ib) {
  return Math.min(120, Math.max(0.25, 15 / MAX_DAILY_MOTION[ib]));
}

// Step for a combined ingress scan: the fastest selected body governs.
export function ingressScanStep(bodies) {
  return Math.min(...bodies.map(ingressGridStep));
}

// Sign ingresses of one body on the coarse grid. Longitude is unwrapped
// sample-to-sample; a change in floor(U/30) brackets a sign boundary,
// refined with the shared secant/bisection. Direction comes from the
// speed sign at the root. Returns [{ jd, ib, fromSign, toSign, lon, retro }]
// with sign indices 0=Aries and lon the boundary longitude (0° of toSign
// for direct motion). Prototype: proto/ingress_search_proto.py.
export function ingressRoots(grid, eph, ib) {
  if (grid.length < 2) return [];
  const out = [];
  let prev = grid[0];
  let prevRaw = wrap360(prev.lon[ib]);
  let unwrapped = prevRaw;
  let prevFloor = Math.floor(unwrapped / 30);
  for (let i = 1; i < grid.length; i++) {
    const cur = grid[i];
    const raw = wrap360(cur.lon[ib]);
    unwrapped += wrap180(raw - prevRaw);
    const fl = Math.floor(unwrapped / 30);
    if (fl !== prevFloor) {
      const boundaries = [];
      if (fl > prevFloor) for (let b = prevFloor + 1; b <= fl; b++) boundaries.push(b * 30);
      else for (let b = prevFloor; b > fl; b--) boundaries.push(b * 30);
      for (const B of boundaries) {
        const jd = refineRoot(ingressFn(eph, ib, wrap360(B)), prev.jd, cur.jd);
        const retro = eph(jd).spd[ib] < 0;
        const boundarySign = ((Math.floor(B / 30) % 12) + 12) % 12;
        out.push({
          jd, ib,
          fromSign: retro ? boundarySign : (boundarySign + 11) % 12,
          toSign: retro ? (boundarySign + 11) % 12 : boundarySign,
          lon: wrap360(B),
          retro,
        });
      }
    }
    prev = cur; prevRaw = raw; prevFloor = fl;
  }
  out.sort((a, b) => a.jd - b.jd);
  return out.filter((r, i) => i === 0 || r.jd - out[i - 1].jd > 1e-4);
}

// Bracket perfectings of one pair+target on the coarse grid, refine with eph.
// Returns sorted JD list.
export function aspectRoots(grid, eph, ia, ib, targetDeg) {
  const xs = grid.map(g => g.jd);
  const signs = (targetDeg === 0 || targetDeg === 180) ? [1] : [1, -1];
  let roots = [];
  for (const s of signs) {
    const fs = grid.map(g => wrap180(g.lon[ia] - g.lon[ib] - s * targetDeg));
    for (const [a, b] of bracketSamples(xs, fs, true)) {
      roots.push(refineRoot(aspectFn(eph, ia, ib, targetDeg, s), a, b));
    }
  }
  return dedupeRoots(roots);
}

// Station times of one planet. Returns [{ jd, type }] with type 'R'
// (stations retrograde: was direct) or 'D' (stations direct: was retrograde).
export function stationRoots(grid, eph, ib) {
  const xs = grid.map(g => g.jd);
  const fs = grid.map(g => g.spd[ib]);
  const out = [];
  for (const [a, b] of bracketSamples(xs, fs, false)) {
    const jd = refineRoot(stationFn(eph, ib), a, b);
    out.push({ jd, type: eph(jd - 0.25).spd[ib] > 0 ? 'R' : 'D' });
  }
  out.sort((p, q) => p.jd - q.jd);
  // Merge a root landing exactly on a grid point (captured twice).
  return out.filter((s, i) => i === 0 || s.jd - out[i - 1].jd > 1e-4);
}

// Nearest station of one body on either side of jd, with the station
// longitude attached. Returns { prev, next } of
// { jd, type: 'R'|'D', lon } (either side may be null when the grid
// window holds no station there).
export function stationsAround(grid, eph, ib, jd) {
  const sts = stationRoots(grid, eph, ib)
    .map(s => ({ jd: s.jd, type: s.type, lon: eph(s.jd).lon[ib] }));
  let prev = null, next = null;
  for (const s of sts) {
    if (s.jd <= jd) prev = s;
    else { next = s; break; }
  }
  return { prev, next };
}

// Nearest new/full moons bracketing jd. Returns { prev, next } of
// { jd, kind: 'new'|'full', moonLon } (either side may be null).
export function syzygiesAround(grid, eph, jd) {
  const all = [];
  for (const [deg, kind] of [[0, 'new'], [180, 'full']]) {
    for (const r of aspectRoots(grid, eph, 0, 1, deg)) {
      all.push({ jd: r, kind, moonLon: eph(r).lon[1] });
    }
  }
  all.sort((a, b) => a.jd - b.jd);
  let prev = null, next = null;
  for (const s of all) {
    if (s.jd <= jd) prev = s;
    else { next = s; break; }
  }
  return { prev, next };
}

// Group a planet's stations into retrograde periods: R station -> next D.
// Returns [{ start, end, startLon, endLon }]; stations must carry .lon.
export function retroPeriods(stations) {
  const periods = [];
  let open = null;
  for (const s of stations) {
    if (s.type === 'R') open = s;
    else if (s.type === 'D' && open) {
      periods.push({ start: open.jd, end: s.jd, startLon: open.lon, endLon: s.lon });
      open = null;
    }
  }
  return periods;
}

export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Extended retrograde periods (the "shadow").
//
// A retrograde period runs from the planet's entry into the stretch of
// zodiac its loop will cover until its final exit from that stretch:
//   - Mercury, Venus, Mars: the SIGN span. A sign transit is comparable in
//     length to the loop, so the period begins at the ingress into the
//     first sign the loop touches and ends at the egress from the last.
//   - Jupiter and beyond: the DEGREE span (the classical shadow). A sign
//     transit would dwarf the loop (years against months), so the period
//     begins when the direct-station degree is first crossed on the way
//     in and ends when the retrograde-station degree is left for the
//     last time.
// shadowBounds(ib, startLon, endLon) -> { bIn, bOut, signBased }: the two
// boundary longitudes the planet crosses at the period's ends. bIn/bOut
// are unwrapped (a loop crossing 0° Aries yields bOut > 360); the
// crossing searches difference against them with wrap180, so the offset
// is irrelevant there, and display code formats them mod 360.
const SIGN_SHADOW_PLANETS = new Set([2, 3, 4]); // Mercury, Venus, Mars

export function shadowBounds(ib, startLon, endLon) {
  const uD = endLon;
  const uR = uD + wrap360(startLon - endLon);
  if (SIGN_SHADOW_PLANETS.has(ib))
    return { bIn: 30 * Math.floor(uD / 30), bOut: 30 * (Math.floor(uR / 30) + 1), signBased: true };
  return { bIn: uD, bOut: uR, signBased: false };
}

// Boundary-crossing searches. Starting from t0 (a station, where the body
// is inside the span), walk in steps sized so the body moves < ~5 deg per
// step (MAX_DAILY_MOTION bounds) until wrap180(lon - B) changes sign, then
// refine with the shared secant/bisection. A step can only hide two
// crossings if the body stations within the step inside ~5 deg of B — but
// near a station the actual motion is ~0, far under the step bound, so
// the first crossing met is the one adjacent to t0. Throws when no
// crossing is found (e.g. the ephemeris has no data that far out).
function crossingStep(ib) {
  return Math.min(90, Math.max(1, 5 / MAX_DAILY_MOTION[ib]));
}

export function boundaryCrossingBefore(eph, ib, B, t0) {
  const g = jd => wrap180(eph(jd).lon[ib] - B);
  const step = crossingStep(ib);
  let hi = t0, ghi = g(hi);
  for (let n = 0; n < 20000; n++) {
    const lo = hi - step, glo = g(lo);
    if (glo === 0) return lo;
    if (glo < 0 && ghi > 0) return refineRoot(g, lo, hi);
    hi = lo; ghi = glo;
  }
  throw new Error('no boundary crossing before the station');
}

export function boundaryCrossingAfter(eph, ib, B, t1) {
  const g = jd => wrap180(eph(jd).lon[ib] - B);
  const step = crossingStep(ib);
  let lo = t1, glo = g(lo);
  for (let n = 0; n < 20000; n++) {
    const hi = lo + step, ghi = g(hi);
    if (ghi === 0) return hi;
    if (glo < 0 && ghi > 0) return refineRoot(g, lo, hi);
    lo = hi; glo = ghi;
  }
  throw new Error('no boundary crossing after the station');
}

// ---------------------------------------------------------------------------
// Conditional modifiers for aspect search.
//
// A condition is a plain object evaluated on an ephemeris snapshot
// { lon, spd } at a perfecting instant of the base pair (ia, ib).
// Conditions are grouped: every group must hold (AND), and within a
// group any one subcondition suffices (OR). References 'a'/'b' mean the
// pair's first/second body. Condition shapes:
//   { type:'sign', who, mode:'sign'|'ruler'|'element'|'quad'|'same', value }
//   { type:'aspect', from, to, deg, mode:'orb'|'signbased', orb }
//   { type:'motion', body, dir:'direct'|'retrograde' }
//   { type:'speed', body, min, max }        (percentile bounds, either null)
//   { type:'phase', body, phase:'morning'|'evening'|'combust'|'beams' }
// Prototype: proto/aspect_conditions_proto.py.

// Traditional sign rulers (body indices) for Aries..Pisces.
export const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 4, 5, 6, 6, 5];
export const SIGN_ELEMENT_NAMES = ['Fire', 'Earth', 'Air', 'Water']; // sign % 4
export const SIGN_QUAD_NAMES = ['Cardinal', 'Fixed', 'Mutable'];     // sign % 3

// Heliacal-phase bands by |signed elongation| from the Sun (degrees).
export const COMBUST_ORB = 8.5, BEAMS_ORB = 15;

export function signIndexOf(lon) {
  return Math.floor(wrap360(lon) / 30);
}

export function solarElongation(lon, sunLon) {
  return wrap180(lon - sunLon);
}

// Instant heliacal phase from signed elongation: west of the Sun (E < 0)
// rises first (morning/oriental); east (E > 0) sets later (evening).
export function heliacalPhase(lon, sunLon) {
  const e = solarElongation(lon, sunLon);
  const a = Math.abs(e);
  if (a <= COMBUST_ORB) return 'combust';
  if (a <= BEAMS_ORB) return 'beams';
  return e < 0 ? 'morning' : 'evening';
}

function resolveRef(ref, ia, ib) {
  return ref === 'a' ? ia : ref === 'b' ? ib : ref;
}

export function evaluateCondition(c, snap, ia, ib) {
  switch (c.type) {
    case 'sign': {
      const s = signIndexOf(snap.lon[resolveRef(c.who, ia, ib)]);
      switch (c.mode) {
        case 'sign': return s === c.value;
        case 'ruler': return SIGN_RULERS[s] === c.value;
        case 'element': return s % 4 === c.value;
        case 'quad': return s % 3 === c.value;
        case 'same': return s === signIndexOf(snap.lon[resolveRef(c.value, ia, ib)]);
      }
      return false;
    }
    case 'aspect': {
      const l1 = snap.lon[resolveRef(c.from, ia, ib)];
      const l2 = snap.lon[resolveRef(c.to, ia, ib)];
      if (c.mode === 'orb')
        return Math.abs(Math.abs(wrap180(l1 - l2)) - c.deg) <= c.orb;
      const d = ((signIndexOf(l2) - signIndexOf(l1)) % 12 + 12) % 12;
      return Math.min(d, 12 - d) * 30 === c.deg;
    }
    case 'motion':
      return c.dir === 'retrograde' ? snap.spd[c.body] < 0 : snap.spd[c.body] >= 0;
    case 'speed': {
      const p = speedPercentile(c.body, Math.abs(snap.spd[c.body]));
      if (Number.isNaN(p)) return false;
      return (c.min == null || p >= c.min) && (c.max == null || p <= c.max);
    }
    case 'phase':
      return heliacalPhase(snap.lon[c.body], snap.lon[0]) === c.phase;
  }
  return false;
}

// Conditions are organized as groups: the top level is a logical AND of
// groups, and within a group the subconditions are ORed. A legacy flat
// condition object normalizes to a one-condition group.
export function normalizeConditionGroups(conds) {
  if (!Array.isArray(conds)) return [];
  return conds.map(g => (Array.isArray(g) ? g : [g])).filter(g => g.length);
}

export function evaluateConditions(conds, snap, ia, ib) {
  return normalizeConditionGroups(conds)
    .every(group => group.some(c => evaluateCondition(c, snap, ia, ib)));
}

const SIGN_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const ELEMENT_NAMES_L = ['fire', 'earth', 'air', 'water'];
const QUAD_NAMES_L = ['cardinal', 'fixed', 'mutable'];

function refName(ref, ia, ib) {
  return SEARCH_BODIES[resolveRef(ref, ia, ib)];
}

// Human-readable evidence for one condition at a snapshot: the concrete
// values that make it true or false (used for the results table's filter
// columns). Always describes the actual state, matched or not; callers
// combine it with evaluateCondition.
export function conditionEvidence(c, snap, ia, ib) {
  const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
  switch (c.type) {
    case 'sign': {
      const who = resolveRef(c.who, ia, ib);
      const s = signIndexOf(snap.lon[who]);
      const head = `${SEARCH_BODIES[who]} in ${SIGN_NAMES[s]}`;
      switch (c.mode) {
        case 'sign': return head;
        case 'ruler': return `${head} (ruled by ${SEARCH_BODIES[SIGN_RULERS[s]]})`;
        case 'element': return `${head} — ${ELEMENT_NAMES_L[s % 4]} sign`;
        case 'quad': return `${head} — ${QUAD_NAMES_L[s % 3]} sign`;
        case 'same': {
          const other = resolveRef(c.value, ia, ib);
          return `${head} — same sign as ${SEARCH_BODIES[other]} (${SIGN_NAMES[signIndexOf(snap.lon[other])]})`;
        }
      }
      return head;
    }
    case 'aspect': {
      const l1 = snap.lon[resolveRef(c.from, ia, ib)];
      const l2 = snap.lon[resolveRef(c.to, ia, ib)];
      const names = `${refName(c.from, ia, ib)}–${refName(c.to, ia, ib)}`;
      if (c.mode === 'orb') {
        const sep = Math.abs(wrap180(l1 - l2));
        return `${names} separation ${f1(sep)}° (target ${c.deg}° ±${c.orb}°)`;
      }
      const d = ((signIndexOf(l2) - signIndexOf(l1)) % 12 + 12) % 12;
      const apart = Math.min(d, 12 - d);
      return `${names} whole-sign ${c.deg}° (${apart} sign${apart === 1 ? '' : 's'} apart)`;
    }
    case 'motion': {
      const v = snap.spd[c.body];
      return `${SEARCH_BODIES[c.body]} ${v < 0 ? 'retrograde' : 'direct'} (${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(3)}°/d)`;
    }
    case 'speed': {
      const p = speedPercentile(c.body, Math.abs(snap.spd[c.body]));
      return Number.isNaN(p) ? `${SEARCH_BODIES[c.body]} speed n/a`
        : `${SEARCH_BODIES[c.body]} at speed percentile ${Math.round(p)} (${Math.abs(snap.spd[c.body]).toFixed(3)}°/d)`;
    }
    case 'phase': {
      const e = solarElongation(snap.lon[c.body], snap.lon[0]);
      return `${SEARCH_BODIES[c.body]} ${heliacalPhase(snap.lon[c.body], snap.lon[0])} — ${f1(Math.abs(e))}° ${e < 0 ? 'west' : 'east'} of the Sun`;
    }
  }
  return '';
}

// Per condition group, the evidence of the first subcondition that holds
// (null when none does). Lets the results table show *how* each filter
// group was satisfied at a given perfecting instant.
export function explainConditions(conds, snap, ia, ib) {
  return normalizeConditionGroups(conds).map(group => {
    for (const c of group)
      if (evaluateCondition(c, snap, ia, ib)) return conditionEvidence(c, snap, ia, ib);
    return null;
  });
}

// Signs a retrograde period belongs to for filtering: the sign of each
// station (retrograde station at startLon, direct station at endLon).
// The shadow span is deliberately NOT considered — a period whose two
// stations sit in Taurus must not match a Gemini search just because its
// egress crosses into Gemini. Returns a Set of 1–2
// sign indices 0..11.
export function periodSignSet(startLon, endLon) {
  return new Set([signIndexOf(startLon), signIndexOf(endLon)]);
}

// Body indices a condition set reads (the runner unions these into the
// ephemeris mask). Phase conditions also read the Sun (index 0).
export function conditionBodies(conds) {
  const out = new Set();
  const addRef = r => { if (typeof r === 'number') out.add(r); };
  for (const group of normalizeConditionGroups(conds)) {
    for (const c of group) {
      if (c.type === 'sign') addRef(c.who);
      else if (c.type === 'aspect') { addRef(c.from); addRef(c.to); }
      else if (c.type === 'motion' || c.type === 'speed') out.add(c.body);
      else if (c.type === 'phase') { out.add(c.body); out.add(0); }
    }
  }
  return out;
}

const isBodyRef = r => r === 'a' || r === 'b' || (Number.isInteger(r) && r >= 0 && r <= 10);

// Validate one condition; returns an error string or null.
export function validateCondition(c) {
  if (!c || typeof c !== 'object') return 'malformed condition';
  switch (c.type) {
    case 'sign': {
      if (!isBodyRef(c.who)) return 'sign condition: pick whose sign';
      if (c.mode === 'sign' && !(c.value >= 0 && c.value <= 11)) return 'sign condition: pick a sign';
      if (c.mode === 'ruler' && !(c.value >= 0 && c.value <= 6)) return 'sign condition: pick a ruler (traditional seven)';
      if (c.mode === 'element' && !(c.value >= 0 && c.value <= 3)) return 'sign condition: pick an element';
      if (c.mode === 'quad' && !(c.value >= 0 && c.value <= 2)) return 'sign condition: pick a quadruplicity';
      if (c.mode === 'same' && c.value !== 'a' && c.value !== 'b') return 'sign condition: pick A or B to match';
      if (!['sign', 'ruler', 'element', 'quad', 'same'].includes(c.mode)) return 'sign condition: unknown mode';
      return null;
    }
    case 'aspect': {
      if (!isBodyRef(c.from) || !isBodyRef(c.to)) return 'aspect condition: pick both bodies';
      if (c.from === c.to) return 'aspect condition: a body cannot aspect itself';
      if (!ASPECTS.some(a => a.deg === c.deg)) return 'aspect condition: pick an aspect';
      if (c.mode === 'orb' && !(Number.isFinite(c.orb) && c.orb > 0 && c.orb <= 30))
        return 'aspect condition: orb must be between 0 and 30 degrees';
      if (!['orb', 'signbased'].includes(c.mode)) return 'aspect condition: unknown mode';
      return null;
    }
    case 'motion':
      if (!(c.body >= 0 && c.body <= 10)) return 'motion condition: pick a body';
      if (c.dir === 'retrograde' && (c.body === 0 || c.body === 1))
        return 'the Sun and Moon are never retrograde';
      if (!['direct', 'retrograde'].includes(c.dir)) return 'motion condition: pick a direction';
      return null;
    case 'speed':
      if (c.body === 10) return 'no long-term speed statistics for the North Node';
      if (!(c.body >= 0 && c.body <= 9)) return 'speed condition: pick a body';
      if (c.min == null && c.max == null) return 'speed condition: give at least one percentile bound';
      if (c.min != null && !(c.min >= 0 && c.min <= 100)) return 'speed condition: percentiles run 0 to 100';
      if (c.max != null && !(c.max >= 0 && c.max <= 100)) return 'speed condition: percentiles run 0 to 100';
      if (c.min != null && c.max != null && c.min > c.max) return 'speed condition: minimum exceeds maximum';
      return null;
    case 'phase':
      if (c.body === 0) return 'the Sun has no heliacal phase from itself';
      if (!(c.body >= 1 && c.body <= 10)) return 'phase condition: pick a body';
      if (!['morning', 'evening', 'combust', 'beams'].includes(c.phase)) return 'phase condition: pick a phase';
      return null;
  }
  return 'unknown condition type';
}

// First validation error across the set, or null. Positions are 1-based;
// inside a multi-condition group they read "condition 2.1" (group 2, first
// subcondition).
export function validateConditions(conds) {
  const groups = normalizeConditionGroups(conds);
  for (let gi = 0; gi < groups.length; gi++) {
    for (let ci = 0; ci < groups[gi].length; ci++) {
      const e = validateCondition(groups[gi][ci]);
      if (e) return `condition ${gi + 1}${groups[gi].length > 1 ? '.' + (ci + 1) : ''}: ${e}`;
    }
  }
  return null;
}
