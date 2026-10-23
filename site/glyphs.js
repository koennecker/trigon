// glyphs.js — custom SVG glyphs for the zodiac signs and chart points.
//
// Each glyph is hand-built path data on a 0..100 grid (x right, y down),
// split into strokes (open line work, drawn with the glyph color and a
// configurable stroke width) and fills (solid shapes). Rendering emits
// a <g> that translates/scales the grid onto the target box, so one
// definition serves the sign band, spoke labels, outer wheels, and the
// mobile wheel at any size — no font involved, so the shapes render
// identically on every platform.
//
// Stroke width is in grid units: at the default 7, a glyph drawn at
// size S shows strokes of 0.07*S px. The chart's weight parameters
// (400..900) scale it linearly, 400 = the standard width.

/** Full circle as a path (two arcs). */
const circ = (cx, cy, r) =>
  `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;

/** The 12 sign glyphs, in zodiac order (Aries .. Pisces). */
export const SIGN_PATHS = [
  // Aries: two horn arcs rising from a central stem.
  { s: ['M50 34 V88',
        'M50 36 C32 36 18 30 18 19 C18 9 31 7 35 16',
        'M50 36 C68 36 82 30 82 19 C82 9 69 7 65 16'], f: [] },
  // Taurus: horn crescent over a circle.
  { s: ['M19 29 C27 11 73 11 81 29', circ(50, 63, 20)], f: [] },
  // Gemini: two pillars between top and bottom bars.
  { s: ['M25 20 H75', 'M25 80 H75', 'M35 20 V80', 'M65 20 V80'], f: [] },
  // Cancer: two circled spirals facing each other.
  { s: [circ(62, 36, 12), circ(38, 64, 12),
        'M51 31 C37 24 24 26 15 35', 'M49 69 C63 76 76 74 85 65'], f: [] },
  // Leo: a circle with a sweeping tail ending in a curl.
  { s: [circ(37, 63, 16),
        'M50 55 C72 46 83 32 77 20 C73 12 61 13 61 22'], f: [] },
  // Virgo: an M whose last leg closes into a crossed loop.
  { s: ['M20 80 V28 L37 52 L54 28 V80', 'M71 28 V60',
        'M71 60 C71 76 57 85 46 77 C37 70 43 57 54 59'], f: [] },
  // Libra: a domed line over a baseline.
  { s: ['M16 62 H84', 'M16 44 H37', 'M63 44 H84',
        'M37 44 A13 12 0 0 1 63 44'], f: [] },
  // Scorpio: an M ending in an arrow tail.
  { s: ['M14 78 V24 L30 48 L46 24 V60',
        'M62 24 V48 C62 62 68 69 82 69',
        'M82 69 L65 65', 'M82 69 L79 53'], f: [] },
  // Sagittarius: an arrow with a crossbar on the shaft.
  { s: ['M25 75 L69 31', 'M47 25 H73', 'M73 25 V51',
        'M29 53 L45 69'], f: [] },
  // Capricorn: a peaked stroke descending into a loop.
  { s: ['M16 22 H38 L52 44', 'M38 22 V58',
        'M52 44 C60 58 76 54 78 64 C80 75 68 82 59 76 C50 70 52 58 61 55'], f: [] },
  // Aquarius: two zigzag waves.
  { s: ['M10 36 L26 22 L42 36 L58 22 L74 36 L90 22',
        'M10 64 L26 50 L42 64 L58 50 L74 64 L90 50'], f: [] },
  // Pisces: two arcs tied by a bar.
  { s: ['M38 14 C21 33 21 67 38 86', 'M62 14 C79 33 79 67 62 86',
        'M24 50 H76'], f: [] },
];

/** Point glyphs, keyed by the chart's point keys. */
export const BODY_PATHS = {
  // Sun: a circle with a solid center point.
  sun: { s: [circ(50, 50, 25)], f: [circ(50, 50, 6)] },
  // Moon: a crescent (filled).
  moon: { s: [], f: ['M65 10 A42 42 0 1 0 65 90 A33 33 0 1 1 65 10 Z'] },
  // Mercury: horned circle over a cross.
  mercury: { s: ['M27 19 C35 5 65 5 73 19', circ(50, 37, 14),
                 'M50 51 V86', 'M35 71 H65'], f: [] },
  // Venus: a circle over a cross.
  venus: { s: [circ(50, 33, 17), 'M50 50 V87', 'M33 69 H67'], f: [] },
  // Mars: a circle with an arrow leaving to the upper right.
  mars: { s: [circ(39, 61, 20), 'M53 47 L79 21', 'M55 19 H81', 'M81 19 V45'], f: [] },
  // Jupiter: a crescent left of a cross.
  jupiter: { s: ['M58 13 C37 15 25 30 25 46 C25 62 39 73 58 68',
                  'M58 13 V87', 'M21 50 H85'], f: [] },
  // Saturn: a cross over a hook.
  saturn: { s: ['M29 23 H67', 'M48 9 V42',
                'M48 42 C48 60 41 76 28 73 C17 70 16 57 27 53 C37 49 48 55 48 65'], f: [] },
  // Uranus: two stemmed circles joined by a bar, center stem to a circle.
  uranus: { s: [circ(24, 15, 6), circ(76, 15, 6), circ(50, 76, 10),
                'M24 21 V58', 'M76 21 V58', 'M24 42 H76', 'M50 42 V66'], f: [] },
  // Neptune: a trident cup over a cross.
  neptune: { s: ['M21 10 V31 C21 53 79 53 79 31 V10',
                 'M50 40 V87', 'M34 68 H66'], f: [] },
  // Pluto: a crescent cup over a circled cross.
  pluto: { s: ['M27 12 C27 33 73 33 73 12', circ(50, 47, 11),
               'M50 58 V87', 'M36 73 H64'], f: [] },
  // North Node: a horseshoe arc with solid end knobs.
  'true-node': { s: ['M16 64 C16 40 24 27 34 36 C42 43 44 51 50 51 C56 51 58 43 66 36 C76 27 84 40 84 64'],
                 f: [circ(16, 72, 5.5), circ(84, 72, 5.5)] },
  // South Node: the same, inverted.
  'south-node': { s: ['M16 36 C16 60 24 73 34 64 C42 57 44 49 50 49 C56 49 58 57 66 64 C76 73 84 60 84 36'],
                  f: [circ(16, 28, 5.5), circ(84, 28, 5.5)] },
};

/** Default stroke width in grid units (weight 400). */
export const GLYPH_STROKE_BASE = 7;

/**
 * SVG markup for one glyph entry, centered at (cx, cy) in a box of
 * `size` px, drawn in `color`.
 * o: {strokeW} stroke width in grid units (default GLYPH_STROKE_BASE),
 *    {strokeO, fillO} opacities in [0,1] (default 1).
 */
export function glyphSVG(entry, cx, cy, size, color, o = {}) {
  const w = o.strokeW != null ? o.strokeW : GLYPH_STROKE_BASE;
  const so = o.strokeO != null ? o.strokeO : 1;
  const fo = o.fillO != null ? o.fillO : 1;
  const k = size / 100;
  let inner = '';
  if (entry.s.length && w > 0) {
    inner += `<path d="${entry.s.join(' ')}" fill="none" stroke="${color}" `
      + `stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" opacity="${so}"/>`;
  }
  if (entry.f.length) {
    inner += `<path d="${entry.f.join(' ')}" fill="${color}" stroke="none" opacity="${fo}"/>`;
  }
  return `<g class="svg-glyph" transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)}) `
    + `scale(${k.toFixed(4)}) translate(-50 -50)">${inner}</g>`;
}

/** Glyph markup for sign index i (0 = Aries). */
export function signGlyphSVG(i, cx, cy, size, color, o) {
  return glyphSVG(SIGN_PATHS[i], cx, cy, size, color, o);
}

/** Glyph markup for a point key ('sun', 'true-node', ...); '' if unknown. */
export function bodyGlyphSVG(key, cx, cy, size, color, o) {
  const e = BODY_PATHS[key];
  return e ? glyphSVG(e, cx, cy, size, color, o) : '';
}
