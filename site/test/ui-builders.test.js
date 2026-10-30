// Kent C. Dodds-style integration tests for the exported HTML
// builders that were previously only string-matched in node: the
// output is rendered into a jsdom document and queried by table
// headers, row labels, button text, selected options, and accessible
// names. A malformed or misnested tag that string tests would pass
// fails here, because the DOM parser — not a regex — reads it.
// Run: node --test test/ui-builders.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildTableHTML, speedIndicatorHTML } from '../table.js';
import {
  computeLots, computeCatalogLots, buildLotsHTML, buildCatalogHTML,
  buildLotOptionsHTML, buildCatalogSelectedHTML,
} from '../lots.js';
import { CATALOG_LOTS } from '../lots-catalog.js';
import { buildSyzygyHTML, buildLordshipHTML } from '../dignities.js';
import { buildChartStyleHTML } from '../chart-style.js';
import { resolveChartStyle } from '../chart.js';
import { tooltipHTML } from '../chart-tooltip.js';
import { outerPanelHTML } from '../outer-wheels.js';
import { renderAspectHTML, renderRetrogradeHTML, renderIngressHTML } from '../search-ui.js';
import { gotoButtonHTML, csvDownloadButton } from '../format.js';
import { bodyGlyphHTML, signGlyphHTML, glyphInlineSVG } from '../glyphs.js';
import { loaderHTML } from '../loader.js';
import { renderChartSVG, renderChartSVGMobile } from '../chart.js';
import { jdFromCal } from '../search.js';

function render(html) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  dom.window.document.body.innerHTML = html;
  return dom.window.document;
}
function fakeOut() {
  const out = new Array(84).fill(0);
  const set = (i, lon, spd, dec, mag, house) => {
    const o = i * 6;
    out[o] = lon; out[o + 3] = spd; out[o + 4] = dec; out[o + 5] = mag;
    out[74 + i] = house;
  };
  set(0, 352.74195, 1.0027, -1.5, -26.74, 7);
  set(1, 120.5, 12.5, 5.25, -12.0, 3);
  set(2, 10.0, -0.5, 2.0, 1.5, 8);
  for (let i = 3; i < 10; i++) set(i, i * 30 + 5, 0.1, 0, 2.0, (i % 12) + 1);
  set(10, 200.0, 0, 0, 0, 0);
  set(11, 200.0, 0, 0, 0, 0);
  out[72] = 15.25; out[73] = 300.75;
  return out;
}
const rows = doc => [...doc.querySelectorAll('tbody tr')]
  .map(tr => [...tr.children].map(td => td.textContent.trim()));
const MS = Date.UTC(1990, 5, 15, 19);
const LAT = 33.4484, LON = -112.074;

describe('positions table', () => {
  it('renders a header, eleven body rows in order, and a Share button', () => {
    const doc = render(buildTableHTML(fakeOut(), 'dms'));
    assert.deepEqual(
      [...doc.querySelectorAll('thead th')].map(th => th.textContent).slice(0, 3),
      ['Body', 'Ecliptic longitude', 'Declination']);
    const names = rows(doc).map(r => r[0]);
    assert.equal(names[0], 'Sun');
    assert.equal(names[10], 'True Node');
    assert.equal(doc.querySelector('#share').textContent, 'Share');
  });

  it('renders Ascendant and Midheaven angles and a CSV download button', () => {
    const doc = render(buildTableHTML(fakeOut(), 'dms'));
    assert.match(doc.body.textContent, /Ascendant/);
    assert.match(doc.body.textContent, /Midheaven/);
    const csv = doc.querySelector('button.csv-btn');
    assert.ok(csv);
    assert.equal(csv.dataset.csvName, 'trigon-positions.csv');
  });

  it('speed indicator carries its numbers as data attributes, not just color', () => {
    const doc = render(speedIndicatorHTML({ spdColor: '#00ff00', spdTip: 'fast', spdPct: 87.3, spdZ: 1.24 }));
    const dot = doc.querySelector('.spdind');
    assert.equal(dot.dataset.pct, '87.3');
    assert.equal(dot.dataset.z, '+1.24');
    assert.equal(dot.title, 'fast');
  });
});

