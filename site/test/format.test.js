// Tests for format.js — pure display formatting.
// Run: node --test test/format.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGNS, norm360, signOf, fmtLon, fmtDec, fmtSpeed, motionOf, fmtMag, dash,
  fmtUTC, fmtOffset, fmtCoord, zoneOffsetMinutes, fmtSignPos,
  FMT_KEY, readAngleFmt, writeAngleFmt, rowsToCSV, csvDownloadButton,
} from '../format.js';
import { jdFromCal } from '../search.js';

describe('norm360', () => {
  it('wraps negatives and >360', () => {
    assert.equal(norm360(-30), 330);
    assert.equal(norm360(360), 0);
    assert.equal(norm360(720.5), 0.5);
    assert.equal(norm360(0), 0);
  });
});

describe('signOf', () => {
  it('names the twelve signs at boundaries', () => {
    assert.equal(signOf(0), 'Aries');
    assert.equal(signOf(29.999), 'Aries');
    assert.equal(signOf(30), 'Taurus');
    assert.equal(signOf(359.9), 'Pisces');
    assert.equal(signOf(-0.5), 'Pisces'); // wraps
  });
});

describe('fmtLon', () => {
  it('formats DMS by default', () => {
    assert.equal(fmtLon(0), 'Aries 0°00′00″');
    assert.equal(fmtLon(12.5822), 'Aries 12°34′55″');
    assert.equal(fmtLon(352.74195), 'Pisces 22°44′31″'); // Ides of March Sun
  });
  it('formats decimal with fmt=dec', () => {
    assert.equal(fmtLon(12.5822, 'dec'), '12.5822°');
    assert.equal(fmtLon(359.99996, 'dec'), '360.0000°'); // toFixed rounds up; pre-existing quirk
  });
  it('normalizes before formatting', () => {
    assert.equal(fmtLon(360), fmtLon(0));
    assert.equal(fmtLon(-30), fmtLon(330));
  });
  it('compact keeps the leading pair', () => {
    assert.equal(fmtLon(352.74195, 'compact'), 'Pisces 22°44′'); // degrees lead
    assert.equal(fmtLon(150.0117, 'compact'), 'Virgo 0°00′'); // 0°00′42″: zero degrees shown
    assert.equal(fmtLon(150.0861, 'compact'), 'Virgo 0°05′'); // never "Virgo 5′09″" (reads as 5°)
    assert.equal(fmtLon(180.1502, 'compact'), 'Libra 0°09′'); // the Fortune case
    assert.equal(fmtDec(-0.0861, 'compact'), '-0°05′');
    assert.equal(fmtDec(12.5822, 'compact'), '+12°34′');
  });
});

describe('fmtSignPos', () => {
  it('formats sign + degree/minutes in DMS', () => {
    assert.equal(fmtSignPos(0), 'Aries 0°00′');
    assert.equal(fmtSignPos(19.2041), 'Aries 19°12′');
    assert.equal(fmtSignPos(352.74195), 'Pisces 22°44′');
  });
  it('formats sign + decimal degrees with fmt=dec', () => {
    assert.equal(fmtSignPos(19.2041, 'dec'), 'Aries 19.2041°');
  });
  it('normalizes before formatting', () => {
    assert.equal(fmtSignPos(360), fmtSignPos(0));
    assert.equal(fmtSignPos(-30), fmtSignPos(330));
  });
});

describe('fmtDec', () => {
  it('signs and formats DMS', () => {
    assert.equal(fmtDec(23.4375), '+23°26′15″');
    assert.equal(fmtDec(-5.25), '-5°15′00″');
    assert.equal(fmtDec(0), '+0°00′00″');
  });
  it('decimal mode', () => {
    assert.equal(fmtDec(-5.25, 'dec'), '-5.2500°');
  });
});

describe('fmtSpeed/motionOf/fmtMag', () => {
  it('speed carries a sign', () => {
    assert.equal(fmtSpeed(1.0027), '+1.0027°/d');
    assert.equal(fmtSpeed(-0.5), '-0.5000°/d');
    assert.equal(fmtSpeed(0), '+0.0000°/d');
  });
  it('motion names', () => {
    assert.equal(motionOf(0.1), 'Direct');
    assert.equal(motionOf(-0.1), 'Retrograde');
    assert.equal(motionOf(0), 'Stationary');
  });
  it('magnitude', () => {
    assert.equal(fmtMag(-1.234), '-1.23');
    assert.equal(dash, '—');
  });
});

