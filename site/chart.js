// chart.js — whole-sign horoscope wheel rendered as SVG.
//
// Orientation: the 1st-house cusp (0° of the Ascendant's sign) sits at the
// 9 o'clock position; ecliptic longitude increases counter-clockwise.
// Screen position for ecliptic longitude `lon` at radius `r`:
//     θ = 180° + (lon − ref),  x = cx + r·cos θ,  y = cy − r·sin θ
// where ref = 0° of the Ascendant's sign. Screen y is flipped relative to
// math convention, so increasing θ reads counter-clockwise on screen.
//
// Layout (viewBox 700×700, center 350,350):
//   r=294  outer circle + degree ticks (1°/5°/10°/30°)
//   r=278  zodiac sign glyphs in their own band (outer rim -> divider at 262),
//           colored by element
//   r=216  glyph ring for isolated points (one glyph per point, no lanes:
//           isolated means >CLUSTER_T° from any neighbor, so glyphs can't
//           collide)
//   r=250  degree ring for isolated points: the degree sits just outside its
//           glyph at the same angle (radial adjacency, Astro-Seek style) —
//           deterministic, no sweep, no leader, no glyph duplication
//   r=168  inner circle; Ptolemaic aspect lines drawn inside (r=150)
//   r=336  cluster lists OUTSIDE the wheel: one compact (glyph+degree) list
//           per cluster at the cluster's location (astro.com style). Vertical
//           if it fits in the viewBox, else horizontal, else a 2-column grid.
//           Lists are angularly swept against each other; the 86px radial
//           clearance to the degree ring makes list/degree overlap impossible.
//   12 house-cusp lines radiate from the inner circle to the outer rim;
//   the Asc–Dsc axis runs through the center.
// Every point owns exactly ONE glyph and ONE degree: isolated points show
// the glyph on the wheel and the degree beside it; cluster members show
// both together in the cluster's list. Nothing is duplicated.
//
// Effective vs. actual longitude: points within NUDGE_ZONE degrees of either
// end of their sign are plotted slightly inside it (effective longitude) so
// glyphs don't sit on the sign-divider lines; labels and aspect orbs use the
// actual longitude.

const CX = 350, CY = 350;
const VB = 700; // viewBox size (square, center CX,CY)

// --- Chart style customization ---
// Every radius, glyph size, and line width the wheel renderers use is a
// style parameter with a descriptor (label, range, default). The Customize
// panel in the chart tab is built from CHART_STYLE_SECTIONS; overrides are
// persisted by the app (localStorage) and passed as opts.style.
export const CHART_STYLE_SECTIONS = [
  { id: 'desktop', title: 'Desktop wheel', params: [
    { key: 'rOut',  label: 'Outer circle radius',  min: 250, max: 330, step: 1,   def: 294 },
    { key: 'rSign', label: 'Sign glyph radius',    min: 235, max: 315, step: 1,   def: 278 },
    { key: 'rDiv',  label: 'Divider radius',       min: 220, max: 300, step: 1,   def: 262 },
    { key: 'rHug',  label: 'Label ring radius',    min: 200, max: 285, step: 1,   def: 248 },
    { key: 'rIn',   label: 'Inner circle radius',  min: 80,  max: 170, step: 1,   def: 120 },
    { key: 'rAsp',  label: 'Aspect circle radius', min: 50,  max: 150, step: 1,   def: 100 },
    { key: 'signSize',     label: 'Sign glyph size',   min: 12, max: 28, step: 0.5, def: 19 },
    { key: 'lblGlyphSize', label: 'Label glyph size',  min: 8,  max: 18, step: 0.5, def: 12 },
    { key: 'lblTextSize',  label: 'Label degree size', min: 7,  max: 14, step: 0.5, def: 9.5 },
    { key: 'aspGlyphSize', label: 'Aspect glyph size', min: 8,  max: 18, step: 0.5, def: 12 },
  ] },
  { id: 'mobile', title: 'Mobile wheel', params: [
    { key: 'rOut',   label: 'Outer circle radius', min: 120, max: 200, step: 1, def: 165 },
    { key: 'rSign',  label: 'Sign glyph radius',   min: 110, max: 190, step: 1, def: 150 },
    { key: 'rAsp',   label: 'Aspect circle radius',min: 55,  max: 120, step: 1, def: 85 },
    { key: 'rGlyph', label: 'Glyph ring radius',   min: 180, max: 260, step: 1, def: 218 },
    { key: 'glyphSize', label: 'Glyph size',       min: 20,  max: 48,  step: 1, def: 32 },
    { key: 'signSize',  label: 'Sign glyph size',  min: 10,  max: 24,  step: 0.5, def: 16 },
  ] },
  { id: 'shared', title: 'Shared', params: [
    { key: 'aspWidth', label: 'Aspect line thickness', min: 0.3, max: 2.5, step: 0.05, def: 1 },
    { key: 'sepScale', label: 'Label separation \u00d7', min: 0, max: 3, step: 0.05, def: 1,
      allowZero: true,
      hint: 'Multiplier on the declutter guard. 1 = geometric no-overlap size; lower packs labels tighter; 0 puts every label at its true longitude.' },
  ] },
];

