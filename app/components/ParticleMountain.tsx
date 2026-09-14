"use client";

/* ParticleMountain — a generative range drawn entirely in points and draped
   lines, with a depth-only surface underneath it so the terrain cannot show
   through itself.

   Built on `ogl`, the renderer the rest of this project's particle work already
   uses. Five layers share one context, one camera and one height field:

     occluder     an invisible triangulated surface. Writes depth, no colour.
     haze         a thin bank behind the silhouette.
     paths        draped lines running across the landscape, warped in depth.
     points       the mass of the range.
     drift        a few grains hanging just above the surface.

   The shape is designed, not discovered. A noise plane with a mask over it can
   only ever produce whatever silhouette the noise happens to have that day, so
   the large forms here are an explicit table of mountain masses and ridge paths
   (see MOUNTAIN.masses / MOUNTAIN.ridges) which the shader evaluates
   analytically. Domain-warped ridged noise then supplies the detail, weighted by
   how much designed mass is underneath it — so crests get teeth and the flats
   stay calm.

   Everything is evaluated in the vertex shader, never on the CPU: nothing is
   re-uploaded between frames, and the same height function feeds points, lines,
   drift and the occluder, so they cannot drift apart. */

import { useEffect, useRef } from "react";
import { Renderer, Camera, Transform, Program, Mesh, Geometry } from "ogl";
import { SIMPLEX_3D } from "../lib/noise";

/* ── Configuration ────────────────────────────────────────────────────────
   Distances are scene units. The field spans `terrainWidth` across and runs
   from `nearZ` (just in front of the camera) back to `farZ`. */

/** One designed mountain mass: an oriented ellipse with a height.
 *  `crest` is how much this mass counts as a ridgeline for the brightening
 *  pass — teeth and summits do, broad collars do not. */
export interface MountainMass {
  x: number; z: number; rx: number; rz: number; rot: number; h: number; crest?: number;
}
/** One ridge path: a spine running from (ax, az) to (bx, bz), tapering in
 *  height along its length. These are what make ridges branch and descend. */
export interface MountainRidge {
  ax: number; az: number; bx: number; bz: number; w: number; ha: number; hb: number; crest?: number;
}

export const MOUNTAIN = {
  /* Field. Wide and deep enough that its rectangle never enters the frame. */
  terrainWidth: 270,
  nearZ: 30,
  farZ: -115,

  /* Point lattice. Samples are packed toward the centre and toward the camera,
     because that is where the frame spends its pixels — a uniform grid wastes
     most of its budget on the far corners.

     packX / packZ are the sample spacing at the centre of the field as a
     fraction of uniform. A power curve would do the same job but its derivative
     goes to zero at the origin, which stacks a whole column of the lattice onto
     x = 0 and leaves a bright seam up the middle of the frame. */
  cols: 680,
  rows: 400,
  packX: 0.45,
  packZ: 0.75,

  /* ── The designed skeleton ──────────────────────────────────────────────
     Large forms first: one tall narrow summit, teeth around it, a shoulder
     left, a secondary peak right, and side ranges running out of frame. */
  masses: [
    /* Heights are pre-carve. The ridged octave cuts up to `ampRidge` back out of
       the high ground, so every number here runs roughly ten units above the
       elevation it actually reaches. */
    /* Main summit — narrow, slightly turned, the tallest thing in the field. */
    { x: 5, z: -50, rx: 11, rz: 10, rot: 16, h: 42, crest: 1.0 },
    /* Its collar: a broad low mass so the summit rises out of a range rather
       than off a plain. No crest weight — this is bulk, not skyline. */
    { x: 3, z: -53, rx: 38, rz: 24, rot: -8, h: 16 },
    /* Teeth around the summit. Small footprints, real height: these are what
       stop the peak reading as a single cone. */
    { x: -8, z: -46, rx: 5.6, rz: 5.0, rot: 0, h: 26, crest: 1.0 },
    { x: 13, z: -47, rx: 5.0, rz: 4.6, rot: 0, h: 28, crest: 1.0 },
    { x: 20, z: -52, rx: 6.2, rz: 5.6, rot: 0, h: 23, crest: 0.9 },
    { x: -14, z: -51, rx: 6.6, rz: 6.0, rot: 0, h: 21, crest: 0.9 },
    { x: -2.5, z: -42, rx: 4.6, rz: 4.2, rot: 0, h: 21, crest: 0.9 },
    { x: 8.5, z: -57, rx: 5.2, rz: 5.0, rot: 0, h: 24, crest: 0.9 },
    /* Prominent shoulder to the left — broad, and clearly lower than the peak. */
    { x: -31, z: -56, rx: 22, rz: 15, rot: 20, h: 29, crest: 0.6 },
    { x: -58, z: -66, rx: 26, rz: 16, rot: 10, h: 20, crest: 0.4 },
    /* Distinct secondary peak to the right, narrower than the shoulder. */
    { x: 35, z: -55, rx: 12, rz: 11, rot: -20, h: 32, crest: 1.0 },
    { x: 44, z: -51, rx: 6.5, rz: 6, rot: 0, h: 24, crest: 0.9 },
    { x: 57, z: -62, rx: 20, rz: 13, rot: -12, h: 20, crest: 0.4 },
    /* Side ranges, lower and further back, continuing past both frame edges. */
    { x: -96, z: -82, rx: 38, rz: 21, rot: 0, h: 14, crest: 0.3 },
    { x: 92, z: -78, rx: 36, rz: 20, rot: 0, h: 13.5, crest: 0.3 },
    { x: -145, z: -96, rx: 42, rz: 23, rot: 0, h: 12, crest: 0.2 },
    { x: 142, z: -92, rx: 40, rz: 22, rot: 0, h: 11, crest: 0.2 },
    /* Mid-ground knolls, between the range and the rolling foreground. */
    { x: -22, z: -30, rx: 16, rz: 9, rot: 12, h: 10, crest: 0.3 },
    { x: 26, z: -28, rx: 14, rz: 8, rot: -14, h: 9, crest: 0.3 },
  ] as MountainMass[],

  ridges: [
    /* Skyline connectors. Deliberately well below both summits they join, so
       the range reads as peaks with saddles between them rather than a wall. */
    { ax: 5, az: -50, bx: -31, bz: -56, w: 7.0, ha: 27, hb: 24, crest: 0.8 },
    { ax: 5, az: -50, bx: 35, bz: -55, w: 6.0, ha: 29, hb: 26, crest: 0.9 },
    /* Long branching spines descending toward the camera, with the valleys
       between them left empty. */
    { ax: 5, az: -50, bx: -5, bz: -32, w: 6.5, ha: 40, hb: 11, crest: 0.9 },
    { ax: -5, az: -32, bx: -19, bz: -12, w: 7.5, ha: 11, hb: 4.0, crest: 0.6 },
    { ax: -5, az: -32, bx: -23, bz: -25, w: 5.4, ha: 11, hb: 3.5, crest: 0.5 },
    { ax: 5, az: -50, bx: 17, bz: -34, w: 6.0, ha: 39, hb: 10.5, crest: 0.9 },
    { ax: 17, az: -34, bx: 31, bz: -14, w: 7.5, ha: 10.5, hb: 3.8, crest: 0.6 },
    { ax: 17, az: -34, bx: 33, bz: -30, w: 5.4, ha: 10, hb: 3.2, crest: 0.5 },
    /* Shoulder and secondary-peak spines, running out toward the frame edges. */
    { ax: -31, az: -56, bx: -45, bz: -38, w: 8.5, ha: 20, hb: 9, crest: 0.5 },
    { ax: -45, az: -38, bx: -61, bz: -20, w: 9.5, ha: 9, hb: 3.0, crest: 0.4 },
    { ax: 35, az: -55, bx: 49, bz: -40, w: 7.5, ha: 22, hb: 9, crest: 0.5 },
    { ax: 49, az: -40, bx: 64, bz: -23, w: 8.5, ha: 9, hb: 2.8, crest: 0.4 },
  ] as MountainRidge[],

  /* ── Noise detail over the skeleton ─────────────────────────────────────── */
  noiseScale: 0.03,
  /** Domain warp, so the ridged detail bends instead of running in straight
      parallel creases. */
  warp: 0.8,
  ampRidge: 8.5,
  ampFbm: 2.0,
  /** The fine gully octave, carved into the flowing surface for the points. */
  ampGully: 2.2,
  ampFine: 0.8,
  /** How much detail survives off the mountain, where there is no mass. */
  detailFloor: 0.2,
  /** Broad rolling undulation near the camera — the foreground of the frame. */
  fgAmp: 4.0,
  fgScale: 0.02,
  fgFront: 30,
  fgBack: -34,

  /* ── Depth occluder ─────────────────────────────────────────────────────── */
  occluderCols: 330,
  occluderRows: 200,
  /** How far the invisible surface sits below the drawn one. Must clear the
      finest octave, or points in crevices get eaten by their own ground. */
  occluderDrop: 1.35,

  /* ── Particles ──────────────────────────────────────────────────────────── */
  pointSize: 1.6,
  brightness: 5.2,
  /** Fraction kept in the flats. Crests keep all of theirs. */
  valleyThin: 0.88,
  crestGain: 1.1,

  /* ── Draped paths ───────────────────────────────────────────────────────── */
  pathCount: 900,
  pathRes: 340,
  pathOpacity: 0.36,
  /** Depth wander, as a fraction of the local gap between paths. */
  pathWarp: 1.15,
  /** Dotted samples along the paths. */
  pathDotStride: 1,
  pathDotKeep: 0.45,
  pathDotOpacity: 0.75,

  /* ── Drift and haze ─────────────────────────────────────────────────────── */
  driftCount: 1800,
  driftHeight: 6.5,
  driftOpacity: 0.32,
  hazeCount: 260,
  hazeOpacity: 0.07,

  /* ── Camera ─────────────────────────────────────────────────────────────── */
  camY: 8.5,
  camZ: 40,
  aimY: 10.5,
  aimZ: -52,
  fov: 44,
  /** How far the camera presses forward across the section's scroll. */
  scrollPush: 20,

  /* ── Motion ─────────────────────────────────────────────────────────────── */
  idleSpeed: 0.04,
  parallax: 1.0,
  pointerRadius: 0.4,
  pointerForce: 0.055,

  /* ── Quality ────────────────────────────────────────────────────────────── */
  maxDpr: 2,
};

