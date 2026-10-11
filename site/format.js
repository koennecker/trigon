// format.js — pure display formatting for angles, coordinates, and instants.
//
// No DOM, no storage, no network: every function takes explicit arguments,
// so this module imports cleanly in node for unit tests. The only impure
// helpers are readAngleFmt/writeAngleFmt, which take an explicit storage
// object ({getItem, setItem}) instead of touching localStorage directly.
import { fmtInstant } from './dateapi.js';

export const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
                      'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];

// Glyph sets (U+FE0E text presentation appended by consumers when needed).
export const SIGN_GLYPHS = ['♈︎', '♉︎', '♊︎', '♋︎', '♌︎', '♍︎',
                            '♎︎', '♏︎', '♐︎', '♑︎', '♒︎', '♓︎'];
export const BODY_GLYPHS = {
  Sun: '☉︎', Moon: '☽︎', Mercury: '☿︎', Venus: '♀︎', Mars: '♂︎',
  Jupiter: '♃︎', Saturn: '♄︎', Uranus: '♅︎', Neptune: '♆︎', Pluto: '♇︎',
  'True Node': '☊︎',
};

// Table color palette (same hues as the chart wheel): planets by body
// index (Sun..Pluto, True Node neutral), signs by element.
export const PLANET_COLORS = ['#58a6ff', '#ffd75e', '#9fe870', '#ff9d5c', '#ff6b6b',
  '#7ee787', '#d2a8ff', '#f778ba', '#79c0ff', '#ffa657', '#e6edf3'];
export const ELEMENT_COLORS = ['#ff7b72', '#e3b341', '#79c0ff', '#a371f7'];
/** @param {number} signIdx 0..11 @returns {string} */
export const signColor = signIdx => ELEMENT_COLORS[signIdx % 4];

export function norm360(deg) { return ((deg % 360) + 360) % 360; }

// Zodiac sign name for a longitude. Used in aspect results.
export function signOf(lon) { return SIGNS[Math.floor(norm360(lon) / 30)]; }

// Sign + degree/minutes within the sign, e.g. "Aries 19°12′".
// Used in aspect-search results for each planet's position at the root.
// fmt: 'dms' | 'dec'; glyphs swaps the sign name for its glyph.
export function fmtSignPos(lon, fmt = 'dms', glyphs = false) {
  const l = norm360(lon);
  const s = Math.floor(l / 30);
  const rem = l - s * 30;
  const sign = glyphs ? SIGN_GLYPHS[s] : SIGNS[s];
  if (fmt === 'dec') return `${sign} ${rem.toFixed(4)}°`;
  const d = Math.floor(rem);
  const m = Math.floor((rem - d) * 60);
  return `${sign} ${d}°${String(m).padStart(2, '0')}′`;
}

// fmt: 'dms' (12°34′56″), 'compact' (12°35′ when degrees lead, else
// minutes+seconds: 0°05′10″ -> 5′10″ — for slow movers whose degrees are
// leading zeroes), 'dec' (12.5822°). glyphs swaps the sign name for its
// glyph. Display only: the underlying state is always the precise decimal.
export function fmtLon(deg, fmt = 'dms', glyphs = false) {
  deg = norm360(deg);
  if (fmt === 'dec') return `${deg.toFixed(4)}°`;
  const s = Math.floor(deg / 30);
  const rem = deg - s * 30;
  const sign = glyphs ? SIGN_GLYPHS[s] : SIGNS[s];
  const d = Math.floor(rem);
  const m = Math.floor((rem - d) * 60);
  const sec = Math.floor((((rem - d) * 60) - m) * 60);
  // Compact never drops the degree unit: "Virgo 0°05′" cannot be misread
  // as 5° the way "Virgo 5′09″" can. Seconds are dropped, as in the d>0 case.
  if (fmt === 'compact' && d === 0) return `${sign} 0°${String(m).padStart(2, '0')}′`;
  if (fmt === 'compact') return `${sign} ${d}°${String(m).padStart(2, '0')}′`;
  return `${sign} ${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″`;
}

export function fmtDec(deg, fmt = 'dms') {
  if (fmt === 'dec') {
    const sign = deg < 0 ? '-' : '+';
    return `${sign}${Math.abs(deg).toFixed(4)}°`;
  }
  const sign = deg < 0 ? '-' : '+';
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const sec = Math.floor((((a - d) * 60) - m) * 60);
  // Same zero-degree rule as fmtLon: "+0°09′", never "+9′00″".
  if (fmt === 'compact' && d === 0) return `${sign}0°${String(m).padStart(2, '0')}′`;
  if (fmt === 'compact') return `${sign}${d}°${String(m).padStart(2, '0')}′`;
  return `${sign}${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″`;
}

