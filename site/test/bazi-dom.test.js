// BaZi view integration tests — jsdom, not string matching.
//
// The pure unit tests in bazi.test.js assert the computed pillars;
// these tests render buildBaziHTML into a real DOM (the way app.js
// drops it into #panel-table) and assert on the resulting structure:
// the section id, the four pillar rows in order, the stem/branch
// cells, the hidden-stem cells, and the Day Master note. A markup
// regression that keeps the right strings but breaks the table
// (missing section, wrong row order, dropped column) fails here
// while passing the pure tests.
//
// This is the view test, not an app.js test: app.js needs WASM and
// the full DOM shell, so its BaZi wiring is covered by the Playwright
// E2E smoke (e2e/bazi_e2e.py) instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { computeBazi, buildBaziHTML, trigSunLongitude } from '../bazi.js';
import { jdFromCal } from '../search.js';

// View tests have no chart output, so the Sun longitude is mocked
// with the trig function: wall datetime plus offset -> UTC instant
// -> mock Sun longitude there. Live code passes the chart's out[0]
// instead; the view builder itself is identical either way.
function render(input) {
  const offsetMin = input.offsetMin ?? 0;
  const sunLon = trigSunLongitude(jdFromCal(
    input.y, input.mo, input.d, input.hh + (input.mi ?? 0) / 60 - offsetMin / 60));
  const dom = new JSDOM('<!DOCTYPE html><body><div id="panel-table"></div></body>');
  dom.window.document.getElementById('panel-table').innerHTML =
    buildBaziHTML(computeBazi(input, sunLon));
  return dom.window.document;
}

function rows(doc) {
  return [...doc.querySelectorAll('#bazi-section tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent));
}

test('renders the published Hong Kong chart as a four-row table', () => {
  const doc = render({ y: 1990, mo: 6, d: 15, hh: 10, offsetMin: 480 });
  const section = doc.getElementById('bazi-section');
  assert.ok(section, 'section exists');
  assert.match(section.querySelector('h3').textContent, /Four Pillars/);
  const r = rows(doc);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map(x => x[0]), ['Year', 'Month', 'Day', 'Hour']);
  assert.match(r[0][1], /庚 Geng/);
  assert.match(r[0][1], /Metal Yang/);
  assert.match(r[0][2], /午 Wu/);
  assert.match(r[0][2], /Fire Horse/);
  assert.match(r[2][1], /辛 Xin/);
  assert.match(r[3][2], /巳 Si/);
  assert.match(r[3][2], /Fire Snake/);
});

test('Day Master note names the day stem', () => {
  const doc = render({ y: 1990, mo: 6, d: 15, hh: 10, offsetMin: 480 });
  assert.match(doc.querySelector('#bazi-section').textContent, /Day Master: 辛 Xin \(Metal Yin\)/);
  assert.match(doc.querySelector('#bazi-section').textContent, /Month term: Mangzhong/);
});

test('hidden-stem cells list main, middle, residual stems', () => {
  const doc = render({ y: 1990, mo: 6, d: 15, hh: 10, offsetMin: 480 });
  const r = rows(doc);
  // Year branch Wu hides Ding, Ji; day branch Hai hides Ren, Jia.
  assert.match(r[0][3], /丁 Ding/);
  assert.match(r[0][3], /己 Ji/);
  assert.match(r[2][3], /壬 Ren/);
  assert.match(r[2][3], /甲 Jia/);
});

test('a re-render with a different instant replaces, not appends, rows', () => {
  const panel = new JSDOM('<!DOCTYPE html><body><div id="panel-table"></div></body>')
    .window.document.getElementById('panel-table');
  const mock = (y, mo, d, hh) => trigSunLongitude(jdFromCal(y, mo, d, hh - 8));
  panel.innerHTML = buildBaziHTML(computeBazi({ y: 1990, mo: 6, d: 15, hh: 10 }, mock(1990, 6, 15, 10)));
  panel.innerHTML = buildBaziHTML(computeBazi({ y: 1988, mo: 4, d: 12, hh: 10 }, mock(1988, 4, 12, 10)));
  const r = [...panel.querySelectorAll('#bazi-section tbody tr')].map(tr => tr.children[0].textContent);
  assert.deepEqual(r, ['Year', 'Month', 'Day', 'Hour']);
  // Stem and branch cells are separate, so the pillars are checked
  // as stem and branch, not as a combined character pair. The year
  // row of the new chart is Wu Chen; the old chart's Geng year stem
  // is gone from that row (Geng still appears, legitimately, in the
  // hour branch's hidden stems).
  const yearRow = [...panel.querySelectorAll('#bazi-section tbody tr')][0].children;
  assert.match(yearRow[1].textContent, /戊 Wu/);
  assert.match(yearRow[2].textContent, /辰 Chen/);
  assert.doesNotMatch(yearRow[1].textContent, /庚 Geng/);
});

test('23:00 boundary shows in the rendered day row', () => {
  const doc = render({ y: 1990, mo: 6, d: 15, hh: 23, offsetMin: 480 });
  const r = rows(doc);
  assert.match(r[2][1], /壬 Ren/);
  assert.match(r[2][2], /子 Zi/);
  assert.match(r[3][1], /庚 Geng/);
});
