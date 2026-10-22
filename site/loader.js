// loader.js — the download loading animation.
//
// Shown only while uncached data downloads (WASM engine first load,
// ephemeris .se1 files). An SVG glyph that melts through the twelve
// zodiac signs: at each transition a turbulence/displacement filter
// peaks while the glyph blurs, scales and cross-swaps mid-morph.
//
// The factory owns all loader state (generation counter, RAF handle,
// armed flag). The armed flag gates display: the ephemeris layer asks
// to show the loader on a download, but it only appears when the
// current run armed it (live clock ticks never do). DOM access goes
// through the injected env so the pure pieces stay node-testable.

// Zodiac glyphs in order, colored by element like the chart wheel.
export const MORPH_GLYPHS = ['\u2648', '\u2649', '\u264A', '\u264B', '\u264C', '\u264D',
                             '\u264E', '\u264F', '\u2650', '\u2651', '\u2652', '\u2653'];
export const MORPH_COLORS = ['#ff7b72', '#e3b341', '#79c0ff', '#a371f7']; // fire, earth, air, water
const TVS = '\uFE0E'; // text presentation, matching the chart

/** Loader card markup for a status label. Pure. */
export function loaderHTML(label) {
  return `<div class="loader" id="loader" role="status" aria-live="polite">`
    + `<svg viewBox="0 0 120 120" width="110" height="110" aria-hidden="true">`
    + `<defs><filter id="lmorph" x="-40%" y="-40%" width="180%" height="180%">`
    + `<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="7" result="n"/>`
    + `<feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"/>`
    + `</filter></defs>`
    + `<circle class="orbit" cx="60" cy="60" r="46" fill="none" stroke="#30363d" stroke-width="1.5" stroke-dasharray="4 10" stroke-linecap="round"/>`
    + `<g filter="url(#lmorph)"><text id="lglyph" x="60" y="79" text-anchor="middle" font-size="52" fill="${MORPH_COLORS[0]}"`
    + ` font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">${MORPH_GLYPHS[0]}${TVS}</text></g>`
    + `</svg><div class="load-label" id="load-label">${label}</div></div>`;
}

/** Set the morph glyph element to sign i (glyph + element color). */
export function setGlyph(el, i) {
  el.textContent = MORPH_GLYPHS[i] + TVS;
  el.setAttribute('fill', MORPH_COLORS[i % 4]);
}

/** Apply one morph frame: s in [0,1] is the melt amount (0 = crisp). */
export function morphFrame(el, disp, s) {
  disp.setAttribute('scale', (22 * s).toFixed(2));
  el.style.filter = s > 0.01 ? `blur(${(6 * s).toFixed(2)}px)` : '';
  el.style.opacity = (1 - 0.3 * s).toFixed(3);
  el.style.transform = `scale(${(1 - 0.12 * s).toFixed(4)})`;
}

/**
 * @param {object} env
 * @param {(html: string) => void} env.mount  paint markup into the host panel
 * @param {() => void} env.onShow             called on a fresh paint (app: show the host tab)
 * @param {() => object|null} env.glyphEl     the #lglyph element, or null once replaced
 * @param {() => object|null} env.dispEl      the feDisplacementMap element
 * @param {() => object|null} env.labelEl     the #load-label element
 * @param {() => boolean} env.exists          whether the loader card is in the DOM
 * @param {(cb: (t: number) => void) => number} [env.raf]
 * @param {(id: number) => void} [env.cancelRaf]
 * @param {() => number} [env.now]
 * @param {() => boolean} [env.reducedMotion]
 */
export function createLoader(env) {
  const raf = env.raf || (cb => requestAnimationFrame(cb));
  const cancelRaf = env.cancelRaf || (id => cancelAnimationFrame(id));
  const now = env.now || (() => performance.now());
  const reducedMotion = env.reducedMotion || (() => false);
  let gen = 0, rafId = 0, armed = false;

  // One morph cycle per glyph: hold crisp, then melt into the next sign.
  function morphLoop(g, idx) {
    if (g !== gen) return;
    const reduce = reducedMotion();
    const HOLD = reduce ? 900 : 550, MORPH = reduce ? 0 : 450;
    const t0 = now();
    let swapped = false;
    const frame = t => {
      if (g !== gen) return;
      const el = env.glyphEl();
      if (!el) return; // card was replaced; stop quietly
      const dt = t - t0;
      if (MORPH > 0 && dt >= HOLD) {
        const q = Math.min(1, (dt - HOLD) / MORPH);
        if (!swapped && q >= 0.5) { swapped = true; setGlyph(el, (idx + 1) % 12); }
        morphFrame(el, env.dispEl(), Math.sin(Math.PI * q));
      }
      if (dt < HOLD + MORPH) rafId = raf(frame);
      else morphLoop(g, (idx + 1) % 12);
    };
    rafId = raf(frame);
  }

  return {
    /** Show the loader, or just update its label when already shown. */
    show(label) {
      if (env.exists()) {
        const lb = env.labelEl();
        if (lb && label) lb.textContent = label;
        return;
      }
      env.onShow();
      env.mount(loaderHTML(label));
      morphLoop(++gen, 0);
    },
    /** Stop the animation; the card itself is replaced by the results. */
    hide() {
      gen++;
      if (rafId) { cancelRaf(rafId); rafId = 0; }
    },
    /** Gate display for the current run (live ticks pass false). */
    arm(v) { armed = !!v; },
    isArmed() { return armed; },
  };
}
