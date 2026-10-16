// share.js — pure share-link state packing.
//
// Two formats:
//   1. Compact base64url pack: 14 chars per (lat, lon, utcMs) triplet,
//      82 bits each: lat(+90)*1e4 (21 bits) | lon(+180)*1e4 (22 bits) |
//      seconds-since-0001-01-01 (39 bits). Multiple triplets append for
//      multi-wheel charts (biwheel, triwheel, ...); the wheel count is
//      len/14. A single triplet is the original share format and parses
//      identically, so old links and stored hashes keep working.
//   2. Legacy readable form "#lat,lon,epochSec" — kept for old links and for
//      BCE instants (the pack's seconds-since-0001 goes negative there and
//      would corrupt the BigInt bit layout). Single triplet only.
//
// Pure: parseShareHashString takes the hash string and the BCE floor as
// arguments instead of reading location.hash or module constants.

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const EPOCH_OFFSET = 62167219200; // -62167219200 = 0001-01-01T00:00:00Z
const MS_0001 = -62167219200000; // ms instant of 0001-01-01T00:00:00Z

function packTriplet(lat, lon, utcMs) {
  const la = BigInt(Math.round((lat + 90) * 1e4));
  const lo = BigInt(Math.round((lon + 180) * 1e4));
  const t = BigInt(Math.round(utcMs / 1000) + EPOCH_OFFSET);
  let v = (la << 61n) | (lo << 39n) | t; // 82 bits
  let s = '';
  for (let i = 0; i < 14; i++) { s = B64U[Number(v & 63n)] + s; v >>= 6n; }
  return s;
}

function unpackTriplet(s) {
  let v = 0n;
  for (const ch of s) {
    const i = B64U.indexOf(ch);
    if (i < 0) return null;
    v = (v << 6n) | BigInt(i);
  }
  const t = Number(v & ((1n << 39n) - 1n)) - EPOCH_OFFSET;
  const lon = Number((v >> 39n) & ((1n << 22n) - 1n)) / 1e4 - 180;
  const lat = Number(v >> 61n) / 1e4 - 90;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, utcMs: t * 1000 };
}

export function shareState(lat, lon, utcMs) {
  return '#' + packTriplet(lat, lon, utcMs);
}

// Multi-wheel: array of {lat, lon, utcMs} -> '#' + 14 chars each.
export function shareStates(states) {
  return '#' + states.map(s => packTriplet(s.lat, s.lon, s.utcMs)).join('');
}

// Returns an array of {lat, lon, utcMs}, one per triplet, or null.
// Single-triplet hashes (the original format) yield a 1-element array.
export function parseShareHashString(hash, bceMinMs) {
  const m = /^#([A-Za-z0-9\-_]+)$/.exec(hash || '');
  if (m && m[1].length % 14 === 0 && m[1].length > 0) {
    const out = [];
    for (let k = 0; k < m[1].length; k += 14) {
      const t = unpackTriplet(m[1].slice(k, k + 14));
      if (!t) return null;
      out.push(t);
    }
    return out;
  }
  // Legacy readable form (single triplet only).
  const l = /^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+)$/.exec(hash || '');
  if (!l) return null;
  const lat = parseFloat(l[1]), lon = parseFloat(l[2]), sec = parseInt(l[3], 10);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(sec)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const ms = sec * 1000;
  if (ms < bceMinMs || ms > 253402300799999) return null; // 12999 BCE..9999 CE
  return [{ lat, lon, utcMs: ms }];
}

// BCE instants predate the 14-char pack's epoch, so they share via the
// legacy readable form, whose range extends to 12999 BCE.
export function shareLink(lat, lon, utcMs) {
  if (utcMs < MS_0001) // before 0001-01-01T00:00:00Z
    return `#${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(utcMs / 1000)}`;
  return shareState(lat, lon, utcMs);
}

// Multi-wheel share link. Falls back to the legacy single form only when
// there is exactly one state and it predates the pack epoch.
export function shareLinks(states) {
  if (states.length === 1) return shareLink(states[0].lat, states[0].lon, states[0].utcMs);
  return shareStates(states);
}
