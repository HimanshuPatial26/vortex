"use client";

/* ParticleMountain — a generative terrain built entirely from points and
   contour lines.

   Built on `ogl`, the renderer the rest of this project's particle work already
   uses. The brief called for three.js APIs, but the site has no three and no
   R3F; adding them would mean a second 3D framework, a second set of
   conventions, and a second WebGL context alongside the hero's. Everything
   asked for — BufferGeometry-equivalent attributes, custom shaders, GPU-side
   geometry, correct disposal — ogl does natively.

   Three layers share one context and one height function:

     terrain points   the mass of the range, ~60k of them
     contour lines    slices across the terrain, following its elevation
     haze             sparse soft points drifting behind the ridgeline

   They are layers of one scene rather than three React components: they must
   share a GL context, a camera and — critically — the exact same
   `terrainHeight` GLSL, or the lines would float off the surface the points
   describe. Splitting them into components would mean either three contexts or
   a great deal of plumbing to keep one in sync across them.

   The height field is evaluated in the vertex shader, never on the CPU. That is
   what makes the idle deformation free: nothing is re-uploaded between frames,
   the terrain simply breathes because its noise is sampled against time. */

import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Program, Mesh, Geometry } from "ogl";
import { SIMPLEX_3D } from "../lib/noise";

/* ── Configuration ────────────────────────────────────────────────────────
   Every tunable in one place. Distances are in scene units; the terrain spans
   TERRAIN_W across and from NEAR_Z (in front of the camera) back to FAR_Z. */
export const MOUNTAIN = {
  /* Geometry */
  terrainWidth: 150,
  nearZ: 10,
  farZ: -110,
  /** Grid resolution. cols × rows is the particle count. */
  cols: 460,
  rows: 250,

  /* Height field. The range is large-scale mass plus ridges plus detail,
     multiplied by a band that puts the mountains in the middle distance and a
     peak mask that raises one summit above the rest. */
  noiseScale: 0.0105,
  ampLarge: 6.4,
  ampRidge: 7.4,
  ampMedium: 2.4,
  ampFine: 0.7,
  /** Baseline gain, so the foreground still rolls instead of lying flat. */
  baseGain: 0.13,
  /** Where the mountain mass sits in depth, and how far it reaches. */
  bandZ: -46,
  bandWidth: 34,
  bandGain: 0.58,
  /** The hero summit: its centre, its footprint, and how far it out-tops the
      surrounding ridges. */
  peakX: 7,
  peakZ: -44,
  peakWidth: 27,
  peakDepth: 21,
  peakGain: 1.9,
  /** A narrower shoulder beside the summit, so the range is not one pyramid. */
  peak2X: 26,
  peak2Z: -52,
  peak2Width: 13,
  peak2Depth: 13,
  peak2Gain: 1.15,
  /** Height added outright at each summit, so one exists wherever the noise
   *  happens to fall. A multiplicative mask alone cannot guarantee that. */
  peakLift: 7,
  peak2Lift: 3.5,
  /** Where the range fades out at the left and right edges of the field. */
  edgeStart: 0.36,
  edgeEnd: 0.5,

  /* Particles */
  pointSize: 2.0,
  /** Fraction of points kept in the flats; ridges always keep all of theirs. */
  valleyThin: 0.42,
  brightness: 1.9,

  /* Contours */
  contourCount: 52,
  contourOpacity: 0.2,

  /* Haze */
  hazeCount: 300,
  hazeOpacity: 0.035,

  /* Camera */
  camY: 13,
  camZ: 36,
  aimY: 12,
  aimZ: -46,
  fov: 44,
  /** How far the camera pushes into the range across the section's scroll. */
  scrollPush: 26,

  /* Motion */
  idleSpeed: 0.035,
  parallax: 1.0,
  pointerRadius: 0.42,
  pointerForce: 0.075,

  /* Quality */
  maxDpr: 2,
};

export type MountainConfig = typeof MOUNTAIN;