// Defaults as {desktop: {...}, mobile: {...}, shared: {...}}.
export function defaultChartStyle() {
  const out = {};
  for (const sec of CHART_STYLE_SECTIONS) {
    out[sec.id] = {};
    for (const p of sec.params) out[sec.id][p.key] = p.def;
  }
  return out;
}

// Deep-merge overrides over the defaults; unknown sections/keys are dropped,
// non-finite values (and non-positive ones, unless the param sets allowZero)
// fall back to the default. Sizes and radii are unbounded: any positive
// finite value is accepted as typed (styling inputs take
// arbitrary sizes).
export function resolveChartStyle(overrides) {
  const st = defaultChartStyle();
  if (overrides && typeof overrides === 'object') {
    for (const sec of CHART_STYLE_SECTIONS) {
      const o = overrides[sec.id];
      if (!o || typeof o !== 'object') continue;
      for (const p of sec.params) {
        const v = o[p.key];
        if (Number.isFinite(v) && (v > 0 || (v === 0 && p.allowZero))) st[sec.id][p.key] = v;
      }
    }
  }
  return st;
}

// Angular half-width (degrees) of one radial spoke label at the given
// radius, from the actual token sizes: the widest token is the glyph
// (~lblGlyphSize) or the degree/minutes token (~2x lblTextSize).
export function labelAngularHW(lblGlyphSize, lblTextSize, radius) {
  const tokW = Math.max(lblGlyphSize, 2 * lblTextSize);
  return (tokW / 2) / radius * 180 / Math.PI;
}

// Radial spacing between spoke tokens: tokens are ~font-size tall with
// dominant-baseline central, so the pitch must clear the largest token.
// 1.25x reproduces the legacy 15px pitch at the defaults (12/9.5).
export function labelTokenPitch(lblGlyphSize, lblTextSize) {
  return 1.25 * Math.max(lblGlyphSize, lblTextSize);
}


const SIGN_GLYPHS = ['\u2648', '\u2649', '\u264A', '\u264B', '\u264C', '\u264D',
                     '\u264E', '\u264F', '\u2650', '\u2651', '\u2652', '\u2653'];
// Element colors: fire, earth, air, water (sign index % 4, Aries = 0).
const ELEMENT_COLORS = ['#ff7b72', '#e3b341', '#79c0ff', '#a371f7'];
const PLANET_GLYPHS = ['\u2609', '\u263D', '\u263F', '\u2640', '\u2642',
                       '\u2643', '\u2644', '\u2645', '\u2646', '\u2647'];
const PLANET_COLORS = ['#58a6ff', '#ffd75e', '#9fe870', '#ff9d5c', '#ff6b6b',
                       '#7ee787', '#d2a8ff', '#f778ba', '#79c0ff', '#ffa657'];
const NODE_N = '\u260A', NODE_S = '\u260B'; // ☊ ☋ (U+260A/B, not U+264A/B which are ♊/♋)

const ASPECTS = [
  { angle: 0,   glyph: '\u260C', color: '#e6edf3', name: 'conjunction' },
  { angle: 60,  glyph: '\u26B9', color: '#39c5cf', name: 'sextile' },
  { angle: 90,  glyph: '\u25A1', color: '#ff7b72', name: 'square' },
  { angle: 120, glyph: '\u25B3', color: '#39c5cf', name: 'trine' },
  { angle: 180, glyph: '\u260D', color: '#ff7b72', name: 'opposition' },
];
const ORB = 3; // degrees

function norm360(d) { return ((d % 360) + 360) % 360; }

// --- PAVA (Pool Adjacent Violators Algorithm) for optimal label declutter ---
// Solves: min sum (x_i - theta_i)^2 s.t. x_{i+1} - x_i >= h_i + h_{i+1},
// via the isotonic-regression transform y_i = x_i - S_i where
// S_i = sum_{j<i} (h_j + h_{j+1}). The constraint becomes y_{i+1} >= y_i.
// Exported for unit testing.
export function pavaIsotonic(vals, wts) {
  const n = vals.length;
  const stack = []; // each: [value, weight, lo, hi]
  for (let i = 0; i < n; i++) {
    let v = vals[i], w = wts[i], lo = i;
    while (stack.length && stack[stack.length - 1][0] > v) {
      const [pv, pw, plo] = stack.pop();
      if (pw === Infinity || w === Infinity) {
        v = pw === Infinity ? pv : v;
        w = Infinity;
      } else {
        v = (pv * pw + v * w) / (pw + w);
        w = pw + w;
      }
      lo = plo;
    }
    stack.push([v, w, lo, i]);
  }
  const y = new Array(n);
  for (const [v, , lo, hi] of stack)
    for (let j = lo; j <= hi; j++) y[j] = v;
  return y;
}

