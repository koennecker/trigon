// animation.js — time-lapse animation of the ephemeris over a date range.
//
// Two range modes: absolute (start/end datetimes) or relative (N
// minutes/hours/days/months/years ahead of the current instant). Each tick
// advances the instant by speed x elapsed real time and re-runs the normal
// calculation path (the same quiet live-tick path the clock uses), so the
// table, chart and sky views all track the animation.
//
// Orchestration only, like clock.js: no pure logic here worth a node unit
// test. Covered by browser E2E (animation advances the instant and repaints).

// Simulated seconds per real second.
export const ANIM_SPEEDS = [
  { label: '1 min /s',   v: 60 },
  { label: '10 min /s',  v: 600 },
  { label: '1 hour /s',  v: 3600 },
  { label: '6 hours /s', v: 21600 },
  { label: '1 day /s',   v: 86400 },
  { label: '1 week /s',  v: 604800 },
  { label: '1 month /s', v: 2592000 },
];

// Fixed durations for the relative range; months/years are calendar-exact
// (Jan 31 + 1 month overflows to Mar 2/3, standard Date behaviour).
export const REL_UNIT_MS = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000,
};
function addRelative(sMs, n, unit) {
  if (unit === 'month' || unit === 'year') {
    const d = new Date(sMs);
    if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + n);
    else d.setUTCFullYear(d.getUTCFullYear() + n);
    return d.getTime();
  }
  return sMs + n * (REL_UNIT_MS[unit] || REL_UNIT_MS.day);
}

// Recompute at most this often: the WASM chart compute is cheap but the DOM
// patch + sky refresh per frame is not free. The instant still advances
// every rAF so playback timing stays exact.
const MIN_FRAME_MS = 120;

