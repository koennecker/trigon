// outer-wheels.js — outer chart wheels (biwheel, triwheel, ...).
//
// The root chart uses the main inputs. Each outer wheel is a UTC
// datetime (+ label) shown as a ring outside the root wheel. Positions
// are geocentric ecliptic longitudes, so no location is needed.
//
// The factory owns the wheel list and the animation target (0 = root
// chart, 1..N = outer wheel index+1; only the target moves during
// animation/clock, the others stay static). Panel edits are scraped
// from the DOM at read time, so uncommitted edits count — the same
// semantics the run and share paths have always used.

const pad2 = n => String(n).padStart(2, '0');

/** UTC ms -> datetime-local input value ("YYYY-MM-DDTHH:MM", UTC). Pure. */
export function msToLocalInputValue(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    + `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/** datetime-local input value -> UTC ms (NaN when empty/invalid). Pure. */
export function localInputValueToMs(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return NaN;
  return Date.parse(v + ':00Z');
}

/** Animation target clamped to the wheels that exist. Pure. */
export function clampAnimTarget(target, nWheels) {
  return target > nWheels ? 0 : target;
}

/** One panel's inner markup. Pure. */
export function outerPanelHTML(i, w) {
  return `<div class="outer-panel-head"><span>Outer wheel ${i + 1}</span>`
    + `<button type="button" class="ghost outer-remove" data-idx="${i}" aria-label="Remove outer wheel ${i + 1}">&times;</button></div>`
    + `<input type="datetime-local" class="outer-dt" data-idx="${i}" value="${msToLocalInputValue(w.utcMs)}" aria-label="Outer wheel ${i + 1} date and time (UTC)">`
    + `<input type="text" class="outer-label" data-idx="${i}" value="${(w.label || '').replace(/"/g, '&quot;')}" placeholder="Label (e.g. Transits)" aria-label="Outer wheel ${i + 1} label">`;
}

/**
 * @param {object} env
 * @param {(id: string) => object|null} env.el  element lookup by id
 * @param {() => number|null} env.rootInstantMs  root chart instant (default for a new wheel)
 * @param {() => Iterable<object>} env.panels  the rendered .outer-panel elements
 * @param {(i: number) => object|null} env.panelInput  wheel i's datetime input
 * @param {() => object|null} env.rootRadio  the root animation-target radio
 */
export function createOuterWheels(env) {
  let wheels = []; // [{utcMs, label}]
  let animTarget = 0;

  function renderAnimTargetRadios() {
    const box = env.el('anim-target-wheels');
    if (!box) return;
    box.innerHTML = '';
    wheels.forEach((w, i) => {
      const lbl = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'anim-target'; radio.value = String(i + 1);
      if (animTarget === i + 1) radio.checked = true;
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(` Wheel ${i + 1}`));
      box.appendChild(lbl);
    });
    // If the target wheel was removed, fall back to root.
    if (animTarget > wheels.length) {
      animTarget = 0;
      const root = env.rootRadio();
      if (root) root.checked = true;
    }
  }

  function renderPanels() {
    const box = env.el('outer-panels');
    if (!box) return;
    box.innerHTML = '';
    renderAnimTargetRadios();
    wheels.forEach((w, i) => {
      const div = document.createElement('div');
      div.className = 'outer-panel';
      div.dataset.idx = i;
      div.innerHTML = outerPanelHTML(i, w);
      box.appendChild(div);
    });
  }

  return {
    /** The animation target: 0 = root, 1..N = outer wheel index+1. */
    getTarget: () => animTarget,
    /** A copy of the wheel list as last rendered (panel edits not included). */
    list: () => wheels.map(w => ({ ...w })),
    /** Replace the wheel list (share-link restore) and re-render panels. */
    setWheels(list) {
      wheels = list.map(w => ({ utcMs: w.utcMs, label: w.label || '' }));
      animTarget = clampAnimTarget(animTarget, wheels.length);
      renderPanels();
    },
    renderPanels,
    /**
     * Scrape the panels from the DOM: [{utcMs, label}] with a default
     * label per wheel. Throws on an invalid datetime, like the inputs.
     */
    readPanels() {
      const out = [];
      env.panels().forEach(div => {
        const i = parseInt(div.dataset.idx, 10);
        const dtEl = div.querySelector('.outer-dt');
        const lbEl = div.querySelector('.outer-label');
        const ms = dtEl ? localInputValueToMs(dtEl.value) : NaN;
        if (!Number.isFinite(ms)) throw new Error(`outer wheel ${i + 1}: invalid date/time`);
        out.push({ utcMs: ms, label: (lbEl && lbEl.value.trim()) || `Wheel ${i + 1}` });
      });
      return out;
    },
    /** Update one wheel's datetime (state + DOM input). */
    setWheelMs(i, ms) {
      if (!wheels[i]) return;
      wheels[i].utcMs = ms;
      const input = env.panelInput(i);
      if (input) input.value = msToLocalInputValue(ms);
    },
    /** Wire the add/remove buttons and the animation-target radios. */
    init() {
      const targetRow = env.el('anim-target-row');
      if (targetRow) targetRow.addEventListener('change', e => {
        const r = e.target.closest('input[name="anim-target"]');
        if (r) animTarget = parseInt(r.value, 10);
      });
      const add = env.el('add-wheel');
      if (add) add.addEventListener('click', () => {
        // Default to the root chart's instant so the new ring is visible immediately.
        const ms = env.rootInstantMs() != null ? env.rootInstantMs() : Date.now();
        wheels.push({ utcMs: ms, label: '' });
        renderPanels();
      });
      const box = env.el('outer-panels');
      if (box) box.addEventListener('click', e => {
        const btn = e.target.closest('.outer-remove');
        if (!btn) return;
        wheels.splice(parseInt(btn.dataset.idx, 10), 1);
        renderPanels();
      });
    },
  };
}
