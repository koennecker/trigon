// sky-data.js — pure astronomy math and lore data for the Sky tab.
//
// No DOM, no three.js, no network: everything here is importable from node
// for unit tests. The 3D rendering lives in sky.js; the WASM ephemeris stays
// behind app.js (positions arrive via computeChart's 84-double output).
//
// Conventions: angles in degrees unless noted; RA in degrees (0-360);
// azimuth measured from north, eastward; JD = Julian day (UT).

// --- Shared type contracts ----------------------------------------------------
// These typedefs document the idiosyncratic seams of the app: the flat
// WASM output layout, the ephemeris snapshot handed to the Sky viewer, and
// the parsed star records. They are checked by `tsc --noEmit --checkJs`
// (see site/jsconfig.json); keep them in sync with swe_wrap.c and app.js.

/**
 * Flat 84-double output of the WASM `chart_compute` (see swe_wrap.c).
 * Body i in 0..11 (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn,
 * Uranus, Neptune, Pluto, True Node, Mean Node):
 *   out[6*i+0] ecliptic longitude, degrees [0,360)
 *   out[6*i+1] ecliptic latitude, degrees
 *   out[6*i+2] distance, AU
 *   out[6*i+3] speed in longitude, degrees/day (sign => direct/retrograde)
 *   out[6*i+4] declination, degrees
 *   out[6*i+5] apparent magnitude
 * (for the two nodes only out[6*i+0] is meaningful)
 * out[72] Ascendant, degrees; out[73] MC, degrees;
 * out[74+i] whole-sign house number (1..12) of body i, i in 0..9.
 * @typedef {Array<number>} EphOut
 */

/** Field offsets within one 6-double body slot of an {@link EphOut}. */
export const EPH_LON = 0, EPH_LAT = 1, EPH_DIST = 2, EPH_LONSPD = 3, EPH_DEC = 4, EPH_MAG = 5;
/** Slot base index of body i: `out[EPH_SLOT(i) + EPH_LON]` is its longitude.
 * @param {number} i body index 0..11
 * @returns {number} */
export const EPH_SLOT = i => 6 * i;
export const EPH_ASC = 72, EPH_MC = 73, EPH_HOUSE0 = 74;

/**
 * Chart input as built by readInputs() in app.js and handed to computeChart.
 * @typedef {object} ChartInput
 * @property {number} y astronomical year (<=0 means BCE)
 * @property {number} mo month 1..12
 * @property {number} d day of month 1..31
 * @property {number} hourUT UT hour of day
 * @property {number} lat geographic latitude, degrees (+N)
 * @property {number} lon geographic longitude, degrees (+E)
 * @property {number} utcMs Unix milliseconds of the instant
 * @property {boolean} bce true when y < 1
 * @property {boolean} gregorian true for Gregorian calendar dates
 */

/**
 * Live ephemeris snapshot: the `{out, inp, utcMs}` object app.js hands to
 * `createSkyUI({ getEphemeris })`, or null before the first calculation.
 * @typedef {object} EphemerisSnapshot
 * @property {EphOut} out the 84-double WASM output
 * @property {ChartInput} inp the chart input that produced it
 * @property {number} utcMs Unix milliseconds of the instant
 */

/**
 * One merged sefstars.txt record, J2000 mean place.
 * @typedef {object} StarRecord
 * @property {string} name traditional name (or bayer when unnamed)
 * @property {string} bayer nomenclature code
 * @property {number} ra0 J2000 right ascension, degrees
 * @property {number} dec0 J2000 declination, degrees
 * @property {number} pmRA proper motion in RA, mas/yr * cos(dec)
 * @property {number} pmDec proper motion in Dec, mas/yr
 * @property {number} mag apparent V magnitude
 * @property {string[]} altNames alternate names merged from duplicate records
 */

/** Equatorial coordinates, degrees. @typedef {{ra: number, dec: number}} EqCoords */
/** Ecliptic coordinates, degrees. @typedef {{lon: number, lat: number}} EclCoords */
/** Horizontal coordinates, degrees (az from north, eastward). @typedef {{az: number, alt: number}} HorizCoords */

/**
 * Layer opacities for the realistic-daylight model, all 0..1.
 * @typedef {object} DaylightFactors
 * @property {number} dayF sky brightness
 * @property {number} highF sun-height factor: color distribution evolution after brightness saturates
 * @property {number} twiF twilight glow strength
 * @property {number} starF star visibility (fades first)
 * @property {number} bodyF planet visibility (lingers through twilight)
 * @property {number} lineF overlay line visibility (dims, never vanishes)
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const J2000 = 2451545.0;          // JD of J2000.0
export const B1950 = 2433282.4235;       // JD of B1950.0 (FK4)
export const JD_UNIX = 2440587.5;        // JD of 1970-01-01 00:00 UTC

/**
 * @param {number} d
 * @returns {number}
 */
export function norm360(d) {
  let x = d % 360;
  if (x < 0) x += 360;
  // Avoid returning 360 for values like 359.9999999999 -> keep as-is; only
  // coerce exact multiples.
  return x;
}

// Mean obliquity of the ecliptic (Meeus, Astronomical Algorithms ch. 22).
/**
 * @param {number} jd
 * @returns {number}
 */
export function meanObliquity(jd) {
  const T = (jd - J2000) / 36525;
  return 23.4392911 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}

// Greenwich Mean Sidereal Time, degrees (Meeus ch. 12).
/**
 * @param {number} jd
 * @returns {number}
 */
export function gmstDeg(jd) {
  const T = (jd - J2000) / 36525;
  const d = jd - J2000;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - T * T * T / 38710000);
}

// Local Mean Sidereal Time, degrees. lonEastDeg: geographic longitude, east positive.
/**
 * @param {number} jd
 * @param {number} lonEastDeg
 * @returns {number}
 */
export function lstDeg(jd, lonEastDeg) {
  return norm360(gmstDeg(jd) + lonEastDeg);
}

/**
 * @param {number} ms
 * @returns {number}
 */
export function unixMsToJd(ms) {
  return ms / 86400000 + JD_UNIX;
}

// --- Precession ------------------------------------------------------------
// Mean equator/equinox of fromJD -> mean equator/equinox of toJD, via the
// rotation-matrix form of Meeus ch. 21: P(t0->t1) = P(J2000->t1) * P(J2000->t0)^T.
// Verified: exact round-trips, forward direction matches Meeus eq. 21.3 to
// 1e-15, NCP displacement 0.5566 deg/cy (= 50.29"/yr * sin(eps)).

/**
 * @param {number} aDeg
 * @returns {number[][]}
 */
function rot3(aDeg) {
  const a = aDeg * DEG2RAD, c = Math.cos(a), s = Math.sin(a);
  return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
}
/**
 * @param {number} aDeg
 * @returns {number[][]}
 */
