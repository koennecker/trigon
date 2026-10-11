// location.js — city search, geolocation, manual coordinates, and timezone
// derivation.
//
// Pure pieces (saveLocation/loadSavedLocation with an injected storage,
// deriveZoneFor with an injected tzlookup) unit-test in node. The DOM
// wiring lives in createLocationUI(env), which owns the tzAuto /
// derivedZone / lastTzSig / tzBceNote state.
import { loadCities, searchCities, nearestCity } from './cities.js';
import { fmtCoord, fmtOffset, zoneOffsetMinutes } from './format.js';
import { fmtLmtOffset } from './dateapi.js';

export const LOC_KEY = 'swisseph-location-v1';

export function saveLocation(storage, lat, lon, label, city) {
  try {
    storage.setItem(LOC_KEY, JSON.stringify({ lat, lon, label, city: city || null }));
  } catch (e) { /* storage unavailable (e.g. sandboxed iframe) */ }
}

export function loadSavedLocation(storage) {
  try {
    const raw = storage.getItem(LOC_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) return null;
    return o;
  } catch (e) { return null; }
}

// Pure core of timezone derivation: IANA zone + UTC offset for coordinates
// and a wall-clock {y, mo, d, hh, mi}. Returns null when derivation is
// impossible (no lookup, bad coords, lookup throws).
export function deriveZoneFor(lat, lon, dt, tzlookupFn) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (typeof tzlookupFn !== 'function') return null;
  try {
    const zone = tzlookupFn(lat, lon);
    const off = zoneOffsetMinutes(zone, dt.y, dt.mo, dt.d, dt.hh, dt.mi);
    return { zone, off };
  } catch (e) { return null; }
}

