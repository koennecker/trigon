// Unit tests for chart.js pure functions.
// Run: node --test test/chart.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pavaIsotonic, declutterArc, renderChartSVG, renderChartSVGMobile,
         CHART_STYLE_SECTIONS, defaultChartStyle, resolveChartStyle,
         labelAngularHW, labelTokenPitch } from '../chart.js';

const approx = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const approxArr = (a, b, tol = 1e-9) => {
  assert.equal(a.length, b.length, `length ${a.length} != ${b.length}`);
  a.forEach((v, i) => assert.ok(approx(v, b[i], tol), `[${i}] ${v} != ${b[i]}`));
};

describe('pavaIsotonic', () => {
  it('leaves monotonic input unchanged', () => {
    approxArr(pavaIsotonic([1, 2, 3], [1, 1, 1]), [1, 2, 3]);
  });

  it('pools a single violator pair (chain reaction)', () => {
    // 3 > 1 violates monotonicity; pool to mean 2.
    approxArr(pavaIsotonic([3, 1, 4], [1, 1, 1]), [2, 2, 4]);
  });

  it('propagates pooling through a chain', () => {
    // 5 > 4 > 3 > 2 > 1: all pool to mean 3.
    approxArr(pavaIsotonic([5, 4, 3, 2, 1], [1, 1, 1, 1, 1]), [3, 3, 3, 3, 3]);
  });

  it('respects weights in pooled mean', () => {
    // weights 3 and 1: (3*3 + 1*1)/4 = 2.5
    approxArr(pavaIsotonic([3, 1], [3, 1]), [2.5, 2.5]);
  });

  it('infinite-weight anchors pin the ends', () => {
    const y = pavaIsotonic([0, 5, 10], [Infinity, 1, Infinity]);
    assert.equal(y[0], 0);
    assert.equal(y[2], 10);
    assert.ok(y[1] >= 0 && y[1] <= 10);
  });

  it('single element is identity', () => {
    approxArr(pavaIsotonic([42], [1]), [42]);
  });

  it('empty input returns empty', () => {
    assert.deepEqual(pavaIsotonic([], []), []);
  });
});

describe('declutterArc', () => {
  it('returns empty for empty arc', () => {
    assert.deepEqual(declutterArc([], [], [0, 1], [10, 1]), []);
  });

  it('leaves well-separated labels at true positions', () => {
    const xs = declutterArc([10, 30, 50], [2, 2, 2], [0, 2], [60, 2]);
    approxArr(xs, [10, 30, 50], 1e-6);
  });

  it('separates overlapping labels, preserving order', () => {
    // 10, 11, 12 with hw=2 need 4° spacing: pooled to 10, 14, 18-ish.
    const xs = declutterArc([10, 11, 12], [2, 2, 2], [0, 2], [60, 2]);
    for (let i = 1; i < xs.length; i++)
      assert.ok(xs[i] - xs[i - 1] >= 4 - 1e-9, `gap ${xs[i] - xs[i - 1]}`);
    // Order preserved.
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1]);
  });

  it('respects anchor bounds (no spill into anchors)', () => {
    const xs = declutterArc([5, 55], [2, 2], [0, 2], [60, 2]);
    assert.ok(xs[0] >= 0 + 2 + 2 - 1e-9, `xs[0]=${xs[0]} violates lo anchor`);
    assert.ok(xs[1] <= 60 - 2 - 2 + 1e-9, `xs[1]=${xs[1]} violates hi anchor`);
  });

  it('symmetric displacement for a close pair (Ds/Mercury case)', () => {
    // Two labels 1° apart, hw=2.5: optimal is symmetric, not one-sided.
    const xs = declutterArc([20, 21], [2.5, 2.5], [0, 2.5], [60, 2.5]);
    const d0 = Math.abs(xs[0] - 20), d1 = Math.abs(xs[1] - 21);
    assert.ok(Math.abs(d0 - d1) < 0.5, `asymmetric: ${d0} vs ${d1}`);
    assert.ok(xs[1] - xs[0] >= 5 - 1e-9);
  });

  it('handles overcrowded arc by spilling (order preserved)', () => {
    // 5 labels need 5*5=25° but arc only has 20°: spill, keep order.
    const xs = declutterArc([10, 11, 12, 13, 14], [2.5, 2.5, 2.5, 2.5, 2.5],
                            [0, 2.5], [20, 2.5]);
    assert.equal(xs.length, 5);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  });
});

// --- helpers for integration tests ---
// `out` is a flat array: out[i*6]=lon, out[i*6+3]=speed (10 planets),
// out[10*6]=true node lon, then asc, mc.
function makeOut(planetLons, { asc = 0, mc = 90, node = 0 } = {}) {
  const out = new Array(74).fill(0);
  planetLons.forEach((lon, i) => { out[i * 6] = lon; out[i * 6 + 3] = 1; });
  out[10 * 6] = node;
  out[72] = asc;
  out[73] = mc;
  return out;
}

