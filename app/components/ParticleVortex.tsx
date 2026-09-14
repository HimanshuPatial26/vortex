"use client";

/* ParticleVortex — the abstract particle sculpture from the hero reference,
   rebuilt as a live WebGL scene. Same `ogl` renderer and lifecycle conventions
   as GradientWaves (ResizeObserver sizing, IntersectionObserver + page
   visibility gating, pointer parallax, explicit context teardown).

   The sculpture is one GPU-resident lattice of points. Every particle is
   addressed by its index → (column, row) on a cylindrical grid, wrapped onto
   an hourglass profile: a wide funnel mouth at the top, a waist in the middle,
   and a dispersing dust cloud at the base. Because the lattice stays regular,
   the dense upper rings self-moire into the veil of the reference while the
   sparser waist reads as a warped grid surface. Nothing is simulated on the
   CPU — the vertex shader derives position, size and brightness from the index
   alone, so 100k+ points cost one draw call.

   Around it sit five concentric hairline prisms sharing the particle camera,
   so the vitrine keeps perspective with the sculpture as the pointer moves. */

import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Program, Mesh, Geometry } from "ogl";
import { SIMPLEX_3D } from "../lib/noise";

const hexToRgb = (hex: string): [number, number, number] => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return [1, 1, 1];
  return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255];
};

/** How long the click pulse ring takes to travel out and fade, in ms. */
const PULSE_MS = 1176;

const densityToCount = (d: "low" | "medium" | "high") =>
  d === "low" ? 48000 : d === "high" ? 180000 : 110000;

/* ── Shared GLSL ─────────────────────────────────────────────────────────── */

/* Drives the turbulence that crumples the lattice into cloth at the waist and
   dust at the base. Shared with the mountain, which builds its terrain on it. */
const NOISE = SIMPLEX_3D;

/* Screen-space pointer forces, shared by the points and the vitrine so both
   react to the same cursor. Returns an NDC offset. */
const POINTER = `
vec2 pointerOffset(vec2 ndc, float depthScale, out float heat) {
  vec2 d = ndc - uMouse;
  d.x *= uAspect;
  float r = length(d);
  heat = 0.0;

  vec2 off = vec2(0.0);

  // Steady repulsion — the cursor parts the curtain as it travels.
  float push = exp(-(r * r) / max(uRepelRadius * uRepelRadius, 1e-4)) * uRepel * uPointerIn;
  off += (r > 1e-4 ? d / r : vec2(0.0)) * push * depthScale;
  heat += push * 9.0;

  // Click pulse — a ring that expands, displaces and brightens as it passes.
  if (uPulse > 0.001) {
    float ringR = (1.0 - uPulse) * 1.5;
    float band = exp(-pow((r - ringR) / 0.13, 2.0));
    float amp = band * uPulse * 0.34;
    off += (r > 1e-4 ? d / r : vec2(0.0)) * amp * depthScale;
    heat += band * uPulse * 2.6;
  }
  return off;
}

/* Splash — the whole field bursts outward from the click and reconverges,
   covering the screen while the page scrolls to the next section. Kept
   separate from pointerOffset because it needs per-particle scatter, which
   the vitrine (a fixed cage) must not have. */
vec2 splashOffset(vec2 ndc, vec3 seed, float depthScale, out float heat) {
  heat = 0.0;
  if (uSplash <= 0.001) return vec2(0.0);

  float p = 1.0 - uSplash;              // 0 at impact, 1 when settled
  vec2 d = ndc - uSplashOrigin;
  d.x *= uAspect;
  float r = length(d);

  // Radially outward, jittered per particle so the burst scatters like spray
  // instead of expanding as one clean disc.
  vec2 n = r > 1e-4 ? d / r : vec2(cos(seed.x * 6.2832), sin(seed.x * 6.2832));
  float ang = (seed.y - 0.5) * 1.2;
  n = vec2(n.x * cos(ang) - n.y * sin(ang), n.x * sin(ang) + n.y * cos(ang));

  // The front travels outward from the impact, so near particles leave first
  // and the far edge of the screen answers a beat later.
  float lead = smoothstep(0.0, 0.42, p - r * 0.2);
  // Out and back: sin peaks mid-flight and returns the field to rest at p = 1.
  float wave = sin(clamp(lead, 0.0, 1.0) * 3.14159);
  float speed = mix(0.75, 2.6, seed.z);

  heat = wave * 2.0;
  return n * wave * speed * uSplashStrength * depthScale;
}
`;

/* ── Particle sculpture ──────────────────────────────────────────────────── */

