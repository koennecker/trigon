// Kent C. Dodds-style integration tests for the sky view's pure
// builders (sky.js). bodyTipHTML, starTipHTML, skyReadoutHTML, and
// lockButtonHTML were closure/inline templates inside createSkyUI
// and had no browserless test at all; they are now exported pure
// builders. Each test renders the builder output into a jsdom
// document and asserts on what a user would see: names, signs,
// coordinates, and button text — never on the raw HTML string.
// Run: node --test test/ui-sky.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bodyTipHTML, starTipHTML, skyReadoutHTML, lockButtonHTML } from '../sky.js';
import { loreForStar } from '../sky-data.js';

function render(html) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  dom.window.document.body.innerHTML = html;
  return dom.window.document;
}

describe('bodyTipHTML', () => {
  it('an angle tip shows its name, sign position, and altitude', () => {
    const doc = render(bodyTipHTML({ kind: 'angle', name: 'Ascendant', lon: 15.25, alt: 12.3 }));
    assert.match(doc.body.textContent, /Ascendant/);
    assert.match(doc.body.textContent, /♈ 15\.3°/);
    assert.match(doc.body.textContent, /alt 12\.3°/);
  });

  it('a body tip shows its glyph name, house, alt/az, and retrograde mark', () => {
    const doc = render(bodyTipHTML({
      kind: 'body', def: { name: 'Mars', glyph: '♂', color: '#ff0000' },
      lon: 130.5, alt: -5.2, az: 210.4, house: 5, speed: -0.3,
    }));
    assert.match(doc.body.textContent, /Mars/);
    assert.match(doc.body.textContent, /house 5/);
    assert.match(doc.body.textContent, /alt -5\.2° · az 210\.4°/);
    assert.match(doc.body.textContent, /℞/);
  });

  it('a direct body tip has no retrograde mark and a + altitude sign', () => {
    const doc = render(bodyTipHTML({
      kind: 'body', def: { name: 'Jupiter', glyph: '♃', color: '#00ff00' },
      lon: 10, alt: 20, az: 90, house: 0, speed: 0.1,
    }));
    assert.doesNotMatch(doc.body.textContent, /℞/);
    assert.match(doc.body.textContent, /alt \+20\.0°/);
    assert.doesNotMatch(doc.body.textContent, /house/);
  });
});

describe('starTipHTML', () => {
  const star = { name: 'Aldebaran', bayer: 'alTau', altNames: ['Rohini'], ra0: 68.98, dec0: 16.51, mag: 0.86 };

  it('a star tip shows name, Bayer, magnitude, alt names, and J2000 coordinates', () => {
    const doc = render(starTipHTML(star, loreForStar(star)));
    assert.match(doc.body.textContent, /Aldebaran/);
    assert.match(doc.body.textContent, /alTau · mag 0\.86/);
    assert.match(doc.body.textContent, /aka Rohini/);
    assert.match(doc.body.textContent, /RA 04h35m Dec \+16°30′ \(J2000\)/);
  });

  it('a star with lore shows its traditions and lore text', () => {
    const doc = render(starTipHTML(star, loreForStar(star)));
    assert.match(doc.body.textContent, /Western/);
    assert.match(doc.body.textContent, /The Follower; one of the four Royal Stars/);
  });

  it('a star without lore shows no traditions line', () => {
    const plain = { name: 'HD 12345', bayer: 'hd12345', altNames: [], ra0: 10, dec0: -20, mag: 5.0 };
    const doc = render(starTipHTML(plain, loreForStar(plain)));
    assert.match(doc.body.textContent, /HD 12345/);
    assert.doesNotMatch(doc.body.textContent, /aka/);
    assert.equal(doc.querySelector('.trad'), null);
  });
});

describe('skyReadoutHTML and lockButtonHTML', () => {
  it('a readout shows UTC time, LST, position, Sun altitude, and ayanamsa', () => {
    const doc = render(skyReadoutHTML({
      utcMs: Date.UTC(2026, 0, 15, 12, 30, 5), lst: 123.45,
      lat: 33.4484, lon: -112.074, sunAlt: 42.1, ayanamsa: 24.12,
      viewMode: 'observer', lockName: null,
    }));
    assert.match(doc.body.textContent, /UTC 2026-01-15 12:30:05/);
    assert.match(doc.body.textContent, /LST 123\.45°/);
    assert.match(doc.body.textContent, /33\.45°N 112\.07°W/);
    assert.match(doc.body.textContent, /Sun \+42\.1°/);
    assert.match(doc.body.textContent, /ayanāṃśa 24\.12°/);
    assert.doesNotMatch(doc.body.textContent, /sphere view/);
    assert.doesNotMatch(doc.body.textContent, /tracking/);
  });

  it('a readout without Sun altitude omits the Sun segment, and sphere view is named', () => {
    const doc = render(skyReadoutHTML({
      utcMs: Date.UTC(2026, 0, 15, 0, 0, 0), lst: 0,
      lat: -33.45, lon: 151.21, sunAlt: null, ayanamsa: 24.0,
      viewMode: 'sphere', lockName: 'Mars',
    }));
    assert.match(doc.body.textContent, /33\.45°S 151\.21°E/);
    assert.doesNotMatch(doc.body.textContent, /Sun /);
    assert.match(doc.body.textContent, /sphere view/);
    assert.match(doc.body.textContent, /tracking Mars/);
  });

  it('a lock button names the tracked body and offers unlock', () => {
    const doc = render(`<button>${lockButtonHTML({ name: 'Saturn' })}</button>`);
    assert.equal(doc.querySelector('button').textContent, '🔒 tracking Saturn · unlock');
  });
});