describe('fmtUTC (integration with dateapi)', () => {
  it('round-trips a known CE instant', () => {
    const jd = jdFromCal(2026, 9, 29, 12.5);
    assert.equal(fmtUTC(jd), '2026-09-29 12:30');
  });
  it('handles a BCE instant', () => {
    const jd = jdFromCal(-43, 3, 15, 19.4716); // Ides of March, astronomical year
    assert.equal(fmtUTC(jd), '15 Mar 44 BCE 19:28');
  });
});

describe('fmtOffset', () => {
  it('formats minute offsets', () => {
    assert.equal(fmtOffset(-300), 'UTC-05:00');
    assert.equal(fmtOffset(345), 'UTC+05:45'); // Kathmandu
    assert.equal(fmtOffset(0), 'UTC+00:00');
  });
});

describe('fmtCoord', () => {
  it('formats hemisphere labels', () => {
    assert.equal(fmtCoord(40.7128, -74.006), '40.7128° N, 74.0060° W');
    assert.equal(fmtCoord(-33.8688, 151.2093), '33.8688° S, 151.2093° E');
  });
});

describe('zoneOffsetMinutes (integration with Intl)', () => {
  it('distinguishes EST from EDT', () => {
    assert.equal(zoneOffsetMinutes('America/New_York', 2026, 1, 15, 12, 0), -300);
    assert.equal(zoneOffsetMinutes('America/New_York', 2026, 7, 15, 12, 0), -240);
  });
  it('handles half-hour zones', () => {
    assert.equal(zoneOffsetMinutes('Australia/Adelaide', 2026, 1, 15, 12, 0), 630); // +10:30 DST
    assert.equal(zoneOffsetMinutes('Asia/Kathmandu', 2026, 1, 15, 12, 0), 345);
  });
  it('is independent of the host timezone', () => {
    // Pure wall-clock arithmetic: same instant, different zone name.
    assert.equal(zoneOffsetMinutes('Europe/London', 2026, 1, 15, 12, 0), 0);
    assert.equal(zoneOffsetMinutes('Europe/London', 2026, 7, 15, 12, 0), 60);
  });
});

describe('angle format persistence', () => {
  const memStore = () => {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
    };
  };
  it('defaults to dms', () => {
    assert.equal(readAngleFmt(memStore()), 'dms');
  });
  it('round-trips dec', () => {
    const s = memStore();
    writeAngleFmt(s, 'dec');
    assert.equal(s.getItem(FMT_KEY), 'dec');
    assert.equal(readAngleFmt(s), 'dec');
  });
  it('survives throwing storage', () => {
    const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.equal(readAngleFmt(bad), 'dms');
    assert.doesNotThrow(() => writeAngleFmt(bad, 'dec'));
  });
});

describe('SIGNS', () => {
  it('has twelve entries in order', () => {
    assert.equal(SIGNS.length, 12);
    assert.equal(SIGNS[0], 'Aries');
    assert.equal(SIGNS[11], 'Pisces');
  });
});

describe('rowsToCSV', () => {
  it('joins rows with CRLF and ends with a trailing CRLF', () => {
    assert.equal(rowsToCSV([['a', 'b'], ['1', '2']]), 'a,b\r\n1,2\r\n');
  });
  it('quotes cells with commas, quotes, or newlines (quotes doubled)', () => {
    assert.equal(rowsToCSV([['x,y', 'say "hi"', 'a\nb']]),
      '"x,y","say ""hi""","a\nb"\r\n');
  });
  it('stringifies numbers and empties null/undefined', () => {
    assert.equal(rowsToCSV([[1, null, undefined, 2.5]]), '1,,,2.5\r\n');
  });
  it('renders a CSV download button with the filename and icon', () => {
    const html = csvDownloadButton('trigon-aspects.csv');
    assert.match(html, /data-csv-name="trigon-aspects\.csv"/);
    assert.match(html, /<svg/);
    assert.match(html, /Download this table as CSV/);
  });
});