function rot2(aDeg) {
  const a = aDeg * DEG2RAD, c = Math.cos(a), s = Math.sin(a);
  return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
}
/**
 * @param {number[][]} A
 * @param {number[][]} B
 * @returns {number[][]}
 */
function matMul(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
}
/**
 * @param {number[][]} A
 * @returns {number[][]}
 */
function matTrans(A) {
  return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
}

// Precession matrix J2000 -> T (Julian centuries from J2000).
/**
 * @param {number} T
 * @returns {number[][]}
 */
function precMatrix(T) {
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) / 3600;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) / 3600;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) / 3600;
  return matMul(rot3(-z), matMul(rot2(theta), rot3(-zeta)));
}

/**
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} fromJD
 * @param {number} toJD
 * @returns {EqCoords}
 */
export function precess(raDeg, decDeg, fromJD, toJD) {
  const T0 = (fromJD - J2000) / 36525, T1 = (toJD - J2000) / 36525;
  const P = matMul(precMatrix(T1), matTrans(precMatrix(T0)));
  const r = raDeg * DEG2RAD, d = decDeg * DEG2RAD;
  const v0 = [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
  const v = [
    P[0][0] * v0[0] + P[0][1] * v0[1] + P[0][2] * v0[2],
    P[1][0] * v0[0] + P[1][1] * v0[1] + P[1][2] * v0[2],
    P[2][0] * v0[0] + P[2][1] * v0[1] + P[2][2] * v0[2],
  ];
  return {
    ra: norm360(Math.atan2(v[1], v[0]) * RAD2DEG),
    dec: Math.asin(Math.max(-1, Math.min(1, v[2]))) * RAD2DEG,
  };
}

// --- Coordinate transforms ------------------------------------------------

// Ecliptic -> equatorial (Meeus ch. 13).
/**
 * @param {number} lonDeg
 * @param {number} latDeg
 * @param {number} epsDeg
 * @returns {EqCoords}
 */
export function eclToEq(lonDeg, latDeg, epsDeg) {
  const l = lonDeg * DEG2RAD, b = latDeg * DEG2RAD, e = epsDeg * DEG2RAD;
  const sinDec = Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const y = Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e);
  const x = Math.cos(l);
  return { ra: norm360(Math.atan2(y, x) * RAD2DEG), dec: dec * RAD2DEG };
}

// Equatorial -> ecliptic.
/**
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} epsDeg
 * @returns {EclCoords}
 */
export function eqToEcl(raDeg, decDeg, epsDeg) {
  const a = raDeg * DEG2RAD, d = decDeg * DEG2RAD, e = epsDeg * DEG2RAD;
  const sinLat = Math.sin(d) * Math.cos(e) - Math.cos(d) * Math.sin(e) * Math.sin(a);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  const y = Math.sin(a) * Math.cos(e) + Math.tan(d) * Math.sin(e);
  const x = Math.cos(a);
  return { lon: norm360(Math.atan2(y, x) * RAD2DEG), lat: lat * RAD2DEG };
}

// Equatorial -> horizontal. az from north, eastward; verified against an
// independent 3D-vector derivation.
/**
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} lstDeg
 * @param {number} latDeg
 * @returns {HorizCoords}
 */
export function eqToHoriz(raDeg, decDeg, lstDeg, latDeg) {
  const H = (lstDeg - raDeg) * DEG2RAD;
  const dec = decDeg * DEG2RAD, lat = latDeg * DEG2RAD;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
  return { az: norm360(az * RAD2DEG + 180), alt: alt * RAD2DEG };
}

// Smoothstep edge, local helper.
/**
 * @param {number} a
 * @param {number} b
 * @param {number} x
 * @returns {number}
 */
function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Realistic-daylight layer opacities from the Sun's altitude (degrees).
// A stylized but phase-honest model: stars wash out through twilight while
// planets (morning/evening stars) linger near the Sun until well after
// sunrise; overlay lines dim but never vanish. Prototype-verified in
// Python against sunrise/sunset for 33.4N 112.1W on 2026-10-01.
/**
 * @param {number} sunAltDeg
 * @returns {DaylightFactors}
 */
export function daylightFactors(sunAltDeg) {
  const h = sunAltDeg;
  const dayF = sstep(-10, 0, h);                            // sky brightness 0..1
  const highF = sstep(0, 35, h);                            // sun-height factor: the zenith/horizon color
                                                            // distribution keeps evolving after brightness saturates
  const twiF = sstep(-18, -12, h) * (1 - sstep(-4, 2, h));   // twilight glow, peaks mid-twilight
  const starF = 1 - sstep(-12, -3, h);                       // stars fade first
  const bodyF = 1 - sstep(-6, 4, h);                         // planets linger through twilight
  const lineF = 1 - dayF * 0.75;                             // overlays dim, stay legible
  return { dayF, highF, twiF, starF, bodyF, lineF };
}

// Horizontal (az from north eastward, alt) -> cartesian on a sphere of radius R.
// x east, y up, z south-negated: az=0 (north) -> -z, az=90 (east) -> +x.
/**
 * @param {number} azDeg
 * @param {number} altDeg
 * @param {number} R
 * @returns {number[]}
 */
export function horizToVec(azDeg, altDeg, R) {
  const az = azDeg * DEG2RAD, alt = altDeg * DEG2RAD, c = Math.cos(alt);
  return [R * c * Math.sin(az), R * Math.sin(alt), -R * c * Math.cos(az)];
}

// Equatorial (RA/Dec) -> cartesian on the celestial sphere, y = north
// celestial pole. Same axis convention as horizToVec, so the horizontal and
// equatorial world frames coincide when LST/lat align them.
/**
 * @param {number} raDeg
 * @param {number} decDeg
 * @param {number} R
 * @returns {number[]}
 */
export function eqToVec(raDeg, decDeg, R) {
  return horizToVec(raDeg, decDeg, R);
}

// Inverse of eqToHoriz: horizontal -> equatorial, via the observer-frame
// basis (east, up, south) expressed in equatorial cartesian coordinates.
// Verified by 20k-case round-trip in Python (worst error ~1e-11 deg).
/**
 * @param {number} azDeg
 * @param {number} altDeg
 * @param {number} lstDeg
 * @param {number} latDeg
 * @returns {EqCoords}
 */
export function horizToEq(azDeg, altDeg, lstDeg, latDeg) {
  const eE = eqToVec(lstDeg + 90, 0, 1);          // east point of the horizon
  const eU = eqToVec(lstDeg, latDeg, 1);         // zenith
  const nP = eqToVec(lstDeg + 180, 90 - latDeg, 1); // north point of the horizon
  const eS = [-nP[0], -nP[1], -nP[2]];           // south point
  const [vx, vy, vz] = horizToVec(azDeg, altDeg, 1);
  const ex = vx * eE[0] + vy * eU[0] + vz * eS[0];
  const ey = vx * eE[1] + vy * eU[1] + vz * eS[1];
  const ez = vx * eE[2] + vy * eU[2] + vz * eS[2];
  return {
    ra: norm360(Math.atan2(ex, -ez) * RAD2DEG),
    dec: Math.asin(Math.max(-1, Math.min(1, ey))) * RAD2DEG,
  };
}