/* ── Shared GLSL ──────────────────────────────────────────────────────────
   The height field, and the uniforms it reads. Injected into every layer so
   points, lines and normals are all derived from one definition. */
const TERRAIN = `
uniform float uTime;
uniform float uNoiseScale;
uniform float uAmpLarge;
uniform float uAmpRidge;
uniform float uAmpMedium;
uniform float uAmpFine;
uniform float uBaseGain;
uniform float uBandZ;
uniform float uBandWidth;
uniform float uBandGain;
uniform vec2 uPeakAt;
uniform vec2 uPeakSize;
uniform float uPeakGain;
uniform vec2 uPeak2At;
uniform vec2 uPeak2Size;
uniform float uPeak2Gain;
uniform float uPeakLift;
uniform float uPeak2Lift;
uniform float uEdge0;
uniform float uEdge1;
uniform float uHalfWidth;

float fbm(vec2 p, float t) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 4; i++) {
    s += snoise(vec3(p * f, t)) * a;
    a *= 0.5;
    f *= 2.03;
  }
  return s;
}

/* Two octaves only — the smooth counterpart used by the contour lines. */
float fbm2(vec2 p, float t) {
  return snoise(vec3(p, t)) * 0.5 + snoise(vec3(p * 2.03, t)) * 0.25;
}

/* Ridged noise: inverting |noise| turns rounded hills into sharp crests, which
   is what gives a range its skyline — fbm alone reads as dunes. Squaring each
   octave sharpens the crest and deepens the trough; the result stays in [0, 1]
   and is added, never subtracted. */
float ridged(vec2 p, float t) {
  float s = 0.0, a = 0.5, f = 1.0, norm = 0.0;
  for (int i = 0; i < 4; i++) {
    float r = 1.0 - abs(snoise(vec3(p * f, t)));
    s += r * r * a;
    norm += a;
    a *= 0.48;
    f *= 2.11;
  }
  return s / norm;
}

float ridged2(vec2 p, float t) {
  float r0 = 1.0 - abs(snoise(vec3(p, t)));
  float r1 = 1.0 - abs(snoise(vec3(p * 2.11, t)));
  return (r0 * r0 * 0.5 + r1 * r1 * 0.24) / 0.74;
}

/* The masks that turn a noise field into a range: mass in the middle distance,
   one dominant summit, a narrower shoulder beside it, and a fade at the flanks.
   Shared, so the smooth and detailed forms describe the same mountain. */
/* Returns the mask, and writes the added summit domes into the out param. */
float terrainMask(vec2 p, out float lift) {
  float band = exp(-pow((p.y - uBandZ) / uBandWidth, 2.0));
  vec2 d = (p - uPeakAt) / uPeakSize;
  float peak = exp(-dot(d, d));
  // A second, narrower summit off the main one. Without it the range resolves
  // into a single pyramid however the noise falls.
  vec2 d2 = (p - uPeak2At) / uPeak2Size;
  float peak2 = exp(-dot(d2, d2));
  float m = uBaseGain + band * uBandGain + peak * uPeakGain + peak2 * uPeak2Gain;
  lift = peak * uPeakLift + peak2 * uPeak2Lift;
  // Asymmetric flanks — equal falloff on both sides reads as a diagram.
  float ex = p.x < 0.0 ? abs(p.x) * 1.12 : abs(p.x) * 0.9;
  float edge = 1.0 - smoothstep(uEdge0 * uHalfWidth, uEdge1 * uHalfWidth, ex);
  lift *= edge;
  return m * edge;
}

/* p is (x, z) in scene units. Time drifts the field so the range breathes. */
float terrainHeight(vec2 p, float t) {
  vec2 n = p * uNoiseScale;
  float h = fbm(n, t) * uAmpLarge;
  h += ridged(n * 1.15 + 11.3, t) * uAmpRidge;
  h += fbm(n * 4.1 + 31.0, t * 1.3) * uAmpMedium;
  h += fbm(n * 11.0 + 71.0, t * 1.7) * uAmpFine;
  float lift;
  float m = terrainMask(p, lift);
  return max(h * m + lift, -1.5);
}

/* The same mountain read at low detail. Contour lines follow this rather than
   the full field: a slice across the detailed surface spikes on every crest and
   crosses its neighbours into what looks like a triangulated mesh. Dropping the
   fine octaves gives lines that flow along the mass instead of zig-zagging over
   it. Normals use it too — broad shading wants the broad shape, and it costs
   half as many noise samples. */
float terrainSmooth(vec2 p, float t) {
  vec2 n = p * uNoiseScale;
  float h = fbm2(n, t) * uAmpLarge * 1.05;
  h += ridged2(n * 1.15 + 11.3, t) * uAmpRidge * 0.86;
  float lift;
  float m = terrainMask(p, lift);
  return max(h * m + lift, -1.5);
}

/* Surface normal by finite difference. Two extra height samples, which is what
   pays for the ridge brightening and the density weighting. */
vec3 terrainNormal(vec2 p, float t, float e) {
  float h = terrainSmooth(p, t);
  float hx = terrainSmooth(p + vec2(e, 0.0), t);
  float hz = terrainSmooth(p + vec2(0.0, e), t);
  return normalize(vec3((h - hx) / e, 1.0, (h - hz) / e));
}
`;

