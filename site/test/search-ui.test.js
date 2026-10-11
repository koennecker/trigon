// Tests for search-ui.js pure pieces.
// Run: node --test test/search-ui.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEARCH_SHOW_MAX, aspectSigns, isEclipseResult, readRangeValues,
  renderAspectHTML, renderRetrogradeHTML, renderIngressHTML,
} from '../search-ui.js';
import { stationRoots, ingressRoots, retroPeriods, jdFromCal, SEARCH_BODIES } from '../search.js';

describe('aspectSigns', () => {
  it('names the shared sign once for conjunctions, with degree and minutes', () => {
    assert.equal(aspectSigns({ lonA: 10, lonB: 20 }), 'Aries 10°00′');
  });
  it('shows both signs with positions otherwise, in body order', () => {
    assert.equal(aspectSigns({ lonA: 10, lonB: 40 }), 'Aries 10°00′ / Taurus 10°00′');
    assert.equal(aspectSigns({ lonA: 40, lonB: 10 }), 'Taurus 10°00′ / Aries 10°00′');
  });
  it('honors the decimal angle format', () => {
    assert.equal(aspectSigns({ lonA: 10.5, lonB: 20 }, 'dec'), 'Aries 10.5000°');
    assert.equal(aspectSigns({ lonA: 10.5, lonB: 40.25 }, 'dec'), 'Aries 10.5000° / Taurus 10.2500°');
  });
});

describe('isEclipseResult', () => {
  it('passes only syzygies classified as eclipses', () => {
    assert.ok(isEclipseResult({ eclipse: { eclipse: true, type: 4, jdMax: 1 } }));
    assert.ok(!isEclipseResult({ eclipse: { eclipse: false, type: 0, jdMax: 0 } }));
    assert.ok(!isEclipseResult({})); // no verdict (non-syzygy) never passes
  });
});

describe('readRangeValues', () => {
  const f = (y, mo, d, hh = 0, mi = 0) => ({ y, mo, d, hh, mi });
  it('parses a forward range', () => {
    const { jd0, jd1 } = readRangeValues(f(2026, 1, 1), f(2026, 1, 2));
    assert.ok(jd1 - jd0 > 0.99 && jd1 - jd0 < 1.01);
  });
  it('rejects non-forward ranges', () => {
    assert.throws(() => readRangeValues(f(2026, 1, 2), f(2026, 1, 1)), /end must be after start/);
    assert.throws(() => readRangeValues(f(2026, 1, 1), f(2026, 1, 1)), /end must be after start/);
  });
  it('handles BCE field structs', () => {
    const { jd0, jd1 } = readRangeValues(f(-43, 3, 1), f(-43, 3, 15));
    assert.ok(jd1 > jd0);
  });
});