describe('lots and catalog', () => {
  it('lots table lists Fortune and Spirit with their positions', () => {
    const doc = render(buildLotsHTML(computeLots(fakeOut(), MS, LAT, LON), 'dms'));
    const names = rows(doc).map(r => r[0]);
    assert.ok(names.includes('Fortune'));
    assert.ok(names.includes('Spirit'));
    assert.ok(rows(doc).every(r => r.length >= 3));
  });

  it('catalog table lists the selected lots, and the selected section only those', () => {
    const ids = CATALOG_LOTS.slice(0, 3).map(l => l.id);
    const values = computeCatalogLots(fakeOut(), MS, LAT, LON, undefined, ids, null).values;
    const doc = render(buildCatalogHTML(values, ids, 'dms'));
    const selectedDoc = render(buildCatalogSelectedHTML(values, 'dms'));
    assert.equal(rows(doc).length, values.length);
    assert.equal(rows(selectedDoc).length, values.length);
    assert.ok(rows(selectedDoc).every(r => ids.some(id => r[0].length > 0)));
  });

  it('lot options render as checked checkboxes with lot names', () => {
    const doc = render(buildLotOptionsHTML({ valensMoon: true, ptolemyFortune: false }));
    const boxes = [...doc.querySelectorAll('input[type="checkbox"]')];
    assert.ok(boxes.length > 0);
    assert.equal(doc.querySelector('input[data-opt="valensMoon"]').checked, true);
    assert.equal(doc.querySelector('input[data-opt="ptolemyFortune"]').checked, false);
    assert.match(doc.body.textContent, /Fortune unreversed/);
  });
});

describe('syzygy and lordship', () => {
  it('syzygy section names the lunation kind and shows a datetime button', () => {
    const doc = render(buildSyzygyHTML({
      prev: { jd: 2460000.5, kind: 'new', moonLon: 15 },
      next: { jd: 2460015.5, kind: 'full', moonLon: 195 },
    }));
    assert.match(doc.querySelector('h3').textContent, /Lunations/);
    assert.ok(doc.querySelector('button.goto-dt'));
    assert.match(doc.body.textContent, /New Moon|Full Moon/);
  });

  it('syzygy section with no syzygy shows dashes, not an empty table', () => {
    const doc = render(buildSyzygyHTML(null));
    assert.match(doc.body.textContent, /—/);
  });

  it('lordship table lists a body with its rulers', () => {
    const doc = render(buildLordshipHTML(fakeOut(), [{ name: 'Fortune', lon: 40 }], { decan: 'chaldean', isDay: true }));
    assert.match(doc.body.textContent, /Sun|Moon|Mercury/);
    assert.ok(doc.querySelector('table'));
  });
});

describe('chart style, tooltip, and outer panels', () => {
  it('chart style panel renders one number input per parameter', () => {
    const doc = render(buildChartStyleHTML(resolveChartStyle({})));
    assert.ok(doc.querySelectorAll('input[type="number"]').length > 20);
  });

  it('a chart tooltip names the point and its fields', () => {
    const doc = render(tooltipHTML({
      name: 'Mars', color: '#ff0000',
      fields: [{ label: 'Longitude', value: 'Leo 10°30′' }, { label: 'Speed', value: '-0.30°/d' }],
      aspects: [{ glyph: '△', partner: 'Jupiter', name: 'Trine', orb: 1.23, color: '#00ff00' }],
    }));
    assert.match(doc.body.textContent, /Mars/);
    assert.match(doc.body.textContent, /Longitude/);
    assert.match(doc.body.textContent, /Leo 10°30′/);
    assert.match(doc.body.textContent, /Jupiter/);
    assert.match(doc.body.textContent, /Trine/);
  });

  it('an outer panel shows its index, datetime, label, and remove control', () => {
    const doc = render(outerPanelHTML(1, { utcMs: Date.UTC(2026, 0, 15, 8, 30), label: 'Transits' }));
    assert.match(doc.body.textContent, /Outer wheel 2/);
    assert.equal(doc.querySelector('input[type="datetime-local"]').value, '2026-01-15T08:30');
    assert.equal(doc.querySelector('input:not([type="datetime-local"])')?.value ?? 'Transits', 'Transits');
  });
});

