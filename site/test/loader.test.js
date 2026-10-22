// Tests for loader.js — the download loading animation.
// Run: node --test test/loader.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MORPH_GLYPHS, MORPH_COLORS, loaderHTML, setGlyph, morphFrame, createLoader } from '../loader.js';

describe('loaderHTML', () => {
  it('renders the card with the first glyph, filter, and the label', () => {
    const h = loaderHTML('Downloading ephemeris data…');
    assert.match(h, /id="loader"/);
    assert.match(h, /id="lglyph"/);
    assert.match(h, /feDisplacementMap/);
    assert.match(h, />Downloading ephemeris data…<\/div>/);
    assert.ok(h.includes(MORPH_GLYPHS[0]));
    assert.ok(h.includes(MORPH_COLORS[0]));
  });
  it('has twelve morph glyphs cycling the four element colors', () => {
    assert.equal(MORPH_GLYPHS.length, 12);
    assert.equal(MORPH_COLORS.length, 4);
  });
});

describe('setGlyph / morphFrame', () => {
  const fakeEl = () => ({
    textContent: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    style: {},
  });
  it('setGlyph sets the glyph text and its element color', () => {
    const el = fakeEl();
    setGlyph(el, 5); // Virgo, earth
    assert.equal(el.textContent, MORPH_GLYPHS[5] + '\uFE0E');
    assert.equal(el.attrs.fill, MORPH_COLORS[1]);
    setGlyph(el, 8); // Sagittarius, fire wraps the color cycle
    assert.equal(el.attrs.fill, MORPH_COLORS[0]);
  });
  it('morphFrame peaks the displacement at s=1 and is crisp at s=0', () => {
    const el = fakeEl(), disp = fakeEl();
    morphFrame(el, disp, 0);
    assert.equal(disp.attrs.scale, '0.00');
    assert.equal(el.style.filter, '');
    morphFrame(el, disp, 1);
    assert.equal(disp.attrs.scale, '22.00');
    assert.equal(el.style.filter, 'blur(6.00px)');
    assert.equal(el.style.opacity, '0.700');
    assert.equal(el.style.transform, 'scale(0.8800)');
  });
});

describe('createLoader', () => {
  // Fake env: captures mounts, drives RAF manually with a virtual clock.
  function fakeEnv() {
    const state = { mounted: [], shown: 0, inDom: false, label: null, frames: [] };
    const glyph = { textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, style: {} };
    const disp = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    let rafCb = null, clock = 0;
    const env = {
      mount: html => { state.mounted.push(html); state.inDom = true; },
      onShow: () => { state.shown++; },
      glyphEl: () => (state.inDom ? glyph : null),
      dispEl: () => disp,
      labelEl: () => state.label,
      exists: () => state.inDom,
      raf: cb => { rafCb = cb; return 7; },
      cancelRaf: () => { rafCb = null; },
      now: () => clock,
      reducedMotion: () => false,
    };
    const step = ms => { clock += ms; const cb = rafCb; rafCb = null; if (cb) cb(clock); };
    return { env, state, glyph, disp, step, hasFrame: () => !!rafCb };
  }

  it('show paints once; a second show only updates the label', () => {
    const f = fakeEnv();
    const loader = createLoader(f.env);
    loader.show('first');
    assert.equal(f.state.mounted.length, 1);
    assert.equal(f.state.shown, 1);
    f.state.label = { textContent: '' };
    loader.show('second');
    assert.equal(f.state.mounted.length, 1, 'no repaint');
    assert.equal(f.state.label.textContent, 'second');
  });

  it('the morph loop swaps the glyph mid-morph and cycles signs', () => {
    const f = fakeEnv();
    const loader = createLoader(f.env);
    loader.show('x');
    f.step(100);           // still holding sign 0
    assert.equal(f.glyph.textContent, '');
    f.step(500);           // t=600: morph q=0.11, no swap yet
    f.step(300);           // t=900: q=0.78 -> swapped to sign 1
    assert.equal(f.glyph.textContent, MORPH_GLYPHS[1] + '\uFE0E');
  });

  it('hide stops the loop; stale frames do not resurrect it', () => {
    const f = fakeEnv();
    const loader = createLoader(f.env);
    loader.show('x');
    loader.hide();
    assert.equal(f.hasFrame(), false);
    f.step(2000);
    assert.equal(f.glyph.textContent, '');
  });

  it('the loop stops quietly when the card leaves the DOM', () => {
    const f = fakeEnv();
    const loader = createLoader(f.env);
    loader.show('x');
    f.state.inDom = false;  // results replaced the card
    f.step(100);
    assert.equal(f.hasFrame(), false);
  });

  it('arm/isArmed round-trips the gate', () => {
    const loader = createLoader(fakeEnv().env);
    assert.equal(loader.isArmed(), false);
    loader.arm(true);
    assert.equal(loader.isArmed(), true);
    loader.arm(false);
    assert.equal(loader.isArmed(), false);
  });
});