describe('renderAspectHTML', () => {
  const jd = jdFromCal(2026, 6, 15, 12);
  const results = [
    { jd, ia: 3, ib: 5, deg: 120, lonA: 10, lonB: 130 },   // Venus trine Jupiter
    { jd: jd + 1, ia: 0, ib: 1, deg: 0, lonA: 200.5, lonB: 200.7 }, // Sun conjunct Moon
  ];
  it('renders rows with signs and the evaluation count', () => {
    const html = renderAspectHTML(results, 1234);
    assert.match(html, /2 perfectings found \(1234 ephemeris evaluations\)/);
    assert.match(html, /Venus.*Jupiter/);
    assert.match(html, /\(Aries 10°00′ \/ Leo 10°00′\)/);   // 10° Aries, 130° Leo
    assert.match(html, /\(Libra 20°30′\)/);          // shared sign once
    assert.match(html, /<div class="asp-card">/);
    assert.equal((html.match(/<tr>/g) || []).length, 3); // header + 2
  });
  it('handles the empty case', () => {
    const html = renderAspectHTML([], 42);
    assert.match(html, /0 perfectings found \(42 ephemeris evaluations\)/);
    assert.doesNotMatch(html, /<table>/);
  });
  it('caps rendered rows at SEARCH_SHOW_MAX', () => {
    const many = Array.from({ length: SEARCH_SHOW_MAX + 5 }, (_, i) => ({ ...results[0], jd: jd + i }));
    const html = renderAspectHTML(many, 1);
    assert.match(html, new RegExp(`showing first ${SEARCH_SHOW_MAX}`));
  });
  it('renders the eclipse verdict for Sun-Moon syzygies', () => {
    const rows = [
      { jd, ia: 0, ib: 1, deg: 0, lonA: 200.5, lonB: 200.7,
        eclipse: { eclipse: true, type: 4, jdMax: jd } },
      { jd: jd + 1, ia: 0, ib: 1, deg: 180, lonA: 20.5, lonB: 200.5,
        eclipse: { eclipse: false, type: 0, jdMax: 0 } },
    ];
    const html = renderAspectHTML(rows, 10);
    assert.match(html, /New Moon · <span class="ecl">Total solar eclipse<\/span>/);
    assert.match(html, /Full Moon · <span class="dim">no eclipse<\/span>/);
    // mobile cards carry the same verdicts
    assert.equal((html.match(/Total solar eclipse/g) || []).length, 2);
    assert.equal((html.match(/no eclipse/g) || []).length, 2);
  });
  it('names Sun-Moon syzygies even without eclipse data', () => {
    const html = renderAspectHTML(
      [{ jd, ia: 0, ib: 1, deg: 0, lonA: 200.5, lonB: 200.7 }], 10);
    assert.match(html, /New Moon<\/td>/);
  });
  it('uses the eclipse noun when filtering to eclipses', () => {
    const rows = [
      { jd, ia: 0, ib: 1, deg: 0, lonA: 200.5, lonB: 200.7,
        eclipse: { eclipse: true, type: 4, jdMax: jd } },
      { jd: jd + 1, ia: 0, ib: 1, deg: 180, lonA: 20.5, lonB: 200.5,
        eclipse: { eclipse: true, type: 8, jdMax: jd + 1 } },
    ];
    assert.match(renderAspectHTML(rows, 10, 'dms', 'eclipse'), /2 eclipses found/);
  });

  it('renders filter-evidence columns when condText is present', () => {
    const rows = [{ jd: jdFromCal(2026, 1, 29, 12), ia: 0, ib: 4, deg: 90, lonA: 0, lonB: 90,
      condText: ['Mars in Aries — fire sign', 'Venus combust — 3.0° west of the Sun'] }];
    const html = renderAspectHTML(rows, 10, 'dms', 'perfecting', 5, 2);
    assert.match(html, /<th>Filter 1<\/th>/);
    assert.match(html, /Mars in Aries — fire sign/);
    assert.match(html, /1 of 5 perfectings matched the conditions/);
    const bare = renderAspectHTML(rows, 10);
    assert.ok(!bare.includes('Filter 1'));
    assert.match(renderAspectHTML(rows.slice(0, 1), 10, 'dms', 'eclipse'), /1 eclipse found/);
    assert.match(renderAspectHTML([], 10, 'dms', 'eclipse'), /0 eclipses found/);
  });
  it('makes every date cell a goto button carrying the result JD', () => {
    const html = renderAspectHTML(results, 10);
    // One button per result row (table) plus one per mobile card.
    const btns = [...html.matchAll(/<button[^>]*data-goto-jd="([\d.]+)"[^>]*>/g)];
    assert.equal(btns.length, results.length * 2);
    const jds = btns.map(b => parseFloat(b[1]));
    for (const r of results) {
      assert.equal(jds.filter(x => x === r.jd).length, 2, `jd ${r.jd}`);
    }
  });
  it('reports matched-vs-total when conditions filtered the perfectings', () => {
    const html = renderAspectHTML(results.slice(0, 1), 10, 'dms', 'perfecting', 5);
    assert.match(html, /1 of 5 perfectings matched the conditions \(10 ephemeris evaluations\)/);
    // No fifth argument (or total == shown): the plain wording is kept.
    assert.match(renderAspectHTML(results, 10), /2 perfectings found/);
  });
});