// Whole-sign house cusp longitudes from the Ascendant (tropical).
/**
 * @param {number} ascLonDeg
 * @returns {number[]}
 */
export function houseCusps(ascLonDeg) {
  const s0 = Math.floor(norm360(ascLonDeg) / 30) * 30;
  return Array.from({ length: 12 }, (_, i) => (s0 + i * 30) % 360);
}

// Tropical sign boundary longitudes.
/**
 * @returns {number[]}
 */
export function signCusps() {
  return Array.from({ length: 12 }, (_, i) => i * 30);
}

// Galactic (l, b, J2000) -> equatorial (J2000). Rotation matrix (Perryman/ESA):
// gal = M * eq, so eq = M^T * gal. Verified: galactic centre -> (266.405, -28.936).
const GAL_M = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
/**
 * @param {number} lDeg
 * @param {number} bDeg
 * @returns {EqCoords}
 */
export function galacticToEq(lDeg, bDeg) {
  const l = lDeg * DEG2RAD, b = bDeg * DEG2RAD;
  const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  const e = [
    GAL_M[0][0] * g[0] + GAL_M[1][0] * g[1] + GAL_M[2][0] * g[2],
    GAL_M[0][1] * g[0] + GAL_M[1][1] * g[1] + GAL_M[2][1] * g[2],
    GAL_M[0][2] * g[0] + GAL_M[1][2] * g[1] + GAL_M[2][2] * g[2],
  ];
  return {
    ra: norm360(Math.atan2(e[1], e[0]) * RAD2DEG),
    dec: Math.asin(Math.max(-1, Math.min(1, e[2]))) * RAD2DEG,
  };
}

// --- Ayanamsa ---------------------------------------------------------------
// Lahiri ayanamsa, linear approximation: anchored at 23 deg 51' 11"
// (23.8531 deg) on J2000.0, increasing at the general-precession rate
// 50.2876"/yr. Good to ~0.02 deg within a few centuries of 2000 — plenty
// for drawing 13.33-deg-wide nakshatras. Documented as approximate.
/**
 * @param {number} jd
 * @returns {number}
 */
export function lahiriAyanamsa(jd) {
  return 23.8531 + (jd - J2000) * (50.2876 / 3600) / 365.25;
}

// --- Tropical zodiac (12 signs) ----------------------------------------------

export const SIGNS = [
  { name: 'Aries',       glyph: '♈', element: 'fire',  delineation: 'Initiative and courage; the spark that starts.' },
  { name: 'Taurus',      glyph: '♉', element: 'earth', delineation: 'Steadiness and sensuality; the builder that endures.' },
  { name: 'Gemini',      glyph: '♊', element: 'air',   delineation: 'Curiosity and exchange; the messenger that connects.' },
  { name: 'Cancer',      glyph: '♋', element: 'water', delineation: 'Nurture and memory; the tide that shelters.' },
  { name: 'Leo',         glyph: '♌', element: 'fire',  delineation: 'Radiance and loyalty; the heart that performs.' },
  { name: 'Virgo',       glyph: '♍', element: 'earth', delineation: 'Discernment and craft; the hand that perfects.' },
  { name: 'Libra',       glyph: '♎', element: 'air',   delineation: 'Harmony and justice; the scales that weigh.' },
  { name: 'Scorpio',     glyph: '♏', element: 'water', delineation: 'Intensity and transformation; the depths that renew.' },
  { name: 'Sagittarius', glyph: '♐', element: 'fire',  delineation: 'Vision and quest; the arrow that seeks.' },
  { name: 'Capricorn',   glyph: '♑', element: 'earth', delineation: 'Mastery and patience; the mountain that stands.' },
  { name: 'Aquarius',    glyph: '♒', element: 'air',   delineation: 'Freedom and foresight; the wave that breaks.' },
  { name: 'Pisces',      glyph: '♓', element: 'water', delineation: 'Compassion and dissolution; the ocean that dreams.' },
];

// --- Indian nakshatras (27, sidereal) -----------------------------------------
// Each spans 13 deg 20' of sidereal longitude. yogatara: principal star, using
// the identifications in sefstars.txt's own alternate-name records where present
// (bayer: sefstars nomenclature code, lowercase).

