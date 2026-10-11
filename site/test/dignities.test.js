// Tests for dignities.js — decan/bound/triplicity/exaltation/D12/D9
// lords and the lordship deep dive. Expected values mirror
// proto/dignities_proto.py.
// Run: node --test test/dignities.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decanLord, egyptianBoundLord, triplicityLords, exaltationLord,
  d12Lord, d9Lord, domicileLord, wholeSignHouse, pointLords,
  computeLordships, buildLordshipHTML, buildSyzygyHTML,
  readDignityOpts, writeDignityOpts,
} from '../dignities.js';

// Body indices: 0 Sun, 1 Moon, 2 Mercury, 3 Venus, 4 Mars, 5 Jupiter, 6 Saturn.

describe('decanLord', () => {
  it('Chaldean: Aries Mars/Sun/Venus, Pisces Saturn/Jupiter/Mars', () => {
    assert.deepEqual([5, 15, 25].map(l => decanLord(l, 'chaldean')), [4, 0, 3]);
    assert.deepEqual([335, 345, 355].map(l => decanLord(l, 'chaldean')), [6, 5, 4]);
    assert.deepEqual([35, 45, 55].map(l => decanLord(l, 'chaldean')), [2, 1, 6]);
  });
  it('Indian: domicile lords of the sign, 5th, 9th', () => {
    assert.deepEqual([5, 15, 25].map(l => decanLord(l, 'indian')), [4, 0, 5]);   // Aries
    assert.deepEqual([35, 45, 55].map(l => decanLord(l, 'indian')), [3, 2, 6]);  // Taurus
    assert.deepEqual([305, 315, 325].map(l => decanLord(l, 'indian')), [6, 2, 3]); // Aquarius
  });
  it('methods differ where they should (Taurus I)', () => {
    assert.notEqual(decanLord(35, 'chaldean'), decanLord(35, 'indian'));
  });
});

describe('egyptianBoundLord', () => {
  it('follows the supplied table incl. boundary semantics', () => {
    assert.equal(egyptianBoundLord(5.999), 5);  // Aries Jupiter
    assert.equal(egyptianBoundLord(6.0), 3);    // Aries Venus from 6 exactly
    assert.equal(egyptianBoundLord(29.999), 6); // Aries Saturn
    assert.equal(egyptianBoundLord(120 + 17.999), 6); // Leo Saturn
    assert.equal(egyptianBoundLord(120 + 18.0), 2);   // Leo Mercury
    assert.equal(egyptianBoundLord(-0.001), 6); // wraps to Pisces Saturn
  });
});

describe('triplicityLords (Dorothean)', () => {
  it('sect lord primary, other sect lord secondary, participating third', () => {
    assert.deepEqual(triplicityLords(15, true), [0, 5, 6]);   // Aries day
    assert.deepEqual(triplicityLords(15, false), [5, 0, 6]);  // Aries night
    assert.deepEqual(triplicityLords(225, true), [3, 4, 1]);  // Scorpio day
    assert.deepEqual(triplicityLords(225, false), [4, 3, 1]); // Scorpio night
  });
});

describe('exaltationLord / d12Lord / d9Lord / domicileLord', () => {
  it('exaltations by sign, null where none', () => {
    assert.equal(exaltationLord(15), 0);   // Sun in Aries
    assert.equal(exaltationLord(160), 2);  // Mercury in Virgo
    assert.equal(exaltationLord(75), null);
  });
  it('D12 counts forward from the sign itself', () => {
    assert.equal(d12Lord(15), 3);   // Aries 15 -> Libra -> Venus
    assert.equal(d12Lord(32), 3);   // Taurus -> Taurus
    assert.equal(d12Lord(119), 2);  // Cancer 29 -> Gemini -> Mercury
  });
  it('D9 starts: cardinal self, fixed 9th, mutable 5th', () => {
    assert.equal(d9Lord(15), 0);    // Aries 15 -> Leo -> Sun
    assert.equal(d9Lord(30), 6);    // Taurus 0 -> Capricorn -> Saturn
    assert.equal(d9Lord(60), 3);    // Gemini 0 -> Libra -> Venus
    assert.equal(d9Lord(130), 1);   // Leo 10 -> Cancer -> Moon
    assert.equal(d9Lord(359.9), 5); // Pisces end -> Pisces -> Jupiter
  });
  it('domicile + whole-sign house', () => {
    assert.equal(domicileLord(200), 3); // Libra -> Venus
    assert.equal(wholeSignHouse(200, 5), 7); // Asc Aries: Libra is 7th
  });
});

