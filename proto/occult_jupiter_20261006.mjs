// Prototype: verify the 2026-10-06 Moon-occults-Jupiter event for Phoenix,
// cross-check the article's Eastern/Mountain times via New York, scan for the
// next North-America-visible lunar occultation of Jupiter (article: not until
// 2034), and check Draconids/new-Moon context for Oct 8-9.
// Uses real swe.wasm (Moshier). Geocentric apparent positions from
// _chart_compute; topocentric correction for the Moon done in JS
// (lunar parallax ~1 deg shifts contacts by up to ~2 h vs geocentric).
import SweModule from '../site/swe.js';
import { computeChart } from '../site/ephe.js';
import { ephProvider } from '../site/ephe.js';
import { jdFromCal, calFromJd, wrap180, refineRoot, syzygiesAround } from '../site/search.js';

const mod = await SweModule();
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const AU_KM = 149597870.7, MOON_R_KM = 1737.4;

// --- chart helper: geocentric apparent lon/lat/dist/dec/mag -----------------
function chart(jd) {
  const c = calFromJd(jd);
  const out = computeChart(mod, c.y, c.mo, c.d, c.hourUT, 0, 0, false);
  const body = i => {
    const b = 6 * i;
    return { lon: out[b], lat: out[b + 1], dist: out[b + 2], dec: out[b + 4], mag: out[b + 5] };
  };
  return { sun: body(0), moon: body(1), jup: body(5) };
}

// --- time / coordinate helpers ----------------------------------------------
const obliquity = jd => {
  const T = (jd - 2451545.0) / 36525;
  return (23 * 3600 + 26 * 60 + 21.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T) / 3600;
};
// ecliptic (lon,lat deg) -> equatorial (ra,dec deg), mean obliquity
function eclToEq(lon, lat, jd) {
  const e = obliquity(jd) * D2R, l = lon * D2R, b = lat * D2R;
  const sd = Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l);
  const dec = Math.asin(sd);
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  return { ra: ((ra * R2D) % 360 + 360) % 360, dec: dec * R2D };
}
function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - T * T * T / 38710000;
  return ((g % 360) + 360) % 360;
}
// observer geocentric position, AU (WGS84 ellipsoid, h in km)
function obsGeo(latDeg, lonEastDeg, jd, hKm = 0.33) {
  const f = 1 / 298.257223563, a = 6378.137;
  const e2 = f * (2 - f), la = latDeg * D2R;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  const th = (gmstDeg(jd) + lonEastDeg) * D2R;
  const x = (N + hKm) * Math.cos(la) * Math.cos(th);
  const y = (N + hKm) * Math.cos(la) * Math.sin(th);
  const z = (N * (1 - e2) + hKm) * Math.sin(la);
  return [x / AU_KM, y / AU_KM, z / AU_KM];
}
function eqVec(raDeg, decDeg, rAU) {
  const ra = raDeg * D2R, dc = decDeg * D2R;
  return [rAU * Math.cos(dc) * Math.cos(ra), rAU * Math.cos(dc) * Math.sin(ra), rAU * Math.sin(dc)];
}
function vecToEq(v) {
  const r = Math.hypot(...v);
  return { ra: ((Math.atan2(v[1], v[0]) * R2D) % 360 + 360) % 360, dec: Math.asin(v[2] / r) * R2D, r };
}
function angSep(a1, d1, a2, d2) {
  const [A1, D1, A2, D2] = [a1, d1, a2, d2].map(x => x * D2R);
  return Math.acos(Math.min(1, Math.sin(D1) * Math.sin(D2) + Math.cos(D1) * Math.cos(D2) * Math.cos(A1 - A2))) * R2D;
}
function altAz(raDeg, decDeg, latDeg, lonEastDeg, jd) {
  const H = (gmstDeg(jd) + lonEastDeg - raDeg) * D2R;
  const la = latDeg * D2R, dc = decDeg * D2R;
  const alt = Math.asin(Math.sin(la) * Math.sin(dc) + Math.cos(la) * Math.cos(dc) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(la) - Math.tan(dc) * Math.cos(la));
  return { alt: alt * R2D, az: ((az * R2D + 180) % 360 + 360) % 360 }; // az from north... +180: from south convention fix below
}
// topocentric Moon equatorial + angular radius (deg)
function topoMoon(jd, latDeg, lonEastDeg) {
  const { moon } = chart(jd);
  const g = eclToEq(moon.lon, moon.lat, jd);
  const gv = eqVec(g.ra, g.dec, moon.dist);
  const ov = obsGeo(latDeg, lonEastDeg, jd);
  const t = vecToEq([gv[0] - ov[0], gv[1] - ov[1], gv[2] - ov[2]]);
  return { ...t, radius: Math.asin(MOON_R_KM / (t.r * AU_KM)) * R2D };
}
// f(jd) = topocentric Moon-Jupiter center separation minus lunar radius (deg)
function occultF(jd, latDeg, lonEastDeg) {
  const m = topoMoon(jd, latDeg, lonEastDeg);
  const { jup } = chart(jd);
  const j = eclToEq(jup.lon, jup.lat, jd); // Jupiter parallax ~0.0005 deg: geocentric is fine
  return angSep(m.ra, m.dec, j.ra, j.dec) - m.radius;
}
function findContacts(jd0, jd1, latDeg, lonEastDeg, stepDays = 120 / 86400) {
  const f = jd => occultF(jd, latDeg, lonEastDeg);
  const roots = [];
  let a = jd0, fa = f(a);
  for (let b = a + stepDays; b <= jd1 + 1e-9; a = b, fa = f(b), b += stepDays) {
    const fb = f(b);
    if (fa === 0) roots.push(a);
    else if (fa < 0 !== fb < 0) roots.push(refineRoot(f, a, b));
  }
  return roots;
}
const p2 = n => String(n).padStart(2, '0');
function fmtLocal(jdUTC, utcOffsetH) {
  const c = calFromJd(jdUTC + utcOffsetH / 24);
  const s = Math.floor(c.hourUT * 3600);
  return `${c.y}-${p2(c.mo)}-${p2(c.d)} ${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}:${p2(s % 60)}`;
}
function fmtUTC(jd) { return fmtLocal(jd, 0) + ' UTC'; }