export const NAKSHATRAS = [
  { name: 'Ashvini',         deity: 'Ashvin Kumaras',  ruler: 'Ketu',    yogatara: 'Sheratan',      bayer: 'beari', delineation: 'Swift healing and initiative; the physicians of the gods.' },
  { name: 'Bharani',         deity: 'Yama',            ruler: 'Venus',   yogatara: '41 Arietis',    bayer: '41ari', delineation: 'Bearing and restraint; creative energy held until its proper birth.' },
  { name: 'Krittika',        deity: 'Agni',            ruler: 'Sun',     yogatara: 'Alcyone',       bayer: 'ettau', delineation: 'The cutters; sharp discernment that purifies by fire.' },
  { name: 'Rohini',          deity: 'Prajapati',       ruler: 'Moon',    yogatara: 'Aldebaran',     bayer: 'altau', delineation: 'The ruddy one; beauty, fertility and allure — the Moon’s favourite wife.' },
  { name: 'Mrigashira',      deity: 'Soma',            ruler: 'Mars',    yogatara: 'Meissa',        bayer: 'laori', delineation: 'The deer’s head; the eternal seeker — curious and restless.' },
  { name: 'Ardra',           deity: 'Rudra',           ruler: 'Rahu',    yogatara: 'Betelgeuse',    bayer: 'alori', delineation: 'The moist one; the storm’s intensity — destruction that clears the way.' },
  { name: 'Punarvasu',       deity: 'Aditi',           ruler: 'Jupiter', yogatara: 'Pollux',        bayer: 'begem', delineation: 'Return of the light; renewal and safe recovery after loss.' },
  { name: 'Pushya',          deity: 'Brihaspati',      ruler: 'Saturn',  yogatara: 'Asellus Australis', bayer: 'decnc', delineation: 'The nourisher; devotion, counsel and quiet thriving.' },
  { name: 'Ashlesha',        deity: 'the Nagas',       ruler: 'Mercury', yogatara: 'ε Hydrae',      bayer: 'ephya', delineation: 'The entwiner; serpent wisdom — insight coiled around hidden things.' },
  { name: 'Magha',           deity: 'the Pitris',      ruler: 'Ketu',    yogatara: 'Regulus',       bayer: 'alleo', delineation: 'The mighty; ancestral authority and the dignity of lineage.' },
  { name: 'Purva Phalguni',  deity: 'Bhaga',           ruler: 'Venus',   yogatara: 'Zosma',         bayer: 'deleo', delineation: 'The former red one; pleasure, affection and the arts of delight.' },
  { name: 'Uttara Phalguni', deity: 'Aryaman',         ruler: 'Sun',     yogatara: 'Denebola',      bayer: 'beleo', delineation: 'The latter red one; loyalty, patronage and lasting alliances.' },
  { name: 'Hasta',           deity: 'Savitar',         ruler: 'Moon',    yogatara: 'δ Corvi',       bayer: 'decrv', delineation: 'The hand; skill, craft and ready helpfulness.' },
  { name: 'Chitra',          deity: 'Vishvakarma',     ruler: 'Mars',    yogatara: 'Spica',         bayer: 'alvir', delineation: 'The brilliant; the celestial architect’s art — form given to vision.' },
  { name: 'Svati',           deity: 'Vayu',            ruler: 'Rahu',    yogatara: 'Arcturus',      bayer: 'alboo', delineation: 'Independence; the wind’s freedom — self-reliant, easily scattered.' },
  { name: 'Vishakha',        deity: 'Indra-Agni',      ruler: 'Jupiter', yogatara: 'ι Librae',      bayer: null,    delineation: 'The forked branches; ambition that triumphs through concentrated effort.' },
  { name: 'Anuradha',        deity: 'Mitra',           ruler: 'Saturn',  yogatara: 'Dschubba',      bayer: 'desco', delineation: 'Following Radha; devotion in friendship — success through cooperation.' },
  { name: 'Jyeshtha',        deity: 'Indra',           ruler: 'Mercury', yogatara: 'Antares',       bayer: 'alsco', delineation: 'The eldest; seniority, occult power and the burdens of rank.' },
  { name: 'Mula',            deity: 'Nirriti',         ruler: 'Ketu',    yogatara: 'Shaula',        bayer: 'lasco', delineation: 'The root; going to the root of things — uprooting, fearless research.' },
  { name: 'Purva Ashadha',   deity: 'Apas',            ruler: 'Venus',   yogatara: 'Kaus Media',    bayer: 'desgr', delineation: 'The former invincible; conviction that cannot be defeated.' },
  { name: 'Uttara Ashadha',  deity: 'Vishvadevas',     ruler: 'Sun',     yogatara: 'Nunki',         bayer: 'sisgr', delineation: 'The latter invincible; enduring victory through righteousness.' },
  { name: 'Shravana',        deity: 'Vishnu',          ruler: 'Moon',    yogatara: 'Altair',        bayer: 'alaql', delineation: 'Hearing; learning by listening — fame through knowledge.' },
  { name: 'Dhanishta',       deity: 'the Vasus',       ruler: 'Mars',    yogatara: 'Sualocin',      bayer: 'bedel', delineation: 'The richest; wealth, music and rhythm — the drum of the gods.' },
  { name: 'Shatabhisha',     deity: 'Varuna',          ruler: 'Rahu',    yogatara: 'λ Aquarii',     bayer: 'laaqr', delineation: 'A hundred healers; the veiled healer — mystery, solitude, medicine.' },
  { name: 'Purva Bhadrapada',deity: 'Aja Ekapada',     ruler: 'Jupiter', yogatara: 'Markab',        bayer: 'alpeg', delineation: 'The former lucky feet; spiritual fire — the ascetic’s intensity.' },
  { name: 'Uttara Bhadrapada', deity: 'Ahirbudhnya',   ruler: 'Saturn',  yogatara: 'Algenib',       bayer: 'gapeg', delineation: 'The latter lucky feet; depth and stillness — the serpent of the deep.' },
  { name: 'Revati',          deity: 'Pushan',          ruler: 'Mercury', yogatara: 'ζ Piscium',     bayer: 'zepsc', delineation: 'The wealthy; the protector of the road — safe journeys and compassion.' },
];

// Nakshatra index (0-26) for a tropical longitude, given the ayanamsa.
/**
 * @param {number} tropLonDeg
 * @param {number} ayanamsaDeg
 * @returns {number}
 */
export function nakshatraIndex(tropLonDeg, ayanamsaDeg) {
  const sid = norm360(tropLonDeg - ayanamsaDeg);
  return Math.min(26, Math.floor(sid / (360 / 27)));
}

// Tropical-longitude spans of the 27 nakshatras: [{start, end}] in degrees.
/**
 * @param {number} ayanamsaDeg
 * @returns {Array<{start: number, end: number, width: number}>}
 */
export function nakshatraSpans(ayanamsaDeg) {
  const w = 360 / 27, spans = [];
  for (let i = 0; i < 27; i++) {
    const s = norm360(i * w + ayanamsaDeg);
    spans.push({ start: s, end: norm360(s + w), width: w });
  }
  return spans;
}

// --- Chinese 28 lunar mansions (xiu) ------------------------------------------
// Equatorial system. The traditional definition: each mansion runs eastward
// from its determinative star's hour circle to the next mansion's — so the
// boundaries ARE the determinative stars' right ascensions and the ring
// always tiles with no gaps. Widths in du (Chinese degrees, 365.25 per
// circle) are the classical tabulated values, kept as reference; the drawn
// spans use the stars' actual apparent RAs, which is why a mansion's drawn
// width can differ slightly from its classical du.
// bayer: sefstars nomenclature code (lowercase) or null when the star is
// absent from the file — the viewer then starts the mansion where the
// previous one ends and extends it by the classical width, keeping the ring
// tiled.