/* Screen-space pointer push, shared by the points and the lines so both answer
   the same cursor. */
const POINTER = `
/* Copy guard: the field dims where the editorial block sits. A scrim over the
   canvas would flatten the whole corner; dimming the particles themselves keeps
   the terrain present behind the type without ever competing with it. */
float copyGuard(vec2 ndc) {
  float gx = smoothstep(0.12, -0.5, ndc.x);
  float gy = smoothstep(0.06, -0.52, ndc.y);
  return 1.0 - 0.72 * gx * gy;
}

uniform vec2 uMouse;
uniform float uAspect;
uniform float uPointerIn;
uniform float uPointerRadius;
uniform float uPointerForce;

vec2 pointerPush(vec2 ndc, float depthScale) {
  vec2 d = ndc - uMouse;
  d.x *= uAspect;
  float r2 = dot(d, d);
  float infl = exp(-r2 / max(uPointerRadius * uPointerRadius, 1e-4)) * uPointerIn;
  if (infl < 0.002) return vec2(0.0);
  float r = sqrt(r2);
  return (r > 1e-4 ? d / r : vec2(0.0)) * infl * uPointerForce * depthScale;
}
`;

/* ── Terrain points ───────────────────────────────────────────────────────── */

const pointVertex = `#version 300 es
precision highp float;

in vec2 aCell;
in vec3 aRand;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPointSize;
uniform float uDpr;
uniform float uBrightness;
uniform float uValleyThin;
uniform float uReveal;
uniform float uCamDist;

${SIMPLEX_3D}
${TERRAIN}
${POINTER}

out float vAlpha;

void main() {
  // Jitter inside the cell: on a bare lattice the eye finds the grid instantly,
  // and a terrain has to read as sampled rather than tabulated.
  vec2 p = aCell + (aRand.xy - 0.5) * vec2(0.9, 0.9) * 0.9;

  float h = terrainHeight(p, uTime);
  vec3 pos = vec3(p.x, h, p.y);

  vec3 nrm = terrainNormal(p, uTime, 1.1);
  // Slope, 0 flat to 1 sheer. Ridges and faces read bright; flats sit back.
  float slope = clamp(1.0 - nrm.y, 0.0, 1.0);
  float steep = smoothstep(0.015, 0.3, slope);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 2.0));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  gl_PointSize = clamp(uPointSize * uDpr * (0.72 + aRand.z * 0.5) * (uCamDist * 1.5 / dist), 0.55, 1.9);

  /* Density is carried by alpha, not by count: thinning the buffer would mean
     rebuilding it whenever the terrain moved. A share of the flat-ground points
     drop out, ridges keep all of theirs. */
  // Density follows the terrain: full on ridges and faces, thinned hard in the
  // flats and valleys where the reference has almost nothing.
  float keep = step(aRand.z, mix(uValleyThin, 1.0, steep * 1.3));
  // Distance haze — the far range has to sink into the dark or the whole field
  // reads as one flat sheet of dots.
  float fog = 1.0 - smoothstep(uCamDist * 1.7, uCamDist * 4.6, dist);
  // A slow shimmer, well under the threshold where it reads as blinking.
  float shimmer = 0.86 + 0.14 * sin(uTime * 11.0 + aRand.x * 62.8);

  /* Opacity carries the depth: a wide per-particle spread so the mass reads as
     layered rather than as one flat sheet, weighted up on the steep ground and
     again on the summit itself, which the reference shows as the brightest
     accumulation in the frame. */
  vec2 sd = (p - uPeakAt) / (uPeakSize * 1.35);
  float summit = exp(-dot(sd, sd));
  float weight = mix(0.18, 0.95, aRand.y) * (0.45 + steep * 1.1 + summit * 0.55);
  vAlpha = keep * fog * uBrightness * uReveal * shimmer * weight * copyGuard(ndc);
}
`;

