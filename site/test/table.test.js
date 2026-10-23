// Tests for table.js — table row structs and HTML builders.
// Run: node --test test/table.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BODIES, tableRows, buildTableHTML, speedIndicatorHTML, angleRows, pointTooltip, TOOLTIP_POINT_KEYS, swapGlyphChars } from '../table.js';
import { fmtLon } from '../format.js';

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
  it('renders values per the angle format; settings controls live in the modal', () => {
    const dms = buildTableHTML(fakeOut(), 'dms');
    assert.ok(!dms.includes('data-fmt=') && !dms.includes('glyph-toggle')
      && !dms.includes('size-toggle'), 'no settings controls in the results head');
    assert.match(dms, /id="share"/, 'share action remains');
    const dec = buildTableHTML(fakeOut(), 'dec');
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

describe('vector glyphs in HTML (glyphs mode)', () => {
  it('swapGlyphChars replaces sign and body chars (with U+FE0E) by inline SVGs', () => {
    const out = swapGlyphChars('<td>☉︎</td><td>23° ♓︎ 14′</td><td>Jupiter</td>');
    assert.ok(out.includes('<svg class="glyph-inline"'), 'svg present');
    assert.ok(out.includes('<title>☉</title>'), 'char kept as title (Sun)');
    assert.ok(out.includes('<title>♓</title>'), 'char kept as title (Pisces)');
    assert.ok(out.includes('fill="#58a6ff"'), 'Sun planet color');
    assert.ok(out.includes('fill="#a371f7"'), 'Pisces water color');
    assert.ok(!/[☉-☋♀-♇♈-♓]/.test(out.replace(/<title>[^<]*<\/title>/g, '')), 'no raw glyph chars outside titles');
    assert.ok(out.includes('<td>Jupiter</td>'), 'plain names untouched');
    assert.equal(swapGlyphChars('Sun in Pisces'), 'Sun in Pisces', 'names mode is a no-op');
  });
  it('buildTableHTML in glyphs mode renders vector glyphs everywhere', () => {
    const html = buildTableHTML(fakeOut(), 'dms', { decan: 'chaldean', isDay: true }, { glyphs: true });
    assert.ok((html.match(/glyph-inline/g) || []).length >= 30, 'many inline glyphs');
    const bare = html.replace(/<title>[^<]*<\/title>/g, '');
    assert.ok(!/[☉-☋♀-♇♈-♓]/.test(bare), 'no font glyph chars remain');
    const named = buildTableHTML(fakeOut(), 'dms', { decan: 'chaldean', isDay: true }, { glyphs: false });
    assert.ok(!named.includes('glyph-inline'), 'names mode has no inline glyphs');
    assert.ok(named.includes('>Sun<'), 'names mode keeps names');
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

describe('pointTooltip', () => {
  const dig = { decan: 'chaldean', isDay: true };
  const byLabel = tip => Object.fromEntries(tip.fields.map(f => [f.label, f.value]));
  it('mirrors the Sun table row (stations dashed: Sun has none)', () => {
    const out = fakeOut();
    const rows = tableRows(out, 'dms', dig);
    const tip = pointTooltip('sun', out, 'dms', dig, { prev: 'P', next: 'N' });
    assert.equal(tip.name, 'Sun');
    const f = byLabel(tip);
    assert.equal(f['Longitude'], rows[0].lon);
    assert.equal(f['Declination'], rows[0].dec);
    assert.equal(f['Speed'], rows[0].spd);
    assert.equal(f['Magnitude'], rows[0].mag);
    assert.equal(f['House'], rows[0].house);
    assert.equal(f['Prev station'], '—');
    assert.equal(f['Next station'], '—');
    assert.equal(f['Domicile'], rows[0].dign.domicile);
    assert.equal(f['Triplicity'], rows[0].dign.tripFull);
  });
  it('passes station text through for Mercury..Pluto, dashes when not supplied', () => {
    const out = fakeOut();
    const withStn = byLabel(pointTooltip('mercury', out, 'dms', dig, { prev: 'D Leo 1°', next: 'R Ari 2°' }));
    assert.equal(withStn['Prev station'], 'D Leo 1°');
    assert.equal(withStn['Next station'], 'R Ari 2°');
    const noStn = byLabel(pointTooltip('mercury', out, 'dms', dig));
    assert.equal(noStn['Prev station'], '—');
  });
  it('true node: dashes for dec/speed/magnitude/house and all lords', () => {
    const f = byLabel(pointTooltip('true-node', fakeOut(), 'dms', dig));
    assert.equal(f['Declination'], '—');
    assert.equal(f['Speed'], '—');
    assert.equal(f['Magnitude'], '—');
    assert.equal(f['House'], '—');
    assert.equal(f['Domicile'], '—');
    assert.ok(!('Speed percentile' in f));
  });
  it('angle tooltip: longitude and lords, blanks elsewhere', () => {
    const out = fakeOut();
    const tip = pointTooltip('ascendant', out, 'dms', dig);
    assert.equal(tip.name, 'Ascendant');
    const f = byLabel(tip);
    assert.equal(f['Longitude'], angleRows(out, dig)[0].lon);
    assert.equal(f['Speed'], '—');
    assert.equal(f['House'], '—');
    assert.equal(f['Domicile'], angleRows(out, dig)[0].dign.domicile);
  });
  it('south node longitude is the true node longitude + 180', () => {
    const f = byLabel(pointTooltip('south-node', fakeOut(), 'dms', dig));
    assert.equal(f['Longitude'], fmtLon(20, 'dms')); // fakeOut node at 200
    assert.equal(f['Domicile'], '—');
  });
  it('every tooltip key resolves; unknown keys return null', () => {
    const out = fakeOut();
    for (const k of TOOLTIP_POINT_KEYS) assert.ok(pointTooltip(k, out, 'dms', dig), k);
    assert.equal(pointTooltip('ceres', out, 'dms', dig), null);
  });
});