// Declutter a single arc: thetas (strictly increasing, linearized),
// hws (half-widths), loA/hiA ([angle, halfWidth] fixed anchors).
// Returns placed angles in the same linearized frame. Exported for testing.
//
// Overcrowded arcs (guards wider than the arc, common at large label sizes):
// the guards are scaled down uniformly until they fit, then the normal
// constrained PAVA runs. Every label stays inside the arc, so anchors and
// neighboring arcs are never invaded -- the old "spill" fallback dropped
// the anchor constraints and let labels sit on top of anchors (e.g. Moon on
// MC, 2026-10-08).
export function declutterArc(thetas, hws, loA, hiA) {
  const k = thetas.length;
  if (!k) return [];
  let s = 1;
  const need = loA[1] + hiA[1] + hws[0] + hws[k - 1]
    + hws.slice(0, k - 1).reduce((a, h, i) => a + h + hws[i + 1], 0);
  const have = hiA[0] - loA[0];
  if (need > have && need > 0) s = Math.max(have / need, 1e-3);
  const hs = hws.map((h) => h * s);
  const loS = loA[1] * s, hiS = hiA[1] * s;
  const S = [0];
  for (let i = 0; i < k - 1; i++) S.push(S[i] + hs[i] + hs[i + 1]);
  const phi = thetas.map((t, i) => t - S[i]);
  const L = loA[0] + loS + hs[0];
  const U = hiA[0] - hiS - hs[k - 1] - S[k - 1];
  let y;
  if (L <= U) {
    y = pavaIsotonic([L, ...phi, U],
                     [Infinity, ...new Array(k).fill(1), Infinity]);
    y = y.slice(1, k + 1);
  } else {
    y = phi; // degenerate arc (have <= 0): labels stay at their thetas
  }
  return y.map((v, i) => v + S[i]);
}

// U+FE0E requests text (non-emoji) presentation so glyphs render with our
// fill colors deterministically instead of as platform emoji badges.
const TVS = '\uFE0E';

// --- effective vs. actual longitude ---
// A glyph plotted near either end of its sign would sit on the radial
// sign-divider line. The *effective* longitude nudges such points back inside
// their sign for display: a smoothstep ramp over NUDGE_ZONE degrees at each
// end, peaking at NUDGE_MAX. The ramp is continuous and monotonic, so
// clock-mode motion never jumps and ordering is preserved. Labels and aspect
// orbs always use the *actual* longitude; glyph, label, and aspect-line
// placement use the effective one.
const NUDGE_ZONE = 4, NUDGE_MAX = 2.5; // degrees
function effLon(lon) {
  lon = norm360(lon);
  const f = lon % 30;
  const sstep = x => x * x * (3 - 2 * x);
  if (f >= 30 - NUDGE_ZONE) { // late degrees: nudge back
    const x = (f - (30 - NUDGE_ZONE)) / NUDGE_ZONE; // 0..1
    return norm360(lon - NUDGE_MAX * sstep(x));
  }
  if (f <= NUDGE_ZONE) { // early degrees: nudge forward
    const x = (NUDGE_ZONE - f) / NUDGE_ZONE; // 1..0
    return norm360(lon + NUDGE_MAX * sstep(x));
  }
  return lon;
}

function degLabel(lon, angleFmt) {
  const d = norm360(lon) % 30;
  if (angleFmt === 'dec') return `${d.toFixed(2)}\u00B0`;
  const dd = Math.floor(d);
  const mm = Math.floor((d - dd) * 60);
  return `${dd}\u00B0${String(mm).padStart(2, '0')}\u2032`;
}

function text(x, y, s, size, fill, extra = '') {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" `
       + `dominant-baseline="central" font-size="${size}" fill="${fill}"${extra}>${s}</text>`;
}