const PHX = { lat: 33.4484, lonE: -112.0740, tz: -7, name: 'Phoenix' };
const NYC = { lat: 40.7128, lonE: -74.0060, tz: -4, name: 'New York' };

console.log('=== Moon occults Jupiter, 2026-10-06 (topocentric) ===');
for (const P of [PHX, NYC]) {
  const w0 = jdFromCal(2026, 10, 6, 6), w1 = jdFromCal(2026, 10, 6, 14); // 23:00-07:00 MST window
  const roots = findContacts(w0, w1, P.lat, P.lonE);
  console.log(`\n${P.name} (UTC${P.tz >= 0 ? '+' : ''}${P.tz}):`);
  if (roots.length < 2) { console.log('  contacts found:', roots.map(fmtUTC).join(' / ') || 'NONE'); continue; }
  const [ing, egr] = roots;
  console.log(`  ingress (disappearance): ${fmtUTC(ing)}  = ${fmtLocal(ing, P.tz)} local`);
  console.log(`  egress  (reappearance):  ${fmtUTC(egr)}  = ${fmtLocal(egr, P.tz)} local`);
  console.log(`  duration: ${((egr - ing) * 1440).toFixed(1)} min`);
  const mid = (ing + egr) / 2;
  const m = topoMoon(mid, P.lat, P.lonE);
  const { jup, sun, moon } = chart(mid);
  const j = eclToEq(jup.lon, jup.lat, mid);
  const s = eclToEq(sun.lon, sun.lat, mid);
  const ma = altAz(m.ra, m.dec, P.lat, P.lonE, mid);
  const ja = altAz(j.ra, j.dec, P.lat, P.lonE, mid);
  const sa = altAz(s.ra, s.dec, P.lat, P.lonE, mid);
  const illum = (1 - Math.cos(wrap180(moon.lon - sun.lon) * D2R)) / 2;
  console.log(`  at mid-occultation: Moon alt ${ma.alt.toFixed(1)} deg az ${ma.az.toFixed(0)} | ` +
    `Jupiter alt ${ja.alt.toFixed(1)} deg az ${ja.az.toFixed(0)} | Sun alt ${sa.alt.toFixed(1)} deg`);
  console.log(`  Moon illumination ${(illum * 100).toFixed(1)}% waning | Jupiter mag ${jup.mag.toFixed(1)} | ` +
    `lunar radius ${m.radius.toFixed(3)} deg`);
}

