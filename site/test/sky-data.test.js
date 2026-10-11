// Unit tests for sky-data.js (pure math + data for the Sky tab).
// Run: node --test test/sky-data.test.js  (from site/)
// Regression values were verified against an independent Python
// implementation (Meeus, Astronomical Algorithms).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  norm360, meanObliquity, gmstDeg, lstDeg, unixMsToJd, J2000,
  precess, eclToEq, eqToEcl, eqToHoriz, horizToVec, galacticToEq,
  lahiriAyanamsa, nakshatraIndex, nakshatraSpans, NAKSHATRAS,
  XIU, xiuSpans, SIGNS, STAR_LORE, loreForStar,
  parseSefstars, starApparent, SKY_BODIES, dragYaw, dragPitch, DEG2RAD,
  eqToVec, horizToEq, houseCusps, signCusps,
  southNodeLon, moonOrbitPoint, MOON_ORBIT_INCL, daylightFactors,
} from '../sky-data.js';

const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

describe('meanObliquity', () => {
  it('is 23.4392911 at J2000', () => assert.ok(approx(meanObliquity(J2000), 23.4392911, 1e-9)));
  it('matches reference on 2026-10-01', () =>
    assert.ok(approx(meanObliquity(2461313.5), 23.43581317314527, 1e-9)));
});

describe('gmst/lst', () => {
  it('GMST at J2000.0 is 280.46061837', () =>
    assert.ok(approx(gmstDeg(J2000), 280.46061837, 1e-9)));
  it('GMST on 2026-10-01 0h UT', () =>
    assert.ok(approx(gmstDeg(2461313.5), 8.756943721324205, 1e-6)));
  it('LST adds east longitude', () =>
    assert.ok(approx(lstDeg(J2000, -112.07), norm360(280.46061837 - 112.07), 1e-9)));
  it('unixMsToJd', () => assert.ok(approx(unixMsToJd(0), 2440587.5, 1e-9)));
});

describe('precess', () => {
  it('is identity for equal epochs', () => {
    const p = precess(123.4, -12.3, J2000, J2000);
    assert.ok(approx(p.ra, 123.4, 1e-12) && approx(p.dec, -12.3, 1e-12));
  });
  it('J2000 -> J2100 of (0,0)', () => {
    const p = precess(0, 0, J2000, J2000 + 36525);
    assert.ok(approx(p.ra, 1.28166050, 1e-6), `ra=${p.ra}`);
    assert.ok(approx(p.dec, 0.55658809, 1e-6), `dec=${p.dec}`);
  });
  it('Sirius J2000 -> 2026-10-01', () => {
    const p = precess(101.287155, -16.716116, J2000, 2461313.5);
    assert.ok(approx(p.ra, 101.58597567436706, 1e-6), `ra=${p.ra}`);
    assert.ok(approx(p.dec, -16.745638973223944, 1e-6), `dec=${p.dec}`);
  });
  it('round-trips exactly (incl. B1950)', () => {
    const B1950 = 2433282.4235;
    for (const [ra, dec, f, t] of [[101.28, -16.71, B1950, J2000], [280, -45, J2000, 2400000]]) {
      const p1 = precess(ra, dec, f, t), p2 = precess(p1.ra, p1.dec, t, f);
      assert.ok(approx(p2.ra, ra, 1e-9) && approx(p2.dec, dec, 1e-9),
        `rt failed for ${ra},${dec}`);
    }
  });
});

describe('eclToEq/eqToEcl', () => {
  it('round-trips', () => {
    const e = eclToEq(123.456, 4.321, 23.44);
    const b = eqToEcl(e.ra, e.dec, 23.44);
    assert.ok(approx(b.lon, 123.456, 1e-9) && approx(b.lat, 4.321, 1e-9));
  });
  it('vernal equinox -> RA 0, Dec 0', () => {
    const e = eclToEq(0, 0, 23.44);
    assert.ok(approx(e.ra, 0, 1e-9) && approx(e.dec, 0, 1e-9));
  });
});

