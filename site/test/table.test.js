// Tests for table.js — table row structs and HTML builders.
// Run: node --test test/table.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, tableRows, buildTableHTML, speedIndicatorHTML, angleRows } from '../table.js';

// Synthetic chart_compute-shaped output: 84 doubles. Bodies 0..11 at
// slots i*6 ([lon, lat, dist, speedLon, dec, mag]); out[72]=Asc,
// out[73]=MC, out[74+i]=house.
function fakeOut() {
  const out = new Array(84).fill(0);
  const set = (i, lon, spd, dec, mag, house) => {
    const o = i * 6;
    out[o] = lon; out[o + 3] = spd; out[o + 4] = dec; out[o + 5] = mag;
    out[74 + i] = house;
  };
  set(0, 352.74195, 1.0027, -1.5, -26.74, 7);   // Sun
  set(1, 120.5, 12.5, 5.25, -12.0, 3);           // Moon
  set(2, 10.0, -0.5, 2.0, 1.5, 8);               // Mercury retrograde
  for (let i = 3; i < 10; i++) set(i, i * 30 + 5, 0.1, 0, 2.0, (i % 12) + 1);
  set(10, 200.0, 0, 0, 0, 0);                    // nodes: dec/spd/mag/house dashed
  set(11, 200.0, 0, 0, 0, 0);
  out[72] = 15.25; out[73] = 300.75;             // Asc, MC
  return out;
}

describe('tableRows', () => {
  it('builds eleven rows in body order (True Node last, no Mean Node)', () => {
    const rows = tableRows(fakeOut());
    assert.equal(rows.length, 11);
    assert.ok(!BODIES.includes('Mean Node'));
    assert.deepEqual(rows.map(r => r.body), BODIES);
  });
  it('formats longitudes per the fmt argument (integration with format.js)', () => {
    const dms = tableRows(fakeOut(), 'dms');
    assert.equal(dms[0].lon, 'Pisces 22°44′31″');
    const dec = tableRows(fakeOut(), 'dec');
    assert.equal(dec[0].lon, '352.7419°'); // 352.74195 is 352.7419499… in binary
  });
  it('flags retrograde motion', () => {
    const rows = tableRows(fakeOut());
    assert.equal(rows[2].retro, true);
    assert.equal(rows[2].mot, 'Retrograde');
    assert.equal(rows[0].retro, false);
    assert.equal(rows[0].mot, 'Direct');
  });
  it('dashes node declination/speed/magnitude/house', () => {
    const rows = tableRows(fakeOut());
    for (const i of [10]) {
      assert.equal(rows[i].dim, true);
      assert.equal(rows[i].dec, '—');
      assert.equal(rows[i].spd, '—');
      assert.equal(rows[i].mag, '—');
      assert.equal(rows[i].house, '—');
    }
    assert.equal(rows[0].house, '7');
  });
  it('carries the speed percentile and sigma for CSV export', () => {
    const rows = tableRows(fakeOut());
    assert.ok(Number.isFinite(rows[0].spdPct));
    assert.ok(Number.isFinite(rows[0].spdZ));
    assert.equal(rows[10].spdPct, null); // nodes unscored
    const html = speedIndicatorHTML(rows[0]);
    assert.match(html, /data-pct="-?\d+\.\d"/);
    assert.match(html, /data-z="[+-]\d+\.\d{2}"/);
    assert.equal(speedIndicatorHTML(rows[10]), '');
    // The dot lands in both the desktop table and the mobile card.
    assert.equal((buildTableHTML(fakeOut(), 'dms').match(/data-pct=/g) || []).length, 20);
  });
});