// --- next North-America-visible lunar occultation of Jupiter -----------------
console.log('\n=== Next NA-visible Moon-occults-Jupiter (geocentric scan, then city check) ===');
const eph = ephProvider(mod, false, (1 << 1) | (1 << 5)); // Moon + Jupiter lon/spd
const cities = [
  { n: 'Phoenix', lat: 33.45, lonE: -112.07 }, { n: 'Los Angeles', lat: 34.05, lonE: -118.24 },
  { n: 'Chicago', lat: 41.88, lonE: -87.63 }, { n: 'New York', lat: 40.71, lonE: -74.01 },
  { n: 'Toronto', lat: 43.65, lonE: -79.38 }, { n: 'Mexico City', lat: 19.43, lonE: -99.13 },
];
function naVisible(jdCA) {
  // topocentric check +/-2h at 15-min steps: Moon up, Sun down somewhere in NA
  for (let jd = jdCA - 2 / 24; jd <= jdCA + 2 / 24 + 1e-9; jd += 0.25 / 24) {
    const { sun } = chart(jd);
    const s = eclToEq(sun.lon, sun.lat, jd);
    for (const c of cities) {
      const m = topoMoon(jd, c.lat, c.lonE);
      const ma = altAz(m.ra, m.dec, c.lat, c.lonE, jd);
      const sa = altAz(s.ra, s.dec, c.lat, c.lonE, jd);
      const { jup } = chart(jd);
      const j = eclToEq(jup.lon, jup.lat, jd);
      if (ma.alt > 3 && sa.alt < -1 && angSep(m.ra, m.dec, j.ra, j.dec) < m.radius + 0.05)
        return { city: c.n, jd };
    }
  }
  return null;
}
{
  const t0 = Date.now();
  const start = jdFromCal(2026, 10, 7, 0), end = jdFromCal(2036, 1, 1, 0);
  const cands = [];
  let prev = null;
  for (let jd = start; jd < end; jd += 0.5) {
    const s = eph(jd);
    const dlon = Math.abs(wrap180(s.lon[1] - s.lon[5]));
    if (dlon < 5 && (!prev || jd - prev > 20)) { cands.push(jd); prev = jd; }
  }
  console.log(`coarse scan: ${cands.length} close-approach candidates (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const rows = [];
  for (const c0 of cands) {
    // refine: geocentric min separation in +/-3 d
    let best = { jd: c0, sep: 1e9 };
    for (let jd = c0 - 3; jd <= c0 + 3; jd += 0.5 / 24) {
      const { moon, jup } = chart(jd);
      const mg = eclToEq(moon.lon, moon.lat, jd), jg = eclToEq(jup.lon, jup.lat, jd);
      const sep = angSep(mg.ra, mg.dec, jg.ra, jg.dec);
      if (sep < best.sep) best = { jd, sep };
    }
    if (best.sep > 1.4) continue; // no occultation anywhere on Earth (parallax <= ~1 deg)
    const v = naVisible(best.jd);
    const when = fmtUTC(best.jd).slice(0, 10);
    rows.push(`  ${when}: geocentric min sep ${best.sep.toFixed(2)} deg -> ` +
      (v ? `VISIBLE from NA (${v.city}, ~${fmtUTC(v.jd).slice(11, 16)} UTC)` : 'not NA-night-visible (proxy)'));
  }
  for (const r of rows) console.log(r);
  console.log(`  total geocentric occultations 2026-10-07..2035-12-31: ${rows.length}`);
  eph.free();
}

// --- Phoenix moonrise Oct 6 (when does the Moon actually come up?) ---------------
console.log('\n=== Phoenix Moon rise Oct 6 ===');
{
  const f = jd => { const m = topoMoon(jd, PHX.lat, PHX.lonE); return altAz(m.ra, m.dec, PHX.lat, PHX.lonE, jd).alt; };
  let a = jdFromCal(2026, 10, 6, 6), fa = f(a);
  for (let b = a + 10 / 1440; b <= jdFromCal(2026, 10, 6, 18); a = b, fa = f(b), b += 10 / 1440) {
    const fb = f(b);
    if (fa < 0 && fb >= 0) {
      const r = refineRoot(f, a, b);
      console.log(`  moonrise: ${fmtUTC(r)} = ${fmtLocal(r, -7)} MST`);
      const m = topoMoon(r, PHX.lat, PHX.lonE);
      console.log(`  Moon illumination then: ${((1 - Math.cos(wrap180(chart(r).moon.lon - chart(r).sun.lon) * D2R)) / 2 * 100).toFixed(1)}%`);
      break;
    }
  }
}

// --- Draconids + new Moon context --------------------------------------------
console.log('\n=== Draconids peak Oct 8-9 (Phoenix) ===');
{
  const eph2 = ephProvider(mod, false, 0b11); // Sun + Moon
  const grid = [];
  for (let jd = jdFromCal(2026, 10, 1, 0); jd <= jdFromCal(2026, 10, 22, 0); jd += 5)
    grid.push({ jd, ...eph2(jd) });
  const syz = syzygiesAround(grid, eph2, jdFromCal(2026, 10, 8, 12));
  for (const s of [syz.prev, syz.next]) if (s) console.log(`  ${s.kind} moon: ${fmtUTC(s.jd)}`);
  eph2.free();
  // radiant Draco ~ RA 17h28m, Dec +54.5 (J2000; precession ignored, ~arcmin-level need here)
  const rRA = (17 + 28 / 60) * 15, rDec = 54.5;
  for (const h of [18, 19, 20, 21, 22]) {
    const jd = jdFromCal(2026, 10, 9, h + 7); // MST -> UTC (+7)
    const a = altAz(rRA, rDec, PHX.lat, PHX.lonE, jd);
    const m = topoMoon(jd, PHX.lat, PHX.lonE);
    const ma = altAz(m.ra, m.dec, PHX.lat, PHX.lonE, jd);
    console.log(`  Oct 8 ${p2(h)}:00 MST: radiant alt ${a.alt.toFixed(0)} deg | Moon alt ${ma.alt.toFixed(0)} deg`);
  }
}