export type MountainConfig = typeof MOUNTAIN;

/* ── Shared GLSL ──────────────────────────────────────────────────────────
   The skeleton is unrolled into constants at build time rather than passed as
   uniform arrays: it is authored data that never changes at runtime, and a flat
   sequence of adds compiles to something the GPU can schedule without a loop. */

const n1 = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : "0.0000");

function skeletonGLSL(C: MountainConfig): string {
  const masses = C.masses
    .map((m, i) => {
      const a = (m.rot * Math.PI) / 180;
      return `  { vec2 q = p - vec2(${n1(m.x)}, ${n1(m.z)});
    q = vec2(q.x * ${n1(Math.cos(a))} + q.y * ${n1(Math.sin(a))}, -q.x * ${n1(Math.sin(a))} + q.y * ${n1(Math.cos(a))});
    q /= vec2(${n1(m.rx)}, ${n1(m.rz)});
    float g${i} = exp(-dot(q, q));
    h = max(h, g${i} * ${n1(m.h)});
    cr = max(cr, smoothstep(0.3, 0.85, g${i}) * ${n1(m.crest ?? 0)}); }`;
    })
    .join("\n");

  const ridges = C.ridges
    .map((r, i) => {
      const bax = r.bx - r.ax;
      const baz = r.bz - r.az;
      const len2 = bax * bax + baz * baz;
      return `  { vec2 pa = p - vec2(${n1(r.ax)}, ${n1(r.az)});
    vec2 ba = vec2(${n1(bax)}, ${n1(baz)});
    float t${i} = clamp(dot(pa, ba) / ${n1(len2)}, 0.0, 1.0);
    float d${i} = length(pa - ba * t${i}) / ${n1(r.w)};
    float g${i} = exp(-d${i} * d${i} * 1.35);
    h = max(h, g${i} * mix(${n1(r.ha)}, ${n1(r.hb)}, t${i}));
    cr = max(cr, smoothstep(0.3, 0.85, g${i}) * ${n1(r.crest ?? 0)}); }`;
    })
    .join("\n");

  return `
/* The designed range: masses, then the spines that join and descend from them.
   Forms combine by max, never by sum. Summing means every spine that meets at
   the summit adds its own height there and the peak leaves the frame as a
   spire; taking the greater of the two merges them the way real ground does,
   and each number in the table is then literally how tall that form is.

   Returns height in scene units; 'cr' carries how much of this point is
   ridgeline, which the brightening pass reads instead of slope (slope alone
   lights whole faces rather than their crests). */
float skeleton(vec2 p, out float cr) {
  float h = 0.0;
  cr = 0.0;
${masses}
${ridges}
  return h;
}
`;
}