export function createAnimation(env) {
  const { el, readInstantMs, setPickerToInstantMs, run, hasLocation,
          stopClock, setSkipEnabled, onError } = env;

  let raf = 0, playing = false, paused = false;
  let startMs = 0, endMs = 0, curMs = 0;
  let lastTick = 0, lastRun = 0;
  let speed = ANIM_SPEEDS[2].v; // 1 hour/s

  const mode = () => el('anim-mode').value;
  const isActive = () => playing || paused;

  function setStatus(msg) {
    const s = el('anim-status');
    if (s) s.textContent = msg;
  }

  function setTransport() {
    el('anim-play').textContent = playing ? 'Pause' : (paused ? 'Resume' : 'Play');
    el('anim-stop').disabled = !isActive();
    for (const id of ['anim-mode', 'anim-start', 'anim-end', 'anim-n', 'anim-unit'])
      el(id).disabled = isActive();
  }

  function fmtRange() {
    const d0 = new Date(startMs), d1 = new Date(endMs);
    const f = d => d.toISOString().slice(0, 16).replace('T', ' ');
    return `${f(d0)} UTC → ${f(d1)} UTC`;
  }

  function beginPlayback() {
    playing = true; paused = false;
    stopClock();
    setSkipEnabled(false);
    onError('');
    lastTick = performance.now(); lastRun = 0;
    setTransport();
    setStatus('Animating ' + fmtRange());
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function finish(atEnd) {
    if (atEnd) curMs = endMs;
    playing = false; paused = false;
    cancelAnimationFrame(raf);
    setSkipEnabled(true);
    setTransport();
    setStatus(atEnd ? 'Finished ' + fmtRange() : '');
    if (atEnd) {
      // Paint the exact end instant (the loop may have overshot it).
      try {
        const ms = curMs;
        setPickerToInstantMs(ms);
        run(true, { quiet: true, utcMs: ms, live: true });
      } catch (e) { onError(e.message); }
    }
  }

  function tick(now) {
    if (!playing) return;
    const dtMs = Math.min(1000, Math.max(0, now - lastTick)); // clamp tab-switch gaps
    lastTick = now;
    curMs += speed * dtMs; // speed is sim-seconds per real-second; dtMs/1000*1000 cancel
    if (curMs >= endMs) { finish(true); return; }
    if (now - lastRun >= MIN_FRAME_MS) {
      lastRun = now;
      try {
        setPickerToInstantMs(curMs);
        run(true, { quiet: true, utcMs: curMs, live: true }); // run-token guard drops overruns
      } catch (e) { onError(e.message); finish(false); return; }
    }
    raf = requestAnimationFrame(tick);
  }

  function parseAbsolute() {
    const s = el('anim-start').value, e = el('anim-end').value;
    if (!s || !e) throw new Error('Set both animation start and end.');
    const sMs = Date.parse(s + ':00Z'), eMs = Date.parse(e + ':00Z');
    if (!Number.isFinite(sMs) || !Number.isFinite(eMs)) throw new Error('Invalid animation range.');
    if (eMs <= sMs) throw new Error('Animation end must be after start.');
    return [sMs, eMs];
  }

  function play() {
    if (playing) { // toggle to pause
      playing = false; paused = true;
      cancelAnimationFrame(raf);
      setTransport();
      setStatus('Paused at ' + new Date(curMs).toISOString().slice(0, 19).replace('T', ' ') + ' UTC');
      return;
    }
    if (paused) { beginPlayback(); return; }
    try {
      if (!hasLocation()) throw new Error('Set a location first (city search, geolocation, or manual coordinates).');
      let sMs, eMs;
      if (mode() === 'absolute') {
        [sMs, eMs] = parseAbsolute();
      } else {
        const n = Math.max(1, Math.floor(parseFloat(el('anim-n').value) || 1));
        el('anim-n').value = n;
        const unit = el('anim-unit').value;
        sMs = readInstantMs(); // throws on an invalid picker
        if (new Date(sMs).getUTCFullYear() < 1) throw new Error('Animation needs a CE date.');
        eMs = addRelative(sMs, n, unit);
      }
      startMs = sMs; endMs = eMs; curMs = sMs;
      beginPlayback();
    } catch (e) { onError(e.message); }
  }

  function stop() {
    if (!isActive()) return;
    finish(false);
  }

  // Programmatic start: fill the absolute-range UI and play. Used by the
  // retrograde-period animate button. With autoSpeed the speed select is set
  // to the option nearest to a ~60 s playback of the range.
  function playRange({ startMs: sMs, endMs: eMs, autoSpeed = false }) {
    if (!(eMs > sMs)) { onError('Invalid animation range.'); return; }
    el('anim-mode').value = 'absolute';
    el('anim-start').value = new Date(sMs).toISOString().slice(0, 16);
    el('anim-end').value = new Date(eMs).toISOString().slice(0, 16);
    syncModeUI();
    if (autoSpeed) {
      const target = (eMs - sMs) / 1000 / 60; // sim-sec per real-sec for 60 s playback
      let best = ANIM_SPEEDS[0];
      for (const sp of ANIM_SPEEDS)
        if (Math.abs(Math.log(sp.v / target)) < Math.abs(Math.log(best.v / target))) best = sp;
      el('anim-speed').value = String(best.v);
      speed = best.v;
    }
    if (paused) { paused = false; }
    if (playing) { playing = false; cancelAnimationFrame(raf); }
    try {
      if (!hasLocation()) throw new Error('Set a location first (city search, geolocation, or manual coordinates).');
      startMs = sMs; endMs = eMs; curMs = sMs;
      beginPlayback();
    } catch (e) { onError(e.message); }
  }

  function syncModeUI() {
    const abs = el('anim-mode').value === 'absolute';
    el('anim-absolute').style.display = abs ? '' : 'none';
    el('anim-relative').style.display = abs ? 'none' : '';
  }

  function init() {
    const spd = el('anim-speed');
    for (const { label, v } of ANIM_SPEEDS) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = label;
      if (v === speed) o.selected = true;
      spd.appendChild(o);
    }
    spd.addEventListener('change', () => { speed = parseFloat(spd.value) || speed; });
    el('anim-mode').addEventListener('change', syncModeUI);
    el('anim-play').addEventListener('click', play);
    el('anim-stop').addEventListener('click', stop);
    setTransport();
  }

  return { init, play, stop, playRange, isActive, isPlaying: () => playing,
           setSpeed: v => { speed = v; }, getSpeed: () => speed };
}