export function renderChartSVG(out, opts = {}) {
  const angleFmt = opts.angleFmt === 'dec' ? 'dec' : 'dms';
  const _sty = resolveChartStyle(opts.style);
  const st = _sty.desktop, sh = _sty.shared;
  const asc = norm360(out[72]);
  const mc = norm360(out[73]);
  const ref = Math.floor(asc / 30) * 30; // 0° of the Ascendant's sign

  // Debug info collected during render; retrieved via getLastChartDebug().
  const dbg = {
    version: 'chart.js per-arc-orient',
    asc, mc, ref, angleFmt,
    points: [],  // {glyph,label,kind,lon,elon,placed,orient,retro,dx,sign}
    arcs: [],    // {aGlyph,bGlyph,midLon,radial,thetas,hws,xs}
  };

  const P = (r, lon) => {
    const t = (180 + (norm360(lon) - ref)) * Math.PI / 180;
    return [CX + r * Math.cos(t), CY - r * Math.sin(t)];
  };

  let s = '';

  // --- degree ticks around the outer ring ---
  for (let dgr = 0; dgr < 360; dgr++) {
    const len = dgr % 30 === 0 ? 14 : dgr % 10 === 0 ? 11 : dgr % 5 === 0 ? 8 : 5;
    const [x1, y1] = P(st.rOut, ref + dgr);
    const [x2, y2] = P(st.rOut - len, ref + dgr);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
       + `stroke="#6e7681" stroke-width="${dgr % 30 === 0 ? 1.4 : 1}"/>`;
  }
  s += `<circle cx="${CX}" cy="${CY}" r="${st.rOut}" fill="none" stroke="#8b949e" stroke-width="1.5"/>`;
  s += `<circle cx="${CX}" cy="${CY}" r="${st.rDiv}" fill="none" stroke="#6e7681" stroke-width="1"/>`;

  // --- sign glyphs in their own band, colored by element ---
  for (let k = 0; k < 12; k++) {
    const sIdx = (Math.floor(ref / 30) + k) % 12;
    const [x, y] = P(st.rSign, ref + k * 30 + 15);
    s += text(x, y, SIGN_GLYPHS[sIdx] + TVS, st.signSize, ELEMENT_COLORS[sIdx % 4]);
  }

  // --- house cusps: Asc–Dsc axis through the center, the rest inner→outer ---
  {
    const [ax1, ay1] = P(st.rOut, ref), [ax2, ay2] = P(st.rOut, ref + 180);
    s += `<line x1="${ax1.toFixed(1)}" y1="${ay1.toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${ay2.toFixed(1)}" `
       + `stroke="#6e7681" stroke-width="1.5"/>`;
    for (let k = 1; k < 12; k++) {
      if (k === 6) continue; // Dsc end of the axis, already drawn
      const [x1, y1] = P(st.rIn, ref + k * 30);
      const [x2, y2] = P(st.rOut, ref + k * 30);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
         + `stroke="#30363d" stroke-width="1"/>`;
    }
  }
  s += `<circle cx="${CX}" cy="${CY}" r="${st.rIn}" fill="none" stroke="#8b949e" stroke-width="1"/>`;

  // --- points: 10 planets + Asc/Dsc/MC/IC + true-node axis ---
  const tnode = norm360(out[10 * 6]);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    pts.push({ lon: norm360(out[i * 6]), glyph: PLANET_GLYPHS[i], color: PLANET_COLORS[i],
               retro: out[i * 6 + 3] < 0,
               size: 22, label: degLabel(out[i * 6], angleFmt), kind: 'planet', idx: i });
  }
  const angle = (lon, glyph) => ({ lon: norm360(lon), glyph, color: '#e6edf3',
    size: 14, label: degLabel(lon, angleFmt), kind: 'angle', idx: -1 });
  pts.push(angle(asc, 'As'), angle(norm360(asc + 180), 'Ds'),
           angle(mc, 'Mc'), angle(norm360(mc + 180), 'Ic'));
  pts.push({ lon: tnode, glyph: NODE_N, color: '#c9d1d9', size: 20,
             label: degLabel(tnode, angleFmt), kind: 'node', idx: -1 });
  pts.push({ lon: norm360(tnode + 180), glyph: NODE_S, color: '#8b949e', size: 20,
             label: degLabel(tnode, angleFmt), kind: 'node', idx: -1 });

  // Effective longitudes for placement (see effLon): p.lon stays the actual
  // longitude for label text and aspect orb math.
  pts.forEach((p) => { p.elon = effLon(p.lon); });

  // --- point labels: radial spokes ---
  // Single text per point: [Point Glyph] [Degree]° [Zodiac Glyph] [Minutes]′.
  // Positioned hugging the outer circle (R_HUG), oriented radially like
  // spokes on a wheel. Reading direction follows the spoke:
  //   Eastern half (right): left-to-right (glyph inner, minutes outer)
  //   Western half (left):  right-to-left (glyph inner, minutes outer)
  //   10th house (top):     top-to-bottom (glyph outer, minutes inner)
  //   4th house (bottom):   bottom-to-top (glyph outer, minutes inner)
  // PAVA places them angularly; hw is the angular half-width of the text's
  // cross-spoke extent, derived from the actual token sizes via
  // labelAngularHW() so arbitrary font sizes keep the no-overlap guarantee.
  // (pavaIsotonic and declutterArc are defined at module level, exported.)
  // Legacy tuning note: with 12/9.5px tokens at rHug 248 the dense/isolated
  // split came out 3.5°/2.5°; the size-aware factors reproduce that.
  // ALL labels use the radial spoke layout (no horizontal/radial mix):
  // tokens are positioned individually along the radial direction, glyph at
  // the outer end, characters upright. Token order is always
  // [glyph][degree][sign][minutes] from outer to inner.
  // Adaptive hw: labels in dense neighborhoods (nearest neighbor < 7°)
  // get a wider guard (prevents token overlap); isolated labels get a
  // narrower one (prevents over-displacement of mid-sign glyphs). Both
  // derive from the actual label sizes so arbitrary font sizes keep the
  // no-overlap guarantee; the 1.6/1.15 factors reproduce the legacy
  // 3.5°/2.5° split at the defaults.
  // Radial token spacing: tokens are ~font-size tall, so the pitch must
  // clear the largest token (see labelTokenPitch).
  const TOKEN_PITCH = labelTokenPitch(st.lblGlyphSize, st.lblTextSize);
  // Innermost token radius: the token stack runs inward from rHug, and
  // spokes converge toward the center, so the no-overlap angular guard
  // must be evaluated where labels are closest together — not at the
  // outer ring. Calibration: at the defaults (12/9.5px, rHug 248,
  // pitch 15) the inner radius is 203, angHW is 2.68°, and the factors
  // below reproduce the legacy 3.5°/2.5° split exactly.
  const R_INNER = Math.max(24, st.rHug - 3 * TOKEN_PITCH);
  const angHW = labelAngularHW(st.lblGlyphSize, st.lblTextSize, R_INNER);
  // User-settable separation multiplier: scales the
  // geometric guard; 1 = no-overlap size, lower packs tighter, 0 disables.
  const SEP = sh.sepScale;
  const HW_DENSE = angHW * 1.305 * SEP, HW_ISOLATED = angHW * 0.932 * SEP;
  const HW_ANCHOR = angHW * 0.932 * SEP;
  const labelElon = pts.map((p) => p.elon);
  const isAnchor = pts.map((p) => p.kind === 'angle');
  const idx = pts.map((_, i) => i).sort((a, b) => labelElon[a] - labelElon[b]);
  const anchorIdx = idx.filter((i) => isAnchor[i]);
  const placed = new Array(pts.length);
  // Nearest-neighbor distance (in elon space) for each movable label.
  const movIdx = idx.filter((i) => !isAnchor[i]);
  const nnDist = new Map();
  movIdx.forEach((mi) => {
    let best = Infinity;
    movIdx.forEach((mj) => {
      if (mi === mj) return;
      let d = Math.abs(labelElon[mi] - labelElon[mj]);
      d = Math.min(d, 360 - d);
      if (d < best) best = d;
    });
    nnDist.set(mi, best);
  });
  const hwOf = (mi) => (nnDist.get(mi) < 7 ? HW_DENSE : HW_ISOLATED);
  for (let f = 0; f < anchorIdx.length; f++) {
    const i0 = anchorIdx[f], i1 = anchorIdx[(f + 1) % anchorIdx.length];
    const A = pts[i0], B = pts[i1];
    const mov = [];
    for (let i = (idx.indexOf(i0) + 1) % idx.length; idx[i] !== i1; i = (i + 1) % idx.length)
      mov.push(idx[i]);
    const base = A.elon;
    const lin = (a) => base + norm360(a - base);
    const bLin = base + norm360(B.elon - base);
    const thetas = mov.map((i) => lin(labelElon[i]));
    const hws = mov.map((mi) => hwOf(mi));
    const xs = declutterArc(thetas, hws, [base, HW_ANCHOR], [bLin, HW_ANCHOR]);
    mov.forEach((mi, k) => { placed[mi] = norm360(xs[k]); });
    placed[i0] = norm360(A.elon);
  }
  pts.forEach((p) => { p.orient = 'radial'; });
  dbg.arcs.push({ note: `all-radial; adaptive hw (dense ${HW_DENSE.toFixed(2)} / isolated ${HW_ISOLATED.toFixed(2)}, pitch ${TOKEN_PITCH.toFixed(1)}, sep x${SEP})` });
  // Spoke label content: [Point Glyph] [Degree]° [Zodiac Glyph] [Minutes]′.
  // Returns the tokens as structured data: [{text, glyph:boolean, color}].
  // glyph tokens get font-size 12 and a color; plain tokens use 9.5/#8b949e.
  const spokeTokens = (p) => {
    const lon = norm360(p.lon);
    const sIdx = Math.floor(lon / 30);
    const d = lon % 30;
    const g = (p.kind === 'angle' ? p.glyph : p.glyph + TVS) + (p.retro ? 'R' : '');
    const toks = [{ text: g, glyph: true, color: p.color }];
    let minTok = null;
    if (angleFmt === 'dec') {
      toks.push({ text: `${d.toFixed(2)}\u00B0` });
    } else {
      const dd = Math.floor(d), mm = Math.floor((d - dd) * 60);
      toks.push({ text: `${dd}\u00B0` });
      minTok = { text: `${String(mm).padStart(2, '0')}\u2032` };
    }
    toks.push({ text: SIGN_GLYPHS[sIdx] + TVS, glyph: true, color: ELEMENT_COLORS[sIdx % 4] });
    if (minTok) toks.push(minTok);
    return toks;
  };
  // Spoke layout (all-radial): every label's tokens are positioned
  // individually along the radial direction — glyph at the outer end
  // (hugging the circle), then degree, sign glyph, minutes moving inward.
  // Characters stay upright; token order is always
  // [glyph][degree][sign][minutes] from outer to inner. No rotation, no
  // bidi, no DOM reversal.
  // Emit leaders (under text), then spoke labels.
  const LEADER_MIN_DISP = 2.0;
  pts.forEach((p, pi) => {
    const th = placed[pi];
    let dd = Math.abs(norm360(th) - norm360(p.elon));
    dd = Math.min(dd, 360 - dd);
    if (dd < LEADER_MIN_DISP || isAnchor[pi]) return;
    const [x1, y1] = P(st.rHug, th);
    const [x2, y2] = P(st.rHug, p.elon);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
       + `stroke="#484f58" stroke-width="1" opacity="0.55"/>`;
  });
  pts.forEach((p, pi) => {
    const th = placed[pi];
    const [x, y] = P(st.rHug, th);
    // Debug: record per-point placement.
    dbg.points.push({
      glyph: p.glyph, label: p.label, kind: p.kind,
      lon: +p.lon.toFixed(4), elon: +p.elon.toFixed(4),
      placed: +th.toFixed(4), orient: p.orient,
      retro: !!p.retro, sign: Math.floor(norm360(p.lon) / 30),
      disp: +(+Math.min(Math.abs(norm360(th) - norm360(p.elon)), 360 - Math.abs(norm360(th) - norm360(p.elon)))).toFixed(2),
    });
    // Radial spoke: each token positioned along the radial direction,
    // glyph at the outer end. Tokens stay together, characters upright.
    const ux = (x - CX) / st.rHug, uy = (y - CY) / st.rHug;
    const toks = spokeTokens(p);
    const tspans = toks.map((t, i) => {
      const r = st.rHug - i * TOKEN_PITCH;
      const tx = CX + ux * r, ty = CY + uy * r;
      const attrs = t.glyph ? ` font-size="${st.lblGlyphSize}" fill="${t.color}"` : '';
      return `<tspan x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"${attrs}>${t.text}</tspan>`;
    }).join('');
    s += `<text text-anchor="middle" dominant-baseline="central" font-size="${st.lblTextSize}" fill="#8b949e">${tspans}</text>`;
  });

  // --- Ptolemaic aspects between the 10 planets, 3° orb ---
  // Line width grows as the aspect tightens toward exact. Glyphs sit at
  // line midpoints, nudged perpendicular when midpoints would pile up.
  // The aspect circle (R_ASP=100) is compact, leaving the planet zone
  // (r=120..262) clear for the radial degree labels.
  let aspectSVG = '';
  const aspectMarks = [];
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      let sep = Math.abs(pts[i].lon - pts[j].lon);
      sep = Math.min(sep, 360 - sep);
      for (const a of ASPECTS) {
        const delta = Math.abs(sep - a.angle);
        if (delta > ORB) continue;
        const [x1, y1] = P(st.rAsp, pts[i].elon);
        const [x2, y2] = P(st.rAsp, pts[j].elon);
        const w = ((0.8 + 2.7 * (1 - delta / ORB)) * sh.aspWidth).toFixed(2);
        aspectSVG += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" `
                   + `x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${a.color}" `
                   + `stroke-width="${w}" opacity="0.9">`
                   + `<title>${a.name}, orb ${delta.toFixed(2)}°</title></line>`;
        aspectMarks.push({ mx: (x1 + x2) / 2, my: (y1 + y2) / 2,
                           dx: x2 - x1, dy: y2 - y1,
                           glyph: a.glyph, color: a.color });
        break;
      }
    }
  }
  const placedMarks = [];
  aspectMarks.forEach((m) => {
    const len = Math.hypot(m.dx, m.dy);
    let px, py;
    if (len < 20) {
      const rl = Math.hypot(m.mx - CX, m.my - CY) || 1;
      px = (m.mx - CX) / rl; py = (m.my - CY) / rl;
    } else {
      px = -m.dy / len; py = m.dx / len;
    }
    // Collision distance and nudge step scale with the glyph size so
    // arbitrary aspect glyph sizes keep the no-overlap guarantee (at the
    // 12px default these evaluate to the legacy 14px / 8px).
    const COLL_D = Math.max(14, st.aspGlyphSize * 1.15);
    const NUDGE = 8 * Math.max(1, st.aspGlyphSize / 12);
    let gx = m.mx, gy = m.my, k = 0;
    while (k < 12 && placedMarks.some((p) => Math.hypot(p[0] - gx, p[1] - gy) < COLL_D)) {
      k++;
      const sgn = len < 20 ? -1 : (k % 2 === 1 ? 1 : -1);
      const off = sgn * NUDGE * Math.ceil(k / 2);
      gx = m.mx + px * off; gy = m.my + py * off;
    }
    if (k >= 12) return;
    placedMarks.push([gx, gy]);
    aspectSVG += text(gx, gy, m.glyph + TVS, st.aspGlyphSize, m.color);
  });
  s += aspectSVG;

  lastDbg = dbg;
  return `<svg viewBox="0 0 ${VB} ${VB}" role="img" aria-label="Whole-sign horoscope wheel">`
       + `<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">${s}</g></svg>`;
}