const pointFragment = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
out vec4 fragColor;

void main() {
  // Soft round sprite; under additive blending dense ground stacks into the
  // bright ridgelines on its own, with no bloom pass.
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q);
  if (r > 0.25) discard;
  float a = (1.0 - r * 4.0) * vAlpha;
  if (a <= 0.0) discard;
  fragColor = vec4(uColor * a, a);
}
`;

/* ── Contour lines ────────────────────────────────────────────────────────── */

const lineVertex = `#version 300 es
precision highp float;

in vec2 aCell;
in float aSeed;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uReveal;
uniform float uCamDist;

${SIMPLEX_3D}
${TERRAIN}
${POINTER}

out float vAlpha;

void main() {
  vec2 p = aCell;
  float h = terrainSmooth(p, uTime);
  vec3 pos = vec3(p.x, h, p.y);

  vec3 nrm = terrainNormal(p, uTime, 1.1);
  float steep = smoothstep(0.015, 0.28, clamp(1.0 - nrm.y, 0.0, 1.0));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 1.4));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float fog = 1.0 - smoothstep(uCamDist * 1.6, uCamDist * 4.4, dist);
  /* Lines draw on in a wave from the foreground back, rather than all at once,
     so the reveal reads as the terrain being surveyed. */
  float order = clamp((p.y - uBandZ * 2.2) / 150.0, 0.0, 1.0);
  float drawn = clamp((uReveal - 0.08) * 2.4 - (1.0 - order) * 0.45, 0.0, 1.0);
  // Each line breathes on its own long cycle and some drop out entirely for a
  // while, which is what keeps the set from reading as a ruled grid.
  float life = 0.45 + 0.55 * sin(uTime * (7.0 + aSeed * 9.0) + aSeed * 40.0);
  vAlpha = fog * drawn * (0.3 + steep * 0.8) * (0.55 + aSeed * 0.5) * clamp(life, 0.0, 1.0) * copyGuard(ndc);
}
`;

const lineFragment = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  float a = vAlpha * uOpacity;
  if (a <= 0.0) discard;
  fragColor = vec4(uColor * a, a);
}
`;

/* ── Atmospheric haze ─────────────────────────────────────────────────────── */

const hazeVertex = `#version 300 es
precision highp float;

in vec3 aPos;
in vec2 aRand;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uDpr;
uniform float uReveal;

out float vAlpha;

void main() {
  // Drifts sideways and wraps, so the bank never settles or repeats visibly.
  vec3 pos = aPos;
  pos.x += sin(uTime * 0.12 + aRand.x * 6.28) * 9.0;
  pos.y += sin(uTime * 0.09 + aRand.y * 6.28) * 2.2;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  gl_PointSize = clamp((7.0 + aRand.x * 13.0) * uDpr * (90.0 / dist), 4.0, 40.0);
  vAlpha = uReveal * (0.3 + aRand.y * 0.7) * (1.0 - smoothstep(70.0, 260.0, dist));
}
`;