const TERRAIN_NOISE = `
uniform float uTime;
uniform float uNoiseScale;
uniform float uWarp;
uniform float uAmpRidge;
uniform float uAmpFbm;
uniform float uAmpFine;
uniform float uAmpGully;
uniform float uDetailFloor;
uniform float uFgAmp;
uniform float uFgScale;
uniform float uFgFront;
uniform float uFgBack;

float fbm3(vec2 p, float t) {
  return snoise(vec3(p, t)) * 0.5
       + snoise(vec3(p * 2.03 + 7.0, t)) * 0.26
       + snoise(vec3(p * 4.11 + 19.0, t)) * 0.13;
}

/* Ridged noise: inverting |noise| turns rounded hills into sharp crests, which
   is what a range needs — fbm alone reads as dunes. Squaring each octave
   sharpens the crest and deepens the trough. Normalised to [0, 1]. */
float ridged3(vec2 p, float t) {
  /* The two octaves that carry the shape are sampled at a fixed time. The
     skyline is the composition — it was tuned against a reference frame and it
     has to stay tuned — so the idle animation is confined to the octaves that
     only texture the surface. Drifting the large ones moved the summit by a
     fifteenth of the frame in under a minute. */
  float r0 = 1.0 - abs(snoise(vec3(p, 0.0)));
  float r1 = 1.0 - abs(snoise(vec3(p * 2.11 + 5.0, 0.0)));
  /* The third is deliberately light. It is the finest thing the lines follow,
     and at full weight it creases them into chevrons. */
  float r2 = 1.0 - abs(snoise(vec3(p * 4.27 + 23.0, t * 0.5)));
  return (r0 * r0 * 0.54 + r1 * r1 * 0.3 + r2 * r2 * 0.09) / 0.93;
}

/* The flowing surface: designed skeleton, three carved octaves, and the rolling
   near ground. This is what the draped lines follow.

   'local' comes back as how much designed mass sits here, and 'crest' as the
   ridgeline weight — designed spines plus wherever the ridged octave is near its
   own crest. Both are by-products of work already done, so nothing re-reads the
   skeleton to get them. */
float terrainFlow(vec2 p, float t, out float crest, out float local) {
  float cr;
  float sk = skeleton(p, cr);

  vec2 n = p * uNoiseScale;
  /* Domain warp before sampling: straight parallel creases are the giveaway of
     raw ridged noise, and a warp bends them into something geological. */
  vec2 wn = n + vec2(snoise(vec3(n * 0.82 + 5.1, 0.0)), snoise(vec3(n * 0.82 + 19.7, 0.0))) * uWarp;
  float rg = ridged3(wn, t);
  float fb = fbm3(n * 2.1 + 31.0, t * 0.45);

  /* Detail scales with how much designed mass is underneath, in proportion
     rather than as a threshold: the summit erodes hard, the shoulders less, the
     open ground barely at all. A threshold gave every part of the range the
     same treatment and the whole thing came out a field of equal spikes. */
  local = clamp(sk / 30.0, 0.0, 1.0);
  float w = uDetailFloor + local;

  /* The ridged octave carves rather than piles. Adding it puts a spire on every
     crest it finds; subtracting (1 - ridged) cuts gullies down into the designed
     mass instead, which is what erosion does and what the reference shows —
     long branching channels between ridges, not a bed of nails. */
  float h = sk - (1.0 - rg) * uAmpRidge * w + fb * uAmpFbm * (uDetailFloor + local * 0.55);

  /* Broad rolling undulation, ramping up toward the camera: the foreground. */
  float near = smoothstep(uFgBack, uFgFront, p.y);
  h += snoise(vec3(p * uFgScale, 0.0)) * uFgAmp * near;
  h += snoise(vec3(p * uFgScale * 2.37 + 9.0, t * 0.6)) * uFgAmp * 0.42 * near;
  h += snoise(vec3(p * uFgScale * 5.1 + 27.0, t * 1.1)) * uFgAmp * 0.1 * near;

  crest = clamp(cr + smoothstep(0.58, 0.94, rg) * 0.85, 0.0, 1.6);
  return h;
}

/* What the lines follow. */
float terrainLine(vec2 p, float t, out float crest) {
  float local;
  return terrainFlow(p, t, crest, local);
}

/* The surface the points sit on and the depth occluder copies: the flowing form
   with a fine gully octave cut into it.

   Three surfaces rather than one, because lines and points want opposite things.
   A slice taken across close-set gullies zigzags, and a family of zigzagging
   slices reads as a triangulated mesh — the one thing this must never look like.
   Points want that detail; lines must not have it. The fine octave is therefore
   carve-only, so this surface is always at or below the one the lines follow and
   a line can never sink beneath the ground it is drawn on. */
float terrainBase(vec2 p, float t, out float crest) {
  float local;
  float h = terrainFlow(p, t, crest, local);
  /* Fixed in time as well. The gullies are the deepest cut in the surface and
     animating them moved the skyline more than everything else put together;
     the visible life belongs in the finer octave the points read, which cannot
     reach the silhouette. */
  float r = 1.0 - abs(snoise(vec3(p * uNoiseScale * 8.9 + 47.0, 0.0)));
  return h - (1.0 - r * r) * uAmpGully * (uDetailFloor + local);
}

/* The points read one octave finer again. The gap is deliberate and small: it
   has to stay under 'occluderDrop' or a point sitting in a crevice would be
   hidden by its own ground. */
float terrainDetail(vec2 p, float t, out float crest) {
  float h = terrainBase(p, t, crest);
  h += snoise(vec3(p * uNoiseScale * 19.0 + 71.0, t * 1.6)) * uAmpFine;
  return h;
}

/* A cheap two-octave read of the same surface, used only for normals. Shading
   wants the broad form, not per-point noise, and a normal costs three height
   samples — taking them off the full field would double what every particle in
   the scene costs for detail nobody can see in a shading term. */
float terrainCoarse(vec2 p, float t) {
  float cr;
  float sk = skeleton(p, cr);
  vec2 n = p * uNoiseScale;
  vec2 wn = n + vec2(snoise(vec3(n * 0.82 + 5.1, 0.0)), snoise(vec3(n * 0.82 + 19.7, 0.0))) * uWarp;
  float r0 = 1.0 - abs(snoise(vec3(wn, 0.0)));
  float r1 = 1.0 - abs(snoise(vec3(wn * 2.11 + 5.0, 0.0)));
  float rg = r0 * r0 * 0.64 + r1 * r1 * 0.36;
  float local = clamp(sk / 30.0, 0.0, 1.0);
  float h = sk - (1.0 - rg) * uAmpRidge * (uDetailFloor + local);
  float near = smoothstep(uFgBack, uFgFront, p.y);
  h += snoise(vec3(p * uFgScale, 0.0)) * uFgAmp * near;
  return h;
}

/* One directional term, not a lighting model. The reference is plainly lit from
   the upper left — bright left flanks, shadowed right ones, dark valley floors —
   and without it a field of equal-brightness dots has no form at all. */
float terrainLight(vec3 nrm) {
  float d = max(dot(nrm, normalize(vec3(-0.58, 0.55, 0.6))), 0.0);
  // Bent rather than linear: the gentle foreground swells sit in a narrow band
  // of this term, and a straight ramp leaves them all the same grey.
  return 0.13 + 0.87 * pow(d, 1.4);
}

vec3 terrainNormal(vec2 p, float t, float e) {
  float h = terrainCoarse(p, t);
  float hx = terrainCoarse(p + vec2(e, 0.0), t);
  float hz = terrainCoarse(p + vec2(0.0, e), t);
  return normalize(vec3((h - hx) / e, 1.0, (h - hz) / e));
}
`;

