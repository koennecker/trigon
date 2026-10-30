// Kent C. Dodds-style integration tests for the two app-level
// builders that were previously untestable without a browser:
// buildMetaHTML (meta.js, extracted from app.js) and stationCellHTML
// (table.js, extracted from app.js's fmtStn closure). Each test
// renders the builder output into a jsdom document and asserts on
// what a user would see: the stamp, calendar, coordinates, engine,
// station type and position, and the datetime button's label and
// target — never on the raw HTML string.
// Run: node --test test/ui-meta.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildMetaHTML } from '../meta.js';
import { stationCellHTML } from '../table.js';
import { jdFromCal } from '../search.js';

function render(html) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>');
  dom.window.document.body.innerHTML = html;
  return dom.window.document;
}
const gotoButton = doc => doc.querySelector('button.goto-dt');

describe('buildMetaHTML', () => {
  const inp = { gregorian: true, lat: 33.4484, lon: -112.074, bce: false };

  it('shows stamp, calendar, coordinates, and Swiss engine for a modern chart', () => {
    const doc = render(buildMetaHTML({ metaStamp: '2026-01-01 12:00', inp, useSwiss: true }));
    assert.equal(doc.getElementById('meta-stamp').textContent, 'UTC 2026-01-01 12:00');
    assert.match(doc.body.textContent, /Gregorian calendar/);
    assert.match(doc.body.textContent, /33\.4484° N, 112\.0740° W/);
    assert.match(doc.body.textContent, /Swiss Ephemeris \(JPL-based \.se1 files\)/);
    assert.doesNotMatch(doc.body.textContent, /local mean time/);
  });

  it('shows Julian calendar, local mean time, and Moshier engine for a BCE chart', () => {
    const doc = render(buildMetaHTML({
      metaStamp: '0044-03-15 12:00',
      inp: { gregorian: false, lat: 41.89, lon: 12.48, bce: true },
      useSwiss: false,
    }));
    assert.match(doc.body.textContent, /Julian calendar/);
    assert.match(doc.body.textContent, /local mean time/);
    assert.match(doc.body.textContent, /Moshier analytic ephemeris \(approximate\)/);
  });

  it('renders nothing without a chart input', () => {
    const doc = render(buildMetaHTML({ metaStamp: 'x', inp: null, useSwiss: true }));
    assert.equal(doc.body.textContent, '');
  });
});

describe('stationCellHTML', () => {
  const jd = jdFromCal(2026, 6, 15, 12);
  const station = { type: 'R', jd: jd + 10, lon: 130.5 };

  it('shows a dash for a missing station', () => {
    const doc = render(`<table><tr><td>${stationCellHTML(null)}</td></tr></table>`);
    assert.equal(doc.querySelector('td').textContent, '—');
  });

  it('shows station type, position, and a button to the absolute instant', () => {
    const doc = render(`<table><tr><td>${stationCellHTML(station)}</td></tr></table>`);
    assert.match(doc.body.textContent, /^R /);
    assert.match(doc.body.textContent, /Leo 10°30′/);
    const btn = gotoButton(doc);
    assert.ok(btn, 'station cell has a datetime button');
    assert.equal(btn.dataset.gotoJd, String(station.jd));
    assert.equal(btn.textContent, '2026-06-25 12:00');
    assert.equal(btn.getAttribute('aria-label'), 'Set the main chart to 2026-06-25 12:00');
  });

  it('in relative mode the button label is relative but its target stays absolute', () => {
    const doc = render(`<table><tr><td>${stationCellHTML(station, { stationTime: 'relative', refJd: jd })}</td></tr></table>`);
    const btn = gotoButton(doc);
    assert.equal(btn.dataset.gotoJd, String(station.jd));
    assert.match(btn.textContent, /in 10d/);
    assert.doesNotMatch(btn.textContent, /2026/);
    assert.match(btn.title, /2026/);
  });
});