describe('buildTableHTML', () => {
  it('renders Ascendant/MC, the table, and mobile cards', () => {
    const html = buildTableHTML(fakeOut(), 'dms');
    assert.match(html, /data-asc>Aries 15°15′00″</);
    assert.match(html, /data-mc>Aquarius 0°45′00″</);
    assert.equal((html.match(/<tr[ >]/g) || []).length, 16); // header + 11 bodies + 4 angles
    assert.equal((html.match(/<div class="planet-card">/g) || []).length, 11);
    assert.match(html, /Ascendant<\/td>/);
    assert.ok(!html.includes('Motion</th>')); // merged into Speed
    assert.match(html, />1°00′09″\/d</); // Sun speed
    assert.match(html, /<span class="direct">D<\/span>/); // green direct marker
  });
  it('marks the active angle format on the toggle', () => {
    const dms = buildTableHTML(fakeOut(), 'dms');
    assert.match(dms, /data-fmt="dms" aria-pressed="true"/);
    assert.match(dms, /data-fmt="dec" aria-pressed="false"/);
    const dec = buildTableHTML(fakeOut(), 'dec');
    assert.match(dec, /data-fmt="dec" aria-pressed="true"/);
    assert.match(dec, /352\.7419°/);
  });
  it('is deterministic', () => {
    assert.equal(buildTableHTML(fakeOut(), 'dms'), buildTableHTML(fakeOut(), 'dms'));
  });
  it('puts a CSV download button on the positions table', () => {
    assert.match(buildTableHTML(fakeOut(), 'dms'), /data-csv-name="trigon-positions\.csv"/);
  });
  it('adds station placeholders and dignity columns', () => {
    const dig = { decan: 'chaldean', isDay: true };
    const html = buildTableHTML(fakeOut(), 'dms', dig);
    assert.match(html, /<th>Prev station<\/th><th>Next station<\/th><th>Domicile<\/th><th>Decan<\/th>/);
    assert.equal((html.match(/stn-prev/g) || []).length, 8); // Mercury..Pluto
    assert.match(html, /data-ib="2"/);
    const rows = tableRows(fakeOut(), 'dms', dig);
    assert.equal(rows[0].dign.decan, 'Mars'); // Sun in late Pisces, Chaldean III
    assert.equal(rows[0].dign.domicile, 'Jupiter'); // Pisces domicile lord
    assert.equal(rows[7].dign, null);         // Uranus: no dignity columns
    assert.equal(tableRows(fakeOut(), 'dms')[0].dign, null); // no opts, no dignities
  });
});

describe('angle rows and display toggles', () => {
  it('angleRows gives the four angles with their lords', () => {
    const dig = { decan: 'chaldean', isDay: true };
    const rows = angleRows(fakeOut(), dig);
    assert.deepEqual(rows.map(r => r.body), ['Ascendant', 'Descendant', 'Midheaven', 'IC']);
    assert.equal(rows[0].lon, 'Aries 15°15′00″');
    assert.equal(rows[0].dign.domicile, 'Mars'); // Aries
    assert.equal(rows[2].dign.domicile, 'Saturn'); // Aquarius (traditional)
  });
  it('glyphs mode swaps names for glyphs in bodies, signs, and lords', () => {
    const rows = tableRows(fakeOut(), 'dms', { decan: 'chaldean', isDay: true }, true);
    assert.ok(rows[0].body.includes('☉'));
    assert.ok(rows[0].lon.startsWith('♓'));
    assert.ok(rows[0].dign.domicile.includes('♃')); // Jupiter rules Pisces
    const named = tableRows(fakeOut(), 'dms', { decan: 'chaldean', isDay: true }, false);
    assert.equal(named[0].body, 'Sun');
  });
  it('compact format keeps the leading pair and precise state', () => {
    const rows = tableRows(fakeOut(), 'compact');
    assert.equal(rows[0].lon, 'Pisces 22°44′'); // degrees lead: seconds dropped
    assert.equal(rows[0].spd, '1°00′/d D');
    const dec = tableRows(fakeOut(), 'dec');
    assert.equal(dec[2].spd, '0.5000°/d R'); // Mercury retrograde
  });
  it('rows carry colors, split speed direction, and magnitude glow data', () => {
    const rows = tableRows(fakeOut(), 'dms', { decan: 'chaldean', isDay: true });
    assert.equal(rows[0].color, '#58a6ff'); // Sun palette
    assert.ok(rows[0].lonHtml.includes('color:#a371f7')); // Pisces = water
    assert.equal(rows[0].spdMag, '1°00′09″/d');
    assert.equal(rows[0].spdDir, 'D');
    assert.equal(rows[2].spdDir, 'R'); // Mercury retrograde
    assert.ok(rows[0].magHtml.includes('brighter than')); // tooltip
    assert.ok(rows[0].dignCol.domicile); // lord color present
  });
});