/* Screen-space pointer push, shared by every layer — the occluder included, so
   a displaced surface still hides what is behind it. */
const POINTER = `
/* Copy guard: the field dims where the editorial block sits. A scrim over the
   canvas would flatten the whole corner; dimming the particles themselves keeps
   the terrain present behind the type without ever competing with it. */
float copyGuard(vec2 ndc) {
  float gx = smoothstep(0.1, -0.52, ndc.x);
  float gy = smoothstep(0.02, -0.56, ndc.y);
  return 1.0 - 0.7 * gx * gy;
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
  float rr = max(uPointerRadius * uPointerRadius, 1e-4);
  float infl = exp(-r2 / rr) * uPointerIn;
  if (infl < 0.002) return vec2(0.0);
  float r = sqrt(r2);
  /* Tangential, not radial: pushing straight outward opens a circular hole.
     Sliding the surface sideways deforms it without punching through it. */
  vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
  vec2 tang = vec2(-dir.y, dir.x);
  return (tang * 0.75 + dir * 0.25) * infl * uPointerForce * depthScale;
}
`;

/* ── Depth occluder ───────────────────────────────────────────────────────
   A triangulated copy of the surface, drawn with the colour mask closed. It
   contributes nothing visible; it exists so that points and lines on the far
   side of a ridge fail the depth test instead of shining through it. Sitting
   `occluderDrop` below the drawn surface keeps it from z-fighting with the very
   points it is there to protect. */

const occluderVertex = (terrain: string) => `#version 300 es
precision highp float;

in vec2 aCell;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uDrop;
uniform float uCamDist;
uniform float uDebug;

${SIMPLEX_3D}
${terrain}
${POINTER}

out float vShade;

void main() {
  float crest;
  float h = terrainBase(aCell, uTime, crest) - uDrop;
  vec4 mv = modelViewMatrix * vec4(aCell.x, h, aCell.y, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  /* The same displacement the visible layers get. A surface that did not move
     with them would occlude the wrong things the moment the cursor arrived. */
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 2.0));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  vShade = 0.0;
  if (uDebug > 0.5) {
    vec3 n = terrainNormal(aCell, uTime, 1.4);
    vShade = 0.1 + 0.9 * max(dot(n, normalize(vec3(-0.35, 0.85, 0.4))), 0.0);
    vShade *= 1.0 - smoothstep(uCamDist * 1.6, uCamDist * 5.0, dist);
  }
}
`;

const occluderFragment = `#version 300 es
precision highp float;
in float vShade;
uniform float uDebug;
out vec4 fragColor;

void main() {
  // Only ever seen with debugSurface; in the real frame the colour mask is
  // closed and this write is discarded by the pipeline.
  fragColor = vec4(vec3(vShade) * uDebug, uDebug);
}
`;

/* ── Terrain points ───────────────────────────────────────────────────────── */

const pointVertex = (terrain: string) => `#version 300 es
precision highp float;

in vec2 aCell;
in vec3 aRand;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uPointSize;
uniform float uDpr;
uniform float uBrightness;
uniform float uValleyThin;
uniform float uCrestGain;
uniform float uReveal;
uniform float uCamDist;

${SIMPLEX_3D}
${terrain}
${POINTER}

out float vAlpha;

void main() {
  vec2 p = aCell;
  float crest;
  float h = terrainDetail(p, uTime, crest);

  vec4 mv = modelViewMatrix * vec4(p.x, h, p.y, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 2.0));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  vec3 nrm = terrainNormal(p, uTime, 1.2);
  float slope = clamp(1.0 - nrm.y, 0.0, 1.0);
  float steep = smoothstep(0.012, 0.26, slope);
  float ridge = smoothstep(0.18, 0.95, crest);

  /* Most points stay tiny. A minority run larger and brighter, and it is that
     minority that gives the crests their broken silver texture rather than an
     even grey wash. */
  float big = step(0.86, aRand.y);
  gl_PointSize = clamp(
    uPointSize * uDpr * (0.55 + aRand.y * 0.45 + big * 0.5) * (uCamDist * 1.35 / dist),
    0.5, 2.4);

  /* Density carried in alpha, not in the buffer: thinning the buffer would mean
     rebuilding it every time the terrain moved. Flats drop points, ridges keep
     all of theirs. */
  float keep = step(aRand.z, mix(uValleyThin, 1.0, max(steep * 1.15, ridge)));
  /* Distance haze — without it the far range reads as the same flat sheet of
     dots as the foreground. */
  float fog = 1.0 - smoothstep(uCamDist * 1.5, uCamDist * 4.4, dist);
  // The closest ground softens out rather than running off the bottom edge at
  // full strength, the way a wide lens loses its near field.
  fog *= smoothstep(uCamDist * 0.16, uCamDist * 0.62, dist);
  float shimmer = 0.88 + 0.12 * sin(uTime * 11.0 + aRand.x * 62.8);

  /* A wide per-point spread so the mass layers instead of reading flat, lifted
     on crests and again where the designed spines run. */
  float weight = mix(0.12, 0.8, aRand.x) * (0.42 + steep * 0.45 + ridge * uCrestGain);
  vAlpha = keep * fog * uBrightness * uReveal * shimmer * weight
         * terrainLight(nrm) * copyGuard(ndc);
}
`;

