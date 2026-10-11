// sky.js — 3D sky viewer for the Sky tab.
//
// Lazily imported on first tab open (three.js too). Positions are fully
// dynamic: every call to onEphemeris() recomputes body places from the WASM
// ephemeris output (unlike the old mini-app, which froze RA/Dec and only
// rotated the sky — so its clock never moved the planets realistically).
// Stars come from sefstars.txt (downloaded once, cached in IndexedDB),
// precessed to the date with proper motion applied.
//
// View: geocentric, observer at the centre. Drag to look around, wheel/pinch
// to zoom. No DOM framework, no OrbitControls — the camera only rotates.

import * as SD from './sky-data.js';

// --- userData contracts -------------------------------------------------------
// THREE.Object3D.userData is an untyped grab-bag; these typedefs document the
// shapes sky.js relies on. THREE itself loads dynamically (let THREE = null),
// so three.js classes are typed loosely as object here.

/**
 * Text sprite made by makeLabel(): a THREE.Sprite with a live-texture setter.
 * @typedef {object} LabelSpriteUserData
 * @property {(txt: string, oo?: object) => void} setText redraw the label text
 */

/**
 * userData on each planet/point group built by buildBodies().
 * @typedef {object} SkyBodyUserData
 * @property {object} def SKY_BODIES entry {id, name, glyph, color}
 * @property {object} glyph the glyph sprite (child)
 * @property {object} label the name-label sprite (child, has setText)
 * @property {'body'} kind discriminant
 * @property {number} lon current ecliptic longitude, degrees
 * @property {number} lat current ecliptic latitude, degrees
 * @property {number} az current azimuth, degrees from north eastward
 * @property {number} alt current altitude, degrees
 * @property {number} house whole-sign house number 1..12
 * @property {number} speed longitude speed, degrees/day
 */

/**
 * userData on Asc/MC marker sprites.
 * @typedef {object} SkyAngleUserData
 * @property {'angle'} kind discriminant
 * @property {string} key 'asc' | 'mc'
 * @property {string} name 'Ascendant' | 'Midheaven'
 * @property {number} lon current ecliptic longitude, degrees
 * @property {number} az current azimuth, degrees
 * @property {number} alt current altitude, degrees
 */

/**
 * userData on star-label sprites (they also carry setText from makeLabel).
 * @typedef {object} SkyStarLabelUserData
 * @property {SD.StarRecord} star the parsed sefstars record
 * @property {(txt: string, oo?: object) => void} setText redraw the label text
 */

/**
 * userData on cardinal-point / zenith sprites.
 * @typedef {object} SkyCardinalUserData
 * @property {true} cardinal marker flag
 * @property {SD.HorizCoords} h fixed horizontal position {az, alt}
 */

/** Stored on overlay materials so daylight dimming never compounds.
 * @typedef {object} SkyMaterialUserData
 * @property {number} [baseOp] opacity before dimming (captured once)
 */

const R = 400;               // celestial sphere radius (world units)
const EYE = 2.5;             // observer eye height above the horizon plane
const STAR_URL = 'https://raw.githubusercontent.com/aloistr/swisseph/refs/heads/master/ephe/sefstars.txt';

// Overlay definitions: [key, label, defaultOn]
const OVERLAY_DEFS = [
  ['bodies', 'Planets & points', true],
  ['bodyLabels', 'Body labels', true],
  ['stars', 'Stars', true],
  ['starLabels', 'Star labels', true],
  ['zodiac', 'Tropical zodiac ring', true],
  ['nakshatra', 'Nakshatras (sidereal)', false],
  ['xiu', 'Chinese mansions (equatorial)', false],
  ['ecliptic', 'Ecliptic', true],
  ['moonOrbit', "Moon's orbit", true],
  ['equator', 'Celestial equator', false],
  ['meridian', 'Meridian', true],
  ['horizon', 'Horizon', true],
  ['cardinals', 'Cardinal points', true],
  ['primeVertical', 'Prime vertical', false],
  ['galactic', 'Galactic equator', false],
  ['graticule', 'RA/Dec graticule', false],
  ['poles', 'Celestial & ecliptic poles', false],
  ['houses', 'Whole-sign houses', true],
  ['spokes', 'House & sign spokes', false],
  ['zodiacFill', 'Zodiac slice fill', false],
  ['nakshatraFill', 'Nakshatra slice fill', false],
  ['xiuFill', 'Mansion slice fill', false],
  ['ground', 'Ground (occludes below horizon)', true],
  ['groundTransparent', 'Transparent ground (see below horizon)', false],
];

// Overlays anchored to the observer's horizon frame. In sphere view the frame
// spins with LST, so these are ignored entirely there.
const HORIZON_FRAME = ['horizon', 'meridian', 'primeVertical', 'cardinals'];