const pointVertex = `#version 300 es
precision highp float;

in float aIndex;
in vec3 aRand;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uCols;
uniform float uRows;
uniform float uFlow;
uniform float uSpin;
uniform float uTwist;
uniform float uHeight;
uniform float uWaist;
uniform float uFlare;
uniform float uSpread;
uniform float uTurbulence;
uniform float uNoiseScale;
uniform float uSize;
uniform float uDpr;
uniform float uBrightness;
uniform float uCamDist;
uniform vec2 uMouse;
uniform float uAspect;
uniform float uRepel;
uniform float uRepelRadius;
uniform float uPointerIn;
uniform float uPulse;
uniform float uSplash;
uniform vec2 uSplashOrigin;
uniform float uSplashStrength;
uniform float uMorph;
uniform float uTerrainRadius;
uniform float uTerrainAmp;
uniform float uTerrainScale;
uniform float uTerrainDrop;
uniform float uDuneWidth;
uniform float uDuneDepth;
uniform float uDuneNear;
uniform float uDuneAmp;
uniform float uDuneDrop;
uniform float uDuneFlow;
uniform float uDuneFocus;

out float vAlpha;
out float vHeat;
out float vDepth;
out float vSeed;
out float vPrism;
out float vHue;
out float vLit;

${NOISE}
${POINTER}

const float TAU = 6.28318530718;

/* Dune height field. Two travelling octaves; the coarse one carries the rolling
   swell, the fine one the ripple on its flanks. Sampled more than once per
   vertex — the crest highlight needs the surface slope, which means
   neighbouring heights. */
float duneHeight(vec2 p, float time) {
  float h = snoise(vec3(p * 0.16, time * 0.22));
  h += snoise(vec3(p * 0.42 + 31.7, time * 0.31)) * 0.38;
  return h;
}

void main() {
  // Morph runs 0 (vortex) -> 1 (terrain) -> 2 (dunes); each stage blends on its
  // own 0..1 slice so the curves keyed to earlier forms do not extrapolate.
  float m1 = clamp(uMorph, 0.0, 1.0);
  float m2 = clamp(uMorph - 1.0, 0.0, 1.0);
  float col = mod(aIndex, uCols);
  float row = floor(aIndex / uCols);

  float a = col / uCols;
  // Rows stream downward and wrap; the lattice is periodic so the loop is seamless.
  float t = fract(row / uRows - uTime * uFlow);
  // Bias toward the mouth, whose surface area is several times the waist's —
  // an even split would leave the veil thin where it should be densest.
  float v = pow(t, 0.74);

  // Hourglass profile: flared mouth above the waist, a slower bloom below it
  // that lets the base shed particles into dust.
  float d = v - uWaist;
  float above = max(d, 0.0);
  float below = max(-d, 0.0);
  float radius = uSpread
    + pow(above / max(1.0 - uWaist, 1e-3), 2.3) * uFlare
    + pow(below / max(uWaist, 1e-3), 2.0) * uFlare * 0.42;

  // Differential rotation. Each strand wraps several turns between the waist
  // and the mouth, so neighbouring strands cross and moire into the veil
  // instead of stacking as separate rings.
  float theta = a * TAU + uTwist * pow(above, 1.4) + uTime * uSpin * (0.45 + v * 0.9);

  // Drapery. A slow fold field wrapped around the profile pushes the wall in
  // and out, so the funnel hangs like cloth instead of ruling a clean cone.
  float fold = snoise(vec3(cos(theta) * 1.6, v * 4.2, sin(theta) * 1.6)
                      + vec3(0.0, uTime * 0.16, 0.0));
  radius *= 1.0 + fold * 0.17 * smoothstep(uWaist - 0.05, 1.0, v);

  vec3 pos = vec3(cos(theta) * radius, (v - 0.5) * uHeight, sin(theta) * radius);

  // Turbulence: near zero through the smooth funnel, peaking at the waist where
  // the lattice folds into cloth, and highest at the base where it disperses.
  float band = exp(-pow((v - (uWaist - 0.06)) / 0.27, 2.0));
  float amp = 0.1 + band * 1.85 + pow(max(uWaist - v, 0.0) / max(uWaist, 1e-3), 1.4) * 1.5;

  vec3 np = pos * uNoiseScale + vec3(0.0, uTime * 0.12, uTime * 0.05);
  vec3 disp = vec3(
    snoise(np),
    snoise(np + vec3(31.4, 0.0, 11.7)) * 0.5,
    snoise(np + vec3(0.0, 57.2, 23.1))
  );
  // Lateral displacement dominates: the waist billows sideways out past the
  // vitrine as a folded sheet rather than swelling into a fat tube.
  pos += disp * vec3(2.6, 0.62, 2.6) * uTurbulence * amp;

  // A finer octave rides on top, breaking the lattice into filaments so the
  // funnel wall shimmers instead of reading as clean geometry.
  vec3 fine = vec3(
    snoise(np * 3.1 + vec3(7.3, 0.0, 0.0)),
    snoise(np * 3.1 + vec3(0.0, 13.9, 0.0)),
    snoise(np * 3.1 + vec3(0.0, 0.0, 19.4))
  );
  pos += fine * uTurbulence * (0.08 + amp * 0.16);

  // Dust: a slice of the base particles is thrown further out, breaking the
  // lattice into the speckle that trails off the bottom of the sculpture.
  float dust = smoothstep(0.38, 0.0, v) * step(0.22, aRand.z);
  pos += (aRand - 0.5) * dust * vec3(2.4, 1.7, 2.4);
  pos.y -= dust * aRand.y * 0.8;

  /* ── Terrain, the form the field collects into ──────────────────────────
     A polar grid, with the lattice's two axes swapped relative to the vortex:
     the long axis (samples along a strand) wraps the circle, so each ring is
     drawn by hundreds of points and reads as a continuous contour band, and
     the short axis (strand index) steps outward as concentric rings. Mapping
     it the other way round gives only ~220 points per ring, which scatters
     into noise instead of banding. */
  if (m1 > 0.001) {
    float rn = 0.06 + a * 0.94;
    float trad = rn * uTerrainRadius;
    float tth = t * TAU + uTime * uSpin * 0.1;
    vec2 tp = vec2(cos(tth), sin(tth)) * trad;

    // Ridged fbm: inverting |noise| turns smooth hills into sharp crests.
    // Three broad octaves, not four narrow ones — more of them shatters the
    // range into a field of spikes.
    float h = 0.0;
    float ampf = 1.0;
    float frq = uTerrainScale;
    for (int i = 0; i < 3; i++) {
      float n = snoise(vec3(tp * frq, uTime * 0.04 + float(i) * 7.3));
      h += (1.0 - abs(n)) * ampf;
      ampf *= 0.42;
      frq *= 2.1;
    }
    h = (h - 1.0) * uTerrainAmp;

    // A hollow at the centre for the ring to sit in, and a fade at the rim so
    // the far edge dissolves into scattered points instead of cutting off.
    h *= smoothstep(0.06, 0.24, rn) * (1.0 - smoothstep(0.76, 1.0, rn));

    vec3 terrain = vec3(tp.x, h - uTerrainDrop, tp.y);

    // Ease the swap so particles accelerate out of the vortex and settle into
    // the landscape rather than sliding between the two at constant speed.
    float m = m1 * m1 * (3.0 - 2.0 * m1);
    pos = mix(pos, terrain, m);
  }

  /* ── Dunes, the third form ─────────────────────────────────────────────
     A wide plane read from just above its own surface. The lattice axes swap
     again: the long axis runs across the frame, the short one away from the
     camera, where perspective compresses it back to a dense field. Each point
     is jittered inside its own cell, which turns the regular lattice into a
     stratified random scatter — a visible grid is the one thing this form
     cannot have. */
  float vCrest = 0.0;
  if (m2 > 0.001) {
    vec2 cell = vec2(uDuneWidth / uRows, (uDuneDepth + uDuneNear) / uCols);
    vec2 dp = vec2(
      (t - 0.5) * uDuneWidth + (aRand.x - 0.5) * cell.x * 1.6,
      mix(uDuneNear, -uDuneDepth, a) + (aRand.y - 0.5) * cell.y * 1.6
    );
    // The swell travels toward the camera, so the field flows rather than
    // simply undulating in place.
    dp.y += uTime * uDuneFlow;

    float h = duneHeight(dp, uTime);

    // Slope from neighbouring samples. The bright line in the reference is the
    // crest catching the light, so brightness has to come from the surface
    // normal, not from height.
    float e = 0.6;
    float hx = duneHeight(dp + vec2(e, 0.0), uTime);
    float hz = duneHeight(dp + vec2(0.0, e), uTime);
    vec3 nrm = normalize(vec3((h - hx) / e, 1.0, (h - hz) / e) * vec3(uDuneAmp, 1.0, uDuneAmp));
    float lambert = clamp(dot(nrm, normalize(vec3(-0.3, 0.5, 0.81))), 0.0, 1.0);
    // Tightened hard: a linear falloff gives a broad sheen where the reference
    // has a filament.
    vCrest = pow(lambert, 3.2);

    vec3 dune = vec3(dp.x, h * uDuneAmp - uDuneDrop, dp.y);
    float md = m2 * m2 * (3.0 - 2.0 * m2);
    pos = mix(pos, dune, md);
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv;

  float heat;
  vec2 ndc = clip.xy / clip.w;
  // Nearer particles answer the cursor harder, so the field gains depth.
  float depthScale = clamp(6.0 / max(-mv.z, 0.5), 0.35, 1.6);
  ndc += pointerOffset(ndc, depthScale, heat);

  float splashHeat;
  ndc += splashOffset(ndc, aRand, depthScale, splashHeat);
  heat += splashHeat;

  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float dist = max(-mv.z, 0.1);
  // Fine at the mouth of the funnel, coarse through the waist.
  // Peaks at the waist (the readable dot grid) and thins toward the mouth,
  // which is what separates the veil from the cloth in the reference.
  float sizeCurve = mix(0.95, 1.5, band) * mix(1.0, 0.55, smoothstep(0.5, 1.0, v));
  // The terrain wants an even, finer grid — the vortex's profile weighting
  // would blotch it.
  sizeCurve = mix(sizeCurve, 0.82, m1);
  gl_PointSize = uSize * uDpr * sizeCurve * (0.62 + aRand.x * 0.8) * (uCamDist * 0.62 / dist);
  if (m2 > 0.001) gl_PointSize = mix(gl_PointSize, max(gl_PointSize, 1.5 * uDpr), m2);

  /* Depth of field, dunes only. The reference is shot with a shallow lens: a
     band in focus, everything nearer and further swelling into soft bokeh.
     Faked the cheap way — a point off the focal plane grows and dims, which is
     what a circle of confusion does to a point source. */
  float coc = 0.0;
  if (m2 > 0.001) {
    coc = clamp(abs(dist - uDuneFocus) / (uDuneFocus * 1.15), 0.0, 1.0) * m2;
    gl_PointSize *= 1.0 + coc * coc * 5.5;
  }
  gl_PointSize = clamp(gl_PointSize, 0.6, 26.0);

  // Depth fog plus a light dimming of the far wall, which keeps the front of
  // the column readable instead of washing into a solid mass.
  float fog = clamp((uCamDist + 6.0 - dist) / 10.0, 0.0, 1.0);
  float facing = mix(0.3, 1.0, smoothstep(uCamDist + 2.6, uCamDist - 3.0, dist));
  float veil = mix(mix(1.0, 1.65, smoothstep(uWaist, 0.95, v)), 1.15, m1);
  vAlpha = fog * facing * uBrightness * veil * (0.55 + aRand.y * 0.6) * (1.0 - dust * 0.3);

  if (m2 > 0.001) {
    // Crest lighting takes over from the vortex's depth shading: the form is a
    // lit surface now, not a cloud, so brightness should follow its slope.
    float duneAlpha = uBrightness * (0.42 + vCrest * 1.7) * (0.55 + aRand.y * 0.6);
    // Spreading the same energy over a larger sprite is what keeps defocused
    // points reading as soft blur rather than bright blobs.
    duneAlpha *= 1.0 - coc * 0.5;
    vAlpha = mix(vAlpha, duneAlpha, m2);
  }
  vLit = vCrest * m2;
  // Mid-splash the field is spread across the whole screen, far from where the
  // fog was calibrated, so lift it back toward full brightness as it flies.
  vAlpha = mix(vAlpha, max(vAlpha, uBrightness * 0.75), clamp(splashHeat * 0.5, 0.0, 1.0));
  vHeat = heat;
  vDepth = clamp(dist / 18.0, 0.0, 1.0);
  vSeed = aRand.z;

  /* Prismatic dispersion. Placed in screen space against the light rather than
     on the geometry, so it always sits on the flank the light leaves through
     however the column is turned. Suppressed as the field becomes terrain —
     that form reads monochrome. */
  vec2 sp = clip.xy / clip.w;
  // The dense lower body, weighted toward the flank the light leaves through.
  float lowerBody = 1.0 - smoothstep(0.38, 0.86, v);
  float litSide = smoothstep(-0.45, 0.4, sp.x);
  vPrism = lowerBody * mix(0.3, 1.0, litSide) * (1.0 - m1);
  /* Spatially coherent, or additive blending averages the region back to grey.
     Clamped rather than wrapped: fract puts a hard seam where pale meets blue,
     and the span below walks the whole ramp across the flank anyway — blue at
     the inner edge through violet and rose to gold at the rim. */
  vHue = clamp(sp.x * 1.15 + sp.y * 0.4 + 0.52, 0.0, 1.0);
}
`;