export const XIU = [
  // Eastern palace — the Azure Dragon
  { name: '角', pinyin: 'Jiǎo',  trans: 'Horn',      star: 'Spica',        bayer: 'alvir', du: 12, delineation: 'The Azure Dragon’s horn; spring’s beginning — the court takes the field.' },
  { name: '亢', pinyin: 'Kàng',  trans: 'Neck',      star: 'κ Virginis',   bayer: 'kavir', du: 9,  delineation: 'The dragon’s throat; judgment and scrutiny — illness and trial.' },
  { name: '氐', pinyin: 'Dī',    trans: 'Root',      star: 'Zubenelgenubi',bayer: 'al-2lib', du: 15, delineation: 'The dragon’s breast; the palace foundations laid.' },
  { name: '房', pinyin: 'Fáng',  trans: 'Room',      star: 'π Scorpii',    bayer: 'pisco', du: 5,  delineation: 'The dragon’s belly; the Son of Heaven’s chambers — union and fertility.' },
  { name: '心', pinyin: 'Xīn',   trans: 'Heart',     star: 'σ Scorpii',    bayer: 'sisco', du: 5,  delineation: 'The dragon’s heart; the emperor himself — a great omen star.' },
  { name: '尾', pinyin: 'Wěi',   trans: 'Tail',      star: 'μ Scorpii',    bayer: null,    du: 18, delineation: 'The dragon’s tail; succession and the heir.' },
  { name: '箕', pinyin: 'Jī',    trans: 'Winnowing', star: 'γ Sagittarii', bayer: 'gasgr', du: 11, delineation: 'The winnowing fan; wind, gossip and separation.' },
  // Northern palace — the Black Tortoise
  { name: '斗', pinyin: 'Dǒu',   trans: 'Dipper',    star: 'φ Sagittarii', bayer: 'phsgr', du: 26, delineation: 'The Southern Dipper; measure and justice — the celestial bushel.' },
  { name: '牛', pinyin: 'Niú',   trans: 'Ox',        star: 'β Capricorni', bayer: 'becap', du: 8,  delineation: 'The ox; agriculture and patient labour.' },
  { name: '女', pinyin: 'Nǚ',    trans: 'Girl',      star: 'ε Aquarii',    bayer: 'epaqr', du: 12, delineation: 'The weaving girl; marriage and women’s work.' },
  { name: '虚', pinyin: 'Xū',    trans: 'Emptiness', star: 'β Aquarii',    bayer: 'beaqr', du: 10, delineation: 'The void; mourning rites — what is hollowed out.' },
  { name: '危', pinyin: 'Wēi',   trans: 'Rooftop',   star: 'α Aquarii',    bayer: 'alaqr', du: 17, delineation: 'The rooftop; peril at the heights.' },
  { name: '室', pinyin: 'Shì',   trans: 'Camp',      star: 'α Pegasi',     bayer: 'alpeg', du: 16, delineation: 'The barracks; building and the war-camp.' },
  { name: '壁', pinyin: 'Bì',    trans: 'Wall',      star: 'γ Pegasi',     bayer: 'gapeg', du: 9,  delineation: 'The wall; the library and the city’s defence.' },
  // Western palace — the White Tiger
  { name: '奎', pinyin: 'Kuí',   trans: 'Legs',      star: 'η Andromedae', bayer: 'etand', du: 16, delineation: 'The White Tiger’s stride; literature and the military step.' },
  { name: '婁', pinyin: 'Lóu',   trans: 'Bond',      star: 'β Arietis',    bayer: 'beari', du: 12, delineation: 'The bond; gathering the harvest, sacrifice.' },
  { name: '胃', pinyin: 'Wèi',   trans: 'Stomach',   star: '35 Arietis',   bayer: null,    du: 14, delineation: 'The granary; stores and the kitchen.' },
  { name: '昴', pinyin: 'Mǎo',   trans: 'Mane',      star: 'Alcyone',      bayer: 'ettau', du: 11, delineation: 'The mane; the hairy head — the hunt and the army.' },
  { name: '畢', pinyin: 'Bì',    trans: 'Net',       star: 'ε Tauri',      bayer: 'eptau', du: 16, delineation: 'The hunting net; rain and the snare.' },
  { name: '觜', pinyin: 'Zī',    trans: 'Beak',      star: 'λ Orionis',    bayer: 'laori', du: 1,  delineation: 'The turtle’s beak; the spearhead — a tiny, sharp mansion.' },
  { name: '参', pinyin: 'Shēn',  trans: 'Triad',     star: 'ζ Orionis',    bayer: 'zeori', du: 10, delineation: 'The three stars; Orion’s banner — the hunt and the army’s van.' },
  // Southern palace — the Vermilion Bird
  { name: '井', pinyin: 'Jǐng',  trans: 'Well',      star: 'μ Geminorum',  bayer: 'mugem', du: 33, delineation: 'The well; irrigation — the Vermilion Bird’s first mansion.' },
  { name: '鬼', pinyin: 'Guǐ',   trans: 'Ghost',     star: 'θ Cancri',     bayer: null,    du: 4,  delineation: 'The ghost; the pile of corpses — death and the ancestral altar.' },
  { name: '柳', pinyin: 'Liǔ',   trans: 'Willow',    star: 'δ Hydrae',     bayer: 'dehya', du: 15, delineation: 'The willow; the kitchens and mourning.' },
  { name: '星', pinyin: 'Xīng',  trans: 'Star',      star: 'α Hydrae',     bayer: 'alhya', du: 7,  delineation: 'The star; the heart of summer.' },
  { name: '張', pinyin: 'Zhāng', trans: 'Net',       star: 'υ¹ Hydrae',    bayer: 'up-1hya', du: 18, delineation: 'The extended net; feasting and celebration.' },
  { name: '翼', pinyin: 'Yì',    trans: 'Wings',     star: 'α Crateris',   bayer: 'alcrt', du: 20, delineation: 'The wings; music and flight.' },
  { name: '軫', pinyin: 'Zhěn',  trans: 'Chariot',   star: 'γ Corvi',      bayer: 'gacrv', du: 17, delineation: 'The celestial chariot; the winds and the journey’s end.' },
];

// Boundaries of the 28 mansions. raByBayer: Map<bayer, raDeg> of determinative
// stars (apparent, precessed to date). The classical definition: each mansion
// runs eastward from its determinative star's hour circle to the next
// mansion's — so boundaries sit on the stars themselves and the ring always
// tiles. Where a determinative star is missing from the catalogue, the gap
// between the neighbouring known stars is divided in proportion to the
// classical du widths. Returns [{startRA, endRA, widthDeg, ...xiu}]; endRA
// can exceed 360 across the 0h wrap.
/**
 * @param {Map<string, number>} raByBayer
 */
export function xiuSpans(raByBayer) {
  const n = XIU.length;
  const known = []; // [index, raDeg] for mansions with a catalogued star
  for (let i = 0; i < n; i++) {
    const b = XIU[i].bayer;
    const ra = b ? raByBayer.get(b) : undefined;
    if (ra !== undefined) known.push([i, norm360(ra)]);
  }
  const spans = new Array(n);
  if (!known.length) { // degenerate: pure classical widths from RA 0
    const totalDu = XIU.reduce((s, x) => s + x.du, 0);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const w = XIU[i].du * 360 / totalDu;
      spans[i] = { ...XIU[i], startRA: s, endRA: s + w, widthDeg: w };
      s += w;
    }
    return spans;
  }
  for (let g = 0; g < known.length; g++) {
    const [j, raJ] = known[g];
    const [k] = known[(g + 1) % known.length];
    let raK = known[(g + 1) % known.length][1];
    if (raK <= raJ) raK += 360;
    let gapDu = 0;
    for (let i = j; i !== k; i = (i + 1) % n) gapDu += XIU[i].du;
    let accDu = 0;
    for (let i = j; i !== k; i = (i + 1) % n) {
      const start = raJ + (raK - raJ) * (accDu / gapDu);
      accDu += XIU[i].du;
      const end = raJ + (raK - raJ) * (accDu / gapDu);
      spans[i] = { ...XIU[i], startRA: norm360(start), endRA: end, widthDeg: end - start };
    }
  }
  return spans;
}

// --- View drag helpers --------------------------------------------------------
// yaw/pitch are radians. Dragging right decreases the view azimuth so the sky
// follows the cursor (grab-style); 0.25 deg/px matches the pitch rate.
/**
 * @param {number} yawRad
 * @param {number} dxPx
 * @returns {number}
 */