function spokeLabels(svg) {
  // Extract spoke labels. Spokes are the 9.5pt texts (zodiac band uses
  // different sizes). Returns array of {x, y, rtl, radial} where radial
  // labels have positioned tspans (x/y on tspan, not text).
  const out = [];
  const re = /<text([^>]*)font-size="9\.5"([^>]*)>([\s\S]*?)<\/text>/g;
  let m;
  while ((m = re.exec(svg))) {
    const attrs = m[1] + m[2];
    const body = m[3];
    const xm = attrs.match(/x="([\d.]+)"/);
    const ym = attrs.match(/y="([\d.]+)"/);
    const radial = /<tspan x="/.test(body);
    out.push({
      x: xm ? +xm[1] : null,
      y: ym ? +ym[1] : null,
      rtl: attrs.includes('direction="rtl"'),
      radial,
    });
  }
  return out;
}

describe('renderChartSVG integration', () => {
  it('emits 16 spoke labels for 16 points', () => {
    const svg = renderChartSVG(
      makeOut([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]), {});
    assert.equal(spokeLabels(svg).length, 16);
  });

  it('spoke quadrants follow the spec', () => {
    // All-radial: every label uses positioned tspans along the spoke,
    // glyph at the outer end. No horizontal labels, no RTL, no rotation.
    // asc=0 at 9 o'clock; ref=0.
    const svg = renderChartSVG(makeOut([180, 0, 90, 270], { asc: 0 }), {});
    const labels = spokeLabels(svg);
    assert.equal(labels.length, 16);
    // No rotate() transforms, no writing-mode, no direction=rtl.
    assert.equal((svg.match(/font-size="9\.5"[^>]*transform="rotate/g) || []).length, 0,
      'spokes must not use rotate transforms');
    assert.equal((svg.match(/writing-mode/g) || []).length, 0,
      'spokes must not use writing-mode');
    assert.equal((svg.match(/direction="rtl"/g) || []).length, 0,
      'spokes must not use direction=rtl');
    assert.equal((svg.match(/unicode-bidi/g) || []).length, 0,
      'spokes must not use unicode-bidi');
    // All 16 labels are radial: each has 4 positioned tspans (glyph, degree,
    // sign, minutes) = 64 positioned tspans total.
    const positioned = (svg.match(/<tspan x="[\d.]+" y="[\d.]+"/g) || []).length;
    assert.equal(positioned, 64, `expected 64 radial tspans (16x4), got ${positioned}`);
  });

  it('glyph is at the outer end in all quadrants', () => {
    // All-radial: every label is a <text> with text-anchor=middle containing
    // positioned tspans; the glyph tspan (font-size=12) is at the largest
    // radius (outermost). All 16 spoke labels have an anchor.
    const svg = renderChartSVG(makeOut([10, 100, 190, 280]), {});
    const labels = spokeLabels(svg);
    assert.equal(labels.length, 16);
    const spokeTags = svg.match(/<text[^>]*font-size="9\.5"[^>]*>/g) || [];
    const anchored = spokeTags.filter((t) => /text-anchor="/.test(t)).length;
    assert.equal(anchored, 16, `all 16 spoke labels need an anchor, got ${anchored}`);
    // Glyph tokens (12pt) come first in each label's tspan sequence.
    const glyphFirst = (svg.match(/<text[^>]*font-size="9\.5"[^>]*><tspan x="[\d.]+" y="[\d.]+" font-size="12"/g) || []).length;
    assert.equal(glyphFirst, 16, `glyph should be first tspan in all 16 labels, got ${glyphFirst}`);
  });

  it('close pair gets symmetric PAVA displacement with leaders', () => {
    // Two planets 1° apart: PAVA separates them, leaders emitted.
    const svg = renderChartSVG(makeOut([100, 101]), {});
    const nLeaders = (svg.match(/stroke="#484f58"/g) || []).length;
    assert.ok(nLeaders >= 2, `expected leaders for displaced pair, got ${nLeaders}`);
  });

  it('labels hug the outer circle (R=248)', () => {
    const svg = renderChartSVG(makeOut([45]), {});
    const labels = spokeLabels(svg);
    assert.ok(labels.length > 0);
    const CX = 350, CY = 350;
    for (const l of labels) {
      if (l.radial) {
        // Radial: first tspan (glyph) should be at R_HUG.
        const m = svg.match(/<tspan x="([\d.]+)" y="([\d.]+)"[^>]*>[^<]*<\/tspan>/);
        // (checked per-label below via body parsing; skip here)
        continue;
      }
      const r = Math.hypot(l.x - CX, l.y - CY);
      // Anchor at R_HUG=248; allow small tolerance for PAVA shifts.
      assert.ok(r > 230 && r < 265, `label radius ${r.toFixed(1)} not hugging`);
    }
    // Radial labels: verify glyph tspan is at R_HUG=248.
    const re = /<text[^>]*font-size="9\.5"[^>]*>([\s\S]*?)<\/text>/g;
    let m;
    while ((m = re.exec(svg))) {
      if (!/<tspan x="/.test(m[1])) continue;
      const tm = m[1].match(/<tspan x="([\d.]+)" y="([\d.]+)"/);
      assert.ok(tm, 'radial label has positioned tspans');
      const r = Math.hypot(+tm[1] - CX, +tm[2] - CY);
      assert.ok(r > 240 && r < 256, `glyph radius ${r.toFixed(1)} not at R_HUG`);
    }
  });
});

describe('chart style', () => {
  it('defaults match the long-standing constants', () => {
    const d = defaultChartStyle();
    assert.deepEqual(d.desktop,
      { rOut: 294, rSign: 278, rDiv: 262, rHug: 248, rIn: 120, rAsp: 100,
        signSize: 19, lblGlyphSize: 12, lblTextSize: 9.5, aspGlyphSize: 12 });
    assert.deepEqual(d.mobile,
      { rOut: 165, rSign: 150, rAsp: 85, rGlyph: 218, glyphSize: 32, signSize: 16 });
    assert.deepEqual(d.shared, { aspWidth: 1, sepScale: 1 });
  });
  it('every section param has a matching default key', () => {
    const d = defaultChartStyle();
    for (const sec of CHART_STYLE_SECTIONS)
      for (const p of sec.params)
        assert.ok(p.key in d[sec.id], `${sec.id}.${p.key}`);
  });
  it('resolves overrides over defaults', () => {
    const st = resolveChartStyle({ desktop: { rOut: 310 }, shared: { aspWidth: 1.5 } });
    assert.equal(st.desktop.rOut, 310);
    assert.equal(st.desktop.rIn, 120); // untouched
    assert.equal(st.shared.aspWidth, 1.5);
  });
  it('accepts arbitrary positive sizes, drops junk and non-positive', () => {
    const st = resolveChartStyle({
      desktop: { rOut: 9999, rIn: -5, bogus: 1, signSize: NaN, lblGlyphSize: 0 },
      mobile: 'nope',
    });
    assert.equal(st.desktop.rOut, 9999);   // unbounded
    assert.equal(st.desktop.rIn, 120);     // non-positive -> default
    assert.ok(!('bogus' in st.desktop));
    assert.equal(st.desktop.signSize, 19); // NaN -> default
    assert.equal(st.desktop.lblGlyphSize, 12); // 0 -> default
  });
  it('sepScale accepts 0 (allowZero) while other params reject 0', () => {
    const st = resolveChartStyle({ shared: { sepScale: 0, aspWidth: 0 } });
    assert.equal(st.shared.sepScale, 0);
    assert.equal(st.shared.aspWidth, 1); // 0 -> default
  });
  it('sepScale scales the declutter guard', () => {
    const thetas = [10, 30, 50], hws = [2, 2, 2];
    const x1 = declutterArc(thetas, hws, [0, 2], [60, 2]);
    // halve the guards via the same path the renderer uses
    const xs = declutterArc(thetas, hws.map((h) => h * 0.5), [0, 1], [60, 1]);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(xs[i] - thetas[i]) <= Math.abs(x1[i] - thetas[i]) + 1e-9,
      'tighter guard displaces less');
  });
  it('labelAngularHW / labelTokenPitch reproduce the legacy tuning at defaults', () => {
    // Guard is evaluated at the innermost token radius (248 - 3*15 = 203).
    const hw = labelAngularHW(12, 9.5, 203);
    assert.ok(Math.abs(hw * 1.305 - 3.5) < 0.02, hw);
    assert.ok(Math.abs(hw * 0.932 - 2.5) < 0.02, hw);
    assert.equal(labelTokenPitch(12, 9.5), 15);
  });
  it('huge label sizes widen the declutter guard and token pitch', () => {
    const svg = renderChartSVG(makeOut([10, 100, 190, 280]),
      { style: { desktop: { lblGlyphSize: 48, lblTextSize: 38 } } });
    // token pitch = 1.25 * max(48, 38) = 60 along each radial spoke:
    // measure Euclidean tspan spacing within each label's <text>.
    const texts = [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map(m => m[1]);
    let n = 0;
    for (const t of texts) {
      const pts = [...t.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)"/g)]
        .map(m => [+m[1], +m[2]]);
      for (let i = 1; i < pts.length; i++) {
        const g = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]);
        assert.ok(Math.abs(g - 60) < 1, `gap ${g}`);
        n++;
      }
    }
    assert.ok(n >= 8, `only ${n} token gaps`);
  });
  it('no inter-label token overlap at 2x label sizes', () => {
    // All 10 planets spread out (36° apart): the 2x guard (9°/side) fits.
    const svg = renderChartSVG(makeOut([10, 46, 82, 118, 154, 190, 226, 262, 298, 334], { node: 205 }),
      { style: { desktop: { lblGlyphSize: 24, lblTextSize: 19 } } });
    // tspans are centered (text-anchor middle, dominant-baseline central):
    // estimate each token's box (glyphs ~1em wide, text ~0.6em/char) and
    // require no two tokens from different labels to overlap.
    const labels = [];
    for (const m of svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
      const parentFS = +m[1];
      const toks = [];
      for (const tm of m[2].matchAll(/<tspan x="([\d.]+)" y="([\d.]+)"([^>]*)>([\s\S]*?)<\/tspan>/g)) {
        const fsAttr = tm[3].match(/font-size="([\d.]+)"/);
        const fs = fsAttr ? +fsAttr[1] : parentFS;
        const w = fsAttr ? fs : 0.6 * fs * tm[4].length;
        toks.push({ x: +tm[1], y: +tm[2], w, h: fs });
      }
      if (toks.length > 1) labels.push(toks);
    }
    assert.ok(labels.length >= 4, 'only ' + labels.length + ' labels');
    for (let a = 0; a < labels.length; a++)
      for (let b = a + 1; b < labels.length; b++)
        for (const ta of labels[a])
          for (const tb of labels[b]) {
            const ox = (ta.w + tb.w) / 2 - Math.abs(ta.x - tb.x);
            const oy = (ta.h + tb.h) / 2 - Math.abs(ta.y - tb.y);
            assert.ok(!(ox > 1 && oy > 1),
              'overlap: (' + ta.x + ',' + ta.y + ') vs (' + tb.x + ',' + tb.y + ')');
          }
  });
  it('overcrowded arc: guards scale to fit, anchors never invaded', () => {
    // Regression: Moon sat on MC because the spill branch dropped the
    // anchor constraints. Guards must scale until they fit instead.
    const thetas = [171.9304, 195.4605, 217.9094, 220.2138];
    const hws = [7.45, 7.45, 10.43, 10.43];
    const xs = declutterArc(thetas, hws, [169.6207, 7.45], [247.1574, 7.45]);
    assert.equal(xs.length, 4);
    // every label stays inside the arc: the first clears the lo anchor
    assert.ok(xs[0] >= 169.6207 + 7.45 * 0.89, 'Moon clear of MC: ' + xs[0]);
    assert.ok(xs[3] <= 247.1574, 'last inside arc: ' + xs[3]);
    // order preserved and separations non-negative
    for (let i = 0; i < 3; i++) assert.ok(xs[i + 1] > xs[i], 'ordered ' + i);
    for (const x of xs) assert.ok(Number.isFinite(x), 'finite');
  });
  it('overcrowded arc degrades gracefully, never NaN', () => {
    const xs = declutterArc([10, 11, 12], [10, 10, 10], [0, 5], [30, 5]);
    assert.equal(xs.length, 3);
    for (const x of xs) {
      assert.ok(Number.isFinite(x), 'finite');
      assert.ok(x >= 0 && x <= 30, 'contained in arc: ' + x);
    }
  });
  it('a radius override moves the rendered circle', () => {
    const mk = (over) => renderChartSVG(makeOut([10, 100, 190, 280]), { style: over });
    const rOf = (svg) => {
      const m = svg.match(/<circle cx="350" cy="350" r="([\d.]+)" fill="none" stroke="#8b949e" stroke-width="1\.5"\/>/);
      return m ? +m[1] : null;
    };
    assert.equal(rOf(mk(undefined)), 294);
    assert.equal(rOf(mk({ desktop: { rOut: 310 } })), 310);
  });
  it('aspect width scales the rendered line widths', () => {
    const mk = (over) => renderChartSVG(makeOut([0, 180]), { style: over }); // opposition
    const wOf = (svg) => {
      const m = svg.match(/stroke-width="([\d.]+)" opacity="0\.9"/);
      return m ? +m[1] : null;
    };
    const w1 = wOf(mk(undefined)), w2 = wOf(mk({ shared: { aspWidth: 2 } }));
    assert.ok(w1 > 0 && w2 > 0);
    assert.ok(Math.abs(w2 / w1 - 2) < 0.01, `${w1} -> ${w2}`);
  });
  it('mobile renderer honors style and keeps the default viewBox', () => {
    const mk = (over) => renderChartSVGMobile(makeOut([10, 100, 190, 280]), { style: over });
    assert.ok(mk(undefined).includes('viewBox="110 110 480 480"'));
    const big = mk({ mobile: { rGlyph: 260, glyphSize: 48 } });
    assert.ok(big.includes('font-size="48"'), 'glyph size override renders');
  });
});