describe('renderRetrogradeHTML (integration with search.js root finding)', () => {
  // Synthetic planet with a sinusoidal longitude speed: stations where the
  // cosine crosses zero. Exercises stationRoots -> retroPeriods ->
  // renderStationHTML end to end without the WASM engine.
  const ib = 4; // Mars slot
  const jd0 = jdFromCal(2026, 1, 1, 0);
  const spdAt = jd => Math.cos((jd - jd0) * 0.08);
  const eph = jd => {
    const lon = new Array(11).fill(0), spd = new Array(11).fill(0);
    lon[ib] = 100 + Math.sin((jd - jd0) * 0.08) * 20;
    spd[ib] = spdAt(jd);
    return { lon, spd };
  };
  const grid = [];
  for (let k = 0; k <= 40; k++) {
    const jd = jd0 + k * 5;
    grid.push({ jd, ...eph(jd) });
  }
  const stations = stationRoots(grid, eph, ib)
    .map(s => ({ ib, ...s, lon: eph(s.jd).lon[ib] }))
    .sort((a, b) => a.jd - b.jd);

  it('finds stations in the synthetic series', () => {
    assert.ok(stations.length >= 4, `found ${stations.length}`);
    assert.ok(stations.some(s => s.type === 'R'));
    assert.ok(stations.some(s => s.type === 'D'));
  });

  const toPeriods = list => retroPeriods(list)
    .filter(pr => pr.start !== null && pr.end !== null)
    .map(pr => ({ ib, ...pr }))
    .sort((a, b) => a.start - b.start);

  it('renders retrograde periods and mobile cards', () => {
    const periods = toPeriods(stations);
    assert.ok(periods.length >= 1);
    const html = renderRetrogradeHTML(periods, 999);
    assert.match(html, new RegExp(`${periods.length} retrograde periods? found \\(999 ephemeris evaluations\\)`));
    assert.match(html, /<div class="sp-card">/);
    assert.match(html, new RegExp(SEARCH_BODIES[ib])); // planet name, not a flag
    assert.ok(html.includes('Stations retrograde'));
    assert.ok(!html.includes('trigon-stations.csv'));
  });

  it('reports filtered period counts', () => {
    const periods = toPeriods(stations);
    const html = renderRetrogradeHTML(periods.slice(0, 1), 5, 'dms', null,
      { total: periods.length, filtered: true });
    assert.match(html, /of \d+ retrograde periods in the selected signs/);
  });

  it('notes dangling stations at range edges', () => {
    // Drop the final D station: Mars is still retrograde at range end.
    const cut = stations.filter(s => !(s.type === 'D' && s.jd === stations[stations.length - 1].jd));
    const html = renderRetrogradeHTML(toPeriods(cut), 1, 'dms', null,
      { dangling: [`${SEARCH_BODIES[ib]} was still retrograde at the end of the range`] });
    assert.match(html, /was still retrograde at the end of the range/);
  });

  it('honours the angle format for station longitudes', () => {
    const periods = toPeriods(stations);
    const dms = renderRetrogradeHTML(periods, 999, 'dms');
    const dec = renderRetrogradeHTML(periods, 999, 'dec');
    assert.match(dms, /°\d\d′\d\d″/); // DMS glyphs
    assert.match(dec, /\d+\.\d{4}°/); // decimal degrees
    assert.ok(!dec.includes('′'));
  });

  it('carries animate-button data attributes on retrograde periods', () => {
    const html = renderRetrogradeHTML(toPeriods(stations), 999);
    // One button per period row (table) plus one per mobile card.
    const btns = [...html.matchAll(/<button[^>]*data-anim-period[^>]*>/g)];
    assert.ok(btns.length >= 2, `found ${btns.length} animate buttons`);
    for (const b of btns) {
      const ib = parseInt(b[0].match(/data-ib="(\d+)"/)[1], 10);
      const s = parseFloat(b[0].match(/data-start="([\d.]+)"/)[1]);
      const e = parseFloat(b[0].match(/data-end="([\d.]+)"/)[1]);
      assert.ok(ib >= 0 && ib < SEARCH_BODIES.length, `ib=${ib}`);
      assert.ok(e > s, `range ${s}..${e}`);
      assert.ok(b[0].includes(`aria-label="Animate the ${SEARCH_BODIES[ib]}`));
    }
  });

  it('renders shadow ingress/egress and the Sun event when enriched', () => {
    const rStn = stations.find(s => s.type === 'R');
    const dStn = stations.find(s => s.type === 'D' && s.jd > rStn.jd);
    const ingress = rStn.jd - 10, egress = dStn.jd + 12;
    const extra = new Map([[`${ib}|${rStn.jd}`, {
      ingress, egress, bIn: 90, bOut: 120, sunJd: (rStn.jd + dStn.jd) / 2,
    }]]);
    const html = renderRetrogradeHTML(toPeriods(stations), 999, 'dms', extra);
    assert.match(html, /<th>Ingress<\/th>/);
    assert.match(html, /<th>Sun event<\/th>/);
    assert.match(html, /<th>Egress<\/th>/);
    assert.match(html, /☍ opposition/); // synthetic body is Mars (ib=4)
    // Days and the animate range follow the extended period.
    assert.ok(html.includes(`${(egress - ingress).toFixed(1)}`), 'extended days');
    assert.ok(html.includes(`data-start="${ingress}"`), 'animates from ingress');
    assert.ok(html.includes(`data-end="${egress}"`), 'animates to egress');
    // Mobile card carries the same moments.
    assert.match(html, /<span class="sp-k dim">ingress<\/span>/);
    assert.match(html, /<span class="sp-k dim">egress<\/span>/);
  });

  it('falls back to the station span without enrichment', () => {
    const rStn = stations.find(s => s.type === 'R');
    const dStn = stations.find(s => s.type === 'D' && s.jd > rStn.jd);
    const html = renderRetrogradeHTML(toPeriods(stations), 999);
    assert.ok(html.includes(`data-start="${rStn.jd}"`));
    assert.ok(html.includes(`${(dStn.jd - rStn.jd).toFixed(1)}`));
    assert.ok(html.includes('<span class="dim">—</span>')); // empty shadow cells
  });

  it('makes period dates goto buttons carrying their JDs', () => {
    const periods = toPeriods(stations);
    const html = renderRetrogradeHTML(periods, 999);
    const jds = [...html.matchAll(/<button[^>]*data-goto-jd="([\d.]+)"[^>]*>/g)]
      .map(b => parseFloat(b[1]));
    // Every period start/end renders in the table and the mobile card (2x).
    for (const p of periods) {
      assert.ok(jds.filter(x => x === p.start).length >= 2, `start jd ${p.start}`);
      assert.ok(jds.filter(x => x === p.end).length >= 2, `end jd ${p.end}`);
    }
    assert.ok(html.includes('aria-label="Set the main chart to'));
  });
});