// env: { el(id), log(msg), storage, readDateFields(p, seconds),
//        tzlookup } — tzlookup defaults to the vendored global.
// Returns { initLocation, deriveTimezone, updateTzForEra, setLocation,
//           getDerivedZone, setTzAuto }.
export function createLocationUI(env) {
  const { el, log, storage, readDateFields } = env;
  const tzlookupFn = env.tzlookup
    || (() => (typeof globalThis.tzlookup === 'function' ? globalThis.tzlookup : null));

  // True while the timezone select follows the location automatically;
  // cleared the moment the user picks a timezone by hand.
  let tzAuto = true;
  let derivedZone = ''; // IANA zone from the last successful derivation
  let lastTzSig = '';   // suppresses repeat derivation (and log spam) on every keystroke
  let lastZoneSig = ''; // zone|offset actually applied; logged only when this changes
  let tzBceNote = false;
  let citiesPromise = null;

  function ensureCities() {
    if (!citiesPromise) {
      const input = el('city');
      if (input) input.placeholder = 'loading city data …';
      citiesPromise = loadCities('data/cities.json', log).then(n => {
        if (input) input.placeholder = 'e.g. Rome';
        log(`city data ready (${n} cities)`);
      }).catch(e => {
        citiesPromise = null; // failed: allow a later retry
        if (input) input.placeholder = 'city search unavailable';
        log('city data failed to load: ' + e.message);
        throw e;
      });
    }
    return citiesPromise;
  }

  // BCE dates use local mean time at the site longitude — time zones are
  // meaningless this far back, so the fixed-offset select is disabled and
  // an LMT note takes the place of the derived zone name.
  function updateTzForEra() {
    const bce = el('dt-era').value === 'bce';
    el('tz').disabled = bce;
    if (bce) {
      const lon = parseFloat(el('lon').value);
      el('tz-name').textContent = 'BCE: local mean time at site longitude'
        + (Number.isFinite(lon) ? ` (${fmtLmtOffset(lon)})` : '');
      tzBceNote = true;
    } else if (tzBceNote) {
      el('tz-name').textContent = '';
      tzBceNote = false;
    }
  }

  function deriveTimezone() {
    updateTzForEra();
    if (el('dt-era').value === 'bce') return; // LMT mode: no zones this far back
    if (!tzAuto) return;
    const lat = parseFloat(el('lat').value), lon = parseFloat(el('lon').value);
    let dt;
    try { dt = readDateFields('dt', true); } catch (e) { return; }
    const r = deriveZoneFor(lat, lon, dt, tzlookupFn());
    if (!r) return;
    const sel = el('tz');
    if (!sel.querySelector(`option[value="${r.off}"]`)) return;
    const sig = `${lat},${lon}|${dt.y}-${dt.mo}-${dt.d} ${dt.hh}:${dt.mi}|${r.zone}|${r.off}`;
    if (sig === lastTzSig) return;
    lastTzSig = sig;
    sel.value = String(r.off);
    el('tz-name').textContent = r.zone;
    derivedZone = r.zone;
    // During animation the datetime changes every frame; log only when the
    // zone or offset itself actually changes (e.g. a DST boundary).
    const zoneSig = `${r.zone}|${r.off}`;
    if (zoneSig !== lastZoneSig) {
      lastZoneSig = zoneSig;
      log(`timezone ${r.zone} (${fmtOffset(r.off)})`);
    }
  }

  function setLocation(lat, lon, label, city) {
    el('lat').value = lat.toFixed(6);
    el('lon').value = lon.toFixed(6);
    el('loc-label').textContent = label;
    saveLocation(storage, lat, lon, label, city);
    tzAuto = true; // a new location re-arms automatic timezone derivation
    lastTzSig = '';
    lastZoneSig = '';
    deriveTimezone();
  }

  function closeCityResults() {
    const box = el('city-results');
    box.classList.remove('open');
    box.innerHTML = '';
    box._items = null;
  }

  function renderCityResults(items) {
    const box = el('city-results');
    box.innerHTML = '';
    box._items = null;
    if (!items.length) { box.classList.remove('open'); return; }
    items.forEach(c => {
      const d = document.createElement('div');
      d.className = 'item';
      const pop = c.pop >= 1e6 ? (c.pop / 1e6).toFixed(1) + 'M'
                : c.pop >= 1e3 ? Math.round(c.pop / 1e3) + 'k' : String(c.pop);
      const nm = document.createElement('span');
      nm.textContent = `${c.name}, ${c.country}`;
      const pp = document.createElement('span');
      pp.className = 'pop';
      pp.textContent = pop;
      d.appendChild(nm); d.appendChild(pp);
      d.addEventListener('mousedown', e => { e.preventDefault(); selectCity(c); });
      box.appendChild(d);
    });
    box.classList.add('open');
    box._items = items;
  }

  function selectCity(c) {
    setLocation(c.lat, c.lng, `${c.name}, ${c.country} — ${fmtCoord(c.lat, c.lng)}`, c.name);
    el('city').value = c.name;
    closeCityResults();
  }

  function initLocation() {
    // If geolocation is blocked by a permissions policy (e.g. the artifact runs
    // in the platform's sandboxed share iframe with no geolocation grant),
    // disable the button up front with an explanation instead of a doomed click.
    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions.query({ name: 'geolocation' }).then(st => {
        if (st.state === 'denied') {
          const btn = el('geolocate');
          btn.disabled = true;
          btn.title = 'Browser location is blocked here (permission denied or disabled by the embedding page). Use city search or manual coordinates.';
        }
      }).catch(() => {});
    }
    const input = el('city');

    let timer = null;
    input.addEventListener('focus', () => { ensureCities().catch(() => {}); });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        ensureCities().then(
          () => renderCityResults(searchCities(input.value)),
          () => closeCityResults());
      }, 150);
    });
    input.addEventListener('keydown', e => {
      const items = el('city-results')._items;
      if (e.key === 'Escape') closeCityResults();
      else if (e.key === 'Enter' && items && items.length) { e.preventDefault(); selectCity(items[0]); }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#city-results') && e.target !== input) closeCityResults();
    });

    el('geolocate').addEventListener('click', () => {
      el('warn').textContent = '';
      if (!('geolocation' in navigator)) {
        el('warn').textContent = 'Geolocation is not available in this browser.';
        return;
      }
      const btn = el('geolocate');
      btn.disabled = true;
      btn.textContent = 'Locating …';
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const { latitude, longitude, accuracy } = pos.coords;
          // Reverse lookup: name the nearest gazetteer city in local state,
          // but keep the device's precise coordinates for the calculation.
          let prefix = '', cityName = null;
          try {
            await ensureCities();
            const c = nearestCity(latitude, longitude);
            if (c) {
              cityName = c.name;
              input.value = c.name;
              prefix = `Nearest city: ${c.name}, ${c.country} — `;
            }
          } catch (e) { /* gazetteer unavailable: fall back to raw coordinates */ }
          setLocation(latitude, longitude,
            `${prefix}${fmtCoord(latitude, longitude)} (±${Math.round(accuracy)} m)`, cityName);
          btn.disabled = false;
          btn.textContent = 'Use my location';
        },
        err => {
          btn.disabled = false;
          btn.textContent = 'Use my location';
          el('warn').textContent = err.code === 1 ? 'Location permission denied.'
            : err.code === 2 ? 'Location unavailable.' : 'Location request timed out.';
        },
        { timeout: 10000, maximumAge: 60000 }
      );
    });

    const manualTouched = () => {
      const lat = parseFloat(el('lat').value), lon = parseFloat(el('lon').value);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        el('loc-label').textContent = `Manual coordinates — ${fmtCoord(lat, lon)}`;
    };
    const manualCommitted = () => {
      const lat = parseFloat(el('lat').value), lon = parseFloat(el('lon').value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const label = `Manual coordinates — ${fmtCoord(lat, lon)}`;
      el('loc-label').textContent = label;
      saveLocation(storage, lat, lon, label, null);
      el('city').value = '';
      tzAuto = true;
      lastTzSig = '';
      lastZoneSig = '';
      deriveTimezone();
    };
    el('lat').addEventListener('input', manualTouched);
    el('lon').addEventListener('input', manualTouched);
    el('lat').addEventListener('change', manualCommitted);
    el('lon').addEventListener('change', manualCommitted);
  }

  return {
    initLocation, deriveTimezone, updateTzForEra, setLocation,
    getDerivedZone: () => derivedZone,
    setTzAuto: v => { tzAuto = v; },
    ensureCities,
  };
}