const pointFragment = `#version 300 es
precision highp float;

in float vAlpha;
in float vHeat;
in float vDepth;
in float vSeed;
in float vPrism;
in float vHue;
in float vLit;

uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;
uniform float uSpectrum;

out vec4 fragColor;

/* The dispersion ramp: deep blue through violet and rose into gold, closing on
   a pale wash. Hand-placed stops rather than a hue rotation — an even sweep
   through HSV puts far too much green in the middle. */
vec3 spectrum(float t) {
  const vec3 c0 = vec3(0.10, 0.28, 1.00);
  const vec3 c1 = vec3(0.45, 0.25, 1.00);
  const vec3 c2 = vec3(0.95, 0.40, 0.70);
  const vec3 c3 = vec3(1.00, 0.72, 0.25);
  const vec3 c4 = vec3(0.70, 0.88, 1.00);
  float x = clamp(t, 0.0, 1.0) * 4.0;
  if (x < 1.0) return mix(c0, c1, x);
  if (x < 2.0) return mix(c1, c2, x - 1.0);
  if (x < 3.0) return mix(c2, c3, x - 2.0);
  return mix(c3, c4, x - 3.0);
}

void main() {
  // Soft round sprite with a hot core — dense regions stack into the bright
  // crests that define the silhouette under additive blending.
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p);
  if (r > 0.5) discard;
  float mask = smoothstep(0.5, 0.06, r);
  mask *= mask;

  float prism = clamp(vPrism * uSpectrum * mix(0.25, 1.0, vSeed), 0.0, 1.0);

  // Faint cool fringe on the deep particles — but it is itself a blue tint, so
  // it stands down wherever the dispersion proper is doing the colouring.
  vec3 tint = mix(uColor, uAccent, smoothstep(0.45, 1.0, vDepth) * 0.35 * vSeed * (1.0 - prism));

  // Dispersion across the lit flank.
  tint = mix(tint, spectrum(vHue), prism);

  vec3 col = mix(tint, vec3(1.0), clamp(vHeat, 0.0, 1.0) * 0.8);
  // The crest line is the brightest thing in the dune reference; let it clip.
  col = mix(col, vec3(1.0), clamp(vLit, 0.0, 1.0) * 0.85);

  float a = mask * vAlpha * uOpacity * (1.0 + vHeat * 1.4);
  fragColor = vec4(col * a, a);
}
`;