export function fmtSpeed(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(4)}°/d`; }

// Merged speed+direction: "1°23′22″/d D", "1.3894°/d R". The sign is
// carried by the D/R letter (semantically identical to +/-). Compact
// drops to minutes+seconds when the degree part is a leading zero.
export function fmtSpeedDR(v, fmt = 'dms') {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const sec = Math.floor((((a - d) * 60) - m) * 60);
  let mag;
  if (fmt === 'dec') mag = `${a.toFixed(4)}°`;
  else if (fmt === 'compact' && d === 0) mag = `${m}′${String(sec).padStart(2, '0')}″`;
  else if (fmt === 'compact') mag = `${d}°${String(m).padStart(2, '0')}′`;
  else mag = `${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″`;
  return `${mag}/d ${v < 0 ? 'R' : 'D'}`;
}
export function motionOf(v) { return v > 0 ? 'Direct' : v < 0 ? 'Retrograde' : 'Stationary'; }
export function fmtMag(m) { return m.toFixed(2); }
export const dash = '—';

export function fmtUTC(jd) {
  return fmtInstant(jd);
}

export function fmtOffset(min) {
  const sign = min < 0 ? '-' : '+';
  const hh = String(Math.floor(Math.abs(min) / 60)).padStart(2, '0');
  const mm = String(Math.abs(min) % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

export function fmtCoord(lat, lon) {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, `
       + `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

// UTC offset in minutes for an IANA zone at a given wall-clock time.
// Pure apart from Intl (available in node), so unit-testable.
export function zoneOffsetMinutes(iana, y, mo, d, hh, mi) {
  const dt = new Date(0);
  dt.setUTCHours(hh, mi, 0, 0);
  dt.setUTCFullYear(y, mo - 1, d);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: iana, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(dt).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute);
  return Math.round((asUTC - dt.getTime()) / 60000);
}

// Angle display format persistence. Pass localStorage in the browser,
// a Map-backed stub in tests.
export const FMT_KEY = 'astroweb-angle-fmt';
export function readAngleFmt(storage) {
  try { return storage.getItem(FMT_KEY) === 'dec' ? 'dec' : 'dms'; } catch (e) { return 'dms'; }
}
export function writeAngleFmt(storage, fmt) {
  try { storage.setItem(FMT_KEY, fmt); } catch (e) { /* storage unavailable */ }
}

// Display preferences for the results tables: glyphs instead of names,
// and arcseconds on/off. Display only — state stays precise decimals.
export const GLYPHS_KEY = 'trigon.glyphs.v1';
export function readGlyphsPref(storage) {
  try { return storage.getItem(GLYPHS_KEY) === '1'; } catch (e) { return false; }
}
export function writeGlyphsPref(storage, on) {
  try { storage.setItem(GLYPHS_KEY, on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
}
export const SECONDS_KEY = 'trigon.seconds.v1';
// Angle size: 'full' (degrees/minutes/seconds) or 'compact' (the leading
// pair only). Supersedes the old seconds toggle; an old '0' migrates to
// compact.
export const ANGLE_MODE_KEY = 'trigon.angle-mode.v1';
export function readAngleMode(storage) {
  try {
    const v = storage.getItem(ANGLE_MODE_KEY);
    if (v === 'compact' || v === 'full') return v;
    return storage.getItem(SECONDS_KEY) === '0' ? 'compact' : 'full';
  } catch (e) { return 'full'; }
}
export function writeAngleMode(storage, mode) {
  try { storage.setItem(ANGLE_MODE_KEY, mode); } catch (e) { /* storage unavailable */ }
}

// RFC 4180 CSV from a 2-D array of cell values (first row is the header).
// Cells containing commas, quotes, or newlines are quoted, quotes doubled.
export function rowsToCSV(rows) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// Spreadsheet-grid icon (inline SVG) for CSV download buttons.
export const CSV_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">'
  + '<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke="#3fb950" stroke-width="1.4"/>'
  + '<path d="M1.5 5.8h13M5.8 5.8v8.7M10.2 5.8v8.7" fill="none" stroke="#3fb950" stroke-width="1.1"/></svg>';

// Download button rendered above each output table. The click handler
// (app.js) serializes the table inside the enclosing .csv-block.
export function csvDownloadButton(filename) {
  return `<div class="csv-wrap"><button type="button" class="csv-btn" data-csv-name="${filename}"`
    + ` title="Download this table as CSV" aria-label="Download this table as CSV">${CSV_ICON}<span>CSV</span></button></div>`;
}

// Clickable datetime button: sets the main chart to this instant (JD).
// One shared helper so every datetime in every table follows the same
// policy (search results, stations, lunations...). The dotted underline
// (CSS .goto-dt) exposes the affordance at rest.
export function gotoButtonHTML(jd, label) {
  return `<button type="button" class="goto-dt" data-goto-jd="${jd}"`
    + ` title="Set the main chart to this date/time"`
    + ` aria-label="Set the main chart to ${label}">${label}</button>`;
}
