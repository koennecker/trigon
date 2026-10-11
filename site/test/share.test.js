// Tests for share.js — share-link state packing round-trips.
// Run: node --test test/share.test.js  (from site/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shareState, parseShareHashString, shareLink } from '../share.js';
import { jdFromCal, JD_UNIX_EPOCH } from '../search.js';
import { BCE_MIN_ASTRO } from '../dateapi.js';

const BCE_MIN_MS = (jdFromCal(BCE_MIN_ASTRO, 1, 1, 0) - JD_UNIX_EPOCH) * 86400000;
const parse = h => parseShareHashString(h, BCE_MIN_MS);

describe('compact pack round-trip', () => {
  it('round-trips a modern instant', () => {
    const lat = 40.7128, lon = -74.006, utcMs = 1787616000000;
    const back = parse(shareState(lat, lon, utcMs));
    assert.ok(back);
    assert.ok(Math.abs(back.lat - lat) < 1e-4);
    assert.ok(Math.abs(back.lon - lon) < 1e-4);
    assert.equal(back.utcMs, Math.round(utcMs / 1000) * 1000);
  });
  it('produces the 14-char form', () => {
    assert.match(shareState(0, 0, 0), /^#[A-Za-z0-9\-_]{14}$/);
  });
  it('round-trips extremes', () => {
    for (const [lat, lon] of [[90, 180], [-90, -180], [0, 0]]) {
      const back = parse(shareState(lat, lon, 0));
      assert.ok(back, `${lat},${lon}`);
      assert.ok(Math.abs(back.lat - lat) < 1e-4);
      assert.ok(Math.abs(back.lon - lon) < 1e-4);
    }
  });
  it('round-trips the 0001-01-01 epoch boundary', () => {
    const ms = -62167219200000;
    const back = parse(shareState(51.5, -0.12, ms));
    assert.ok(back);
    assert.equal(back.utcMs, ms);
  });
  it('rejects malformed hashes', () => {
    assert.equal(parse(''), null);
    assert.equal(parse('#short'), null);
    assert.equal(parse('#!!!!!!!!!!!!!!'), null);
    assert.equal(parse(null), null);
  });
});

describe('legacy readable form', () => {
  it('parses old links', () => {
    const back = parse('#40.7128,-74.0060,1787616000');
    assert.ok(back);
    assert.equal(back.lat, 40.7128);
    assert.equal(back.lon, -74.006);
    assert.equal(back.utcMs, 1787616000000);
  });
  it('rejects out-of-range coordinates and instants', () => {
    assert.equal(parse('#91,0,0'), null);
    assert.equal(parse('#0,181,0'), null);
    assert.equal(parse('#0,0,99999999999999'), null); // past 9999 CE
  });
  it('accepts the BCE floor exactly', () => {
    const sec = Math.round(BCE_MIN_MS / 1000);
    const back = parse(`#40,-74,${sec}`);
    assert.ok(back);
    assert.equal(back.utcMs, sec * 1000);
    assert.equal(parse(`#40,-74,${sec - 1}`), null);
  });
});

describe('shareLink', () => {
  it('uses the compact pack for CE instants', () => {
    assert.match(shareLink(40.7, -74, 1787616000000), /^#[A-Za-z0-9\-_]{14}$/);
  });
  it('uses the readable form for BCE instants, and it parses back', () => {
    const ms = (jdFromCal(-43, 3, 15, 19.4716) - JD_UNIX_EPOCH) * 86400000;
    const link = shareLink(40.7, -112.074, ms);
    assert.match(link, /^#-?\d+\.\d+,-?\d+\.\d+,-?\d+$/);
    const back = parse(link);
    assert.ok(back);
    assert.ok(Math.abs(back.utcMs - ms) < 1000);
    assert.ok(Math.abs(back.lat - 40.7) < 1e-4);
  });
  it('CE/BCE boundary: 0001-01-01T00:00:00Z packs, one second before does not', () => {
    assert.match(shareLink(0, 0, -62167219200000), /^#[A-Za-z0-9\-_]{14}$/);
    assert.match(shareLink(0, 0, -62167219200001), /^#-?\d/);
  });
});
