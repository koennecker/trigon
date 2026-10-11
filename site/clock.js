// clock.js — the astrological clock (live recompute every second).
//
// Pure wall-clock formatting is trivial; this module is orchestration, so
// it lives in createClock(env) with the app-shell dependencies injected.
// Covered by browser E2E (clock ticks must recompute and repaint); there
// is no pure logic here worth a node unit test.
export function createClock(env) {
  const { el, readDateFields, writeDateFields, updateTzForEra, deriveTimezone,
          run, getDerivedZone, setSkipEnabled } = env;

  let clockTimer = null;

  const hasLocation = () =>
    Number.isFinite(parseFloat(el('lat').value))
    && Number.isFinite(parseFloat(el('lon').value));

  function setDateTimeToNow() {
    const now = new Date();
    writeDateFields('dt', {
      y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate(),
      hh: now.getHours(), mi: now.getMinutes(), ss: now.getSeconds(),
    }, true);
    updateTzForEra();
  }

  // Wall-clock time of an instant in an IANA zone. Keeps the picker display
  // coherent with the derived timezone when the browser's own zone differs
  // from the location's.
  function setDateTimeToInstantInZone(ms, iana) {
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: iana, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
      const hh = p.hour === '24' ? '00' : p.hour; // midnight edge in some ICU builds
      // now-instants only: always CE, minute precision (the live clock must
      // not fight the user mid-edit; writeDateFields skips unchanged fields).
      writeDateFields('dt', {
        y: parseInt(p.year, 10), mo: parseInt(p.month, 10), d: parseInt(p.day, 10),
        hh: parseInt(hh, 10), mi: parseInt(p.minute, 10), ss: 0,
      }, true);
    } catch (e) { setDateTimeToNow(); }
  }

  function setDateTimeToZoneNow(iana) {
    setDateTimeToInstantInZone(Date.now(), iana);
  }

  function clockTick() {
    const nowMs = Date.now();
    // The picker shows the wall time (minute precision); the computation uses
    // the exact instant, so the wheel genuinely moves every second.
    const zone = getDerivedZone();
    if (zone) setDateTimeToZoneNow(zone); else setDateTimeToNow();
    deriveTimezone();
    run(true, { quiet: true, utcMs: nowMs, live: true }); // run-token guard drops an overrun tick
  }

  function setClock(on) {
    const box = el('clock-toggle');
    if (on) {
      if (clockTimer || clockWanted) { clockWanted = true; box.checked = true; return; }
      if (!hasLocation()) {
        el('warn').textContent = 'Set a location first (city search, geolocation, or manual coordinates).';
        box.checked = false;
        return;
      }
      el('warn').textContent = '';
      clockWanted = true;
      setSkipEnabled(false);
      // A hidden tab must not burn CPU on 1 Hz recomputes nobody sees;
      // the visibility handler resumes the moment the tab returns.
      if (!document.hidden) {
        clockTick();
        clockTimer = setInterval(clockTick, 1000);
      }
    } else {
      clockWanted = false;
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
      setSkipEnabled(true);
    }
    box.checked = clockWanted;
  }

  let clockWanted = false;
  document.addEventListener('visibilitychange', () => {
    if (!clockWanted) return;
    if (document.hidden) {
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
    } else if (!clockTimer && hasLocation()) {
      clockTick();
      clockTimer = setInterval(clockTick, 1000);
    }
  });

  const isRunning = () => clockTimer !== null;

  return {
    hasLocation, setDateTimeToNow, setDateTimeToInstantInZone,
    setDateTimeToZoneNow, clockTick, setClock, isRunning,
  };
}
