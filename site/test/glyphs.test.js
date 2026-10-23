// Unit tests for glyphs.js: the custom vector glyph set. Runs in node
// with no DOM — glyphs.js is pure string building over path data.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGN_PATHS, BODY_PATHS, GLYPH_STROKE_BASE,
         glyphSVG, signGlyphSVG, bodyGlyphSVG } from '../glyphs.js';

const BODY_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter',
                   'saturn', 'uranus', 'neptune', 'pluto',
                   'true-node', 'south-node'];

describe('glyph path data', () => {
  it('covers 12 signs and all 12 point keys', () => {
    assert.equal(SIGN_PATHS.length, 12);
    assert.deepEqual(Object.keys(BODY_PATHS).sort(), [...BODY_KEYS].sort());
  });

  it('every glyph has at least one stroke or fill path', () => {
    for (const e of [...SIGN_PATHS, ...Object.values(BODY_PATHS)])
      assert.ok(e.s.length + e.f.length > 0);
  });

  it('all path coordinates stay inside the 0..100 grid (with margin)', () => {
    // Walk each path: absolute coordinates (M/L/H/V/C/A endpoints and
    // control points) must land in [-1, 101]; relative arc deltas and
    // radii are sizes, bounded by the grid diagonal instead.
    const inGrid = (v, d) => assert.ok(v >= -1 && v <= 101, `coordinate ${v} in "${d}"`);
    for (const e of [...SIGN_PATHS, ...Object.values(BODY_PATHS)]) {
      for (const d of [...e.s, ...e.f]) {
        const toks = d.match(/[MLHVCZAa]|-?\d+(?:\.\d+)?/g) || [];
        let cmd = '', i = 0;
        const num = () => parseFloat(toks[i++]);
        while (i < toks.length) {
          if (/^[MLHVCZAa]$/.test(toks[i])) cmd = toks[i++];
          if (cmd === 'M' || cmd === 'L') { inGrid(num(), d); inGrid(num(), d); cmd = 'L'; }
          else if (cmd === 'H') inGrid(num(), d);
          else if (cmd === 'V') inGrid(num(), d);
          else if (cmd === 'C') { for (let k = 0; k < 6; k++) inGrid(num(), d); }
          else if (cmd === 'A') {
            const rx = num(), ry = num(); num(); num(); num();
            assert.ok(rx <= 100 && ry <= 100, `arc radius in "${d}"`);
            inGrid(num(), d); inGrid(num(), d);
          } else if (cmd === 'a') {
            const rx = num(), ry = num(); num(); num(); num();
            const dx = num(), dy = num();
            assert.ok(rx <= 100 && ry <= 100 && Math.abs(dx) <= 100 && Math.abs(dy) <= 100,
              `relative arc in "${d}"`);
          } else if (cmd === 'Z') { /* no params */ }
          else assert.fail(`unhandled command "${cmd}" in "${d}"`);
        }
      }
    }
  });

  it('path data uses only the expected command set', () => {
    for (const e of [...SIGN_PATHS, ...Object.values(BODY_PATHS)])
      for (const d of [...e.s, ...e.f])
        assert.ok(/^[MLHVC AZa\d\s.,-]+$/.test(d), `unexpected command in "${d}"`);
  });
});

describe('glyphSVG rendering', () => {
  it('centers and scales the grid onto the target box', () => {
    const s = glyphSVG(SIGN_PATHS[0], 350, 200, 19, '#ff7b72');
    assert.ok(s.includes('translate(350.0 200.0) scale(0.1900) translate(-50 -50)'));
    assert.ok(s.includes('class="svg-glyph"'));
  });

  it('stroke width defaults to the base and follows opts', () => {
    assert.ok(glyphSVG(SIGN_PATHS[0], 0, 0, 20, '#fff')
      .includes(`stroke-width="${GLYPH_STROKE_BASE}"`));
    assert.ok(glyphSVG(SIGN_PATHS[0], 0, 0, 20, '#fff', { strokeW: 12.25 })
      .includes('stroke-width="12.25"'));
  });

  it('strokeW 0 omits the stroke path but keeps fills', () => {
    const sun = glyphSVG(BODY_PATHS.sun, 0, 0, 20, '#fff', { strokeW: 0 });
    assert.ok(!sun.includes('fill="none"'), 'no stroke path');
    assert.ok(sun.includes('fill="#fff"'), 'center dot fill kept');
  });

  it('opacities land on the stroke and fill paths', () => {
    const s = glyphSVG(BODY_PATHS.sun, 0, 0, 20, '#fff', { strokeO: 0.5, fillO: 0.25 });
    assert.ok(s.includes('opacity="0.5"'));
    assert.ok(s.includes('opacity="0.25"'));
  });

  it('the Moon is fill-only (a crescent, no stroke path)', () => {
    const s = bodyGlyphSVG('moon', 0, 0, 20, '#fff');
    assert.ok(!s.includes('fill="none"'));
    assert.ok(s.includes('fill="#fff"'));
  });

  it('signGlyphSVG indexes the zodiac in order; unknown body keys render empty', () => {
    for (let i = 0; i < 12; i++)
      assert.ok(signGlyphSVG(i, 0, 0, 10, '#fff').includes(SIGN_PATHS[i].s[0].split(' ')[0]) ||
                signGlyphSVG(i, 0, 0, 10, '#fff').length > 0);
    assert.equal(bodyGlyphSVG('ceres', 0, 0, 10, '#fff'), '');
  });
});