export function dragYaw(yawRad, dxPx) {
  return norm360(yawRad * RAD2DEG - dxPx * 0.25) * DEG2RAD;
}
/**
 * @param {number} pitchRad
 * @param {number} dyPx
 * @returns {number}
 */
export function dragPitch(pitchRad, dyPx) {
  return Math.max(-1.45, Math.min(1.45, pitchRad - dyPx * 0.004));
}

// --- Fixed-star lore ----------------------------------------------------------
// Delineations for the astrologically significant stars: Western,
// Islamicate, Indian and Chinese traditions. Each entry lists the keys it
// matches (traditional names and sefstars bayer codes, lowercased) and the
// traditions it speaks from. Kept to 1-2 sentences each: these are the
// received delineations, not modern reinterpretations.

export const STAR_LORE = [
  { k: ['sirius', 'alcma'], t: ['Western', 'Islamicate', 'Chinese'], d: 'The Dog Star, brightest of all. Its heliacal rising marked the Nile flood and the “dog days” — ambition, fame and a scorching intensity. Chinese: 天狼 Tiānláng, the celestial wolf.' },
  { k: ['canopus', 'alcar'], t: ['Western', 'Chinese'], d: 'The second-brightest star; the great southern beacon of navigators. Chinese: 老人星 the Old Man — longevity and sage counsel.' },
  { k: ['arcturus', 'alboo'], t: ['Western', 'Islamicate', 'Indian'], d: 'The Bear-Watcher; swift success through pioneering effort, with a volatile, prophetic edge. Yogatara of Svati.' },
  { k: ['vega', 'allyr'], t: ['Western', 'Islamicate', 'Chinese'], d: 'The falling vulture; music, artistry and refinement. Chinese: 織女 the Weaving Girl, parted from her lover by the Milky Way.' },
  { k: ['capella', 'alaur'], t: ['Western', 'Islamicate'], d: 'The she-goat; protective eminence and nurturing honours — Ptolemy gave it the natures of Mercury and Mars.' },
  { k: ['rigel', 'beori'], t: ['Western', 'Islamicate'], d: 'The giant’s foot; benevolence, mechanical ingenuity and lasting honours.' },
  { k: ['procyon', 'alCMi'], t: ['Western', 'Islamicate'], d: 'The little dog rising before Sirius; rapid martial success — and sudden falls.' },
  { k: ['betelgeuse', 'alori'], t: ['Western', 'Islamicate', 'Indian'], d: 'The armpit of the giant (Ar. ibt al-jawzā’); martial honours, wealth and impulsiveness. Yogatara of Ardra.' },
  { k: ['achernar', 'aleri'], t: ['Western', 'Islamicate'], d: 'The river’s end; philosophical and spiritual eminence at the edge of the map.' },
  { k: ['altair', 'alaql'], t: ['Western', 'Islamicate', 'Indian', 'Chinese'], d: 'The flying eagle; bold command and swift ambition. Yogatara of Shravana; Chinese: 牽牛 the Cowherd, lover of the Weaving Girl.' },
  { k: ['aldebaran', 'rohini', 'altau'], t: ['Western', 'Islamicate', 'Indian'], d: 'The Follower; one of the four Royal Stars of Persia — integrity rewarded with high honours. Yogatara of Rohini.' },
  { k: ['antares', 'jyeshtha', 'alsco'], t: ['Western', 'Islamicate', 'Indian'], d: 'Rival of Mars; a Royal Star — extremes of fortune, intensity, military brilliance. Yogatara of Jyeshtha.' },
  { k: ['spica', 'alvir'], t: ['Western', 'Islamicate', 'Indian', 'Chinese'], d: 'The ear of wheat; the most benefic fixed star — success in arts and sciences. Yogatara of Chitra; determinative of the Horn mansion.' },
  { k: ['pollux', 'punarvasu', 'begem'], t: ['Western', 'Islamicate', 'Indian'], d: 'The immortal twin; subtle, enduring intelligence. Yogatara of Punarvasu.' },
  { k: ['castor', 'algem'], t: ['Western'], d: 'The mortal twin; refinement and manners, shadowed by sudden reversals.' },
  { k: ['regulus', 'magha', 'alleo'], t: ['Western', 'Islamicate', 'Indian'], d: 'The Little King; the fourth Royal Star — lasting power only while revenge is avoided. Yogatara of Magha.' },
  { k: ['deneb', 'alcyg'], t: ['Western', 'Islamicate'], d: 'The hen’s tail; swift intelligence and a gift for all learning.' },
  { k: ['algol', 'beper'], t: ['Western', 'Islamicate'], d: 'The Demon’s Head (Ar. ra’s al-ghūl); the most malefic fixed star — violence and tragedy, or intense transformative power.' },
  { k: ['alcyone', 'ettau'], t: ['Western', 'Indian', 'Chinese'], d: 'The central Pleiad; mystical vision amid sorrow and exile. Yogatara of Krittika; determinative of the Mane mansion.' },
  { k: ['gemma', 'alphecca', 'alcrb'], t: ['Western'], d: 'The broken ring of the Northern Crown; honours in poetry and the arts.' },
  { k: ['bellatrix', 'gaori'], t: ['Western'], d: 'The female warrior; military triumph shadowed by sudden dishonour.' },
  { k: ['alnilam', 'epori'], t: ['Western', 'Chinese'], d: 'The string of pearls at Orion’s belt; honours that come — and go. Heart of the Triad mansion’s asterism.' },
  { k: ['alnitak', 'zeori'], t: ['Western', 'Chinese'], d: 'The girdle’s eastern end; fleeting eminence. Determinative of the Triad mansion.' },
  { k: ['mintaka', 'deori'], t: ['Western'], d: 'The belt’s western end; good fortune through boldness.' },
  { k: ['denebola', 'uttaraphalguni', 'beleo'], t: ['Western', 'Indian'], d: 'The lion’s tail; the unconventional path — going against the grain. Yogatara of Uttara Phalguni.' },
  { k: ['alphard', 'alhya'], t: ['Western', 'Chinese'], d: 'The solitary one; wisdom tinged with melancholy. Determinative of the Star mansion.' },
  { k: ['hamal', 'alari'], t: ['Western', 'Islamicate'], d: 'The ram’s head (Ar. ra’s al-ḥamal); bruising independence and leadership.' },
  { k: ['diphda', 'deneb kaitos', 'becet'], t: ['Western'], d: 'The whale’s tail; misfortune courted by excess — steadied by discipline.' },
  { k: ['mirach', 'beand'], t: ['Western'], d: 'The girdle; beauty and good fortune, especially in union.' },
  { k: ['alpheratz', 'aland'], t: ['Western', 'Islamicate', 'Indian'], d: 'The horse’s navel, Andromeda’s head (Ar. surrat al-faras); freedom, movement, honours. Yogatara of Purva Bhadrapada.' },
  { k: ['markab', 'alpeg'], t: ['Western', 'Indian'], d: 'The saddle; martial ambition with a risk of disgrace. Yogatara of Purva Bhadrapada.' },
  { k: ['algenib', 'gapeg'], t: ['Western', 'Indian'], d: 'The wing; penetrating intellect and exploration. Yogatara of Uttara Bhadrapada; determinative of the Wall mansion.' },
  { k: ['scheat', 'bepeg'], t: ['Western'], d: 'The shin; perils of the sea and of overreach.' },
  { k: ['sadr', 'gacyg'], t: ['Western'], d: 'The breast of the swan; visionary and prophetic gifts.' },
  { k: ['enif', 'eppeg'], t: ['Western'], d: 'The nose; the love of horses and of the chase.' },
  { k: ['fomalhaut', 'alpsa'], t: ['Western', 'Islamicate'], d: 'The fish’s mouth; a Royal Star of the south — idealism and spiritual authority; the “star of Gabriel”.' },
  { k: ['sadalmelik', 'alaqr'], t: ['Western'], d: 'The lucky stars of the king; humane and occult pursuits.' },
  { k: ['sadalsuud', 'beaqr'], t: ['Western', 'Chinese'], d: 'Luckiest of the lucky; fortune rising from obscurity. Determinative of the Emptiness mansion.' },
  { k: ['zubenelgenubi', 'al-2lib'], t: ['Western', 'Indian'], d: 'The southern claw (Ar. al-zuban al-janūbiyy); social reform through crisis. Yogatara of Vishakha in the Colebrook reckoning.' },
  { k: ['zubeneschamali', 'belib'], t: ['Western'], d: 'The northern claw; ambition crowned with honours.' },
  { k: ['unukalhai', 'alser'], t: ['Western'], d: 'The serpent’s heart; occult power, with danger from poisons and false friends.' },
  { k: ['rasalhague', 'aloph'], t: ['Western'], d: 'The serpent-bearer’s head; the healer’s gifts, perverse turns of fortune.' },
  { k: ['sabik', 'etoph'], t: ['Western'], d: 'The serpent-bearer’s second; success with a wasteful streak.' },
  { k: ['acrab', 'graffias', 'besco'], t: ['Western'], d: 'The scorpion’s claws; investigation, research, sudden events.' },
  { k: ['dschubba', 'anuradha', 'desco'], t: ['Western', 'Indian'], d: 'The forehead; bold, even shameless pursuit of aims. Yogatara of Anuradha.' },
  { k: ['lesath', 'upsco'], t: ['Western'], d: 'The sting’s barb; morbid, dangerous intensity.' },
  { k: ['shaula', 'mula', 'lasco'], t: ['Western', 'Indian'], d: 'The sting itself; extremes — triumph or catastrophe. Yogatara of Mula.' },
  { k: ['sargas', 'thsco'], t: ['Western'], d: 'The desert; pride and ambition.' },
  { k: ['nunki', 'uttarashadha', 'sisgr'], t: ['Western', 'Indian'], d: 'The herald; truthfulness and optimism. Yogatara of Uttara Ashadha.' },
  { k: ['kaus australis', 'epsgr'], t: ['Western'], d: 'The southern bow; idealism and mental acuity.' },
  { k: ['kaus media', 'purvashadha', 'desgr'], t: ['Indian'], d: 'Yogatara of Purva Ashadha; the middle of the Archer’s bow.' },
  { k: ['albireo', 'becyg'], t: ['Western'], d: 'The beak; beauty in opposites — the celebrated double star.' },
  { k: ['alderamin', 'alcep'], t: ['Western'], d: 'The right arm (Ar. al-dhirā‘); authority with severity.' },
  { k: ['schedar', 'alcas'], t: ['Western'], d: 'The breast; commanding royalty with a violent streak.' },
  { k: ['caph', 'becas'], t: ['Western'], d: 'The hand; changeability of fortune.' },
  { k: ['navi', 'gacas'], t: ['Western'], d: 'The middle of the throne; beauty shadowed by misfortune.' },
  { k: ['polaris', 'alumi'], t: ['Western', 'Chinese'], d: 'The pole star; guidance and constancy. Chinese: 北極 — the pivot of heaven itself.' },
  { k: ['kochab', 'beumi'], t: ['Western'], d: 'The former pole star; steadfast guardianship.' },
  { k: ['thuban', 'aldra'], t: ['Western'], d: 'The pyramid-builders’ pole star; the dragon’s head.' },
  { k: ['eltanin', 'gadra'], t: ['Western'], d: 'The dragon; high office and distinction.' },
  { k: ['adhara', 'epcma'], t: ['Western'], d: 'The virgins; honours through devotion.' },
  { k: ['mirzam', 'becma'], t: ['Western'], d: 'The announcer; herald of Sirius.' },
  { k: ['acrux', 'alcru'], t: ['Western'], d: 'The foot of the Southern Cross; spiritual devotion.' },
  { k: ['gacrux', 'gacru'], t: ['Western'], d: 'The top of the Cross; the ruby star.' },
  { k: ['zosma', 'purvaphalguni', 'deleo'], t: ['Western', 'Indian'], d: 'The girdle; melancholy and spiritual depth. Yogatara of Purva Phalguni.' },
  { k: ['algieba', 'galeo'], t: ['Western'], d: 'The forehead; a commanding, active mind.' },
  { k: ['meissa', 'laori'], t: ['Indian', 'Chinese'], d: 'The head of Orion; the searching star. Yogatara of Mrigashira; determinative of the Beak mansion.' },
  { k: ['sheratan', 'ashvini', 'beari'], t: ['Islamicate', 'Indian', 'Chinese'], d: 'The two signs (Ar. al-sharaṭān); the Ram’s northern horn. Yogatara of Ashvini; determinative of the Bond mansion.' },
  { k: ['bharani', '41ari'], t: ['Indian'], d: 'Yogatara of Bharani; the bearer.' },
  { k: ['alamak', 'almach', 'gaand'], t: ['Western'], d: 'The lynx; honours in art and beauty.' },
  { k: ['sualocin', 'dhanishtha', 'bedel'], t: ['Western', 'Indian'], d: 'Nicolaus reversed; the dolphin’s nose. Yogatara of Dhanishta.' },
  { k: ['acubens', 'ashlesha (colebrook)', 'alcnc'], t: ['Indian'], d: 'The claws; in Colebrook’s reckoning, yogatara of Ashlesha.' },
  { k: ['asellus australis', 'pushya', 'decnc'], t: ['Indian'], d: 'The southern ass; yogatara of Pushya.' },
  { k: ['zhang', 'up-1hya'], t: ['Chinese'], d: 'Determinative of the Net mansion; feasting and celebration.' },
];