describe('eqToHoriz', () => {
  it('matches the vector derivation', () => {
    const h = eqToHoriz(50, 20, 100, 33.44);
    assert.ok(approx(h.az, 266.2286, 1e-3), `az=${h.az}`);
    assert.ok(approx(h.alt, 43.8291, 1e-3), `alt=${h.alt}`);
  });
  it('zenith when dec=lat and ra=lst', () => {
    const h = eqToHoriz(100, 33.44, 100, 33.44);
    assert.ok(approx(h.alt, 90, 1e-9), `alt=${h.alt}`);
  });
  it('star on the meridian transits south (northern observer)', () => {
    const h = eqToHoriz(100, 20, 100, 33.44);
    assert.ok(approx(h.az, 180, 1e-6), `az=${h.az}`);
  });
  it('horizToVec puts north on -z, east on +x', () => {
    const n = horizToVec(0, 0, 1), e = horizToVec(90, 0, 1), u = horizToVec(0, 90, 1);
    assert.ok(approx(n[2], -1, 1e-9) && approx(e[0], 1, 1e-9) && approx(u[1], 1, 1e-9));
  });
});

describe('eqToVec', () => {
  it('matches horizToVec with the same convention', () => {
    for (const [a, d] of [[0, 0], [90, 0], [0, 90], [200, -30], [359.9, 45]]) {
      const v = eqToVec(a, d, 2), w = horizToVec(a, d, 2);
      assert.ok(v.every((x, i) => approx(x, w[i], 1e-12)));
    }
  });
  it('vernal equinox sits on -z, RA 90 on +x, NCP on +y', () => {
    const v0 = eqToVec(0, 0, 1), v1 = eqToVec(90, 0, 1), vp = eqToVec(0, 90, 1);
    assert.ok(approx(v0[2], -1, 1e-9) && approx(v1[0], 1, 1e-9) && approx(vp[1], 1, 1e-9));
  });
});

describe('horizToEq', () => {
  const circ = (a, b) => Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
  it('round-trips eqToHoriz across latitudes', () => {
    const cases = [
      [50, 20, 100, 33.44], [101.58, -16.75, 8.76, -33.9], [266.4, -28.9, 100, -60],
      [0, 89.4, 0, 0], [200, -30, 300, 51.5], [10, 10, 10, -89], [180, 45, 0, 89],
    ];
    for (const [ra, dec, lst, lat] of cases) {
      const h = eqToHoriz(ra, dec, lst, lat);
      const e = horizToEq(h.az, h.alt, lst, lat);
      assert.ok(circ(e.ra, ra) < 1e-9, `ra: ${ra} -> ${e.ra}`);
      assert.ok(approx(e.dec, dec, 1e-9), `dec: ${dec} -> ${e.dec}`);
    }
  });
  it('horizon north point is on the lower meridian', () => {
    const e = horizToEq(0, 0, 120, 40);
    assert.ok(approx(e.dec, 50, 1e-9), `dec=${e.dec}`);
    assert.ok(circ(e.ra, 300) < 1e-9, `ra=${e.ra}`); // lst+180
  });
  it('zenith maps to (lst, lat)', () => {
    const e = horizToEq(123, 90, 123, 33.44);
    assert.ok(circ(e.ra, 123) < 1e-9 && approx(e.dec, 33.44, 1e-9));
  });
});