const pointFragment = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q);
  if (r > 0.25) discard;
  float a = (1.0 - r * 4.0) * vAlpha;
  if (a <= 0.002) discard;
  fragColor = vec4(uColor * a, a);
}
`;

/* ── Draped paths ─────────────────────────────────────────────────────────
   Families of lines running across the landscape, separated in depth and
   wandering in it, so they never read as ruled rows. Each samples its height
   from the same surface the points do, which is what makes them sweep over
   ridges and sag through valleys instead of floating above them.

   Adjacent paths are never joined: no cross-connections, no triangle edges, no
   grid. Each is an independent strip. */

const pathVertex = (terrain: string) => `#version 300 es
precision highp float;

in vec2 aCell;
in vec2 aMeta;   // x: per-path seed, y: position along the path, 0..1

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uReveal;
uniform float uCamDist;

${SIMPLEX_3D}
${terrain}
${POINTER}

out float vAlpha;

void main() {
  vec2 p = aCell;
  float crest;
  float h = terrainLine(p, uTime, crest);

  vec4 mv = modelViewMatrix * vec4(p.x, h, p.y, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 1.5));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  vec3 nrm = terrainNormal(p, uTime, 1.3);
  float steep = smoothstep(0.012, 0.24, clamp(1.0 - nrm.y, 0.0, 1.0));
  float ridge = smoothstep(0.2, 0.95, crest);

  float seed = aMeta.x;
  float fog = (1.0 - smoothstep(uCamDist * 1.4, uCamDist * 4.0, dist))
            * smoothstep(uCamDist * 0.16, uCamDist * 0.62, dist);

  /* Soft interruptions: two slow waves along the path beat against each other
     so each line thins and returns at its own intervals. Nothing blinks — the
     gaps are long and the edges are smooth. */
  float wob = sin(p.x * 0.031 + seed * 31.4) * 0.6 + sin(p.x * 0.0115 + seed * 17.7) * 0.4;
  float breaks = smoothstep(-0.72, -0.26, wob);

  /* Gradual variation along the length, and a slow breath per path. */
  float along = 0.76 + 0.24 * sin(p.x * 0.008 + seed * 9.1);
  float breath = 0.8 + 0.2 * sin(uTime * (5.0 + seed * 7.0) + seed * 40.0);

  /* Drawn on from the foreground back, so the reveal reads as a survey. */
  float order = clamp((p.y + 170.0) / 200.0, 0.0, 1.0);
  float drawn = clamp((uReveal - 0.06) * 2.4 - (1.0 - order) * 0.4, 0.0, 1.0);

  /* Foreground paths stay long and readable; distant ones fine down and fade. */
  float near = smoothstep(-120.0, 10.0, p.y);
  float body = mix(0.5, 1.0, near);

  vAlpha = fog * drawn * breaks * along * breath * body
         * (0.6 + steep * 0.45 + ridge * 0.25)
         * (0.55 + terrainLight(nrm) * 0.7)
         * (0.7 + seed * 0.45) * copyGuard(ndc);
}
`;

const pathFragment = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;

void main() {
  float a = vAlpha * uOpacity;
  if (a <= 0.002) discard;
  fragColor = vec4(uColor * a, a);
}
`;

/* Dotted samples taken along the same paths — the broken, beaded quality in the
   reference is lines and dots occupying the same curves, not two unrelated
   systems. Shares the path shader's height and shaping, drawn as points. */

const pathDotVertex = (terrain: string) => `#version 300 es
precision highp float;

in vec2 aCell;
in vec2 aMeta;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uReveal;
uniform float uCamDist;
uniform float uDpr;
uniform float uPointSize;

${SIMPLEX_3D}
${terrain}
${POINTER}

out float vAlpha;

void main() {
  vec2 p = aCell;
  float crest;
  float h = terrainBase(p, uTime, crest);

  vec4 mv = modelViewMatrix * vec4(p.x, h, p.y, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 1.5));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float seed = aMeta.x;
  gl_PointSize = clamp(uPointSize * uDpr * (0.6 + fract(seed * 91.7) * 0.7) * (uCamDist * 1.35 / dist), 0.5, 2.6);

  vec3 nrm = terrainNormal(p, uTime, 1.3);
  float steep = smoothstep(0.012, 0.24, clamp(1.0 - nrm.y, 0.0, 1.0));
  float ridge = smoothstep(0.2, 0.95, crest);
  float fog = (1.0 - smoothstep(uCamDist * 1.4, uCamDist * 4.0, dist))
            * smoothstep(uCamDist * 0.16, uCamDist * 0.62, dist);
  float wob = sin(p.x * 0.031 + seed * 31.4) * 0.6 + sin(p.x * 0.0115 + seed * 17.7) * 0.4;
  float breaks = smoothstep(-0.72, -0.26, wob);
  float drawn = clamp((uReveal - 0.06) * 2.4, 0.0, 1.0);

  vAlpha = fog * drawn * breaks * (0.35 + steep * 0.6 + ridge * 0.6)
         * terrainLight(nrm)
         * (0.5 + fract(seed * 57.3) * 0.7) * copyGuard(ndc);
}
`;

/* ── Drift ────────────────────────────────────────────────────────────────
   A few grains hanging just above the surface. Sparse by design: this is the
   one layer allowed to leave the terrain, and any more of it would read as a
   starfield. */

const driftVertex = (terrain: string) => `#version 300 es
precision highp float;

in vec2 aCell;
in vec3 aRand;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float uDpr;
uniform float uReveal;
uniform float uCamDist;
uniform float uDriftHeight;

${SIMPLEX_3D}
${terrain}
${POINTER}

out float vAlpha;

void main() {
  vec2 p = aCell + vec2(sin(uTime * 0.5 + aRand.x * 62.8), cos(uTime * 0.42 + aRand.y * 62.8)) * 2.4;
  float crest;
  float h = terrainBase(p, uTime, crest);
  h += (0.25 + aRand.z * 0.75) * uDriftHeight + sin(uTime * 1.7 + aRand.x * 31.4) * 0.5;

  vec4 mv = modelViewMatrix * vec4(p.x, h, p.y, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);
  ndc += pointerPush(ndc, clamp(uCamDist / dist, 0.3, 2.0));
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  gl_PointSize = clamp(1.5 * uDpr * (0.6 + aRand.z * 0.6) * (uCamDist * 1.3 / dist), 0.5, 2.0);
  float fog = 1.0 - smoothstep(uCamDist * 1.3, uCamDist * 3.6, dist);
  vAlpha = uReveal * fog * (0.2 + aRand.x * 0.8) * copyGuard(ndc);
}
`;

