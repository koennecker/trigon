// chart-style.js — the Customize-chart panel and its persisted overrides.
//
// The panel is generated from chart.js's CHART_STYLE_SECTIONS
// descriptors; overrides (only the values that differ from default)
// persist under one storage key and merge over the defaults on every
// render. The factory owns the override state; the host supplies
// storage and an onChange callback (re-render the wheel).

import { CHART_STYLE_SECTIONS, defaultChartStyle, resolveChartStyle } from './chart.js';

export const CSTYLE_KEY = 'astroweb-chart-style';

/** Look up one parameter descriptor by section id and key. */
export function styleParam(sec, key) {
  const s = CHART_STYLE_SECTIONS.find(x => x.id === sec);
  return s ? s.params.find(q => q.key === key) : undefined;
}

// Returns the parsed value, or null when the raw text is not acceptable
// (the caller reverts the input then). Params with allowZero (e.g. the
// label-separation multiplier) accept 0; everything else needs v > 0.
export function parseStyleNum(raw, allowZero) {
  const v = parseFloat(raw);
  return (Number.isFinite(v) && (v > 0 || (v === 0 && allowZero))) ? v : null;
}

/** Panel markup for a resolved style (the Chart section of the settings
 * modal). Pure. */
export function buildChartStyleHTML(style) {
  let h = '<div class="chart-style">';
  for (const sec of CHART_STYLE_SECTIONS) {
    h += `<div class="cs-sec"><h4>${sec.title}</h4>`;
    for (const p of sec.params) {
      const v = style[sec.id][p.key];
      h += `<label class="cs-row"><span class="cs-lab"${p.hint ? ` title="${p.hint}"` : ''}>${p.label}</span>`
        + `<input type="number" step="${p.step}" value="${v}"`
        + ` data-sec="${sec.id}" data-key="${p.key}" aria-label="${sec.title}: ${p.label}">`
        + `</label>`;
    }
    h += '</div>';
  }
  h += '<button id="cs-reset" class="ghost" type="button">Reset to defaults</button></div>';
  return h;
}

/**
 * Apply one override to the overrides object (mutated in place):
 * a value equal to the default deletes the key, and a section left
 * empty is pruned, so the persisted form stays minimal.
 */
export function applyStyleOverride(overrides, sec, key, v) {
  if (v === defaultChartStyle()[sec][key]) {
    if (overrides[sec]) {
      delete overrides[sec][key];
      if (!Object.keys(overrides[sec]).length) delete overrides[sec];
    }
    return overrides;
  }
  if (!overrides[sec]) overrides[sec] = {};
  overrides[sec][key] = v;
  return overrides;
}

/**
 * @param {object} env
 * @param {{getItem: Function, setItem: Function, removeItem: Function}} env.storage
 * @param {() => void} env.onChange  called after any committed change (host re-renders)
 */
export function createChartStyle(env) {
  let overrides = {};
  try {
    const raw = env.storage.getItem(CSTYLE_KEY);
    if (raw) overrides = JSON.parse(raw) || {};
  } catch (e) { overrides = {}; }

  const persist = () => {
    try { env.storage.setItem(CSTYLE_KEY, JSON.stringify(overrides)); } catch (e) {}
  };
  const style = () => resolveChartStyle(overrides);
  const set = (sec, key, v) => {
    applyStyleOverride(overrides, sec, key, v);
    persist();
    env.onChange();
  };
  const reset = () => {
    overrides = {};
    try { env.storage.removeItem(CSTYLE_KEY); } catch (e) {}
    env.onChange();
  };

  return {
    /** Resolved style (defaults merged with overrides). */
    style,
    /** A copy of the current overrides object. */
    overrides: () => JSON.parse(JSON.stringify(overrides)),
    /** Panel markup for the current resolved style. */
    html: () => buildChartStyleHTML(style()),
    /** Commit one parameter value: persist and notify. */
    set,
    /** Clear all overrides: persist and notify. */
    reset,
    /** Attach change/reset listeners under a root element. */
    wire(root) {
      const det = root.querySelector('.chart-style');
      if (!det) return;
      det.querySelectorAll('input[type=number]').forEach(inp => {
        // 'change' (not 'input'): re-render once per committed edit, and an
        // invalid entry reverts instead of clamping.
        inp.addEventListener('change', () => {
          const v = parseStyleNum(inp.value, styleParam(inp.dataset.sec, inp.dataset.key).allowZero);
          if (v == null) { inp.value = style()[inp.dataset.sec][inp.dataset.key]; return; }
          inp.value = v;
          set(inp.dataset.sec, inp.dataset.key, v);
        });
      });
      det.querySelector('#cs-reset').addEventListener('click', () => {
        reset();
        det.querySelectorAll('input[type=number]').forEach(inp => {
          inp.value = styleParam(inp.dataset.sec, inp.dataset.key).def;
        });
      });
    },
  };
}