/**
 * @param {string} s
 * @returns {string}
 */
function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff-]/g, '').replace(/-+$/, '');
}

// Find lore for a parsed star record {name, bayer, altNames[]}.
/**
 * @param {StarRecord} star
 */
export function loreForStar(star) {
  const keys = new Set([normName(star.name), normName(star.bayer)]);
  for (const a of star.altNames || []) keys.add(normName(a));
  for (const e of STAR_LORE) {
    for (const k of e.k) {
      if (keys.has(normName(k))) return { traditions: e.t, text: e.d };
    }
  }
  return null;
}

// --- sefstars.txt parsing ------------------------------------------------------
// Record: traditional name, nomenclature, equinox (1950|2000|ICRS),
// RA h,m,s, Dec d,m,s, pmRA (0.001"/yr * cos dec), pmDec (0.001"/yr),
// radial velocity, parallax, magnitude V.
// Duplicate records (alternate names, e.g. "Rohini" for alTau) are merged:
// the first record keeps the point, later ones append to altNames.

/**
 * @param {string} text
 * @returns {StarRecord[]}
 */
export function parseSefstars(text) {
  const stars = [];
  const byCoord = new Map(); // rounded arcsec key -> index
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const p = line.split(',').map(s => s.trim());
    if (p.length < 14) continue;
    const name = p[0], bayer = p[1], equinox = p[2];
    const raH = +p[3], raM = +p[4], raS = +p[5];
    const decNeg = p[6].startsWith('-');
    const decD = Math.abs(parseFloat(p[6])), decM = +p[7], decS = +p[8];
    if (![raH, raM, raS, decD, decM, decS].every(isFinite)) continue;
    let ra = (raH + raM / 60 + raS / 3600) * 15;
    let dec = (decNeg ? -1 : 1) * (decD + decM / 60 + decS / 3600);
    const fromJD = equinox === '1950' ? B1950 : J2000; // ICRS ~= J2000 to <0.1"
    if (fromJD !== J2000) {
      const pr = precess(ra, dec, fromJD, J2000);
      ra = pr.ra; dec = pr.dec;
    }
    const pmRA = parseFloat(p[9]), pmDec = parseFloat(p[10]);
    const mag = parseFloat(p[13]);
    const key = Math.round(ra * 3600) + ':' + Math.round(dec * 3600);
    const alt = name && normName(name) !== normName(bayer) ? name : null;
    if (byCoord.has(key)) {
      const ex = stars[byCoord.get(key)];
      if (alt && !ex.altNames.includes(alt)) ex.altNames.push(alt);
      continue;
    }
    byCoord.set(key, stars.length);
    stars.push({
      name: name || bayer, bayer,
      ra0: ra, dec0: dec, // J2000 mean
      pmRA: isFinite(pmRA) ? pmRA : 0,   // mas/yr * cos(dec)
      pmDec: isFinite(pmDec) ? pmDec : 0, // mas/yr
      mag: isFinite(mag) ? mag : 9,
      altNames: alt ? [alt] : [],
    });
  }
  return stars;
}

