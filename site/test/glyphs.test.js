// Unit tests for glyphs.js: the custom vector glyph set. Runs in node
// with no DOM — glyphs.js is pure string building over path data.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SIGN_PATHS, BODY_PATHS,
         glyphSVG, signGlyphSVG, bodyGlyphSVG } from '../glyphs.js';

const BODY_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter',
                   'saturn', 'uranus', 'neptune', 'pluto',
                   'true-node', 'south-node'];
const ALL_PATHS = [...SIGN_PATHS, ...Object.values(BODY_PATHS)];

describe('glyph path data', () => {
  it('covers 12 signs and all 12 point keys', () => {
    assert.equal(SIGN_PATHS.length, 12);
    assert.deepEqual(Object.keys(BODY_PATHS).sort(), [...BODY_KEYS].sort());
  });

  it('every glyph is a non-trivial closed outline', () => {
    for (const d of ALL_PATHS) {
      assert.ok(typeof d === 'string' && d.length > 100, 'path too short');
      assert.ok(d.startsWith('M'), 'starts with a moveto');
      assert.ok(d.includes('Z'), 'has a closed subpath');
    }
  });

  it('all path coordinates stay inside the 0..100 grid', () => {
    // Walk each path: every parameter of M/L/C/Q is an absolute
    // coordinate and must land in [0, 100] (the generator's fit margin
    // keeps ink inside 3..97).
    for (const d of ALL_PATHS) {
      const toks = d.match(/[MLCQZHV]|-?\d+(?:\.\d+)?/g) || [];
      let cmd = '', i = 0;
      const num = () => {
        const v = parseFloat(toks[i++]);
        assert.ok(v >= -0.1 && v <= 100.1, `coordinate ${v} in "${d.slice(0, 40)}..."`);
      };
      while (i < toks.length) {
        if (/^[MLCQZHV]$/.test(toks[i])) cmd = toks[i++];
        if (cmd === 'M' || cmd === 'L') { num(); num(); cmd = 'L'; }
        else if (cmd === 'H' || cmd === 'V') { num(); }
        else if (cmd === 'C') { for (let k = 0; k < 6; k++) num(); }
        else if (cmd === 'Q') { for (let k = 0; k < 4; k++) num(); }
        else if (cmd === 'Z') { /* no params */ }
        else assert.fail(`unhandled command "${cmd}"`);
      }
    }
  });

  it('path data uses only the expected command set', () => {
    for (const d of ALL_PATHS)
      assert.ok(/^[MLCQZHV\d\s.,-]+$/.test(d), `unexpected command in "${d.slice(0, 40)}"`);
  });
});

describe('glyphSVG rendering', () => {
  it('centers and scales the grid onto the target box', () => {
    const s = glyphSVG(SIGN_PATHS[0], 350, 200, 19, '#ff7b72');
    assert.ok(s.includes('translate(350.0 200.0) scale(0.1900) translate(-50 -50)'));
    assert.ok(s.includes('class="svg-glyph"'));
    assert.ok(s.includes(`d="${SIGN_PATHS[0]}"`));
  });

  it('fills with the glyph color at full opacity by default, no outline', () => {
    const s = glyphSVG(SIGN_PATHS[0], 0, 0, 20, '#fff');
    assert.ok(s.includes('fill="#fff" fill-opacity="1"'));
    assert.ok(!s.includes('stroke='), 'no outline by default');
  });

  it('outlineW adds a same-color outline; opacities land on the path', () => {
    const s = glyphSVG(BODY_PATHS.sun, 0, 0, 20, '#fff',
                       { outlineW: 2.5, outlineO: 0.5, fillO: 0.25 });
    assert.ok(s.includes('stroke="#fff" stroke-width="2.5" stroke-opacity="0.5"'));
    assert.ok(s.includes('fill-opacity="0.25"'));
  });

  it('signGlyphSVG indexes the zodiac in order; unknown body keys render empty', () => {
    for (let i = 0; i < 12; i++)
      assert.ok(signGlyphSVG(i, 0, 0, 10, '#fff').includes(`d="${SIGN_PATHS[i]}"`));
    assert.ok(bodyGlyphSVG('pluto', 0, 0, 10, '#fff').includes(`d="${BODY_PATHS.pluto}"`));
    assert.equal(bodyGlyphSVG('ceres', 0, 0, 10, '#fff'), '');
  });
});