// Synthetic chart: Asc Aries, MC Capricorn, Sun in Aries, Moon in Taurus.
function fakeOut() {
  const out = new Array(84).fill(0);
  const set = (i, lon) => { out[i * 6] = lon; };
  set(0, 15);   // Sun Aries 15
  set(1, 40);   // Moon Taurus 10
  set(2, 160);  // Mercury Virgo 10
  set(3, 200);  // Venus Libra 20
  set(4, 100);  // Mars Cancer 10
  set(5, 260);  // Jupiter Sagittarius 20
  set(6, 310);  // Saturn Aquarius 10
  set(7, 50); set(8, 70); set(9, 90); set(10, 110); set(11, 110);
  out[72] = 5;   // Asc Aries
  out[73] = 275; // MC Capricorn
  return out;
}
const LOTS = [{ name: 'Fortune', lon: 40 }, { name: 'Spirit', lon: 350 }];
const DAY = { decan: 'chaldean', isDay: true };

describe('computeLordships', () => {
  it('points = 7 planets + Asc/MC/IC + lots, with houses', () => {
    const { points } = computeLordships(fakeOut(), LOTS, DAY);
    assert.equal(points.length, 12);
    assert.equal(points.find(p => p.name === 'Sun').house, 1);
    assert.equal(points.find(p => p.name === 'Fortune').house, 2);
  });
  it('under: Sun in Aries has domicile Mars, decan Sun (Chaldean)', () => {
    const { planets } = computeLordships(fakeOut(), LOTS, DAY);
    const sun = planets[0];
    assert.equal(sun.under.domicile, 4);
    assert.equal(sun.under.decan, 0);
    assert.equal(sun.under.exaltation, 0); // Sun is its own exaltation lord in Aries
  });
  it('over: Mars is domicile lord of the Sun; totals add up', () => {
    const { planets, points } = computeLordships(fakeOut(), LOTS, DAY);
    const mars = planets[4];
    assert.ok(mars.over.domicile.includes('Sun'));
    for (const p of planets) {
      const dims = ['domicile', 'exaltation', 'decan', 'bound', 'triplicity', 'd12', 'd9'];
      assert.equal(p.total, dims.reduce((n, d) => n + p.over[d].length, 0));
    }
    // Every (point, dimension) relation is counted exactly once across
    // planets — including self-lordship (a planet in its own domain).
    const totalRelations = planets.reduce((n, p) => n + p.total, 0);
    let expect = 0;
    for (const p of points) {
      for (const d of ['domicile', 'exaltation', 'decan', 'bound', 'triplicity', 'd12', 'd9']) {
        const lord = d === 'triplicity' ? p.lords.triplicity[0] : p.lords[d];
        if (lord != null) expect++;
      }
    }
    assert.equal(totalRelations, expect);
    // Self-lordship is counted: the Sun in Aries (Chaldean decan = Sun)
    // is its own decan lord.
    assert.ok(planets[0].over.decan.includes('Sun'));
  });
  it('houses ruled: Saturn rules Capricorn+Aquarius houses from Aries Asc', () => {
    const { planets } = computeLordships(fakeOut(), LOTS, DAY);
    assert.deepEqual(planets[6].housesRuled, [10, 11]); // Cap = 10th, Aq = 11th
    assert.deepEqual(planets[0].housesRuled, [5]);      // Leo = 5th
  });
});

describe('buildLordshipHTML / buildSyzygyHTML', () => {
  it('renders summary, cards, sect + decan options', () => {
    const html = buildLordshipHTML(fakeOut(), LOTS, DAY);
    assert.match(html, /Lordship deep dive/);
    assert.match(html, /Day chart/);
    assert.match(html, /class="decan-method"/);
    assert.match(html, /Lords over Sun/);
    assert.match(html, /Sun rules/);
    assert.match(html, /Houses ruled/);
    assert.equal((html.match(/class="lord-card"/g) || []).length, 7);
  });
  it('syzygy lines name kind, Moon position, instant', () => {
    const html = buildSyzygyHTML({
      prev: { jd: 2460000.5, kind: 'new', moonLon: 15 },
      next: { jd: 2460015.5, kind: 'full', moonLon: 195 },
    });
    assert.match(html, /New Moon/);
    assert.match(html, /Full Moon/);
    assert.match(html, /Aries 15°00′/);
    assert.match(buildSyzygyHTML(null), /—/);
  });
  it('dignity opts round-trip, indian only when stored', () => {
    const store = new Map();
    const s = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    assert.equal(readDignityOpts(s).decan, 'chaldean');
    writeDignityOpts(s, { decan: 'indian' });
    assert.equal(readDignityOpts(s).decan, 'indian');
  });
});