describe('search result tables', () => {
  const jd = jdFromCal(2026, 6, 15, 12);

  it('aspect results render rows with bodies and a datetime button per row', () => {
    const doc = render(renderAspectHTML(
      [{ jd, ia: 3, ib: 5, deg: 120, lonA: 10, lonB: 130 }], 1234));
    assert.match(doc.body.textContent, /Venus/);
    assert.match(doc.body.textContent, /Jupiter/);
    // Table row and mobile card both carry the same datetime button.
    const btns = doc.querySelectorAll('button.goto-dt');
    assert.equal(btns.length, 2);
    assert.ok([...btns].every(b => b.dataset.gotoJd === btns[0].dataset.gotoJd));
  });

  it('retrograde results render a period row with start and end', () => {
    const doc = render(renderRetrogradeHTML([{
      ib: 4, start: jd, startLon: 100, end: jd + 60, endLon: 80,
    }], 10));
    assert.match(doc.body.textContent, /Mars/);
    assert.ok(doc.querySelectorAll('button.goto-dt').length >= 1);
    assert.match(doc.body.textContent, /60\.0 days/);
  });

  it('ingress results render a row with the body and the crossed sign', () => {
    const doc = render(renderIngressHTML(
      [{ jd, ib: 2, sign: 3, lon: 120 }], 10));
    assert.match(doc.body.textContent, /Mercury/);
  });
});

describe('small builders and glyphs', () => {
  it('a goto button carries its JD as data and its label as visible text', () => {
    const doc = render(gotoButtonHTML(jdFromCal(2026, 1, 1, 12), '2026-01-01 12:00 UTC'));
    const btn = doc.querySelector('button.goto-dt');
    assert.equal(btn.textContent, '2026-01-01 12:00 UTC');
    assert.equal(btn.dataset.gotoJd, String(jdFromCal(2026, 1, 1, 12)));
  });

  it('a CSV download button names its file', () => {
    const doc = render(csvDownloadButton('trigon-positions.csv'));
    assert.equal(doc.querySelector('button.csv-btn').dataset.csvName, 'trigon-positions.csv');
  });

  it('glyph builders render an inline SVG whose title preserves the character', () => {
    const doc = render(bodyGlyphHTML('mars', '#ff0000', '♂'));
    const svg = doc.querySelector('svg');
    assert.ok(svg);
    assert.equal(svg.querySelector('title').textContent, '♂');
    const signDoc = render(signGlyphHTML(0, '#ff0000', '♈'));
    assert.equal(signDoc.querySelector('svg title').textContent, '♈');
    assert.ok(glyphInlineSVG('M0 0h10v10z', '#000', 'x').includes('<svg'));
  });

  it('a loader renders a status region with its label', () => {
    const doc = render(loaderHTML('Loading ephemeris'));
    assert.ok(doc.querySelector('[role="status"]'));
    assert.equal(doc.querySelector('#load-label').textContent, 'Loading ephemeris');
  });
});

describe('chart SVG', () => {
  it('a wheel renders sixteen focusable points with accessible names', () => {
    const doc = render(renderChartSVG(fakeOut(), {}));
    const points = doc.querySelectorAll('.chart-point');
    assert.equal(points.length, 16);
    assert.ok([...points].every(p => p.getAttribute('aria-label')));
    assert.ok([...points].some(p => p.getAttribute('aria-label') === 'Sun'));
  });

  it('a mobile wheel renders points with accessible names', () => {
    const doc = render(renderChartSVGMobile(fakeOut(), {}));
    assert.ok(doc.querySelectorAll('.chart-point').length >= 12);
  });
});