describe('houseCusps / signCusps', () => {
  it('whole-sign cusps start at the Ascendant sign', () => {
    assert.deepEqual(houseCusps(100), [90, 120, 150, 180, 210, 240, 270, 300, 330, 0, 30, 60]);
  });
  it('12 distinct 30-degree cusps', () => {
    const c = houseCusps(359.9);
    assert.equal(c.length, 12);
    assert.deepEqual(c, [330, 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  });
  it('signCusps are the 12 tropical boundaries', () => {
    assert.deepEqual(signCusps(), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
  });
});

describe('galacticToEq', () => {
  it('galactic centre -> Sgr A* region', () => {
    const p = galacticToEq(0, 0);
    assert.ok(approx(p.ra, 266.4049948019624, 1e-4), `ra=${p.ra}`);
    assert.ok(approx(p.dec, -28.936173956949485, 1e-4), `dec=${p.dec}`);
  });
});

describe('lahiriAyanamsa', () => {
  it('is 23.8531 at J2000', () => assert.ok(approx(lahiriAyanamsa(J2000), 23.8531, 1e-9)));
  it('grows ~50.29"/yr', () =>
    assert.ok(approx(lahiriAyanamsa(2461313.5), 24.226690766406573, 1e-6)));
});

describe('nakshatras', () => {
  it('has 27 entries', () => assert.equal(NAKSHATRAS.length, 27));
  it('index 0 at the sidereal zero point', () => {
    assert.equal(nakshatraIndex(24.0, 24.0), 0);
    assert.equal(nakshatraIndex(24.0 + 13.34, 24.0), 1);
    assert.equal(nakshatraIndex(23.9, 24.0), 26);
  });
  it('spans tile 360 deg starting at the ayanamsa', () => {
    const s = nakshatraSpans(24.0);
    assert.equal(s.length, 27);
    assert.ok(approx(s[0].start, 24.0, 1e-9));
    const total = s.reduce((a, x) => a + x.width, 0);
    assert.ok(approx(total, 360, 1e-9));
  });
});

describe('xiu', () => {
  it('has 28 entries', () => assert.equal(XIU.length, 28));
  // Determinative RAs increasing eastward in mansion order (one 0h wrap).
  const fake = new Map(XIU.map((x, i) => [x.bayer || `nobayer${i}`, (i * 360 / 28) % 360]));
  it('spans tile 360 deg and start at determinative RAs', () => {
    const s = xiuSpans(fake);
    assert.equal(s.length, 28);
    assert.ok(approx(s[0].startRA, fake.get('alvir'), 1e-9));
    const total = s.reduce((a, x) => a + x.widthDeg, 0);
    assert.ok(approx(total, 360, 1e-9), `total=${total}`);
  });
  it('falls back to previous end when a determinative is missing', () => {
    const m = new Map(fake); m.delete('kavir'); // Neck determinative missing
    const s = xiuSpans(m);
    assert.ok(approx(s[1].startRA, s[0].endRA, 1e-9));
    const total = s.reduce((a, x) => a + x.widthDeg, 0);
    assert.ok(approx(total, 360, 1e-9));
  });
  it('spans run star-to-star with no gaps', () => {
    const s = xiuSpans(fake);
    for (let i = 0; i < 27; i++)
      assert.ok(approx(s[i + 1].startRA, s[i].endRA > 360 ? s[i].endRA - 360 : s[i].endRA, 1e-9));
  });
});

describe('parseSefstars', () => {
  const sample = `# comment
Aldebaran  ,alTau,ICRS,04,35,55.23907,+16,30,33.4885,63.45,-188.94,54.26,48.94,0.86, 16,  629
Rohini  ,alTau,ICRS,04,35,55.23907,+16,30,33.4885,63.45,-188.94,54.26,48.94,0.86, 16,  629
Antares    ,alSco,ICRS,16,29,24.45970,-26,25,55.2094,-12.11,-23.3,-3.5,5.89,0.91,-26,11359
BadLine,xx
Sirius     ,alCMa,ICRS,06,45,08.91728,-16,42,58.0171,-546.01,-1223.07,-5.5,379.21,-1.46,-16, 1591
OldStar    ,xxOld,1950,06,45,08.91728,-16,42,58.0171,0,0,0,0,-1.46,0,0
`;
  it('parses records, merges duplicate names, skips bad lines', () => {
    const stars = parseSefstars(sample);
    assert.equal(stars.length, 4);
    const ald = stars.find(s => s.bayer === 'alTau');
    assert.ok(ald.altNames.includes('Rohini'));
    assert.ok(approx(ald.ra0, (4 + 35 / 60 + 55.23907 / 3600) * 15, 1e-6));
    assert.ok(approx(ald.dec0, 16 + 30 / 60 + 33.4885 / 3600, 1e-6));
    assert.equal(ald.mag, 0.86);
    const ant = stars.find(s => s.bayer === 'alSco');
    assert.ok(ant.dec0 < 0 && approx(ant.dec0, -(26 + 25 / 60 + 55.2094 / 3600), 1e-6));
  });
  it('precesses B1950 records to J2000 via the matrix path', () => {
    const stars = parseSefstars(sample);
    const o = stars.find(s => s.bayer === 'xxOld');
    const ref = precess(101.287155, -16.716116, 2433282.4235, 2451545.0);
    assert.ok(Math.abs(o.ra0 - ref.ra) < 1e-6 && Math.abs(o.dec0 - ref.dec) < 1e-6);
    // and it must differ from the un-precessed input (B1950 != J2000)
    assert.ok(Math.abs(o.ra0 - 101.287155) > 0.1, `ra0=${o.ra0}`);
  });
  it('starApparent applies proper motion + precession', () => {
    const stars = parseSefstars(sample);
    const sir = stars.find(s => s.bayer === 'alCMa');
    const app = starApparent(sir, 2461313.5);
    // Python-verified: Sirius J2000 + proper motion, precessed to 2026-10-01
    assert.ok(Math.abs(app.ra - 101.58171) < 0.01, `ra=${app.ra}`);
    assert.ok(Math.abs(app.dec - -16.75471) < 0.01, `dec=${app.dec}`);
  });
});

describe('lore', () => {
  it('finds lore by traditional name', () => {
    const l = loreForStar({ name: 'Rohini', bayer: 'alTau', altNames: [] });
    assert.ok(l && l.traditions.includes('Indian'), JSON.stringify(l));
  });
  it('finds lore by bayer code', () => {
    const l = loreForStar({ name: 'α Tau', bayer: 'alTau', altNames: [] });
    assert.ok(l && l.traditions.includes('Western'));
  });
  it('finds lore via altNames', () => {
    const l = loreForStar({ name: 'Aldebaran', bayer: 'alTau', altNames: ['Rohini'] });
    assert.ok(l && l.traditions.includes('Islamicate'));
  });
  it('returns null for unknown stars', () => {
    assert.equal(loreForStar({ name: 'HD 12345', bayer: 'hd12345', altNames: [] }), null);
  });
  it('every lore entry has traditions and text', () => {
    for (const e of STAR_LORE) assert.ok(e.t.length > 0 && e.d.length > 20, e.k[0]);
  });
});

describe('catalogues', () => {
  it('12 signs, 12 sky bodies', () => {
    assert.equal(SIGNS.length, 12);
    assert.equal(SKY_BODIES.length, 12);
  });
  it('South Node is id 11, glyph U+260B with text presentation', () => {
    const sn = SKY_BODIES.find(b => b.id === 11);
    assert.equal(sn.name, 'South Node');
    assert.equal(sn.glyph, '\u260B\uFE0E');
  });
});

describe('lunar nodes and Moon orbit', () => {
  it('southNodeLon is opposite the node, wrapped', () => {
    assert.equal(southNodeLon(200), 20);
    assert.equal(southNodeLon(10), 190);
    assert.equal(southNodeLon(180), 0);
  });
  it('moonOrbitPoint crosses the ecliptic at the nodes', () => {
    const Om = 125.7;
    const asc = moonOrbitPoint(0, Om);
    assert.ok(approx(asc.lon, Om, 1e-9) && approx(asc.lat, 0, 1e-9));
    const desc = moonOrbitPoint(180, Om);
    assert.ok(approx(desc.lon, southNodeLon(Om), 1e-9) && approx(desc.lat, 0, 1e-9));
  });
  it('moonOrbitPoint extrema are +/- the mean inclination', () => {
    assert.equal(MOON_ORBIT_INCL, 5.14);
    const n = moonOrbitPoint(90, 125.7), s = moonOrbitPoint(270, 125.7);
    assert.ok(approx(n.lat, MOON_ORBIT_INCL, 1e-9));
    assert.ok(approx(s.lat, -MOON_ORBIT_INCL, 1e-9));
  });
  it('moonOrbitPoint traces a unit great circle (planar to 1e-12)', () => {
    const Om = 300.25, inc = MOON_ORBIT_INCL * DEG2RAD;
    const nx = Math.sin(Om * DEG2RAD) * Math.sin(inc);
    const ny = -Math.cos(Om * DEG2RAD) * Math.sin(inc);
    const nz = Math.cos(inc);
    for (let u = 0; u < 360; u += 7) {
      const { lon, lat } = moonOrbitPoint(u, Om);
      const lr = lon * DEG2RAD, br = lat * DEG2RAD;
      const px = Math.cos(br) * Math.cos(lr), py = Math.cos(br) * Math.sin(lr), pz = Math.sin(br);
      assert.ok(Math.abs(px * px + py * py + pz * pz - 1) < 1e-12);
      assert.ok(Math.abs(nx * px + ny * py + nz * pz) < 1e-12);
    }
  });
});

describe('drag helpers', () => {
  it('dragYaw moves 0.25 deg/px and wraps', () => {
    assert.ok(approx(dragYaw(Math.PI, 0), Math.PI, 1e-12));
    assert.ok(approx(dragYaw(Math.PI, 40), Math.PI - 10 * DEG2RAD, 1e-12));
    // wrap past 0 stays in [0, 2pi)
    const y = dragYaw(0.01, 40);
    assert.ok(y >= 0 && y < 2 * Math.PI, `y=${y}`);
    assert.ok(approx(y, (360 + 0.01 / DEG2RAD - 10) * DEG2RAD, 1e-12));
  });
  it('dragPitch clamps to [-1.45, 1.45]', () => {
    assert.equal(dragPitch(0, 10000), -1.45);
    assert.equal(dragPitch(0, -10000), 1.45);
    assert.ok(approx(dragPitch(0.5, 100), 0.5 - 0.4, 1e-12));
  });
});

describe('daylightFactors', () => {
  it('is full night below -18 deg', () => {
    const f = daylightFactors(-25);
    assert.deepEqual(f, { dayF: 0, highF: 0, twiF: 0, starF: 1, bodyF: 1, lineF: 1 });
  });
  it('is full day well above the horizon', () => {
    const f = daylightFactors(53);
    assert.equal(f.dayF, 1);
    assert.equal(f.highF, 1);
    assert.equal(f.twiF, 0);
    assert.equal(f.starF, 0);
    assert.equal(f.bodyF, 0);
    assert.equal(f.lineF, 0.25);
  });
  it('ramps the sun-height factor from sunrise to mid-morning', () => {
    assert.equal(daylightFactors(-5).highF, 0);
    assert.equal(daylightFactors(0).highF, 0);
    const mid = daylightFactors(17.5).highF;
    assert.ok(mid > 0.4 && mid < 0.6, `highF=${mid}`);
    assert.equal(daylightFactors(35).highF, 1);
    assert.equal(daylightFactors(60).highF, 1);
    let prev = -1;
    for (let h = 0; h <= 40; h += 1) {
      const v = daylightFactors(h).highF;
      assert.ok(v >= prev, `h=${h} broke monotonicity`);
      prev = v;
    }
  });
  it('peaks twilight glow mid-twilight with stars fading', () => {
    const f = daylightFactors(-8);
    assert.ok(approx(f.dayF, 0.104, 1e-3));
    assert.equal(f.twiF, 1);
    assert.ok(f.starF > 0.5 && f.starF < 0.65, `starF=${f.starF}`);
    assert.equal(f.bodyF, 1); // planets still fully visible
  });
  it('keeps planets visible at sunrise while stars are gone', () => {
    const f = daylightFactors(0);
    assert.equal(f.dayF, 1);
    assert.equal(f.starF, 0);
    assert.ok(f.bodyF > 0.3 && f.bodyF < 0.4, `bodyF=${f.bodyF}`);
  });
  it('stays within [0,1] across the whole range', () => {
    for (let h = -90; h <= 90; h += 2) {
      for (const v of Object.values(daylightFactors(h)))
        assert.ok(v >= 0 && v <= 1, `h=${h} v=${v}`);
    }
  });
});
