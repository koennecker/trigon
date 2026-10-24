// dom-patch.js — guarded DOM writes for the live-patch path.
//
// A guarded write touches the DOM only when the new value differs from
// the last value written, so a per-second patch pass costs string
// comparisons instead of re-parses and layout. Two cache shapes cover
// the two node lifetimes in the app:
//   - setText/setHTML cache per element (WeakMap): the element persists
//     across patches within one render, and a rebuilt tree yields new
//     elements with empty caches, so a full rebuild is never mistaken
//     for an unchanged value.
//   - Swap guards cache one string: an outerHTML swap destroys the
//     element, so the last value cannot live on the element itself;
//     the guard object holds it across element identities. Wholesale
//     rebuilds record their output with mark() instead of writing
//     through the guard.
// Only textContent, innerHTML, and outerHTML are touched, so a test
// fake needs only those three fields.

/** Cache of the last innerHTML written per element. */
const htmlCache = new WeakMap();

/**
 * Write textContent only when it differs from the current text, so a
 * patch pass over unchanged cells costs comparisons, not layout. A
 * null element is a no-op (the caller may patch a tab that has not
 * rendered yet).
 * @param {HTMLElement|null} el target element, or null when absent
 * @param {string} value text to show
 * @returns {void}
 */
export function setText(el, value) {
  if (el && el.textContent !== value) el.textContent = value;
}

/**
 * Write innerHTML only when it differs from the last value written to
 * this element. A null element is a no-op.
 * @param {HTMLElement|null} el target element, or null when absent
 * @param {string} html markup to show
 * @returns {void}
 */
export function setHTML(el, html) {
  if (!el) return;
  if (htmlCache.get(el) !== html) {
    el.innerHTML = html;
    htmlCache.set(el, html);
  }
}

/**
 * A one-string guard for section and SVG swaps, where the swap
 * condition is "the markup string changed" rather than "this element
 * changed": the guarded value outlives any single element identity.
 * @typedef {object} SwapGuard
 * @property {(html: string) => void} mark record html as the current
 *   value without touching the DOM, for wholesale rebuilds that already
 *   wrote it
 * @property {(html: string) => boolean} changed true when html differs
 *   from the recorded value, without recording it
 * @property {(el: HTMLElement|null, html: string) => boolean} applyInner
 *   replace el's innerHTML when html differs; returns whether a swap
 *   happened (a null element never swaps and never records)
 * @property {(el: HTMLElement|null, html: string) => boolean} applyOuter
 *   replace el via outerHTML when html differs; returns whether a swap
 *   happened (a null element never swaps and never records)
 */

/**
 * A guard holding the last markup string swapped into a section or
 * wrapper. Starts empty, so the first value always counts as changed —
 * the same initial behavior as a module-level empty-string cache.
 * @returns {SwapGuard} the guard
 */
export function createSwapGuard() {
  let last = '';
  return {
    mark(html) { last = html; },
    changed(html) { return html !== last; },
    applyInner(el, html) {
      if (!el || html === last) return false;
      el.innerHTML = html;
      last = html;
      return true;
    },
    applyOuter(el, html) {
      if (!el || html === last) return false;
      el.outerHTML = html;
      last = html;
      return true;
    },
  };
}