/* ── Vitrine ─────────────────────────────────────────────────────────────── */

const lineVertex = `#version 300 es
precision highp float;

in vec3 position;
in float aFade;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uMouse;
uniform float uAspect;
uniform float uRepel;
uniform float uRepelRadius;
uniform float uPointerIn;
uniform float uPulse;
uniform float uSplash;
uniform vec2 uSplashOrigin;
uniform float uSplashStrength;

out float vFade;
out float vHeat;

${POINTER}

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  float heat;
  vec2 ndc = clip.xy / clip.w;
  // A third of the particle response — the cage flexes, it does not billow.
  ndc += pointerOffset(ndc, 0.34, heat);
  clip.xy = ndc * clip.w;
  gl_Position = clip;
  vFade = aFade;
  vHeat = heat;
}
`;

const lineFragment = `#version 300 es
precision highp float;

in float vFade;
in float vHeat;

uniform vec3 uColor;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  float a = vFade * uOpacity * (1.0 + clamp(vHeat, 0.0, 1.0) * 2.0);
  fragColor = vec4(uColor * a, a);
}
`;

/* Five concentric prisms, each inset and dimmer than the last, emitted as an
   indexed-free LINES soup (hairlines are exactly the 1px look of the source). */
const buildVitrine = (shells: number, w: number, h: number, d: number) => {
  const pos: number[] = [];
  const fade: number[] = [];

  const edge = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    f: number,
  ) => {
    pos.push(ax, ay, az, bx, by, bz);
    fade.push(f, f);
  };

  for (let s = 0; s < shells; s++) {
    const t = shells > 1 ? s / (shells - 1) : 0;
    const sx = w * (1 - t * 0.13);
    const sz = d * (1 - t * 0.13);
    const top = h * (0.5 - t * 0.035);
    const bot = -h * 0.5;
    // Outermost shell reads as the vitrine; inner ones are echo lines.
    const f = (1 - t * 0.62) * (s === 0 ? 1 : 0.66);

    const xs = [-sx, sx];
    const zs = [-sz, sz];

    for (const z of zs) {
      edge(xs[0], top, z, xs[1], top, z, f);
      edge(xs[0], bot, z, xs[1], bot, z, f * 1.15);
    }
    for (const x of xs) {
      edge(x, top, zs[0], x, top, zs[1], f);
      edge(x, bot, zs[0], x, bot, zs[1], f * 1.15);
      for (const z of zs) edge(x, bot, z, x, top, z, f * 0.85);
    }
  }

  return {
    position: new Float32Array(pos),
    aFade: new Float32Array(fade),
  };
};


/* ── Eclipse ring ─────────────────────────────────────────────────────────
   The bright annulus at the centre of the terrain. Screen-space on a
   fullscreen triangle, so it stays a perfect circle at any resolution. */

const ringVertex = `#version 300 es
precision highp float;
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const ringFragment = `#version 300 es
precision highp float;

uniform vec2 iResolution;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uMorph;
uniform vec3 uColor;

out vec4 fragColor;