const hazeFragment = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q);
  if (r > 0.5) discard;
  // Wide gaussian falloff — a hard-edged sprite at this size reads as a disc.
  float a = exp(-r * r * 7.0) * vAlpha * uOpacity;
  fragColor = vec4(uColor * a, a);
}
`;

/* ── Component ────────────────────────────────────────────────────────────── */

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
};

export interface ParticleMountainProps {
  /** Overrides merged over MOUNTAIN. */
  config?: Partial<MountainConfig>;
  /** Terrain and contour colour. */
  color?: string;
  /** Haze colour. */
  hazeColor?: string;
  /** Scales the whole scene's opacity. */
  opacity?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function ParticleMountain({
  config,
  color = "#E8EAF2",
  hazeColor = "#9BA6BF",
  opacity = 1,
  style,
  className,
}: ParticleMountainProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const C: MountainConfig = { ...MOUNTAIN, ...config };

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Mobile gets a coarser grid, fewer contours and no pointer displacement.
       The silhouette is the thing to preserve; resolution is not. */
    const narrow = window.innerWidth < 820;
    const cols = narrow ? Math.round(C.cols * 0.62) : C.cols;
    const rows = narrow ? Math.round(C.rows * 0.62) : C.rows;
    const contourCount = narrow ? Math.round(C.contourCount * 0.55) : C.contourCount;
    const hazeCount = narrow ? Math.round(C.hazeCount * 0.5) : C.hazeCount;
    const allowPointer = !narrow;
    // Narrow frames have no room for an off-axis summit, so the camera lines up
    // on the peak instead of on the range's centre.
    const aimX = narrow ? C.peakX : 0;

    const dpr = Math.min(window.devicePixelRatio || 1, C.maxDpr);
    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      dpr,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    // Additive: overlapping points accumulate into the bright ridges.
    gl.blendFunc(gl.ONE, gl.ONE);

    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const camera = new Camera(gl, { fov: C.fov, near: 0.5, far: 600 });
    const scene = new Transform();

    const halfW = C.terrainWidth / 2;
    const depth = C.nearZ - C.farZ;

    /* Terrain uniforms are shared by reference across the three programs, so a
       tweak to the height field cannot desynchronise the layers. */
    const terrainUniforms = {
      uTime: { value: 0 },
      uNoiseScale: { value: C.noiseScale },
      uAmpLarge: { value: C.ampLarge },
      uAmpRidge: { value: C.ampRidge },
      uAmpMedium: { value: C.ampMedium },
      uAmpFine: { value: C.ampFine },
      uBaseGain: { value: C.baseGain },
      uBandZ: { value: C.bandZ },
      uBandWidth: { value: C.bandWidth },
      uBandGain: { value: C.bandGain },
      uPeakAt: { value: new Float32Array([C.peakX, C.peakZ]) },
      uPeakSize: { value: new Float32Array([C.peakWidth, C.peakDepth]) },
      uPeakGain: { value: C.peakGain },
      uPeak2At: { value: new Float32Array([C.peak2X, C.peak2Z]) },
      uPeak2Size: { value: new Float32Array([C.peak2Width, C.peak2Depth]) },
      uPeak2Gain: { value: C.peak2Gain },
      uPeakLift: { value: C.peakLift },
      uPeak2Lift: { value: C.peak2Lift },
      uEdge0: { value: C.edgeStart },
      uEdge1: { value: C.edgeEnd },
      uHalfWidth: { value: halfW },
    };
    const pointerUniforms = {
      uMouse: { value: new Float32Array([0, -2]) },
      uAspect: { value: 1 },
      uPointerIn: { value: 0 },
      uPointerRadius: { value: C.pointerRadius },
      uPointerForce: { value: allowPointer ? C.pointerForce : 0 },
    };

    // ── Terrain points ──────────────────────────────────────────────────────
    const count = cols * rows;
    const cell = new Float32Array(count * 2);
    const rand = new Float32Array(count * 3);
    const cellW = C.terrainWidth / (cols - 1);
    const cellD = depth / (rows - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        cell[i * 2] = -halfW + c * cellW;
        cell[i * 2 + 1] = C.nearZ - r * cellD;
        rand[i * 3] = Math.random();
        rand[i * 3 + 1] = Math.random();
        rand[i * 3 + 2] = Math.random();
      }
    }
    const pointGeometry = new Geometry(gl, {
      aCell: { size: 2, data: cell },
      aRand: { size: 3, data: rand },
    });
    const pointProgram = new Program(gl, {
      vertex: pointVertex,
      fragment: pointFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uPointSize: { value: C.pointSize },
        uDpr: { value: dpr },
        uBrightness: { value: C.brightness },
        uValleyThin: { value: C.valleyThin },
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    new Mesh(gl, { geometry: pointGeometry, program: pointProgram, mode: gl.POINTS }).setParent(scene);

    /* ── Contour lines ──────────────────────────────────────────────────────
       Slices at constant depth rather than true iso-height curves. Marching an
       isoline every frame over a terrain that moves would cost a rebuild per
       frame; a depth slice is a static buffer whose height the shader supplies,
       and on a slope the two are indistinguishable — rows crowd together in
       screen space exactly where a contour map would tighten its bands.

       Spacing is uneven and biased toward the foreground, where the long
       sweeping lines of the reference live. */
    const lineRes = narrow ? 200 : 320;
    const segs = lineRes - 1;
    const lineCell = new Float32Array(contourCount * segs * 2 * 2);
    const lineSeed = new Float32Array(contourCount * segs * 2);
    let w = 0;
    let sIdx = 0;
    for (let k = 0; k < contourCount; k++) {
      const f = k / (contourCount - 1);
      // Cubic bias: dense near the camera, sparser toward the far ridges.
      const zf = Math.pow(f, 1.5);
      const jitter = (Math.sin(k * 12.9898) * 43758.5453) % 1;
      const z = C.nearZ - (zf + jitter * 0.004) * depth;
      const seed = Math.abs((Math.sin(k * 78.233) * 43758.5453) % 1);
      for (let i = 0; i < segs; i++) {
        const x0 = -halfW + (i / segs) * C.terrainWidth;
        const x1 = -halfW + ((i + 1) / segs) * C.terrainWidth;
        lineCell[w++] = x0; lineCell[w++] = z;
        lineCell[w++] = x1; lineCell[w++] = z;
        lineSeed[sIdx++] = seed;
        lineSeed[sIdx++] = seed;
      }
    }
    const lineGeometry = new Geometry(gl, {
      aCell: { size: 2, data: lineCell },
      aSeed: { size: 1, data: lineSeed },
    });
    const lineProgram = new Program(gl, {
      vertex: lineVertex,
      fragment: lineFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uOpacity: { value: C.contourOpacity },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    new Mesh(gl, { geometry: lineGeometry, program: lineProgram, mode: gl.LINES }).setParent(scene);

    // ── Haze ────────────────────────────────────────────────────────────────
    const hazePos = new Float32Array(hazeCount * 3);
    const hazeRand = new Float32Array(hazeCount * 2);
    for (let i = 0; i < hazeCount; i++) {
      hazePos[i * 3] = (Math.random() - 0.5) * C.terrainWidth * 1.15;
      hazePos[i * 3 + 1] = 4 + Math.random() * 26;
      // Strictly behind the range: any of it in front of the ridgeline reads as
      // smudges on the lens, not as depth.
      hazePos[i * 3 + 2] = C.bandZ - 78 + Math.random() * 62;
      hazeRand[i * 2] = Math.random();
      hazeRand[i * 2 + 1] = Math.random();
    }
    const hazeGeometry = new Geometry(gl, {
      aPos: { size: 3, data: hazePos },
      aRand: { size: 2, data: hazeRand },
    });
    const hazeProgram = new Program(gl, {
      vertex: hazeVertex,
      fragment: hazeFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: terrainUniforms.uTime,
        uDpr: { value: dpr },
        uReveal: { value: 0 },
        uOpacity: { value: C.hazeOpacity },
        uColor: { value: new Float32Array(hexToRgb(hazeColor)) },
      },
    });
    const hazeMesh = new Mesh(gl, { geometry: hazeGeometry, program: hazeProgram, mode: gl.POINTS });
    // Drawn first so the terrain reads in front of the bank.
    hazeMesh.setParent(scene);

    // ── Sizing ──────────────────────────────────────────────────────────────
    let vw = 1;
    let vh = 1;
    const setSize = () => {
      const rect = container.getBoundingClientRect();
      vw = Math.max(1, Math.floor(rect.width));
      vh = Math.max(1, Math.floor(rect.height));
      renderer.setSize(vw, vh);
      const aspect = vw / vh;
      // A narrow viewport needs a wider lens, or the range loses its flanks and
      // the summit stops reading as the centre of a range.
      camera.perspective({ fov: aspect < 1 ? C.fov * 1.35 : C.fov, aspect });
      (pointProgram.uniforms.uAspect.value as number) = aspect;
      (lineProgram.uniforms.uAspect.value as number) = aspect;
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    // ── Pointer ─────────────────────────────────────────────────────────────
    const mouse = new Float32Array([0, -2]);
    const mouseTarget = new Float32Array([0, -2]);
    let pointerIn = 0;
    let pointerInTarget = 0;
    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseTarget[0] = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseTarget[1] = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      pointerInTarget = 1;
    };
    const onLeave = () => { pointerInTarget = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });

    // ── Loop ────────────────────────────────────────────────────────────────
    let raf = 0;
    let visible = true;
    let pageVisible = !document.hidden;
    let clock = reduceMotion ? 12 : 0;
    let reveal = 0;
    let last = performance.now();

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.1);
      last = t;
      if (!reduceMotion) clock += dt * C.idleSpeed;

      /* Reveal and push are driven by where the section sits in the viewport,
         so the terrain assembles as it arrives and the camera keeps pressing
         forward as the reader continues. */
      const rect = container.getBoundingClientRect();
      const enter = 1 - Math.max(0, Math.min(1, (rect.top + rect.height * 0.15) / (vh || 1)));
      const through = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));
      const wantReveal = reduceMotion ? 1 : Math.max(0, Math.min(1, enter * 1.25));
      reveal += (wantReveal - reveal) * (1 - Math.exp(-dt * 3.2));

      const k = 1 - Math.exp(-dt * 5);
      mouse[0] += (mouseTarget[0] - mouse[0]) * k;
      mouse[1] += (mouseTarget[1] - mouse[1]) * k;
      pointerIn += (pointerInTarget - pointerIn) * (1 - Math.exp(-dt * 3));

      const par = reduceMotion ? 0 : C.parallax;
      // Deliberately tiny: the camera should breathe with the pointer, not
      // survey the scene from it.
      camera.position.set(
        aimX + mouse[0] * par * 2.6,
        C.camY + mouse[1] * par * 1.4,
        C.camZ - through * C.scrollPush,
      );
      camera.lookAt([aimX, C.aimY + mouse[1] * par * 0.8, C.aimZ]);

      terrainUniforms.uTime.value = clock;
      for (const prog of [pointProgram, lineProgram]) {
        const u = prog.uniforms as any;
        (u.uMouse.value as Float32Array).set(mouse);
        u.uPointerIn.value = pointerIn;
        u.uReveal.value = reveal * opacity;
        u.uCamDist.value = camera.position.z;
      }
      (hazeProgram.uniforms.uReveal.value as number) = reveal * opacity;

      renderer.render({ scene, camera });
      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (visible && pageVisible && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => { if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; } };

    // Off-screen or backgrounded, the section costs nothing.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      visible ? start() : stop();
    }, { threshold: 0 });
    io.observe(container);
    const onVis = () => {
      pageVisible = !document.hidden;
      pageVisible ? start() : stop();
    };
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      try { container.removeChild(canvas); } catch (e) {}
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, color, hazeColor, opacity]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}
    />
  );
}