describe('renderIngressHTML (integration with search.js ingress finding)', () => {
  const ib = 4; // Mars slot
  const jd0 = jdFromCal(2026, 1, 1, 0);
  const eph = jd => {
    const lon = new Array(11).fill(0), spd = new Array(11).fill(0);
    const ph = 2 * Math.PI * (jd - jd0) / 100;
    lon[ib] = ((200 + 25 * Math.sin(ph)) % 360 + 360) % 360;
    spd[ib] = 25 * (2 * Math.PI / 100) * Math.cos(ph);
    return { lon, spd };
  };
  const grid = [];
  for (let k = 0; k <= 20; k++) {
    const jd = jd0 + k * 15;
    grid.push({ jd, ...eph(jd) });
  }
  const ingresses = ingressRoots(grid, eph, ib);

  it('finds and renders ingresses with signs, direction and mobile cards', () => {
    assert.ok(ingresses.length >= 8, `found ${ingresses.length}`);
    const html = renderIngressHTML(ingresses, 777);
    assert.match(html, new RegExp(`${ingresses.length} ingresses? found \\(777 ephemeris evaluations\\)`));
    assert.match(html, /Mars/);
    assert.match(html, /Libra → Scorpio|Virgo → Libra/);
    assert.match(html, /\(retrograde\)/);
    assert.match(html, /<div class="ing-card">/);
  });

  it('makes every ingress date a goto button carrying the result JD', () => {
    const html = renderIngressHTML(ingresses, 10);
    const jds = [...html.matchAll(/<button[^>]*data-goto-jd="([\d.]+)"[^>]*>/g)]
      .map(b => parseFloat(b[1]));
    assert.equal(jds.length, ingresses.length * 2); // table + mobile card
    for (const r of ingresses)
      assert.equal(jds.filter(x => x === r.jd).length, 2, `jd ${r.jd}`);
  });

  it('puts CSV download buttons on every search table', () => {
    const jdA = jdFromCal(2026, 6, 15, 12);
    assert.match(renderAspectHTML([{ jd: jdA, ia: 3, ib: 5, deg: 120, lonA: 10, lonB: 130 }], 10),
      /data-csv-name="trigon-aspects\.csv"/);
    const stn = renderRetrogradeHTML([
      { ib: 4, start: jdA, end: jdA + 40, startLon: 100, endLon: 95 },
    ], 999);
    assert.match(stn, /data-csv-name="trigon-retrograde-periods\.csv"/);
    assert.match(renderIngressHTML(ingresses, 10), /data-csv-name="trigon-ingresses\.csv"/);
  });

  it('handles the empty case', () => {
    const html = renderIngressHTML([], 42);
    assert.match(html, /0 ingresses found \(42 ephemeris evaluations\)/);
    assert.doesNotMatch(html, /<table>/);
  });
});