/* ── Haze ─────────────────────────────────────────────────────────────────── */

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
  vec3 pos = aPos;
  pos.x += sin(uTime * 0.12 + aRand.x * 6.28) * 9.0;
  pos.y += sin(uTime * 0.09 + aRand.y * 6.28) * 2.0;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(-mv.z, 0.1);
  gl_PointSize = clamp((8.0 + aRand.x * 14.0) * uDpr * (100.0 / dist), 4.0, 44.0);
  vAlpha = uReveal * (0.3 + aRand.y * 0.7) * (1.0 - smoothstep(90.0, 300.0, dist));
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

/** Seeded PRNG. The scatter has to be identical on every load, or two
 *  screenshots of the same build are not comparable. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface ParticleMountainProps {
  /** Overrides merged over MOUNTAIN. */
  config?: Partial<MountainConfig>;
  /** Terrain, path and drift colour. */
  color?: string;
  /** Haze colour. */
  hazeColor?: string;
  /** Scales the whole scene's opacity. */
  opacity?: number;
  /** Development only: draws the depth occluder as a shaded surface so the
   *  silhouette can be judged without the particles on top of it. Never on in
   *  the delivered composition. */
  debugSurface?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function ParticleMountain({
  config,
  color = "#E8EAF2",
  hazeColor = "#9BA6BF",
  opacity = 1,
  debugSurface = false,
  style,
  className,
}: ParticleMountainProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const C: MountainConfig = { ...MOUNTAIN, ...config };
    const rnd = mulberry32(0x5eed10);

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* Narrow viewports get a coarser everything. The silhouette is the thing to
       protect; resolution is not. */
    const narrow = window.innerWidth < 820;
    const q = narrow ? 0.62 : 1;
    const cols = Math.round(C.cols * q);
    const rows = Math.round(C.rows * q);
    const occCols = Math.round(C.occluderCols * (narrow ? 0.7 : 1));
    const occRows = Math.round(C.occluderRows * (narrow ? 0.7 : 1));
    const pathCount = Math.round(C.pathCount * (narrow ? 0.6 : 1));
    const pathRes = Math.round(C.pathRes * (narrow ? 0.7 : 1));
    const driftCount = Math.round(C.driftCount * (narrow ? 0.5 : 1));
    const hazeCount = Math.round(C.hazeCount * (narrow ? 0.5 : 1));
    const allowPointer = !narrow;
    // A narrow frame has no room for an off-axis summit, so the camera lines up
    // on the peak rather than on the range's centre.
    const aimX = narrow ? C.masses[0].x : 0;

    const dpr = Math.min(window.devicePixelRatio || 1, C.maxDpr);
    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: true,
      dpr,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);

    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const camera = new Camera(gl, { fov: C.fov, near: 0.5, far: 700 });
    const occluderScene = new Transform();
    const scene = new Transform();

    const halfW = C.terrainWidth / 2;
    const depth = C.nearZ - C.farZ;
    const terrainGLSL = skeletonGLSL(C) + TERRAIN_NOISE;

    /* Shared by reference across every program, so a change to the height field
       cannot desynchronise the layers from each other. */
    const terrainUniforms = {
      uTime: { value: 0 },
      uNoiseScale: { value: C.noiseScale },
      uWarp: { value: C.warp },
      uAmpRidge: { value: C.ampRidge },
      uAmpFbm: { value: C.ampFbm },
      uAmpFine: { value: C.ampFine },
      uAmpGully: { value: C.ampGully },
      uDetailFloor: { value: C.detailFloor },
      uFgAmp: { value: C.fgAmp },
      uFgScale: { value: C.fgScale },
      uFgFront: { value: C.fgFront },
      uFgBack: { value: C.fgBack },
    };
    const pointerUniforms = {
      uMouse: { value: new Float32Array([0, -2]) },
      uAspect: { value: 1 },
      uPointerIn: { value: 0 },
      uPointerRadius: { value: C.pointerRadius },
      uPointerForce: { value: allowPointer ? C.pointerForce : 0 },
    };

    /* Sample placement. Spacing at the centre is `k` of uniform and grows
       smoothly outward; the derivative never reaches zero, so no column of the
       lattice collapses onto a single line. */
    const spread = (u: number, k: number) => u * (k + (1 - k) * u * u);
    const xAt = (c: number, n: number) => halfW * spread((c / (n - 1)) * 2 - 1, C.packX);
    const zAt = (r: number, n: number) => C.nearZ - spread(r / (n - 1), C.packZ) * depth;

    // ── Terrain points ──────────────────────────────────────────────────────
    const count = cols * rows;
    const cell = new Float32Array(count * 2);
    const rand = new Float32Array(count * 3);
    const xs = Array.from({ length: cols }, (_, c) => xAt(c, cols));
    const zs = Array.from({ length: rows }, (_, r) => zAt(r, rows));
    for (let r = 0; r < rows; r++) {
      const dz = Math.abs((zs[Math.min(r + 1, rows - 1)] ?? zs[r]) - (zs[Math.max(r - 1, 0)] ?? zs[r])) / 2 || 1;
      for (let c = 0; c < cols; c++) {
        const dx = Math.abs((xs[Math.min(c + 1, cols - 1)] ?? xs[c]) - (xs[Math.max(c - 1, 0)] ?? xs[c])) / 2 || 1;
        const i = r * cols + c;
        // Jittered once, at build time. On a bare lattice the eye finds the grid
        // instantly, and the positions never change after this.
        cell[i * 2] = xs[c] + (rnd() - 0.5) * dx * 1.9;
        cell[i * 2 + 1] = zs[r] + (rnd() - 0.5) * dz * 1.9;
        rand[i * 3] = rnd();
        rand[i * 3 + 1] = rnd();
        rand[i * 3 + 2] = rnd();
      }
    }

    const pointProgram = new Program(gl, {
      vertex: pointVertex(terrainGLSL),
      fragment: pointFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      cullFace: null as never,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uPointSize: { value: C.pointSize },
        uDpr: { value: dpr },
        uBrightness: { value: C.brightness },
        uValleyThin: { value: C.valleyThin },
        uCrestGain: { value: C.crestGain },
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    pointProgram.setBlendFunc(gl.ONE, gl.ONE);
    new Mesh(gl, {
      geometry: new Geometry(gl, { aCell: { size: 2, data: cell }, aRand: { size: 3, data: rand } }),
      program: pointProgram,
      mode: gl.POINTS,
    }).setParent(scene);

    // ── Depth occluder ──────────────────────────────────────────────────────
    const occCell = new Float32Array(occCols * occRows * 2);
    for (let r = 0; r < occRows; r++) {
      const z = zAt(r, occRows);
      for (let c = 0; c < occCols; c++) {
        const i = r * occCols + c;
        occCell[i * 2] = xAt(c, occCols);
        occCell[i * 2 + 1] = z;
      }
    }
    const occIndex = new Uint32Array((occCols - 1) * (occRows - 1) * 6);
    let oi = 0;
    for (let r = 0; r < occRows - 1; r++) {
      for (let c = 0; c < occCols - 1; c++) {
        const a = r * occCols + c;
        const b = a + 1;
        const d = a + occCols;
        const e = d + 1;
        occIndex[oi++] = a; occIndex[oi++] = d; occIndex[oi++] = b;
        occIndex[oi++] = b; occIndex[oi++] = d; occIndex[oi++] = e;
      }
    }
    const occluderProgram = new Program(gl, {
      vertex: occluderVertex(terrainGLSL),
      fragment: occluderFragment,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      // Heightfield triangles are seen edge-on near the silhouette; culling
      // either winding there would open holes in the very place depth matters.
      cullFace: null as never,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uDrop: { value: C.occluderDrop },
        uCamDist: { value: C.camZ },
        uDebug: { value: debugSurface ? 1 : 0 },
      },
    });
    occluderProgram.setBlendFunc(gl.ONE, gl.ZERO);
    new Mesh(gl, {
      geometry: new Geometry(gl, {
        aCell: { size: 2, data: occCell },
        index: { data: occIndex },
      }),
      program: occluderProgram,
      mode: gl.TRIANGLES,
    }).setParent(occluderScene);

    /* ── Draped paths ───────────────────────────────────────────────────────
       Each path runs across the field at roughly constant depth, wandering in
       depth as it goes so the family never reads as ruled rows. Projected, they
       become the long nested arcs and hanging curtains of the reference: a
       constant-depth cut over a ridge rises and falls exactly where the ridge
       does.

       Adjacent paths are never joined. Every strip is independent — no
       cross-connections, no triangle edges, no grid. */
    const pathPts: Float32Array[] = [];
    const pathSeeds: number[] = [];
    for (let k = 0; k < pathCount; k++) {
      const f = k / (pathCount - 1);
      const zBase = C.nearZ - spread(f, C.packZ) * depth;
      const zNext = C.nearZ - spread(Math.min(f + 1 / (pathCount - 1), 1), C.packZ) * depth;
      const gap = Math.abs(zNext - zBase) || 1;
      const amp = gap * C.pathWarp * (0.6 + rnd() * 0.9);
      const ph1 = rnd() * Math.PI * 2;
      const ph2 = rnd() * Math.PI * 2;
      const seed = rnd();
      const pts = new Float32Array((pathRes + 1) * 2);
      for (let i = 0; i <= pathRes; i++) {
        // Reaches past both edges of the field, so no path ends inside frame.
        const x = -halfW * 1.1 + (i / pathRes) * C.terrainWidth * 1.2;
        pts[i * 2] = x;
        pts[i * 2 + 1] = zBase + amp * (Math.sin(x * 0.021 + ph1) + 0.55 * Math.sin(x * 0.047 + ph2));
      }
      pathPts.push(pts);
      pathSeeds.push(seed);
    }

    const segTotal = pathCount * pathRes;
    const pathCell = new Float32Array(segTotal * 2 * 2);
    const pathMeta = new Float32Array(segTotal * 2 * 2);
    let pw = 0;
    let pm = 0;
    for (let k = 0; k < pathCount; k++) {
      const pts = pathPts[k];
      const seed = pathSeeds[k];
      for (let i = 0; i < pathRes; i++) {
        const t0 = i / pathRes;
        const t1 = (i + 1) / pathRes;
        pathCell[pw++] = pts[i * 2]; pathCell[pw++] = pts[i * 2 + 1];
        pathCell[pw++] = pts[(i + 1) * 2]; pathCell[pw++] = pts[(i + 1) * 2 + 1];
        pathMeta[pm++] = seed; pathMeta[pm++] = t0;
        pathMeta[pm++] = seed; pathMeta[pm++] = t1;
      }
    }
    const pathProgram = new Program(gl, {
      vertex: pathVertex(terrainGLSL),
      fragment: pathFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      cullFace: null as never,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uOpacity: { value: C.pathOpacity },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    pathProgram.setBlendFunc(gl.ONE, gl.ONE);
    new Mesh(gl, {
      geometry: new Geometry(gl, {
        aCell: { size: 2, data: pathCell },
        aMeta: { size: 2, data: pathMeta },
      }),
      program: pathProgram,
      mode: gl.LINES,
    }).setParent(scene);

    /* Dotted samples along the same curves. Irregular by construction — a
       coin flip per sample, not a fixed stride, or the beading reads as a
       dashed line. */
    const dotCell: number[] = [];
    const dotMeta: number[] = [];
    for (let k = 0; k < pathCount; k++) {
      const pts = pathPts[k];
      const seed = pathSeeds[k];
      for (let i = 0; i <= pathRes; i += C.pathDotStride) {
        if (rnd() > C.pathDotKeep) continue;
        dotCell.push(pts[i * 2], pts[i * 2 + 1]);
        dotMeta.push(seed + i * 0.0013, i / pathRes);
      }
    }
    const pathDotProgram = new Program(gl, {
      vertex: pathDotVertex(terrainGLSL),
      fragment: pointFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      cullFace: null as never,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uDpr: { value: dpr },
        uPointSize: { value: C.pointSize * C.pathDotOpacity + 0.4 },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    pathDotProgram.setBlendFunc(gl.ONE, gl.ONE);
    new Mesh(gl, {
      geometry: new Geometry(gl, {
        aCell: { size: 2, data: new Float32Array(dotCell) },
        aMeta: { size: 2, data: new Float32Array(dotMeta) },
      }),
      program: pathDotProgram,
      mode: gl.POINTS,
    }).setParent(scene);

    // ── Drift ───────────────────────────────────────────────────────────────
    const driftCell = new Float32Array(driftCount * 2);
    const driftRand = new Float32Array(driftCount * 3);
    for (let i = 0; i < driftCount; i++) {
      driftCell[i * 2] = spread(rnd() * 2 - 1, 0.5) * halfW * 0.85;
      driftCell[i * 2 + 1] = C.nearZ - spread(rnd(), 0.45) * depth * 0.75;
      driftRand[i * 3] = rnd();
      driftRand[i * 3 + 1] = rnd();
      driftRand[i * 3 + 2] = rnd();
    }
    const driftProgram = new Program(gl, {
      vertex: driftVertex(terrainGLSL),
      fragment: pointFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      cullFace: null as never,
      uniforms: {
        ...terrainUniforms,
        ...pointerUniforms,
        uDpr: { value: dpr },
        uReveal: { value: 0 },
        uCamDist: { value: C.camZ },
        uDriftHeight: { value: C.driftHeight },
        uColor: { value: new Float32Array(hexToRgb(color)) },
      },
    });
    driftProgram.setBlendFunc(gl.ONE, gl.ONE);
    new Mesh(gl, {
      geometry: new Geometry(gl, {
        aCell: { size: 2, data: driftCell },
        aRand: { size: 3, data: driftRand },
      }),
      program: driftProgram,
      mode: gl.POINTS,
    }).setParent(scene);

    // ── Haze ────────────────────────────────────────────────────────────────
    const hazePos = new Float32Array(hazeCount * 3);
    const hazeRand = new Float32Array(hazeCount * 2);
    for (let i = 0; i < hazeCount; i++) {
      hazePos[i * 3] = (rnd() - 0.5) * C.terrainWidth * 1.1;
      hazePos[i * 3 + 1] = 5 + rnd() * 24;
      // Strictly behind the range. Anything in front of the ridgeline reads as
      // a smudge on the lens rather than as depth.
      hazePos[i * 3 + 2] = -95 + rnd() * 55;
      hazeRand[i * 2] = rnd();
      hazeRand[i * 2 + 1] = rnd();
    }
    const hazeProgram = new Program(gl, {
      vertex: hazeVertex,
      fragment: hazeFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      cullFace: null as never,
      uniforms: {
        uTime: terrainUniforms.uTime,
        uDpr: { value: dpr },
        uReveal: { value: 0 },
        uOpacity: { value: C.hazeOpacity },
        uColor: { value: new Float32Array(hexToRgb(hazeColor)) },
      },
    });
    hazeProgram.setBlendFunc(gl.ONE, gl.ONE);
    const hazeMesh = new Mesh(gl, {
      geometry: new Geometry(gl, {
        aPos: { size: 3, data: hazePos },
        aRand: { size: 2, data: hazeRand },
      }),
      program: hazeProgram,
      mode: gl.POINTS,
    });
    hazeMesh.setParent(scene);

    const pointerPrograms = [occluderProgram, pointProgram, pathProgram, pathDotProgram, driftProgram];
    const revealPrograms = [pointProgram, pathProgram, pathDotProgram, driftProgram];

    // ── Sizing ──────────────────────────────────────────────────────────────
    let vw = 1;
    let vh = 1;
    const setSize = () => {
      const rect = container.getBoundingClientRect();
      vw = Math.max(1, Math.floor(rect.width));
      vh = Math.max(1, Math.floor(rect.height));
      renderer.setSize(vw, vh);
      const aspect = vw / vh;
      // A narrow viewport needs a wider lens or the range loses its flanks and
      // the summit stops reading as the high point of anything.
      camera.perspective({ fov: aspect < 1 ? C.fov * 1.35 : C.fov, aspect });
      for (const prog of pointerPrograms) (prog.uniforms.uAspect.value as number) = aspect;
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

      /* Reveal and push follow the section's place in the viewport, so the
         terrain assembles as it arrives and the camera keeps pressing forward
         as the reader continues. */
      const rect = container.getBoundingClientRect();
      const enter = 1 - Math.max(0, Math.min(1, (rect.top + rect.height * 0.15) / (vh || 1)));
      const through = Math.max(0, Math.min(1, -rect.top / Math.max(rect.height, 1)));
      const wantReveal = reduceMotion ? 1 : Math.max(0, Math.min(1, enter * 1.25));
      reveal += (wantReveal - reveal) * (1 - Math.exp(-dt * 3.2));

      const k = 1 - Math.exp(-dt * 5);
      mouse[0] += (mouseTarget[0] - mouse[0]) * k;
      mouse[1] += (mouseTarget[1] - mouse[1]) * k;
      pointerIn += (pointerInTarget - pointerIn) * (1 - Math.exp(-dt * 3));

      /* Deliberately tiny. The camera should breathe with the pointer, not
         survey the scene from it — the silhouette has to stay put. */
      const par = reduceMotion ? 0 : C.parallax;
      camera.position.set(
        aimX + mouse[0] * par * 2.2,
        C.camY + mouse[1] * par * 1.1,
        C.camZ - through * C.scrollPush,
      );
      camera.lookAt([aimX, C.aimY + mouse[1] * par * 0.6, C.aimZ]);

      terrainUniforms.uTime.value = clock;
      for (const prog of pointerPrograms) {
        const u = prog.uniforms as any;
        (u.uMouse.value as Float32Array).set(mouse);
        u.uPointerIn.value = pointerIn;
        u.uCamDist.value = camera.position.z;
      }
      for (const prog of revealPrograms) {
        (prog.uniforms as any).uReveal.value = reveal * opacity;
      }
      (hazeProgram.uniforms.uReveal.value as number) = reveal * opacity;

      /* Two passes. The occluder lays down depth with the colour mask closed,
         then the visible layers draw against that depth buffer — which is what
         keeps the back of the range from shining through its own front. The
         clear has to happen with the mask open, so it is done by hand rather
         than left to the renderer. */
      gl.colorMask(true, true, true, true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!debugSurface) {
        gl.colorMask(false, false, false, false);
        renderer.render({ scene: occluderScene, camera, clear: false, sort: false, frustumCull: false });
        gl.colorMask(true, true, true, true);
      }
      if (debugSurface) {
        // Silhouette check: the surface alone, neutrally shaded, with none of
        // the particle layers on top of it to read through.
        renderer.render({ scene: occluderScene, camera, clear: false, sort: false, frustumCull: false });
      } else {
        renderer.render({ scene, camera, clear: false, sort: false, frustumCull: false });
      }

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
  }, [config, color, hazeColor, opacity, debugSurface]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "absolute", inset: 0, overflow: "hidden", ...style }}
    />
  );
}
