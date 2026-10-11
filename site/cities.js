// cities.js — GeoNames composite gazetteer search.
//
// Data: data/cities.json, rows of
//   [name, asciiname, country, population, lat, lng, [alternate exonyms...]]
// sorted by population descending (build: ../data/build_cities.py).
// Search spec verified in Python first (see ../data/README.md), ported here.
//
// Ranking: A = name/asciiname prefix; B = exact alternate-name match;
// C = alternate-name prefix. B outranks A only when the top B city has
// more than 10x the population of the top A city; otherwise A, then B,
// then C. Population descending within each group (inherited from file order).

const DATA_CACHE = 'swisseph-data-v1';

let CITIES = null;

export function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function indexCities(rows) {
  CITIES = rows.map(r => ({
    name: r[0],
    asciiname: r[1],
    country: r[2],
    pop: r[3],
    lat: r[4],
    lng: r[5],
    nn: normalize(r[0]),
    nan: normalize(r[1]),
    nalts: r[6].map(normalize),
  }));
  return CITIES.length;
}

export async function loadCities(url, onStatus) {
  if (CITIES) return CITIES.length;
  const cache = await caches.open(DATA_CACHE);
  let rows;
  const hit = await cache.match(url);
  if (hit) {
    onStatus && onStatus('city data: cache hit');
    rows = await hit.json();
  } else {
    onStatus && onStatus('city data: downloading ...');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching city data`);
    const buf = await resp.arrayBuffer();
    try {
      await cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/json' } }));
      onStatus && onStatus(`city data: cached (${(buf.byteLength / 1048576).toFixed(1)} MB)`);
    } catch (e) {
      onStatus && onStatus(`city data: downloaded (cache write failed: ${e.message})`);
    }
    rows = JSON.parse(new TextDecoder().decode(buf));
  }
  return indexCities(rows);
}

export function searchCities(query, limit = 8) {
  const qn = normalize(query.trim());
  if (!qn || qn.length < 2 || !CITIES) return [];
  const A = [], B = [], C = [];
  for (const c of CITIES) {
    if (c.nn.startsWith(qn) || c.nan.startsWith(qn)) { A.push(c); continue; }
    let exact = false, prefix = false;
    for (const a of c.nalts) {
      if (a === qn) { exact = true; break; }
      if (!prefix && a.startsWith(qn)) prefix = true;
    }
    if (exact) B.push(c);
    else if (prefix) C.push(c);
  }
  const ordered = (B.length && A.length && B[0].pop > 10 * A[0].pop)
    ? B.concat(A, C)
    : A.concat(B, C);
  return ordered.slice(0, limit);
}

export function citiesLoaded() { return CITIES !== null; }

// Nearest gazetteer city to a coordinate pair (equirectangular distance,
// fine for nearest-neighbor). Used for the reverse lookup after a
// geolocation fix: the city name goes into local state, while the precise
// coordinates remain the source of truth for calculations.
export function nearestCity(lat, lon) {
  if (!CITIES) return null;
  const cosLat = Math.cos(lat * Math.PI / 180);
  let best = null, bestD2 = Infinity;
  for (const c of CITIES) {
    const dx = (c.lng - lon) * cosLat, dy = c.lat - lat;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}