// Apparent mean place of a star at jd: proper motion from J2000, then
// precession to the date. (Nutation/aberration are sub-arcminute; skipped.)
/**
 * @param {StarRecord} star
 * @param {number} jd
 * @returns {EqCoords}
 */
export function starApparent(star, jd) {
  const yrs = (jd - J2000) / 365.25;
  const cd = Math.cos(star.dec0 * DEG2RAD) || 1e-9;
  const ra = star.ra0 + (star.pmRA / 3600000) * yrs / cd;
  const dec = star.dec0 + (star.pmDec / 3600000) * yrs;
  return precess(norm360(ra), dec, J2000, jd);
}

// --- Lunar nodes & the Moon's orbit --------------------------------------------
// The South Node is not an ephemeris slot: it sits opposite the true node on
// the ecliptic (latitude 0) and shares the node's speed (the axis is rigid).
/**
 * @param {number} nodeLonDeg
 * @returns {number}
 */
export function southNodeLon(nodeLonDeg) {
  return norm360(nodeLonDeg + 180);
}

// Mean inclination of the Moon's orbit to the ecliptic, degrees.
export const MOON_ORBIT_INCL = 5.14;

// Ecliptic {lon, lat} of a point on the Moon's mean orbit. uDeg is the
// argument of latitude measured from the ascending (true) node at
// nodeLonDeg. u=0 -> true node, u=180 -> south node, u=90/270 -> max/min
// latitude (+/- MOON_ORBIT_INCL). Verified against a Python prototype:
// exact node crossings, extrema, and planarity to 1e-12.
/**
 * @param {number} uDeg
 * @param {number} nodeLonDeg
 * @returns {EclCoords}
 */
export function moonOrbitPoint(uDeg, nodeLonDeg) {
  const u = uDeg * DEG2RAD, Om = nodeLonDeg * DEG2RAD, inc = MOON_ORBIT_INCL * DEG2RAD;
  const cu = Math.cos(u), su = Math.sin(u);
  // Orbit plane -> ecliptic Cartesian: incline about the node line, then
  // rotate by the node longitude.
  const x = cu * Math.cos(Om) - su * Math.cos(inc) * Math.sin(Om);
  const y = cu * Math.sin(Om) + su * Math.cos(inc) * Math.cos(Om);
  const z = su * Math.sin(inc);
  return {
    lon: norm360(Math.atan2(y, x) * RAD2DEG),
    lat: Math.asin(Math.max(-1, Math.min(1, z))) * RAD2DEG,
  };
}

// --- Bodies shown in the sky ---------------------------------------------------
// Ids 0..10 match computeChart's body slots; id 11 (South Node) is derived.

export const SKY_BODIES = [
  { id: 0,  name: 'Sun',       glyph: '☉', color: '#58a6ff' },
  { id: 1,  name: 'Moon',      glyph: '☽', color: '#ffd75e' },
  { id: 2,  name: 'Mercury',   glyph: '☿', color: '#9fe870' },
  { id: 3,  name: 'Venus',     glyph: '♀', color: '#ff9d5c' },
  { id: 4,  name: 'Mars',      glyph: '♂', color: '#ff6b6b' },
  { id: 5,  name: 'Jupiter',   glyph: '♃', color: '#7ee787' },
  { id: 6,  name: 'Saturn',    glyph: '♄', color: '#d2a8ff' },
  { id: 7,  name: 'Uranus',    glyph: '♅', color: '#f778ba' },
  { id: 8,  name: 'Neptune',   glyph: '♆', color: '#79c0ff' },
  { id: 9,  name: 'Pluto',     glyph: '♇', color: '#ffa657' },
  { id: 10, name: 'True Node', glyph: '\u260A\uFE0E', color: '#e3b341' },
  { id: 11, name: 'South Node', glyph: '\u260B\uFE0E', color: '#e3b341' },
];

export const ANGLES = [
  { key: 'asc', name: 'Ascendant', glyph: 'Asc', color: '#ff7b72' },
  { key: 'mc',  name: 'Midheaven', glyph: 'MC', color: '#ff7b72' },
];
