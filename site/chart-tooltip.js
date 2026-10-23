// chart-tooltip.js — chart point hover/focus tooltips.
//
// Hovering (or keyboard-focusing) a point on the wheel shows the same
// data as its row in the positions table. chart.js stamps each point
// group with data-point (plus data-wheel on outer wheels); the host
// builds the data (table.js pointTooltip) and this module owns the
// display mechanics: the tooltip element's lifecycle, delegated
// pointer/focus events on the panel (so SVG swaps need no rewiring),
// and edge-aware positioning.

/** Escape a string for interpolation into HTML. Pure. */
export const escHTML = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Tooltip position within the panel: offset from the cursor, flipping
 * to the other side when the tooltip would overflow the panel edge.
 * All inputs are plain numbers (panel-relative math). Pure.
 */
export function tipPosition(clientX, clientY, rectLeft, rectTop,
                           tipW, tipH, panelW, panelH) {
  let x = clientX - rectLeft + 14, y = clientY - rectTop + 14;
  if (x + tipW > panelW - 4) x = clientX - rectLeft - tipW - 10;
  if (y + tipH > panelH - 4) y = clientY - rectTop - tipH - 10;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

/** Tooltip inner markup from pointTooltip data (+ wheel header). Pure. */
export function tooltipHTML(data) {
  const head = data.wheel > 0 ? `${data.name} \u00B7 wheel ${data.wheel}` : data.name;
  return `<div class="ct-head" style="color:${data.color}">${escHTML(head)}</div>`
    + data.fields.map(f =>
        `<div class="ct-row"><span class="ct-k">${escHTML(f.label)}</span>`
      + `<span class="ct-v"${f.color ? ` style="color:${f.color}"` : ''}>${escHTML(f.value)}</span></div>`).join('');
}

/**
 * @param {object} env
 * @param {() => object} env.panel  the chart panel element
 * @param {(g: object) => object|null} env.tipData  tooltip data for a point group
 * @param {(html: string) => string} [env.decorateHTML]  post-processes the
 *   tooltip markup before it is set (e.g. glyph-char -> vector SVG swaps)
 */
export function createChartTooltip(env) {
  let tipEl = null, tipKey = null;

  function hide() {
    if (tipEl) tipEl.style.display = 'none';
    tipKey = null;
  }

  function move(clientX, clientY) {
    if (!tipEl || tipEl.style.display === 'none') return;
    const panel = env.panel();
    const r = panel.getBoundingClientRect();
    const { x, y } = tipPosition(clientX, clientY, r.left, r.top,
      tipEl.offsetWidth, tipEl.offsetHeight, panel.clientWidth, panel.clientHeight);
    tipEl.style.left = `${x}px`;
    tipEl.style.top = `${y}px`;
  }

  function show(g, clientX, clientY) {
    const panel = env.panel();
    if (!tipEl || !tipEl.isConnected) {
      tipEl = document.createElement('div');
      tipEl.id = 'chart-tip';
      tipEl.setAttribute('role', 'tooltip');
      panel.appendChild(tipEl);
    }
    const data = env.tipData(g);
    if (!data) { hide(); return; }
    tipEl.innerHTML = env.decorateHTML ? env.decorateHTML(tooltipHTML(data)) : tooltipHTML(data);
    tipEl.style.display = 'block';
    tipKey = `${g.dataset.point}:${data.wheel}`;
    move(clientX, clientY);
  }

  return {
    hide,
    /** Whether a tooltip is currently keyed to a point. */
    get active() { return tipKey !== null; },
    /** Attach the delegated panel listeners. */
    init() {
      const panel = env.panel();
      const keyOf = g => `${g.dataset.point}:${g.dataset.wheel || '0'}`;
      panel.addEventListener('pointerover', e => {
        const g = e.target.closest && e.target.closest('.chart-point');
        if (!g) return;
        if (tipKey !== keyOf(g)) show(g, e.clientX, e.clientY);
        else move(e.clientX, e.clientY);
      });
      panel.addEventListener('pointermove', e => {
        if (tipKey) move(e.clientX, e.clientY);
      });
      panel.addEventListener('pointerout', e => {
        const g = e.target.closest && e.target.closest('.chart-point');
        if (g && !(e.relatedTarget && g.contains(e.relatedTarget))) hide();
      });
      panel.addEventListener('focusin', e => {
        const g = e.target.closest && e.target.closest('.chart-point');
        if (!g) return;
        const r = g.getBoundingClientRect();
        show(g, r.left + r.width / 2, r.top + r.height / 2);
      });
      panel.addEventListener('focusout', hide);
      panel.addEventListener('keydown', e => {
        if (e.key === 'Escape') hide();
      });
    },
  };
}