void main() {
  vec2 ndc = (gl_FragCoord.xy / iResolution) * 2.0 - 1.0;
  vec2 d = ndc - uCenter;
  d.x *= iResolution.x / iResolution.y;
  float r = length(d);

  // A thin bright rim with a dark core, plus a wide falloff that lifts the
  // terrain immediately around it.
  float rim = exp(-pow((r - uRadius) / (uRadius * 0.075), 2.0));
  float halo = exp(-pow(r / (uRadius * 1.7), 2.0)) * 0.16;
  float core = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.94, r);

  float a = (rim + halo * (1.0 - core)) * uMorph;
  a = clamp(a, 0.0, 1.0);
  fragColor = vec4(uColor * a, a);
}
`;

/* Vitrine half-width, full height and half-depth, in scene units. The scene is
   uniformly scaled to fit the viewport, so these only set proportions. */
const VITRINE_W = 2.5;
const VITRINE_H = 10.4;
const VITRINE_D = 1.9;

/* ── Component ───────────────────────────────────────────────────────────── */

export interface ParticleVortexProps {
  /** Particle count tier. `high` is ~150k points; `low` suits weak GPUs. */
  density?: "low" | "medium" | "high";
  /** Base tint of the sculpture. */
  color?: string;
  /** Prismatic fringe colour picked up by deep particles. */
  accentColor?: string;
  /** Hairline colour of the surrounding vitrine. */
  lineColor?: string;
  /** Downward streaming rate of the lattice. */
  flowSpeed?: number;
  /** Continuous rotation rate of the column. */
  spinSpeed?: number;
  /** How hard the noise field crumples the lattice. */
  turbulence?: number;
  /** Overall particle brightness. */
  brightness?: number;
  /** Master opacity of the particle pass. */
  opacity?: number;
  /** Pointer parallax strength; 0 disables camera drift. */
  parallaxStrength?: number;
  /** How far the cursor pushes particles aside. */
  repelStrength?: number;
  /** Render the nested wireframe prisms. */
  showVitrine?: boolean;
  /** Emit an expanding pulse ring on pointer/press. */
  clickPulse?: boolean;
  /** Burst the whole field across the screen on press, then reconverge. */
  splashOnClick?: boolean;
  /** How far the splash throws particles, in NDC units. */
  splashStrength?: number;
  /** Seconds the splash takes to travel out and settle back. */
  splashDuration?: number;
  /** Dive the camera through the field while the splash runs, so the handover
   *  reads as travelling into the next section rather than cutting to it. */
  travelOnSplash?: boolean;
  /** How far in, as a fraction of the distance to the camera's look-target.
   *  Above ~0.9 the camera passes through the target and the dive inverts. */
  travelDepth?: number;
  /** Degrees of field-of-view punch at the deepest point. The widening is what
   *  the eye reads as acceleration; the dolly alone feels like a zoom. */
  travelFov?: number;
  /** Fired the moment a splash starts — use it to advance the page. */
  onSplash?: () => void;
  /** Morph values that fire a splash when the scroll crosses them going down.
   *  Lets a plain scroll scatter the field at a section boundary, the same way
   *  a click does. */
  splashAt?: number[];
  /** 0 = vortex, 1 = terrain. Static blend between the two forms. */
  morph?: number;
  /** Read once per frame for the morph, for scroll-driven blends. Overrides
   *  `morph` when given — it avoids a React render per scroll event. */
  morphSource?: () => number;
  /** Progress through the hero's release, 0 to 1, read once per frame. The
   *  vitrine separates in depth, expands and fades; the spin slows; the field
   *  hands over. Omit and the hero behaves exactly as before. */
  releaseSource?: () => number;
  /** Draw the eclipse ring at the centre of the terrain. */
  showRing?: boolean;
  /** Morph range over which this field hands the frame to something else and
   *  fades out. Both ends land inside a handover, where the splash and the dive
   *  already whiteout the composition, so the cross-fade is never seen. */
  yieldRange?: [number, number] | null;
  /** Strength of the prismatic dispersion across the lit flank of the cloud.
   *  0 leaves the field monochrome. */
  spectrumStrength?: number;
  /** Where pointer events are listened for. "container" is right when the
   *  canvas is the top layer. Use "window" when content sits above the canvas
   *  and would otherwise swallow every click before it arrives. */
  pointerScope?: "container" | "window";
  style?: React.CSSProperties;
  className?: string;
}

export default function ParticleVortex({
  density = "medium",
  color = "#E8EAF2",
  accentColor = "#8FB4FF",
  lineColor = "#C8CEDE",
  flowSpeed = 0.012,
  spinSpeed = 0.075,
  turbulence = 0.72,
  brightness = 1,
  opacity = 1,
  parallaxStrength = 0.5,
  repelStrength = 0.09,
  showVitrine = true,
  clickPulse = true,
  splashOnClick = false,
  splashStrength = 1.15,
  splashDuration = 1.15,
  travelOnSplash = true,
  travelDepth = 0.72,
  travelFov = 9,
  onSplash,
  morph = 0,
  morphSource,
  releaseSource,
  splashAt,
  showRing = true,
  yieldRange = null,
  spectrumStrength = 1,
  pointerScope = "container",
  style,
  className,
}: ParticleVortexProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{ points: Program; lines: Program; ring: Program } | null>(null);

  const propsRef = useRef({
    color, accentColor, lineColor, flowSpeed, spinSpeed, turbulence,
    brightness, opacity, parallaxStrength, repelStrength, showVitrine, clickPulse,
    splashOnClick, splashStrength, splashDuration, onSplash,
    morph, morphSource, releaseSource, showRing, spectrumStrength, splashAt,
    travelOnSplash, travelDepth, travelFov, yieldRange,
  });
  propsRef.current = {
    color, accentColor, lineColor, flowSpeed, spinSpeed, turbulence,
    brightness, opacity, parallaxStrength, repelStrength, showVitrine, clickPulse,
    splashOnClick, splashStrength, splashDuration, onSplash,
    morph, morphSource, releaseSource, showRing, spectrumStrength, splashAt,
    travelOnSplash, travelDepth, travelFov, yieldRange,
  };

  const applyProps = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const p = propsRef.current;
    const u = ctx.points.uniforms as any;
    u.uFlow.value = p.flowSpeed;
    u.uSpin.value = p.spinSpeed;
    u.uTurbulence.value = p.turbulence;
    u.uBrightness.value = p.brightness;
    u.uOpacity.value = p.opacity;
    u.uRepel.value = p.repelStrength;
    u.uSplashStrength.value = p.splashStrength;
    u.uSpectrum.value = p.spectrumStrength;
    const set = (arr: Float32Array, hex: string) => {
      const v = hexToRgb(hex);
      arr[0] = v[0]; arr[1] = v[1]; arr[2] = v[2];
    };
    set(u.uColor.value, p.color);
    if (ctx.ring) set((ctx.ring.uniforms as any).uColor.value, p.color);
    set(u.uAccent.value, p.accentColor);
    const l = ctx.lines.uniforms as any;
    l.uRepel.value = p.repelStrength;
    set(l.uColor.value, p.lineColor);
  };

  useEffect(() => {
    applyProps();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const renderer = new Renderer({
      webgl: 2, alpha: true, premultipliedAlpha: true, antialias: false, depth: false, dpr,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    // Additive: overlapping points accumulate into the bright silhouette crests.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const camera = new Camera(gl, { fov: 42, near: 0.1, far: 100 });
    camera.position.set(0, 1.15, 11.4);
    camera.lookAt([0, 0, 0]);
    const scene = new Transform();

    // Lattice: columns are strands wrapped around the profile, rows are the
    // samples along each strand. Sampling densely along the strand is what
    // resolves the funnel into continuous filaments that moire against each
    // other, rather than a stack of separate rings.
    const count = reduceMotion ? 42000 : densityToCount(density);
    const cols = 220;
    const rows = Math.max(2, Math.round(count / cols));
    const total = cols * rows;

    const index = new Float32Array(total);
    const rand = new Float32Array(total * 3);
    for (let i = 0; i < total; i++) {
      index[i] = i;
      rand[i * 3] = Math.random();
      rand[i * 3 + 1] = Math.random();
      rand[i * 3 + 2] = Math.random();
    }

    const pointGeometry = new Geometry(gl, {
      aIndex: { size: 1, data: index },
      aRand: { size: 3, data: rand },
    });

    const pointProgram = new Program(gl, {
      vertex: pointVertex,
      fragment: pointFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCols: { value: cols },
        uRows: { value: rows },
        uFlow: { value: flowSpeed },
        uSpin: { value: spinSpeed },
        uTwist: { value: 14.0 },
        uHeight: { value: 8.4 },
        uWaist: { value: 0.44 },
        uFlare: { value: 2.75 },
        uSpread: { value: 0.5 },
        uTurbulence: { value: turbulence },
        uNoiseScale: { value: 0.31 },
        uSize: { value: 1.8 },
        uDpr: { value: dpr },
        uBrightness: { value: brightness },
        uCamDist: { value: 11.4 },
        uOpacity: { value: opacity },
        uColor: { value: new Float32Array([1, 1, 1]) },
        uAccent: { value: new Float32Array([1, 1, 1]) },
        uSpectrum: { value: 1.0 },
        uMouse: { value: new Float32Array([0, 0]) },
        uAspect: { value: 1 },
        uRepel: { value: repelStrength },
        uRepelRadius: { value: 0.34 },
        uPointerIn: { value: 0 },
        uPulse: { value: 0 },
        uSplash: { value: 0 },
        uSplashOrigin: { value: new Float32Array([0, 0]) },
        uSplashStrength: { value: 1.15 },
        uMorph: { value: 0 },
        uTerrainRadius: { value: 9.4 },
        uTerrainAmp: { value: 6.4 },
        uTerrainScale: { value: 0.115 },
        uTerrainDrop: { value: 2.2 },
        uDuneWidth: { value: 30 },
        uDuneDepth: { value: 40 },
        uDuneNear: { value: 10 },
        uDuneAmp: { value: 2.8 },
        uDuneDrop: { value: 0.8 },
        uDuneFlow: { value: 0.85 },
        uDuneFocus: { value: 12 },
      },
    });
    const points = new Mesh(gl, { geometry: pointGeometry, program: pointProgram, mode: gl.POINTS });
    points.setParent(scene);

    const vitrineData = buildVitrine(5, VITRINE_W, VITRINE_H, VITRINE_D);
    const lineGeometry = new Geometry(gl, {
      position: { size: 3, data: vitrineData.position },
      aFade: { size: 1, data: vitrineData.aFade },
    });
    const lineProgram = new Program(gl, {
      vertex: lineVertex,
      fragment: lineFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Float32Array([1, 1, 1]) },
        uOpacity: { value: 0.3 },
        uMouse: { value: new Float32Array([0, 0]) },
        uAspect: { value: 1 },
        uRepel: { value: repelStrength },
        uRepelRadius: { value: 0.34 },
        uPointerIn: { value: 0 },
        uPulse: { value: 0 },
      },
    });
    const lines = new Mesh(gl, { geometry: lineGeometry, program: lineProgram, mode: gl.LINES });
    lines.setParent(scene);

    // Screen-space, so it hangs outside the scene graph and is drawn by hand
    // after the field rather than being transformed with it.
    const ringGeometry = new Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
    });
    const ringProgram = new Program(gl, {
      vertex: ringVertex,
      fragment: ringFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        iResolution: { value: new Float32Array([1, 1]) },
        uCenter: { value: new Float32Array([0, 0]) },
        uRadius: { value: 0.055 },
        uMorph: { value: 0 },
        uColor: { value: new Float32Array([1, 1, 1]) },
      },
    });
    const ring = new Mesh(gl, { geometry: ringGeometry, program: ringProgram });

    ctxRef.current = { points: pointProgram, lines: lineProgram, ring: ringProgram };
    applyProps();

    // Declared ahead of setSize, which runs during setup and assigns terrainR.
    let terrainR = 5;
    let duneScale = 1;
    // The dive re-derives the projection each frame, so it needs the aspect the
    // resize last computed.
    let aspectNow = 1;
    const baseFov = 42;
    let lastFov = baseFov;
    const camZ = camera.position.z;
    const camY = camera.position.y;
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const aspect = w / h;
      aspectNow = aspect;
      lastFov = baseFov;
      camera.perspective({ fov: baseFov, aspect });
      camera.lookAt([0, 0, 0]);

      // Fit by scaling the scene rather than dollying the camera: the
      // perspective on the vitrine then stays identical at every viewport,
      // and the sculpture simply grows denser as it shrinks.
      const visH = 2 * camera.position.z * Math.tan(((camera.fov ?? 42) * Math.PI) / 360);
      const visW = visH * aspect;
      // 0.82, not 1.0: the vitrine's near face sits VITRINE_D in front of the
      // fit plane and therefore projects larger than the centre slice.
      const fit = Math.min((visH * 0.82) / VITRINE_H, (visW * 0.58) / (VITRINE_W * 2));
      scene.scale.set(fit, fit, fit);
      // The terrain camera is placed relative to the fitted disc, so the
      // landscape frames the same way at every viewport.
      terrainR = fit * (pointProgram.uniforms.uTerrainRadius.value as number);
      // The dune camera sits inside the field, so its station has to be
      // expressed in the same scaled units the plane is drawn in.
      duneScale = fit;

      (pointProgram.uniforms.uCamDist.value as number) = camera.position.z;
      (pointProgram.uniforms.uAspect.value as number) = aspect;
      (lineProgram.uniforms.uAspect.value as number) = aspect;
      const res = ringProgram.uniforms.iResolution.value as Float32Array;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    /* Pointer: parallax target, repulsion origin, and press pulses. */
    const mouse = new Float32Array([0, 0]);
    const mouseTarget = new Float32Array([0, 0]);
    let pointerIn = 0;
    let pointerInTarget = 0;
    // Wall-clock start times, not per-frame decay: see the dt clamp below.
    let pulseStart = -1;
    let splashStart = -1;
    let pulse = 0;
    let splash = 0;

    const host: HTMLElement | Window =
      pointerScope === "window" ? window : ((container.parentElement || container) as HTMLElement);

    // Clicking a link or a control should do that, not burst the field.
    const INTERACTIVE = "a, button, input, textarea, select, label, [data-no-splash]";
    const isInteractive = (e: PointerEvent) =>
      e.target instanceof Element && e.target.closest(INTERACTIVE) !== null;

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseTarget[0] = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseTarget[1] = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      pointerInTarget = 1;
    };
    const onLeave = () => { pointerInTarget = 0; };
    const onDown = (e: PointerEvent) => {
      const p = propsRef.current;
      if (!p.clickPulse && !p.splashOnClick) return;
      if (isInteractive(e)) return;
      onMove(e);
      // Snap the smoothed cursor to the press so the burst starts exactly
      // under the finger rather than wherever the easing had got to.
      mouse[0] = mouseTarget[0];
      mouse[1] = mouseTarget[1];
      if (p.clickPulse) pulseStart = performance.now();
      if (p.splashOnClick) {
        // Ignore presses during a splash: re-triggering mid-flight snaps the
        // field and would fire the parent's scroll a second time.
        if (splash > 0.001) return;
        if (!reduceMotion) splashStart = performance.now();
        const origin = pointProgram.uniforms.uSplashOrigin.value as Float32Array;
        origin[0] = mouseTarget[0];
        origin[1] = mouseTarget[1];
        p.onSplash?.();
      }
    };

    host.addEventListener("pointermove", onMove as EventListener, { passive: true });
    host.addEventListener("pointerleave", onLeave as EventListener, { passive: true });
    host.addEventListener("pointerdown", onDown as EventListener, { passive: true });

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    let last = performance.now();
    let morphNow = 0;
    let lastTarget: number | null = null;
    // Reduced motion still gets a still frame plus pointer response, never drift.
    let clock = reduceMotion ? 6 : 0;

    const render = () => {
      renderer.render({ scene, camera });
      // Drawn after the scene so the ring sits over the field, and separately
      // from it because its geometry is in clip space, not world space.
      if ((ringProgram.uniforms.uMorph.value as number) > 0.001) {
        // clear:false — a second render would otherwise wipe the field that
        // was just drawn. No camera: the ring's geometry is already clip-space.
        renderer.render({ scene: ring, clear: false, sort: false, frustumCull: false });
      }
    };

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (!reduceMotion) clock += dt;

      const p = propsRef.current;
      mouse[0] += (mouseTarget[0] - mouse[0]) * 0.07;
      mouse[1] += (mouseTarget[1] - mouse[1]) * 0.07;
      pointerIn += (pointerInTarget - pointerIn) * 0.06;
      pulse = pulseStart < 0 ? 0 : Math.max(0, 1 - (t - pulseStart) / PULSE_MS);
      splash =
        splashStart < 0
          ? 0
          : Math.max(0, 1 - (t - splashStart) / (Math.max(p.splashDuration, 0.05) * 1000));

      /* The hero's release. The vitrine is a fixed cage around a sculpture that
         is about to leave, so it opens outward and in depth and fades as the
         field goes with it; the spin eases off so the column is visibly
         slowing rather than cut mid-turn. */
      const release = p.releaseSource ? Math.max(0, Math.min(1, p.releaseSource())) : 0;
      /* Gone by the time the hero's copy has finished leaving: the point of the
         release is that the field hands over during the hero, not after it. */
      const releaseFade = 1 - Math.min(1, Math.max(0, (release - 0.02) / 0.16));
      lines.scale.set(1 + release * 0.9, 1 + release * 0.26, 1 + release * 1.7);
      (pointProgram.uniforms.uSpin.value as number) = p.spinSpeed * (1 - Math.min(1, release / 0.2) * 0.82);
      (pointProgram.uniforms.uFlow.value as number) = p.flowSpeed * (1 - Math.min(1, release / 0.2) * 0.6);

      const target = p.morphSource ? p.morphSource() : p.morph;

      /* Fire a splash when the scroll crosses a boundary on the way down, so
         scrolling scatters the field exactly as clicking does. Guarded on the
         splash already running, which is what stops a click's own splash from
         being doubled by the scroll it triggers. */
      if (p.splashAt && lastTarget !== null && !reduceMotion) {
        for (const mark of p.splashAt) {
          if (lastTarget < mark && target >= mark && splash <= 0.001) {
            splashStart = performance.now();
            const o = pointProgram.uniforms.uSplashOrigin.value as Float32Array;
            o[0] = 0;
            o[1] = 0;
            break;
          }
        }
      }
      lastTarget = target;

      morphNow += (target - morphNow) * 0.14;

      const parallax = reduceMotion ? 0 : p.parallaxStrength;
      // The terrain is read from much closer to its own surface, so the
      // parallax yaw has to shrink or the horizon swings wildly.
      scene.rotation.y = mouse[0] * parallax * (0.32 - morphNow * 0.24);
      scene.rotation.x = -mouse[1] * parallax * (0.14 - morphNow * 0.09);

      /* Three camera stations along the morph axis. Terrain drops to near
         ground level at the rim of the disc, so the far side stacks up the
         frame as a range instead of being read down into as a bowl. Dunes go
         lower and closer still — the reference sits almost on the surface,
         which is what gives it that raking perspective. */
      const k1 = Math.min(morphNow, 1);
      const k2 = Math.max(0, Math.min(morphNow - 1, 1));
      const ty = lerp(camY, terrainR * 0.13, k1);
      const tz = lerp(camZ, terrainR * 0.78, k1);
      const tax = lerp(0, terrainR * 0.05, k1);
      const taz = lerp(0, -terrainR * 0.3, k1);
      const camPy = lerp(ty, duneScale * 3.4, k2);
      const camPz = lerp(tz, duneScale * 8.0, k2);
      const aimY = lerp(tax, -duneScale * 1.6, k2);
      const aimZ = lerp(taz, -duneScale * 9, k2);
      camera.position.y = camPy;
      camera.position.z = camPz;
      camera.lookAt([0, aimY, aimZ]);

      /* The dive. While the splash runs, the camera travels along its own view
         axis toward the point it is already aimed at, so the field opens and
         rushes past instead of the page simply cutting to the next section.
         Out and back on a half-sine: deepest at the midpoint, which is where
         the scroll is fastest and the form is halfway between its two shapes.

         Moving toward the look-target and re-aiming at the same point is a true
         dolly — the orientation never changes, only the distance, which is what
         separates travelling into something from zooming at it. */
      const travel = p.travelOnSplash && splash > 0.001 ? Math.sin((1 - splash) * Math.PI) : 0;
      if (travel > 0.001) {
        const dx = 0 - camera.position.x;
        const dy = aimY - camPy;
        const dz = aimZ - camPz;
        const len = Math.hypot(dx, dy, dz) || 1;
        const reach = travel * p.travelDepth;
        camera.position.set(
          camera.position.x + (dx / len) * len * reach,
          camPy + (dy / len) * len * reach,
          camPz + (dz / len) * len * reach,
        );
        camera.lookAt([0, aimY, aimZ]);
      }
      // Widening the lens as it accelerates is the cue that sells speed; the
      // dolly on its own reads as a slow push.
      const wantFov = baseFov + travel * p.travelFov;
      if (Math.abs(wantFov - lastFov) > 0.01) {
        camera.perspective({ fov: wantFov, aspect: aspectNow });
        lastFov = wantFov;
      }

      /* Yield: 1 normally, 0 across the range where another component owns the
         frame, ramping over a quarter of a stage at each end. */
      let yieldFade = 1;
      let yieldBack = 1;
      if (p.yieldRange) {
        const [y0, y1] = p.yieldRange;
        const ramp = 0.25;
        const rise = Math.max(0, Math.min(1, (morphNow - (y0 - ramp)) / ramp));
        const fall = Math.max(0, Math.min(1, (morphNow - y1) / ramp));
        yieldFade = 1 - rise * (1 - fall);
        yieldBack = fall;
      }

      const pu = pointProgram.uniforms as any;
      pu.uTime.value = clock;
      pu.uPointerIn.value = pointerIn;
      pu.uPulse.value = pulse;
      pu.uSplash.value = splash;
      (pu.uMouse.value as Float32Array).set(mouse);

      const lu = lineProgram.uniforms as any;
      lu.uPointerIn.value = pointerIn;
      lu.uPulse.value = pulse;
      // The cage belongs to the hero; it has no business around a landscape.
      lu.uOpacity.value = (p.showVitrine ? 0.3 : 0) * Math.max(0, 1 - morphNow) * yieldFade
        * (1 - Math.min(1, release / 0.17));
      (lu.uMouse.value as Float32Array).set(mouse);

      pu.uMorph.value = morphNow;
      /* The release fade hands the field off at the hero; the yield range brings
         it back for the next form. Multiplying the two would hold it at zero
         forever, because the release only ever runs one way — so the return
         lifts it instead. */
      pu.uOpacity.value = p.opacity * Math.min(yieldFade, Math.max(releaseFade, yieldBack));

      const ru = ringProgram.uniforms as any;
      // Fades in over the back half of the morph, once there is a terrain for
      // it to sit in.
      // Belongs to the terrain: fades in with it and back out as the dunes
      // take over.
      const ringIn = Math.max(0, Math.min(1, (morphNow - 0.45) / 0.55));
      const ringOut = Math.max(0, Math.min(1, (morphNow - 1.1) / 0.5));
      ru.uMorph.value = (p.showRing ? ringIn * (1 - ringOut) : 0) * yieldFade;
      const rc = ru.uCenter.value as Float32Array;
      rc[0] = mouse[0] * parallax * 0.05;
      rc[1] = -0.06 + mouse[1] * parallax * 0.03;

      render();
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (isVisible && isPageVisible && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } };

    const io = new IntersectionObserver(([e]) => {
      isVisible = e.isIntersecting;
      isVisible ? start() : stop();
    }, { threshold: 0 });
    io.observe(container);

    const onVis = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? start() : stop();
    };
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      host.removeEventListener("pointermove", onMove as EventListener);
      host.removeEventListener("pointerleave", onLeave as EventListener);
      host.removeEventListener("pointerdown", onDown as EventListener);
      ctxRef.current = null;
      try { container.removeChild(canvas); } catch (e) {}
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density, pointerScope]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}
    />
  );
}