export function createSkyUI({ getEphemeris, store, setLoading, log }) {
  let THREE = null;
  let ready = false, visible = false, failed = null, aimed = false;
  let renderer = null, scene = null, camera = null, raf = 0;
  // On-demand rendering: the scene is re-rendered only when something it
  // shows has changed (ephemeris refresh, camera move, resize, options),
  // not at every vsync. A static sky costs zero GPU/CPU between changes;
  // the 50%-CPU idle burn this replaces was pure repaint.
  let dirty = true;
  const markDirty = () => { dirty = true; };
  let hoverDirty = false;      // pointer moved since the last raycast
  let lastOverlaySig = '';     // overlay rebuild quantum signature
  let lastRefreshMs = 0;       // playback detection for the quantum above
  let lastStarKey = '';        // sphere-view star recompute gate
  let wrapEl = null, tipEl = null, readoutEl = null;

  let stars = [];                 // parsed sefstars records
  let starGeo = null, starPos = null, starIndex = []; // positions + record per point
  let labelStars = [];
  let bodies = [];                // {def, group, glyphSprite, labelSprite, labelCanvas...}
  let angleMarkers = {};          // asc, mc
  let groups = {};                // overlay key -> THREE.Group
  let ringLabels = { zodiac: [], nakshatra: [], xiu: [], houses: [], cardinals: [] };
  let groundMesh = null, sphereMesh = null, domeMesh = null, starMat = null;
  let viewBtns = [];

  // View mode: 'observer' (ground-centred, look around) or 'sphere'
  // (free-floating camera outside the celestial sphere, orbit + zoom).
  let viewMode = 'observer';
  let sphYaw = 0, sphPitch = 0, sphDist = 2.6 * R, sphereFaced = false;
  let cur = null; // {jd, eps, lst, lat, sunLon, out} of the last refresh

  // Camera lock: a SKY_BODIES id the camera tracks on every refresh
  // (retrograde-period animation), or null for free look. Lockable at any
  // time from the Lock picker in the options panel.
  let lockBodyId = null, lockBtn = null, lockSel = null, fsBtn = null;

  // Comet trail: recent view positions of the camera-locked body, drawn
  // as an additive line whose vertex colors fade toward the tail, so the
  // body's looping path draws itself during a retrograde animation.
  // Points are view-space: the trail clears when the lock changes body
  // or the view mode flips, and restarts on a discontinuous jump (a
  // manual date change while locked).
  const TRAIL_MAX = 1500;
  const trailPts = [];
  let trailColor = null; // THREE.Color, made in buildTrail (THREE loads lazily)
  let trailGeo = null, trailLine = null;

  const opts = {};
  for (const [k, , d] of OVERLAY_DEFS) opts[k] = d;
  opts.daylight = false; // realistic daylight off by default: classic always-night sky
  // Label sizing (Sky options sliders): multipliers on every label's world
  // height. Glyphs (planet symbols, sign glyphs) scale separately from text.
  let textScale = 1, glyphScale = 1;
  const scaledSprites = new Set(); // persistent sprites re-scaled on slider input
  // The options panel holds a lot of state now: persist it across sessions.
  // Render-rate cap (0 = display rate), set in the Options panel. Declared
  // ahead of loadSkyPrefs so its assignment can't hit the let TDZ.
  let maxFps = 0;
  const SKY_PREFS_KEY = 'trigon.sky.v1';
  function loadSkyPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(SKY_PREFS_KEY) || 'null');
      if (!p || typeof p !== 'object') return;
      if (p.opts && typeof p.opts === 'object')
        for (const [k] of OVERLAY_DEFS) if (typeof p.opts[k] === 'boolean') opts[k] = p.opts[k];
      if (typeof p.daylight === 'boolean') opts.daylight = p.daylight;
      // Arbitrary sizes: any positive finite value.
      if (Number.isFinite(p.textScale) && p.textScale > 0) textScale = p.textScale;
      if (Number.isFinite(p.glyphScale) && p.glyphScale > 0) glyphScale = p.glyphScale;
      if (p.viewMode === 'sphere' || p.viewMode === 'observer') viewMode = p.viewMode;
      if ([0, 24, 30, 60, 90, 120].includes(p.maxFps)) maxFps = p.maxFps;
    } catch (e) { /* sandboxed frames throw on localStorage: session-only */ }
  }
  function saveSkyPrefs() {
    try {
      const o = {};
      for (const [k] of OVERLAY_DEFS) o[k] = !!opts[k];
      localStorage.setItem(SKY_PREFS_KEY, JSON.stringify({
        opts: o, daylight: !!opts.daylight, textScale, glyphScale, viewMode, maxFps,
      }));
    } catch (e) { /* ignore */ }
  }
  loadSkyPrefs();
  const GROUND_NIGHT = 0x05070d, GROUND_DAY = 0x39424c;
  let dayScratch = null; // THREE.Color scratch, created once THREE loads

  // View state: yaw = azimuth of view centre (rad), pitch = altitude (rad).
  let yaw = Math.PI, pitch = 0.42, fov = 62;
  let mouse = null;               // last pointer NDC for hover raycast
  const raycaster = { obj: null }; // created after THREE loads

  // ------------------------------------------------------------------ helpers

  function v3(x, y, z) { return new THREE.Vector3(x, y, z); }

  function hv(azDeg, altDeg, r = R) {
    const [x, y, z] = SD.horizToVec(azDeg, altDeg, r);
    return v3(x, y, z);
  }

  // World placement in the current view mode.
  // Observer: equatorial -> horizontal -> world. Sphere: equatorial -> world.
  function eqToViewV(ra, dec, r = R) {
    if (viewMode === 'sphere') { const [x, y, z] = SD.eqToVec(ra, dec, r); return v3(x, y, z); }
    const h = SD.eqToHoriz(ra, dec, cur.lst, cur.lat);
    return hv(h.az, h.alt, r);
  }
  function horToViewV(az, alt, r = R) {
    if (viewMode === 'sphere') {
      const e = SD.horizToEq(az, alt, cur.lst, cur.lat);
      const [x, y, z] = SD.eqToVec(e.ra, e.dec, r);
      return v3(x, y, z);
    }
    return hv(az, alt, r);
  }

  // Canvas -> SpriteMaterial texture, cached by text+style key.
  const texCache = new Map();
  function textTexture(text, { size = 44, color = '#e6edf3', glow = null, font = null, pad = 18 } = {}) {
    const key = [text, size, color, glow, font].join('|');
    if (texCache.has(key)) return texCache.get(key);
    const fs = font || `600 ${size}px "Segoe UI Symbol","Noto Sans Symbols 2","DejaVu Sans",sans-serif`;
    const lines = String(text).split('\n');
    const cv = document.createElement('canvas');
    const cx = cv.getContext('2d');
    cx.font = fs;
    let w = 0;
    for (const ln of lines) w = Math.max(w, cx.measureText(ln).width);
    w = Math.ceil(w) + pad * 2;
    const lineH = size * 1.25, h = Math.ceil(lineH * lines.length) + pad * 2;
    cv.width = w * 2; cv.height = h * 2; // 2x for crispness
    const c = cv.getContext('2d');
    c.scale(2, 2);
    c.font = fs;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    if (glow) { c.shadowColor = glow; c.shadowBlur = size * 0.35; }
    c.fillStyle = color;
    const y0 = h / 2 - lineH * (lines.length - 1) / 2;
    lines.forEach((ln, i) => c.fillText(ln, w / 2, y0 + i * lineH));
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rec = { tex, w, h };
    if (texCache.size > 400) { const k = texCache.keys().next().value; texCache.get(k).tex.dispose(); texCache.delete(k); }
    texCache.set(key, rec);
    return rec;
  }

  // Material pools: overlay rebuilds used to mint fresh materials for every
  // label/line/fill, and clearGroup disposed them — so three.js released and
  // re-linked the same shader programs nearly every frame during animation
  // (getProgramInfoLog was 18% of the render thread in a 2026-10-03
  // Mars trace). Pooled materials are shared by key and never disposed, so
  // each program links exactly once.
  const matPool = new Map();
  function pooled(key, make) {
    let m = matPool.get(key);
    if (!m) { m = make(); m.userData.pooled = true; matPool.set(key, m); }
    return m;
  }
  const pooledSpriteMaterial = (tex, depthTest) => pooled(
    `sp|${tex.uuid}|${depthTest ? 1 : 0}`,
    () => new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest }));
  const pooledLineMaterial = (color, opacity, dashed) => pooled(
    `ln|${color && color.getHexString ? color.getHexString() : color}|${opacity}|${dashed ? 1 : 0}`,
    () => dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 6, gapSize: 5 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  const pooledFillMaterial = (colorCss, opacity) => pooled(
    `fl|${colorCss}|${opacity}`,
    () => new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorCss), transparent: true, opacity,
      side: THREE.DoubleSide, depthWrite: false,
    }));

  function makeLabel(text, o = {}) {
    const t = textTexture(text, o);
    const depthTest = o.depthTest !== undefined ? !!o.depthTest : viewMode === 'sphere';
    // Persistent sprites may swap their texture (setText), so they keep a
    // private material; the rebuilt overlay labels share pooled ones.
    const mat = o.persist
      ? new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthWrite: false, depthTest })
      : pooledSpriteMaterial(t.tex, depthTest);
    const sp = new THREE.Sprite(mat);
    // userData.base records the un-multiplied size so persistent sprites can
    // be re-scaled when the text/glyph sliders move.
    const base = { w: t.w, h: t.h, worldH: o.worldH || 14, glyph: !!o.glyph };
    sp.userData.base = base;
    const s = (base.worldH * (base.glyph ? glyphScale : textScale)) / t.h;
    sp.scale.set(t.w * s, t.h * s, 1);
    if (o.persist) scaledSprites.add(sp);
    sp.userData.setText = (txt, oo = {}) => {
      const nt = textTexture(txt, { ...o, ...oo });
      if (nt.tex === sp.material.map) return;
      sp.material.map = nt.tex;
      sp.material.needsUpdate = true;
      base.w = nt.w; base.h = nt.h; base.worldH = (oo.worldH || o.worldH) || 14;
      const s2 = (base.worldH * (base.glyph ? glyphScale : textScale)) / nt.h;
      sp.scale.set(nt.w * s2, nt.h * s2, 1);
    };
    return sp;
  }

  // Name label offset for one body group: sit the label just below its
  // glyph, clearing both sprites' half-heights at the current scales.
  function layoutBodyLabel(g) {
    const gh = g.userData.glyph, lb = g.userData.label;
    if (!gh || !lb) return;
    const gHalf = (gh.userData.base.worldH * glyphScale) / 2;
    const lHalf = (lb.userData.base.worldH * textScale) / 2;
    lb.position.y = -(gHalf + lHalf);
  }

  // Re-apply the text/glyph multipliers to sprites that survive refreshes
  // (body glyphs + labels, angle markers, star labels). Ring and overlay
  // labels are rebuilt every refresh and pick the multipliers up there.
  // Body name labels also get their size-aware offset refreshed here.
  function rescalePersisted() {
    for (const sp of scaledSprites) {
      const b = sp.userData.base;
      if (!b) continue;
      const s = (b.worldH * (b.glyph ? glyphScale : textScale)) / b.h;
      sp.scale.set(b.w * s, b.h * s, 1);
    }
    for (const g of bodies) layoutBodyLabel(g);
  }

  function circleLine(pts, color, opacity = 0.55, dashed = false) {
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(g, pooledLineMaterial(color, opacity, dashed));
    if (dashed) line.computeLineDistances();
    return line;
  }

  function arcPts(fn, a0, a1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(a0 + (a1 - a0) * (i / n)));
    return pts;
  }

  function clearGroup(gr) {
    for (let i = gr.children.length - 1; i >= 0; i--) {
      const c = gr.children[i];
      gr.remove(c);
      c.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        // Pooled materials are shared across rebuilds and must survive;
        // disposing them would force a shader re-link next rebuild.
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => { if (!m.userData.pooled) m.dispose(); });
        }
      });
    }
  }

  // ------------------------------------------------------------------ init

  async function ensureInit() {
    if (ready || failed) return;
    if (!THREE) THREE = await import('./vendor/three.module.min.js');
    raycaster.obj = new THREE.Raycaster();
    raycaster.obj.params.Points = { threshold: 3 };

    wrapEl = document.getElementById('sky-canvas');
    tipEl = document.getElementById('sky-tip');
    readoutEl = document.getElementById('sky-readout');

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    wrapEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060c);
    camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 3000);
    camera.position.set(0, EYE, 0);
    applyCam();

    // Faint milky-way-ish backdrop sphere tint? Keep pure black: stars carry it.
    for (const [k] of OVERLAY_DEFS) { groups[k] = new THREE.Group(); scene.add(groups[k]); }
    dayScratch = new THREE.Color();
    buildDome();

    buildControls();
    buildOptionsUI();
    buildChromeButtons();
    new ResizeObserver(resize).observe(wrapEl);
    resize();

    // Stars: IndexedDB first, network on miss.
    let text = null;
    try {
      setLoading('Loading star catalogue…');
      const hit = await store.get('sefstars.txt').catch(() => null);
      if (hit) {
        text = new TextDecoder().decode(hit);
        log && log('star catalogue: local copy (sefstars.txt)');
      } else {
        log && log('star catalogue: downloading sefstars.txt …');
        const resp = await fetch(STAR_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching sefstars.txt`);
        const buf = await resp.arrayBuffer();
        text = new TextDecoder().decode(buf);
        try { await store.put('sefstars.txt', buf); log && log('star catalogue: stored locally'); }
        catch (e) { log && log('star catalogue: local store failed: ' + e.message); }
      }
    } finally {
      setLoading(null);
    }
    stars = SD.parseSefstars(text);
    buildStars();
    buildBodies();
    buildGround();
    buildSphere();
    buildTrail();
    buildCardinals();
    ready = true;
    applyOpts();
    if (visible) { refresh(); loop(); }
  }

  function resize() {
    if (!renderer || !wrapEl) return;
    const w = wrapEl.clientWidth || 2, h = wrapEl.clientHeight || 2;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    markDirty();
  }

  function applyCam() {
    if (viewMode === 'sphere') {
      const cp = Math.cos(sphPitch);
      camera.position.set(
        sphDist * cp * Math.sin(sphYaw),
        sphDist * Math.sin(sphPitch),
        -sphDist * cp * Math.cos(sphYaw));
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(0, EYE, 0);
      const d = v3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(d.multiplyScalar(R).add(camera.position));
    }
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    markDirty();
  }

  function setViewMode(v) {
    if (viewMode === v || !ready) return;
    viewMode = v;
    saveSkyPrefs();
    clearTrail(); // trail points are view-space
    for (const b of viewBtns) b.classList.toggle('on', b.dataset.v === v);
    // First entry to sphere view: face the Sun's place on the celestial sphere.
    if (v === 'sphere' && !sphereFaced && cur) {
      const sun = SD.eclToEq(SD.norm360(cur.sunLon), 0, cur.eps);
      sphYaw = sun.ra * SD.DEG2RAD;
      sphPitch = Math.max(-1.45, Math.min(1.45, sun.dec * SD.DEG2RAD));
      sphereFaced = true;
    }
    // Far-side labels must not show through the sphere in sphere view.
    scene.traverse(o => { if (o.isSprite) o.material.depthTest = v === 'sphere'; });
    applyOpts();
    applyCam();
    if (visible) refresh();
  }

  // ------------------------------------------------------------- interaction

  function buildControls() {
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.style.display = 'block';
    let dragging = false, lx = 0, ly = 0;
    const pinch = new Map();
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId);
      pinch.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch.size === 1) { dragging = true; lx = e.clientX; ly = e.clientY; }
      else dragging = false;
    });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      mouse = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, cx: e.clientX - r.left, cy: e.clientY - r.top };
      hoverDirty = true;
      if (pinch.has(e.pointerId)) pinch.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch.size === 2) {
        const [a, b] = [...pinch.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch.d && d > 0) {
          if (viewMode === 'sphere') sphDist = Math.min(6 * R, Math.max(1.05 * R, sphDist * (pinch.d / d)));
          else fov = Math.min(90, Math.max(12, fov * (pinch.d / d)));
        }
        pinch.d = d;
        applyCam();
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      // A locked camera tracks its body: rotate-drag is ignored (zoom still
      // works), and the unlock chip is the explicit way out.
      if (lockBodyId != null) return;
      if (viewMode === 'sphere') {
        sphYaw = SD.dragYaw(sphYaw, dx);
        sphPitch = SD.dragPitch(sphPitch, dy);
      } else {
        yaw = SD.dragYaw(yaw, dx);
        pitch = SD.dragPitch(pitch, dy);
      }
      applyCam();
    });
    const up = e => { pinch.delete(e.pointerId); pinch.d = 0; if (pinch.size === 0) dragging = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { mouse = null; hideTip(); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (viewMode === 'sphere') sphDist = Math.min(6 * R, Math.max(1.05 * R, sphDist * (1 + e.deltaY * 0.001)));
      else fov = Math.min(90, Math.max(12, fov * (1 + e.deltaY * 0.001)));
      applyCam();
    }, { passive: false });
  }

  // ------------------------------------------------------------------ options UI

  function buildOptionsUI() {
    const host = document.getElementById('sky-overlays');
    host.innerHTML = '';
    viewBtns = [];
    const vmRow = document.createElement('div');
    vmRow.className = 'sky-viewrow';
    const vmLab = document.createElement('span');
    vmLab.textContent = 'View';
    vmRow.appendChild(vmLab);
    for (const [v, label] of [['observer', 'Observer'], ['sphere', 'Sphere']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.v = v;
      b.classList.toggle('on', viewMode === v);
      b.addEventListener('click', () => setViewMode(v));
      vmRow.appendChild(b);
      viewBtns.push(b);
    }
    host.appendChild(vmRow);
    // Camera lock picker: track any body at any time, not just during the
    // retrograde animation. The top-left chip stays the unlock affordance.
    const lockRow = document.createElement('div');
    lockRow.className = 'sky-viewrow';
    const lockLab = document.createElement('span');
    lockLab.textContent = 'Lock';
    lockRow.appendChild(lockLab);
    lockSel = document.createElement('select');
    lockSel.id = 'sky-locksel';
    lockSel.setAttribute('aria-label', 'Lock the camera to a body');
    const off = document.createElement('option');
    off.value = ''; off.textContent = 'Off';
    lockSel.appendChild(off);
    for (const b of SD.SKY_BODIES) {
      const o = document.createElement('option');
      o.value = String(b.id); o.textContent = b.name;
      lockSel.appendChild(o);
    }
    lockSel.value = lockBodyId == null ? '' : String(lockBodyId);
    lockSel.addEventListener('change', () => {
      setCameraLock(lockSel.value === '' ? null : parseInt(lockSel.value, 10));
    });
    lockRow.appendChild(lockSel);
    host.appendChild(lockRow);
    // Realistic daylight: sky brightness follows the Sun's altitude (observer
    // view only). Off = the classic always-night sky.
    const dlRow = document.createElement('div');
    dlRow.className = 'sky-viewrow';
    const dlLab = document.createElement('label');
    dlLab.title = 'Brighten the sky when the Sun is up; stars wash out while planets linger near the Sun at twilight';
    const dlCb = document.createElement('input');
    dlCb.type = 'checkbox';
    dlCb.checked = opts.daylight;
    dlCb.addEventListener('change', () => { opts.daylight = dlCb.checked; saveSkyPrefs(); if (visible) refresh(); });
    dlLab.appendChild(dlCb);
    dlLab.appendChild(document.createTextNode('Realistic daylight'));
    dlRow.appendChild(dlLab);
    host.appendChild(dlRow);
    // Text / glyph size multipliers: free-form numeric inputs, arbitrary
    // positive sizes. Invalid entries revert.
    for (const [txt, isGlyph] of [['Text size', false], ['Glyph size', true]]) {
      const row = document.createElement('div');
      row.className = 'sky-viewrow';
      const lab = document.createElement('span');
      lab.textContent = txt;
      const num = document.createElement('input');
      num.type = 'number'; num.step = '0.05'; num.min = '0';
      num.value = String(isGlyph ? glyphScale : textScale);
      num.style.width = '90px';
      num.setAttribute('aria-label', txt + ' (any positive size)');
      const val = document.createElement('span');
      val.textContent = '×';
      num.addEventListener('change', () => {
        const v = parseFloat(num.value);
        if (!(Number.isFinite(v) && v > 0)) {
          num.value = String(isGlyph ? glyphScale : textScale);
          return;
        }
        if (isGlyph) glyphScale = v; else textScale = v;
        saveSkyPrefs();
        rescalePersisted();
        if (visible) refresh();
      });
      row.append(lab, num, val);
      host.appendChild(row);
    }
    // Max render rate during continuous motion (clock/animation/drag).
    const fpsRow = document.createElement('div');
    fpsRow.className = 'sky-viewrow';
    const fpsLab = document.createElement('span');
    fpsLab.textContent = 'Max FPS';
    fpsRow.appendChild(fpsLab);
    const fpsSel = document.createElement('select');
    fpsSel.id = 'sky-fps';
    fpsSel.setAttribute('aria-label', 'Maximum frames per second');
    for (const [v, label] of [[0, 'Unlimited'], [24, '24'], [30, '30'], [60, '60'], [90, '90'], [120, '120']]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = label;
      fpsSel.appendChild(o);
    }
    fpsSel.value = String(maxFps);
    fpsSel.addEventListener('change', () => { maxFps = parseInt(fpsSel.value, 10) || 0; saveSkyPrefs(); markDirty(); });
    fpsRow.appendChild(fpsSel);
    host.appendChild(fpsRow);
    for (const [key, label] of OVERLAY_DEFS) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = opts[key];
      cb.addEventListener('change', () => { opts[key] = cb.checked; saveSkyPrefs(); applyOpts(); if (visible) refresh(); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(label));
      host.appendChild(lab);
    }
  }

  function applyOpts() {
    if (!ready) return;
    // Horizon-frame overlays are ignored entirely in sphere view.
    const sphere = viewMode === 'sphere';
    for (const [k] of OVERLAY_DEFS)
      groups[k].visible = opts[k] && !(sphere && HORIZON_FRAME.includes(k));
    applyGround();
    if (sphereMesh) sphereMesh.visible = viewMode === 'sphere';
    markDirty();
  }

  function applyGround() {
    if (!groundMesh) return;
    groundMesh.visible = opts.ground && viewMode === 'observer';
    const m = groundMesh.material;
    if (opts.groundTransparent) { m.opacity = 0.15; m.depthWrite = false; }
    else { m.opacity = 0.96; m.depthWrite = true; }
  }

  // ------------------------------------------------- chrome: fullscreen + camera lock

  // iOS Safari exposes no Fullscreen API for divs; there the button falls
  // back to a CSS pseudo-fullscreen (.sky-pseudofull on the wrap), which
  // the existing ResizeObserver picks up to re-fit the renderer.
  let pseudoFull = false;
  function setPseudoFull(on) {
    pseudoFull = on;
    const wrap = document.getElementById('sky-wrap');
    if (wrap) wrap.classList.toggle('sky-pseudofull', on);
    if (fsBtn) {
      fsBtn.textContent = on ? '✕' : '⛶';
      fsBtn.title = on ? 'Exit fullscreen' : 'Fullscreen';
    }
    resize();
  }

  function buildChromeButtons() {
    const wrap = document.getElementById('sky-wrap');
    fsBtn = document.createElement('button');
    fsBtn.id = 'sky-fsbtn';
    fsBtn.type = 'button';
    fsBtn.textContent = '⛶';
    fsBtn.title = 'Fullscreen';
    fsBtn.setAttribute('aria-label', 'Toggle fullscreen sky view');
    fsBtn.addEventListener('click', () => {
      if (pseudoFull || document.fullscreenElement) {
        if (pseudoFull) setPseudoFull(false);
        else document.exitFullscreen().catch(() => {});
        return;
      }
      const rf = typeof wrap.requestFullscreen === 'function'
        ? wrap.requestFullscreen.bind(wrap) : null;
      if (!rf) { setPseudoFull(true); return; }
      try {
        const p = rf();
        if (p && typeof p.catch === 'function') p.catch(() => setPseudoFull(true));
      } catch (e) { setPseudoFull(true); }
    });
    wrap.appendChild(fsBtn);
    lockBtn = document.createElement('button');
    lockBtn.id = 'sky-lockbtn';
    lockBtn.type = 'button';
    lockBtn.style.display = 'none';
    lockBtn.title = 'Unlock camera';
    lockBtn.addEventListener('click', () => setCameraLock(null));
    wrap.appendChild(lockBtn);
    document.addEventListener('fullscreenchange', () => {
      if (pseudoFull) return;
      const on = !!document.fullscreenElement;
      if (fsBtn) {
        fsBtn.textContent = on ? '✕' : '⛶';
        fsBtn.title = on ? 'Exit fullscreen' : 'Fullscreen';
      }
      resize();
    });
    // No fullscreenchange fires for the CSS fallback; Escape exits it.
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && pseudoFull) setPseudoFull(false);
    });
    updateLockBtn();
  }

  function lockDef() {
    return lockBodyId == null ? null
      : SD.SKY_BODIES.find(b => b.id === lockBodyId) || null;
  }

  function updateLockBtn() {
    if (!lockBtn) return;
    const def = lockDef();
    if (lockSel) lockSel.value = def ? String(def.id) : ''; // stay in sync
    if (!def) { lockBtn.style.display = 'none'; return; }
    lockBtn.style.display = '';
    lockBtn.innerHTML = `🔒 tracking <b>${def.name}</b> · unlock`;
    lockBtn.setAttribute('aria-label', `Camera is tracking ${def.name}; activate to unlock`);
  }

  // Aim the camera at the locked body. Observer view: face its alt/az (a
  // tracking telescope). Sphere view: face its RA/Dec on the celestial
  // sphere. Conventions match applyCam: yaw=az, pitch=alt in observer;
  // sphYaw=ra, sphPitch=dec in sphere (cf. the Sun-facing first entry).
  function applyLockAim() {
    const def = lockDef();
    if (!def || !cur || !cur.out) return;
    const eq = SD.eclToEq(SD.norm360(cur.out[def.id * 6]), cur.out[def.id * 6 + 1], cur.eps);
    if (viewMode === 'sphere') {
      sphYaw = eq.ra * SD.DEG2RAD;
      sphPitch = Math.max(-1.45, Math.min(1.45, eq.dec * SD.DEG2RAD));
    } else {
      const h = SD.eqToHoriz(eq.ra, eq.dec, cur.lst, cur.lat);
      yaw = h.az * SD.DEG2RAD;
      pitch = Math.max(-1.45, Math.min(1.45, h.alt * SD.DEG2RAD));
    }
  }

  function buildTrail() {
    trailColor = new THREE.Color('#ffffff');
    trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
    trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    trailLine.visible = false;
    trailLine.frustumCulled = false;
    scene.add(trailLine);
  }

  function clearTrail() {
    trailPts.length = 0;
    if (trailLine) trailLine.visible = false;
  }

  function pushTrailPoint(pos) {
    if (!trailLine) return;
    const last = trailPts[trailPts.length - 1];
    if (last) {
      const d2 = last.distanceToSquared(pos);
      if (d2 < 0.25) return;                        // body has not moved
      if (d2 > (R * 0.26) ** 2) trailPts.length = 0; // jump: restart the trail
    }
    trailPts.push(pos.clone());
    if (trailPts.length > TRAIL_MAX) trailPts.shift();
    const n = trailPts.length;
    const pa = trailGeo.attributes.position, ca = trailGeo.attributes.color;
    for (let i = 0; i < n; i++) {
      const f = n < 2 ? 1 : (i / (n - 1)) ** 2; // bright head, fading tail
      pa.setXYZ(i, trailPts[i].x, trailPts[i].y, trailPts[i].z);
      ca.setXYZ(i, trailColor.r * f, trailColor.g * f, trailColor.b * f);
    }
    pa.needsUpdate = true; ca.needsUpdate = true;
    trailGeo.setDrawRange(0, n);
    trailLine.visible = n > 1;
  }

  function setCameraLock(id) {
    const next = (id == null) ? null : id;
    if (next !== lockBodyId) clearTrail();
    lockBodyId = next;
    updateLockBtn();
    if (!ready) return;
    applyLockAim();
    applyCam();
    if (visible) refresh();
  }

  // E2E hook: current ecliptic lon/lat of every sky body, in SKY_BODIES order.
  // (Same precedent as window.__trigonSetDate in app.js.)
  window.__skyBodyState = () => bodies.map(g => ({
    name: g.userData.def.name, lon: g.userData.lon, lat: g.userData.lat,
  }));
  window.__skyTrailCount = () => trailPts.length;
  // E2E hook: zoom distance, label multipliers, and horizon-frame group
  // visibility (the sphere-view suppression is otherwise pixel-only).
  window.__skyViewState = () => ({
    viewMode, sphDist, textScale, glyphScale,
    fills: { zodiac: !!opts.zodiacFill, nakshatra: !!opts.nakshatraFill, xiu: !!opts.xiuFill },
    horizonVisible: !!(groups.horizon && groups.horizon.visible),
    meridianVisible: !!(groups.meridian && groups.meridian.visible),
    cardinalsVisible: !!(groups.cardinals && groups.cardinals.visible),
  });

  // ------------------------------------------------------------------ stars

  function starPointSize(mag) {
    // world units on the R=400 sphere; brighter -> bigger
    return Math.max(1.1, Math.min(7.5, 8.6 - mag * 1.55));
  }

  function buildStars() {
    const n = stars.length;
    starPos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const colors = new Float32Array(n * 3);
    starIndex = stars;
    for (let i = 0; i < n; i++) {
      const s = stars[i];
      sizes[i] = starPointSize(s.mag);
      // subtle temperature-ish tint: lore/bright stars warm white, else cool
      const lore = SD.loreForStar(s);
      const warm = lore ? 1.0 : 0.92;
      colors[i * 3] = 1.0 * warm;
      colors[i * 3 + 1] = 0.97 * warm;
      colors[i * 3 + 2] = (lore ? 0.82 : 0.94) * warm;
    }
    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { uDim: { value: 1 } },
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (340.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        uniform float uDim;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          float a = 1.0 - smoothstep(0.08, 0.5, d);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a * uDim);
        }`,
    });
    starMat = mat;
    const pts = new THREE.Points(starGeo, mat);
    pts.userData.kind = 'stars';
    groups.stars.add(pts);
    groups.stars.userData.points = pts;

    // Labels for bright or lore-significant stars.
    labelStars = stars.filter(s => s.mag < 2.2 || (SD.loreForStar(s) && s.mag < 4.2)).slice(0, 90);
    for (const s of labelStars) {
      const sp = makeLabel(s.name, { size: 30, color: '#aebdd6', worldH: 11, persist: true });
      sp.userData.star = s;
      groups.starLabels.add(sp);
    }
  }

  // ------------------------------------------------------------------ bodies

  function buildBodies() {
    for (const def of SD.SKY_BODIES) {
      const g = new THREE.Group();
      const glyph = makeLabel(def.glyph, {
        size: 120, color: def.color, glow: def.color, worldH: def.id === 1 ? 30 : 24,
        glyph: true, persist: true,
      });
      const label = makeLabel(def.name, { size: 30, color: def.color, worldH: 11, persist: true });
      g.add(glyph); g.add(label);
      g.userData = { def, glyph, label, kind: 'body', lon: 0, lat: 0, az: 0, alt: 0, house: 0, speed: 0 };
      layoutBodyLabel(g);
      groups.bodies.add(g);
      bodies.push(g);
    }
    for (const a of SD.ANGLES) {
      const sp = makeLabel(a.glyph, { size: 40, color: a.color, worldH: 12, persist: true });
      sp.userData = { kind: 'angle', key: a.key, name: a.name, lon: 0, az: 0, alt: 0 };
      groups.bodies.add(sp);
      angleMarkers[a.key] = sp;
    }
  }

  function signOf(lonDeg) {
    const s = SD.SIGNS[Math.floor(SD.norm360(lonDeg) / 30) % 12];
    const d = SD.norm360(lonDeg) % 30;
    return `${s.glyph} ${d.toFixed(1)}°`;
  }

  function updateBodies(out, jd, eps, lst, lat) {
    for (const g of bodies) {
      const { def } = g.userData;
      let lon, bLat, speed;
      if (def.id === 11) {
        // South Node: derived from the true node, not an ephemeris slot.
        lon = SD.southNodeLon(out[10 * 6]);
        bLat = 0;
        speed = out[10 * 6 + 3];
      } else {
        lon = out[def.id * 6]; bLat = out[def.id * 6 + 1]; speed = out[def.id * 6 + 3];
      }
      const eq = SD.eclToEq(lon, bLat, eps);
      const h = SD.eqToHoriz(eq.ra, eq.dec, lst, lat);
      g.position.copy(eqToViewV(eq.ra, eq.dec));
      const house = def.id < 10 ? Math.round(out[74 + def.id]) : 0;
      Object.assign(g.userData, { lon, lat: bLat, az: h.az, alt: h.alt, house, speed });
      g.userData.glyph.visible = opts.bodies;
      g.userData.label.visible = opts.bodyLabels;
      g.userData.label.userData.setText(
        `${def.name}  ${signOf(lon)}${house ? `  H${house}` : ''}\n${h.alt >= 0 ? '+' : ''}${h.alt.toFixed(0)}° alt`,
        { size: 26 });
    }
    const ascLon = out[72], mcLon = out[73];
    for (const [key, lon] of [['asc', ascLon], ['mc', mcLon]]) {
      const sp = angleMarkers[key];
      const eq = SD.eclToEq(lon, 0, eps);
      const h = SD.eqToHoriz(eq.ra, eq.dec, lst, lat);
      sp.position.copy(eqToViewV(eq.ra, eq.dec));
      sp.visible = opts.bodies;
      Object.assign(sp.userData, { lon, az: h.az, alt: h.alt });
    }
  }

  // ------------------------------------------------------------------ ground & cardinals

  function buildGround() {
    const geo = new THREE.CircleGeometry(R * 0.995, 96);
    const mat = new THREE.MeshBasicMaterial({ color: 0x05070d, transparent: true, opacity: 0.96 });
    groundMesh = new THREE.Mesh(geo, mat);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = 0;
    scene.add(groundMesh);
  }

  // Opaque celestial sphere, only shown in sphere view: it occludes the far
  // hemisphere's stars/labels so the near side reads cleanly. Radius sits
  // just inside the houses ring (0.985R) and the stars (R).
  function buildSphere() {
    const geo = new THREE.SphereGeometry(R * 0.975, 64, 48);
    sphereMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x05070d }));
    sphereMesh.visible = false;
    scene.add(sphereMesh);
  }

  // Sky dome for realistic daylight (observer view only): a gradient sky
  // whose zenith/horizon colors follow the Sun's altitude, plus a warm
  // twilight glow hugging the horizon around the Sun's azimuth. In sphere
  // view the camera floats in space outside any atmosphere, so the dome
  // hides and the sky stays night.
  function buildDome() {
    const geo = new THREE.SphereGeometry(R * 3, 48, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, -1, 0) },
        uDayF: { value: 0 },
        uTwiF: { value: 0 },
        uHighF: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vDir;
        uniform vec3 uSunDir;
        uniform float uDayF, uTwiF, uHighF;
        void main() {
          vec3 d = normalize(vDir);
          vec3 nightZen = vec3(0.016, 0.024, 0.047);
          vec3 nightHor = vec3(0.039, 0.059, 0.102);
          vec3 mornZen  = vec3(0.075, 0.260, 0.660);
          vec3 mornHor  = vec3(0.600, 0.700, 0.820);
          vec3 dayZen   = vec3(0.145, 0.388, 0.780);
          vec3 dayHor   = vec3(0.690, 0.800, 0.890);
          // Brightness saturates at sunrise (uDayF), but the color
          // distribution keeps evolving as the sun climbs (uHighF): deep
          // morning blue at the zenith warming to full noon blue.
          vec3 zen = mix(nightZen, mix(mornZen, dayZen, uHighF), uDayF);
          vec3 hor = mix(nightHor, mix(mornHor, dayHor, uHighF), uDayF);
          float g = pow(clamp(d.y, 0.0, 1.0), 0.55);
          vec3 col = mix(hor, zen, g);
          // Below the horizon the dome sits behind the ground disc anyway;
          // keep it dark so transparent-ground mode still reads as night.
          col = mix(col, mix(nightHor, dayHor, uDayF) * 0.3, 1.0 - smoothstep(-0.35, 0.0, d.y));
          // Twilight glow around the Sun's azimuth, hugging the horizon.
          vec2 dH = d.xz + vec2(1e-6, 0.0);
          vec2 sH = uSunDir.xz + vec2(1e-6, 0.0);
          float sunAmt = pow(max(dot(normalize(dH), normalize(sH)), 0.0), 3.0);
          float band = exp(-abs(d.y) * 5.0);
          col += vec3(1.0, 0.42, 0.13) * (uTwiF * sunAmt * band * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    domeMesh = new THREE.Mesh(geo, mat);
    domeMesh.renderOrder = -10;
    domeMesh.frustumCulled = false;
    domeMesh.visible = false;
    scene.add(domeMesh);
  }

  // Scale a list of objects' material opacities by f, remembering each
  // material's base opacity on first touch (materials are rebuilt on every
  // refresh, so the cache is always fresh; the toggle path reuses it).
  function dimMats(objs, f) {
    for (const o of objs) {
      if (!o || !o.material) continue;
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) {
        if (m.userData.baseOp === undefined) m.userData.baseOp = m.opacity;
        m.opacity = m.userData.baseOp * f;
      }
    }
  }

  function applyDaylight() {
    if (!ready) return;
    const on = opts.daylight && viewMode === 'observer' && cur;
    let f = null, sunDir = null;
    if (on) {
      const sunEq = SD.eclToEq(SD.norm360(cur.sunLon), 0, cur.eps);
      const sunH = SD.eqToHoriz(sunEq.ra, sunEq.dec, cur.lst, cur.lat);
      cur.sunAlt = sunH.alt;
      f = SD.daylightFactors(sunH.alt);
      sunDir = eqToViewV(sunEq.ra, sunEq.dec, 1).normalize();
    } else if (cur) {
      cur.sunAlt = null;
    }
    if (domeMesh) {
      domeMesh.visible = !!on;
      if (on) {
        domeMesh.material.uniforms.uSunDir.value.copy(sunDir);
        domeMesh.material.uniforms.uDayF.value = f.dayF;
        domeMesh.material.uniforms.uTwiF.value = f.twiF;
        domeMesh.material.uniforms.uHighF.value = f.highF;
      }
    }
    const F = f || { dayF: 0, highF: 0, twiF: 0, starF: 1, bodyF: 1, lineF: 1 };
    if (starMat) starMat.uniforms.uDim.value = F.starF;
    dimMats(groups.starLabels.children, F.starF);
    for (const g of bodies) dimMats([g.userData.glyph, g.userData.label], F.bodyF);
    for (const k of Object.keys(angleMarkers)) dimMats([angleMarkers[k]], F.bodyF);
    const skip = new Set(['bodies', 'bodyLabels', 'stars', 'starLabels', 'ground', 'groundTransparent']);
    for (const [k] of OVERLAY_DEFS) {
      if (skip.has(k)) continue;
      dimMats(groups[k].children, F.lineF);
    }
    if (groundMesh) {
      groundMesh.material.color.setHex(GROUND_NIGHT).lerp(dayScratch.setHex(GROUND_DAY), F.dayF);
    }
  }

  function buildCardinals() {
    const defs = [['N', 0, '#ff7b72'], ['E', 90, '#e6edf3'], ['S', 180, '#e6edf3'], ['W', 270, '#e6edf3']];
    for (const [t, az, color] of defs) {
      const sp = makeLabel(t, { size: 44, color, worldH: 15 });
      sp.userData.cardinal = true;
      sp.userData.h = { az, alt: 1.5 };
      groups.cardinals.add(sp);
    }
    const z = makeLabel('Z', { size: 40, color: '#8a9fc2', worldH: 13 });
    z.userData.h = { az: 0, alt: 90 };
    groups.cardinals.add(z);
  }

  function layoutCardinals() {
    for (const sp of groups.cardinals.children) {
      if (sp.userData.h) sp.position.copy(horToViewV(sp.userData.h.az, sp.userData.h.alt));
    }
  }

  // ------------------------------------------------------------------ overlays

  function rebuildOverlays(jd, eps, lst, lat, out) {
    const ayan = SD.lahiriAyanamsa(jd);

    // Ecliptic
    if (opts.ecliptic) {
      const g = groups.ecliptic; clearGroup(g);
      g.add(circleLine(
        arcPts(t => { const e = SD.eclToEq(t, 0, eps); return eqToViewV(e.ra, e.dec); }, 0, 360, 180),
        0xe3b341, 0.5));
    }
    // Moon's orbit: mean 5.14° inclination to the ecliptic, ascending node at
    // the true node. It crosses the ecliptic exactly at the two node points,
    // which is the whole geometry of eclipses: they can only happen when the
    // Moon is near a node.
    if (opts.moonOrbit) {
      const g = groups.moonOrbit; clearGroup(g);
      const nodeLon = SD.norm360(out[10 * 6]);
      const pt = u => {
        const e = SD.moonOrbitPoint(u, nodeLon);
        const eq = SD.eclToEq(e.lon, e.lat, eps);
        return eqToViewV(eq.ra, eq.dec);
      };
      g.add(circleLine(arcPts(pt, 0, 360, 180), 0x8fd0c2, 0.55));
      const lbl = makeLabel("Moon's orbit", { size: 30, color: '#8fd0c2', worldH: 11 });
      lbl.position.copy(pt(90)); // northernmost point, off the ecliptic
      g.add(lbl);
    }
    // Celestial equator
    if (opts.equator) {
      const g = groups.equator; clearGroup(g);
      g.add(circleLine(
        arcPts(t => radecToViewV(t, 0, jd), 0, 360, 180),
        0x79c0ff, 0.5));
    }
    // Meridian (az 0/180 through zenith) — horizon frame: skipped in sphere view
    if (opts.meridian && viewMode !== 'sphere') {
      const g = groups.meridian; clearGroup(g);
      const pts = [];
      for (let a = -90; a <= 90; a += 2) pts.push(horToViewV(180, a));
      for (let a = 90; a >= -90; a -= 2) pts.push(horToViewV(0, a));
      g.add(circleLine(pts, 0x8a9fc2, 0.4));
    }
    // Horizon — horizon frame: skipped in sphere view
    if (opts.horizon && viewMode !== 'sphere') {
      const g = groups.horizon; clearGroup(g);
      g.add(circleLine(arcPts(t => horToViewV(t, 0), 0, 360, 180), 0x3a4a6b, 0.8));
    }
    // Prime vertical (az 90/270) — horizon frame: skipped in sphere view
    if (opts.primeVertical && viewMode !== 'sphere') {
      const g = groups.primeVertical; clearGroup(g);
      const pts = [];
      for (let a = -90; a <= 90; a += 2) pts.push(horToViewV(90, a));
      for (let a = 90; a >= -90; a -= 2) pts.push(horToViewV(270, a));
      g.add(circleLine(pts, 0x8a9fc2, 0.3, true));
    }
    // Galactic equator (J2000 -> precess -> view)
    if (opts.galactic) {
      const g = groups.galactic; clearGroup(g);
      g.add(circleLine(
        arcPts(t => {
          const e = SD.galacticToEq(t, 0);
          const p = SD.precess(e.ra, e.dec, SD.J2000, jd);
          return eqToViewV(p.ra, p.dec);
        }, 0, 360, 180),
        0xa371f7, 0.45, true));
      const lbl = makeLabel('galactic equator', { size: 30, color: '#a371f7', worldH: 11 });
      const e0 = SD.galacticToEq(200, 0);
      const p0 = SD.precess(e0.ra, e0.dec, SD.J2000, jd);
      lbl.position.copy(eqToViewV(p0.ra, p0.dec));
      g.add(lbl);
    }
    // RA/Dec graticule
    if (opts.graticule) {
      const g = groups.graticule; clearGroup(g);
      const seg = [];
      for (let ra = 0; ra < 360; ra += 30)
        for (let d = -75; d < 75; d += 5) {
          seg.push(radecToViewV(ra, d, jd), radecToViewV(ra, d + 5, jd));
        }
      for (let d = -60; d <= 60; d += 30)
        for (let ra = 0; ra < 360; ra += 6) {
          seg.push(radecToViewV(ra, d, jd), radecToViewV(ra + 6, d, jd));
        }
      const geo = new THREE.BufferGeometry().setFromPoints(seg);
      g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x2a3a55, transparent: true, opacity: 0.35 })));
    }
    // Poles: celestial axis + ecliptic axis
    if (opts.poles) {
      const g = groups.poles; clearGroup(g);
      const ncp = radecToViewV(0, 90, jd);
      g.add(circleLine([ncp.clone().multiplyScalar(-1.15), ncp.clone().multiplyScalar(1.15)], 0x79c0ff, 0.5, true));
      const nl = makeLabel('NCP', { size: 30, color: '#79c0ff', worldH: 11 });
      nl.position.copy(ncp.clone().multiplyScalar(1.18)); g.add(nl);
      const ep = SD.eclToEq(0, 90, eps);
      const ev = eqToViewV(ep.ra, ep.dec);
      g.add(circleLine([ev.clone().multiplyScalar(-1.15), ev.clone().multiplyScalar(1.15)], 0xe3b341, 0.5, true));
      const el = makeLabel('ecliptic N pole', { size: 30, color: '#e3b341', worldH: 11 });
      el.position.copy(ev.clone().multiplyScalar(1.18)); g.add(el);
    }
    // Zodiac ring (tropical, on the ecliptic)
    if (opts.zodiac) {
      rebuildRing(groups.zodiac, SD.SIGNS.map((s, i) => ({
        a0: i * 30, a1: i * 30 + 30, label: s.glyph, color: elementColor(s.element),
        toEq: lon => SD.eclToEq(lon, 0, eps),
        ll: (lon, b) => SD.eclToEq(lon, b, eps),
        radius: R,
      })));
      // Degree ticks like a number line on the ring: minor each 1°, longer
      // at 5°/10°, longest at sign boundaries. They straddle the ring and
      // hug the sphere surface (ecliptic-latitude direction), so they read
      // at ground level and in sphere view alike.
      const tp = [];
      for (let d = 0; d < 360; d++) {
        const half = d % 30 === 0 ? 1.4 : d % 10 === 0 ? 1.1 : d % 5 === 0 ? 0.8 : 0.5;
        const e1 = SD.eclToEq(d, -half, eps), e2 = SD.eclToEq(d, half, eps);
        const v1 = eqToViewV(e1.ra, e1.dec, R), v2 = eqToViewV(e2.ra, e2.dec, R);
        tp.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      groups.zodiac.add(new THREE.LineSegments(tg,
        new THREE.LineBasicMaterial({ color: 0x6e7681, transparent: true, opacity: 0.55 })));
    } else clearGroup(groups.zodiac);
    // Nakshatra ring (sidereal: tropical shift by ayanamsa)
    if (opts.nakshatra) {
      const spans = SD.nakshatraSpans(ayan);
      const items = spans.map((sp, i) => ({
        a0: sp.start, a1: sp.end, label: SD.NAKSHATRAS[i].name, color: '#9fe870',
        toEq: lon => SD.eclToEq(lon, 0, eps),
        ll: (lon, b) => SD.eclToEq(lon, b, eps),
        radius: R * 1.022, labelH: 9,
      }));
      rebuildRing(groups.nakshatra, items);
    } else clearGroup(groups.nakshatra);
    // Chinese mansions (equatorial RA bands)
    if (opts.xiu) {
      const raByBayer = new Map();
      for (const s of stars) {
        const a = SD.starApparent(s, jd);
        raByBayer.set(s.bayer.toLowerCase(), a.ra);
      }
      const spans = SD.xiuSpans(raByBayer);
      const items = spans.map(sp => ({
        a0: sp.startRA, a1: sp.endRA, label: sp.name, color: '#ff9d5c',
        toEq: ra => ({ ra, dec: 0 }),
        ll: (raC, d) => ({ ra: raC, dec: d }),
        radius: R * 1.022, labelH: 13,
      }));
      rebuildRing(groups.xiu, items);
    } else clearGroup(groups.xiu);
    // Whole-sign houses from the Ascendant
    if (opts.houses && out) {
      const g = groups.houses; clearGroup(g);
      const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
      const items = SD.houseCusps(out[72]).map((lon0, i) => ({
        a0: lon0, a1: lon0 + 30, label: romans[i], color: '#8a9fc2',
        toEq: lon => SD.eclToEq(lon % 360, 0, eps),
        radius: R * 0.985, labelH: 9,
      }));
      rebuildRing(g, items);
    } else if (!opts.houses) clearGroup(groups.houses);
    // House & sign spokes: the 2D chart's radial division lines projected
    // onto the celestial sphere as meridians through the ecliptic poles.
    if (opts.spokes && out) {
      const g = groups.spokes; clearGroup(g);
      const spoke = (lon, color, opacity, dashed) => {
        const pts = arcPts(b => {
          const e = SD.eclToEq(lon, b, eps);
          return eqToViewV(e.ra, e.dec);
        }, -89, 89, 90);
        g.add(circleLine(pts, color, opacity, dashed));
      };
      for (const lon of SD.signCusps()) spoke(lon, 0x3a4a6b, 0.35, true);
      for (const lon of SD.houseCusps(out[72])) spoke(lon, 0x8a9fc2, 0.5, false);
    } else if (!opts.spokes) clearGroup(groups.spokes);
  }

  function radecToViewV(ra, dec, jd, r = R) {
    const p = SD.precess(ra, dec, SD.J2000, jd);
    return eqToViewV(p.ra, p.dec, r);
  }

  function elementColor(el) {
    return { fire: '#ff7b72', earth: '#e3b341', air: '#79c0ff', water: '#a371f7' }[el] || '#e6edf3';
  }

  // Semi-transparent fill for one ring slice: the spherical lune between the
  // two boundary meridians of the slice (through the ecliptic poles for
  // zodiac/nakshatras, through the celestial poles for xiu), built from the
  // item's ll(coord, lat) mapping. Alternating opacity keeps same-coloured
  // neighbours (nakshatras, mansions) distinguishable.
  function sliceFillMesh(it, idx) {
    const lonSteps = Math.max(4, Math.round(Math.abs(it.a1 - it.a0) / 3));
    const latSteps = 12, r0 = it.radius * 0.999;
    const posArr = [];
    const pt = (c, b) => { const e = it.ll(c, b); return eqToViewV(e.ra, e.dec, r0); };
    for (let i = 0; i < lonSteps; i++) {
      const c0 = it.a0 + (it.a1 - it.a0) * (i / lonSteps);
      const c1 = it.a0 + (it.a1 - it.a0) * ((i + 1) / lonSteps);
      for (let j = 0; j < latSteps; j++) {
        const b0 = -90 + 180 * (j / latSteps), b1 = -90 + 180 * ((j + 1) / latSteps);
        const v00 = pt(c0, b0), v10 = pt(c1, b0), v01 = pt(c0, b1), v11 = pt(c1, b1);
        posArr.push(
          v00.x, v00.y, v00.z, v10.x, v10.y, v10.z, v11.x, v11.y, v11.z,
          v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v01.x, v01.y, v01.z);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    return new THREE.Mesh(geo, pooledFillMaterial(it.color, idx % 2 ? 0.055 : 0.12));
  }

  // Generic ring builder: arcs + centred labels, pooled per group.
  function rebuildRing(group, items) {
    clearGroup(group);
    const poolKey = group === groups.zodiac ? 'zodiac'
      : group === groups.nakshatra ? 'nakshatra'
      : group === groups.xiu ? 'xiu' : 'houses';
    ringLabels[poolKey] = [];
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const pts = arcPts(t => {
        const e = it.toEq(t);
        return eqToViewV(e.ra, e.dec, it.radius);
      }, it.a0, it.a1, Math.max(8, Math.round((it.a1 - it.a0) / 2)));
      group.add(circleLine(pts, new THREE.Color(it.color), 0.4));
      const fillKey = { zodiac: 'zodiacFill', nakshatra: 'nakshatraFill', xiu: 'xiuFill' }[poolKey];
      if (fillKey && opts[fillKey] && it.ll) group.add(sliceFillMesh(it, idx));
      const mid = it.toEq((it.a0 + it.a1) / 2);
      const sp = makeLabel(it.label, {
        size: 44, color: it.color, worldH: it.labelH || 14, glyph: poolKey === 'zodiac',
      });
      sp.position.copy(eqToViewV(mid.ra, mid.dec, it.radius));
      group.add(sp);
      ringLabels[poolKey].push(sp);
    }
  }

  // ------------------------------------------------------------------ refresh

  function refresh() {
    if (!ready) return;
    const eph = getEphemeris();
    if (!eph || !eph.out) return;
    const { out, inp, utcMs } = eph;
    const jd = utcMs / 86400000 + 2440587.5;
    const eps = SD.meanObliquity(jd);
    const lst = SD.lstDeg(jd, inp.lon);
    cur = { jd, eps, lst, lat: inp.lat, sunLon: out[0], out };

    // Stars: proper motion + precession -> view frame. In sphere view the
    // stars sit in the sidereal frame: their apparent places move by
    // arcseconds per day, invisible between close epochs, so the recompute
    // is gated to half-day buckets. Observer view rotates with LST and
    // always recomputes.
    const sphere = viewMode === 'sphere';
    const starKey = sphere ? 's' + Math.round(jd / 0.5) : 'o';
    if (starKey !== lastStarKey) {
      lastStarKey = starKey;
      const pos = starGeo.attributes.position.array;
      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        const a = SD.starApparent(s, jd);
        let x, y, z;
        if (sphere) [x, y, z] = SD.eqToVec(a.ra, a.dec, R);
        else { const h = SD.eqToHoriz(a.ra, a.dec, lst, inp.lat); [x, y, z] = SD.horizToVec(h.az, h.alt, R); }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      }
      starGeo.attributes.position.needsUpdate = true;
      for (const sp of groups.starLabels.children) {
        const s = sp.userData.star;
        const idx = stars.indexOf(s);
        // Offset above the star, scaled so the label clears its own
        // half-height at arbitrary text sizes (8 at the 1x default).
        sp.position.set(pos[idx * 3], pos[idx * 3 + 1] + 8 * textScale, pos[idx * 3 + 2]);
      }
    }

    updateBodies(out, jd, eps, lst, inp.lat);
    if (lockBodyId != null) {
      const g = bodies.find(b => b.userData.def.id === lockBodyId);
      if (g) { trailColor.set(g.userData.def.color); pushTrailPoint(g.position); }
    }
    // Overlays are rebuilt from scratch (geometries + label sprites), so
    // rebuild only when the frame has moved enough to see: a 0.02-degree
    // quantum on LST/node longitude (~0.35 world units at the rim, about
    // a pixel), or when options, view mode, scales, or latitude change.
    // At a 1 Hz clock that's one rebuild per ~5 s instead of every tick.
    // During sustained playback (refreshes many times a second — animation
    // or a fast skip), the quantum widens 10x: the overlay content is
    // quasi-static in sphere view and a half-day of lag is invisible, so
    // rebuilds stop landing on nearly every frame.
    const nowR = performance.now();
    const playing = lastRefreshMs && (nowR - lastRefreshMs) < 150;
    lastRefreshMs = nowR;
    const q = (v, step) => Math.round(v / step);
    const jdQ = playing ? 0.5 : 0.05;
    const overlaySig = [q(lst, playing ? 0.1 : 0.02), q(jd, jdQ), q(inp.lat, 0.01),
      q(SD.norm360(out[10 * 6]), 0.02), viewMode, textScale, glyphScale,
      JSON.stringify(opts)].join('|');
    if (overlaySig !== lastOverlaySig) {
      lastOverlaySig = overlaySig;
      rebuildOverlays(jd, eps, lst, inp.lat, out);
    }
    layoutCardinals();
    applyOpts();
    applyDaylight();
    markDirty();

    // First show: aim at the Sun when it is up, else keep the default
    // southerly view. Never re-aims afterwards (clock/skips must not yank
    // a view the user has positioned). Observer view only. A camera lock
    // takes precedence: it re-aims at its body on every refresh.
    if (lockBodyId != null) {
      applyLockAim();
      applyCam();
    } else if (!aimed && viewMode === 'observer') {
      aimed = true;
      const sunEq = SD.eclToEq(SD.norm360(out[0]), 0, eps);
      const sunH = SD.eqToHoriz(sunEq.ra, sunEq.dec, lst, inp.lat);
      if (sunH.alt > 2) {
        yaw = sunH.az * SD.DEG2RAD;
        pitch = Math.max(0.12, sunH.alt * SD.DEG2RAD);
        applyCam();
      }
    }

    const d = new Date(utcMs);
    const hh = String(d.getUTCHours()).padStart(2, '0'),
          mi = String(d.getUTCMinutes()).padStart(2, '0'),
          ss = String(d.getUTCSeconds()).padStart(2, '0');
    const lockDefNow = lockDef();
    readoutEl.innerHTML =
      `<b>UTC ${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${hh}:${mi}:${ss}</b>`
      + ` · LST ${lst.toFixed(2)}° · ${Math.abs(inp.lat).toFixed(2)}°${inp.lat >= 0 ? 'N' : 'S'} ${Math.abs(inp.lon).toFixed(2)}°${inp.lon >= 0 ? 'E' : 'W'}`
      + (cur.sunAlt != null ? ` · Sun ${cur.sunAlt >= 0 ? '+' : ''}${cur.sunAlt.toFixed(1)}°` : '')
      + ` · ayanāṃśa ${SD.lahiriAyanamsa(jd).toFixed(2)}°`
      + (viewMode === 'sphere' ? ' · sphere view' : '')
      + (lockDefNow ? ` · tracking ${lockDefNow.name}` : '');
  }

  // ------------------------------------------------------------------ hover

  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  function fmtRA(raDeg) {
    const h = raDeg / 15, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m`;
  }
  function fmtDec(decDeg) {
    const s = decDeg < 0 ? '−' : '+', a = Math.abs(decDeg);
    return `${s}${String(Math.floor(a)).padStart(2, '0')}°${String(Math.floor((a % 1) * 60)).padStart(2, '0')}′`;
  }

  function doHover() {
    if (!mouse || !ready || !visible) { hideTip(); return; }
    raycaster.obj.setFromCamera({ x: mouse.x, y: mouse.y }, camera);
    // Bodies first (sprites are easy targets).
    const bodyTargets = [];
    for (const g of bodies) bodyTargets.push(g.children[0]);
    for (const k of Object.keys(angleMarkers)) bodyTargets.push(angleMarkers[k]);
    const hitB = raycaster.obj.intersectObjects(bodyTargets, false)[0];
    if (hitB) {
      const o = hitB.object;
      const u = o.userData.kind ? o.userData : o.parent.userData;
      showTip(mouse.cx, mouse.cy, bodyTipHTML(u));
      return;
    }
    const pts = groups.stars.userData.points;
    const hitS = pts ? raycaster.obj.intersectObject(pts, false)[0] : null;
    if (hitS && hitS.index !== undefined) {
      const s = starIndex[hitS.index];
      showTip(mouse.cx, mouse.cy, starTipHTML(s));
      return;
    }
    hideTip();
  }

  function bodyTipHTML(u) {
    if (u.kind === 'angle') {
      return `<b>${u.name}</b><br><span class="dim">${signOf(u.lon)} · alt ${u.alt.toFixed(1)}°</span>`;
    }
    const { def } = u;
    const retro = u.speed < 0 ? ' <span class="dim">℞</span>' : '';
    return `<b><span style="color:${def.color}">${def.glyph}</span> ${def.name}</b>${retro}<br>`
      + `<span class="dim">${signOf(u.lon)}${u.house ? ` · house ${u.house}` : ''}<br>`
      + `alt ${u.alt >= 0 ? '+' : ''}${u.alt.toFixed(1)}° · az ${u.az.toFixed(1)}°</span>`;
  }

  function starTipHTML(s) {
    const lore = SD.loreForStar(s);
    const aka = s.altNames.length ? `<br><span class="dim">aka ${s.altNames.join(', ')}</span>` : '';
    const loreHtml = lore
      ? `<br><span class="trad">${lore.traditions.join(' · ')}</span><br>${lore.text}`
      : '';
    return `<b>${s.name}</b> <span class="dim">${s.bayer} · mag ${s.mag.toFixed(2)}</span>${aka}<br>`
      + `<span class="dim">RA ${fmtRA(s.ra0)} Dec ${fmtDec(s.dec0)} (J2000)</span>${loreHtml}`;
  }

  function showTip(x, y, html) {
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    const wr = wrapEl.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    tipEl.style.left = Math.min(wr.width - tw - 8, x + 14) + 'px';
    tipEl.style.top = Math.max(8, y - th - 10) + 'px';
  }

  // ------------------------------------------------------------------ main loop

  let lastRenderMs = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!visible) return;
      if (hoverDirty) { hoverDirty = false; doHover(); }
      if (dirty) {
        // Honour the Max FPS cap: keep the dirty flag and let the next
        // eligible frame rasterize.
        const now = performance.now();
        if (!maxFps || now - lastRenderMs >= 1000 / maxFps) {
          dirty = false;
          lastRenderMs = now;
          renderer.render(scene, camera);
          // Bodies may have moved under a stationary pointer on a refresh:
          // re-pick once so the tooltip never goes stale.
          if (mouse) doHover();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ public API

  function onEphemeris() {
    if (!ready || !visible) return;
    refresh();
  }

  function setVisible(v) {
    visible = v;
    if (!ready) return;
    if (v) { refresh(); loop(); }
    else { cancelAnimationFrame(raf); hideTip(); }
  }

  return { ensureInit, onEphemeris, setVisible, setViewMode, setCameraLock,
           getViewState, get ready() { return ready; }, get failed() { return failed; },
           get lockBodyId() { return lockBodyId; } };

  function getViewState() {
    return { viewMode, groundTransparent: !!opts.groundTransparent, spokes: !!opts.spokes };
  }
}