// Debug export: returns the dbg object from the most recent renderChartSVG
// call (placement, orientations, PAVA arcs). Used by the Copy Debug button.
let lastDbg = null;
export function getLastChartDebug() { return lastDbg; }

// Mobile chart: small wheel, big glyphs outside, L-shaped leaders.
// No degree/minute tokens — just glyphs with leaders pointing to their
// actual positions on the wheel. Designed for narrow viewports where the
// desktop radial-spoke labels are unreadably small.
export function renderChartSVGMobile(out, opts = {}) {
  const asc = norm360(out[72]);
  const mc = norm360(out[73]);
  const ref = Math.floor(asc / 30) * 30;

  const _sty = resolveChartStyle(opts.style);
  const st = _sty.mobile, sh = _sty.shared;
  // Mobile geometry: fixed viewBox, same as before customization existed.
  // (Pushing the glyph ring past ~r=240 will clip — same tradeoff as the
  // desktop wheel's fixed 700×700 viewBox.)
  const VB_M = "110 110 480 480";

  const P = (r, lon) => {
    const t = (180 + (norm360(lon) - ref)) * Math.PI / 180;
    return [CX + r * Math.cos(t), CY - r * Math.sin(t)];
  };

  let s = '';

  // Arrowhead marker for the axis lines (double-pointed).
  s += `<defs><marker id="maxis" markerWidth="9" markerHeight="9" refX="7" refY="4.5" `
     + `orient="auto-start-reverse"><path d="M0.5,0.5 L8.5,4.5 L0.5,8.5" fill="none" `
     + `stroke="#a371f7" stroke-width="1.6"/></marker></defs>`;

  // --- degree ticks around the outer ring ---
  for (let dgr = 0; dgr < 360; dgr++) {
    const len = dgr % 30 === 0 ? 10 : dgr % 10 === 0 ? 8 : dgr % 5 === 0 ? 6 : 4;
    const [x1, y1] = P(st.rOut, ref + dgr);
    const [x2, y2] = P(st.rOut - len, ref + dgr);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
       + `stroke="#6e7681" stroke-width="${dgr % 30 === 0 ? 1.2 : 0.8}"/>`;
  }
  s += `<circle cx="${CX}" cy="${CY}" r="${st.rOut}" fill="none" stroke="#8b949e" stroke-width="1.5"/>`;

  // --- sign glyphs, colored by element ---
  for (let k = 0; k < 12; k++) {
    const sIdx = (Math.floor(ref / 30) + k) % 12;
    const [x, y] = P(st.rSign, ref + k * 30 + 15);
    s += text(x, y, SIGN_GLYPHS[sIdx] + TVS, st.signSize, ELEMENT_COLORS[sIdx % 4]);
  }

  // --- house cusps + axis arrows ---
  // Asc–Dsc and Mc–Ic as double-pointed arrows (no labels, space-efficient).
  // The arrows run rim-to-rim through the center.
  {
    const [ax1, ay1] = P(st.rOut, asc), [ax2, ay2] = P(st.rOut, norm360(asc + 180));
    s += `<line x1="${ax1.toFixed(1)}" y1="${ay1.toFixed(1)}" x2="${ax2.toFixed(1)}" y2="${ay2.toFixed(1)}" `
       + `stroke="#a371f7" stroke-width="1.6" marker-start="url(#maxis)" marker-end="url(#maxis)"/>`;
    const [mx1, my1] = P(st.rOut, mc), [mx2, my2] = P(st.rOut, norm360(mc + 180));
    s += `<line x1="${mx1.toFixed(1)}" y1="${my1.toFixed(1)}" x2="${mx2.toFixed(1)}" y2="${my2.toFixed(1)}" `
       + `stroke="#a371f7" stroke-width="1.6" marker-start="url(#maxis)" marker-end="url(#maxis)"/>`;
    for (let k = 1; k < 12; k++) {
      if (k === 6) continue;
      const [x1, y1] = P(st.rAsp, ref + k * 30);
      const [x2, y2] = P(st.rOut, ref + k * 30);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
         + `stroke="#30363d" stroke-width="0.8"/>`;
    }
  }
  s += `<circle cx="${CX}" cy="${CY}" r="${st.rAsp}" fill="none" stroke="#8b949e" stroke-width="1"/>`;

  // --- points: 10 planets + 4 angles + node axis (same as desktop) ---
  const tnode = norm360(out[10 * 6]);
  const pts = [];
  for (let i = 0; i < 10; i++) {
    pts.push({ lon: norm360(out[i * 6]), glyph: PLANET_GLYPHS[i], color: PLANET_COLORS[i],
               kind: 'planet', idx: i });
  }
  const angle = (lon, glyph) => ({ lon: norm360(lon), glyph, color: '#e6edf3',
    kind: 'angle', idx: -1 });
  pts.push(angle(asc, 'As'), angle(norm360(asc + 180), 'Ds'),
           angle(mc, 'Mc'), angle(norm360(mc + 180), 'Ic'));
  pts.push({ lon: tnode, glyph: NODE_N, color: '#c9d1d9', kind: 'node', idx: -1 });
  pts.push({ lon: norm360(tnode + 180), glyph: NODE_S, color: '#8b949e', kind: 'node', idx: -1 });
  pts.forEach((p) => { p.elon = effLon(p.lon); });

  // --- PAVA placement for the big outside glyphs ---
  // Movables (planets+nodes) get hw=4.5° (32pt glyphs at r=218 need
  // (32/2)/218 rad = 4.2°); fixed angles get hw=2.5°.
  // (glyphSize/2)/rGlyph radians, normalized to 1 at the defaults.
  const HW_S = (st.glyphSize * 218) / (32 * st.rGlyph);
  const HW_MOB = 4.5 * HW_S * sh.sepScale, HW_ANG = 2.5 * HW_S * sh.sepScale;
  const isAnchor = pts.map((p) => p.kind === 'angle');
  const labelElon = pts.map((p) => p.elon);
  const idx = pts.map((_, i) => i).sort((a, b) => labelElon[a] - labelElon[b]);
  const anchorIdx = idx.filter((i) => isAnchor[i]);
  const placed = new Array(pts.length);
  for (let f = 0; f < anchorIdx.length; f++) {
    const i0 = anchorIdx[f], i1 = anchorIdx[(f + 1) % anchorIdx.length];
    const A = pts[i0], B = pts[i1];
    const mov = [];
    for (let i = (idx.indexOf(i0) + 1) % idx.length; idx[i] !== i1; i = (i + 1) % idx.length)
      mov.push(idx[i]);
    const base = A.elon;
    const lin = (a) => base + norm360(a - base);
    const bLin = base + norm360(B.elon - base);
    const thetas = mov.map((i) => lin(labelElon[i]));
    const hws = mov.map(() => HW_MOB);
    const xs = declutterArc(thetas, hws, [base, HW_ANG], [bLin, HW_ANG]);
    mov.forEach((mi, k) => { placed[mi] = norm360(xs[k]); });
    placed[i0] = norm360(A.elon);
  }

  // --- L-shaped leaders (under glyphs) ---
  // From below the glyph, radial segment in to the wheel edge, then (if
  // displaced) a tangential segment to the actual position.
  // Angles are not drawn (axes are arrows); skip their leaders.
  const LEADER_R = st.rOut + 5;
  pts.forEach((p, pi) => {
    if (isAnchor[pi]) return;
    const th = placed[pi];
    const [bx, by] = P(LEADER_R, th);           // wheel edge at placed angle
    const [sx, sy] = P(st.rGlyph - st.glyphSize * 0.75, th); // start under glyph
    let dd = Math.abs(norm360(th) - norm360(p.elon));
    dd = Math.min(dd, 360 - dd);
    s += `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" `
       + `stroke="#484f58" stroke-width="1.2"/>`;
    if (dd > 0.5) {
      const [cx2, cy2] = P(LEADER_R, p.elon);   // actual position
      s += `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${cx2.toFixed(1)}" y2="${cy2.toFixed(1)}" `
         + `stroke="#484f58" stroke-width="1.2"/>`;
      // Dot at the actual position on the rim.
      const [dx, dy] = P(st.rOut, p.elon);
      s += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="2.5" fill="${p.color || '#e6edf3'}"/>`;
    }
  });

  // --- big glyphs outside (angles omitted; axes are arrows) ---
  pts.forEach((p, pi) => {
    if (isAnchor[pi]) return;
    const th = placed[pi];
    const [x, y] = P(st.rGlyph, th);
    s += text(x, y, p.glyph + TVS, st.glyphSize, p.color || '#e6edf3');
  });

  // --- Ptolemaic aspects (same logic as desktop, smaller circle) ---
  for (let i = 0; i < 10; i++) {
    for (let j = i + 1; j < 10; j++) {
      let sep = Math.abs(pts[i].lon - pts[j].lon);
      sep = Math.min(sep, 360 - sep);
      for (const asp of ASPECTS) {
        if (Math.abs(sep - asp.angle) <= ORB) {
          const [x1, y1] = P(st.rAsp, pts[i].lon);
          const [x2, y2] = P(st.rAsp, pts[j].lon);
          const w = (0.8 + 2.7 * (1 - Math.abs(sep - asp.angle) / ORB)) * sh.aspWidth;
          s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" `
             + `stroke="${asp.color}" stroke-width="${w.toFixed(1)}" opacity="0.85"/>`;
          break;
        }
      }
    }
  }

  return `<svg viewBox="${VB_M}" role="img" aria-label="Whole-sign horoscope wheel (mobile)">`
       + `<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">${s}</g></svg>`;
}
