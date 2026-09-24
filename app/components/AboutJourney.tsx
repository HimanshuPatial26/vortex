"use client";

/* AboutJourney — a curved pathway of silver particles with three milestones on
   it and a small figure standing at its turning point.

   Built on ogl, like every other particle scene in this project, in one draw
   call. The shape is not noise: each strand of the ribbon is a Catmull-Rom
   centreline through authored control points (see journey.ts), with a frame
   carried along it — tangent, across, up — so the ribbon has a real width and a
   small thickness instead of being a tube or a painted stroke.

   The frames are sampled once on the CPU and uploaded to a float texture. The
   vertex shader reads that texture to place every particle, which is what lets
   the whole field flow along the curve on the GPU without the CPU touching a
   single particle per frame. Only the handful of things that need to be crisp
   HTML — the markers, the cards, the figure — are projected on the CPU. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Renderer, Camera, Transform, Program, Mesh, Geometry, Texture, Vec3 as OVec3 } from "ogl";
import { color, font } from "../theme";
import { JOURNEY, MILESTONES } from "./journey";
import type { JourneyConfig, JourneyStrand, Milestone, Vec3 } from "./journey";

/* ── Strand geometry, CPU side ─────────────────────────────────────────── */

interface Frames {
  pos: Float32Array;
  across: Float32Array;
  up: Float32Array;
  tan: Float32Array;
  halfWidth: Float32Array;
  thickness: Float32Array;
  density: Float32Array;
  glow: Float32Array;
  core: Float32Array;
}

/** Catmull-Rom through the points, t running 0..n-1 (one unit per segment). */
const catmull = (pts: Vec3[], t: number): Vec3 => {
  const n = pts.length;
  const i = Math.min(Math.max(Math.floor(t), 0), n - 2);
  const f = Math.min(Math.max(t - i, 0), 1);
  const p0 = pts[Math.max(i - 1, 0)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(i + 2, n - 1)];
  const f2 = f * f;
  const f3 = f2 * f;
  const out: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      0.5 *
      (2 * p1[k] +
        (-p0[k] + p2[k]) * f +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f3);
  }
  return out;
};

/** A per-point value, eased between points so width and glow never kink. */
const along = (arr: number[], t: number) => {
  const i = Math.min(Math.max(Math.floor(t), 0), arr.length - 2);
  const f = Math.min(Math.max(t - i, 0), 1);
  const e = f * f * (3 - 2 * f);
  return arr[i] + (arr[i + 1] - arr[i]) * e;
};

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/* Frames along a strand. "Across" is taken perpendicular to both the tangent
   and world up, so the ribbon stays level like a road instead of twisting the
   way a Frenet frame does wherever the curvature changes sign. The fallback to
   the previous frame keeps it from flipping if the tangent ever points nearly
   straight up. Banking is then applied as a rotation about the tangent. */
function buildFrames(strand: JourneyStrand, samples: number): Frames {
  const n = strand.points.length - 1;
  const fr: Frames = {
    pos: new Float32Array(samples * 3),
    across: new Float32Array(samples * 3),
    up: new Float32Array(samples * 3),
    tan: new Float32Array(samples * 3),
    halfWidth: new Float32Array(samples),
    thickness: new Float32Array(samples),
    density: new Float32Array(samples),
    glow: new Float32Array(samples),
    core: new Float32Array(samples),
  };
  let prevAcross: Vec3 = [1, 0, 0];
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * n;
    const p = catmull(strand.points, t);
    const a = catmull(strand.points, Math.max(t - 0.02, 0));
    const b = catmull(strand.points, Math.min(t + 0.02, n));
    const tan = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);

    let across = cross(tan, [0, 1, 0]);
    if (Math.hypot(across[0], across[1], across[2]) < 0.05) across = prevAcross;
    across = norm(across);
    // Keep the across vector pointing the same way along the whole strand.
    if (across[0] * prevAcross[0] + across[1] * prevAcross[1] + across[2] * prevAcross[2] < 0 && i > 0) {
      across = [-across[0], -across[1], -across[2]];
    }
    prevAcross = across;
    let up = norm(cross(across, tan));

    const bank = along(strand.bank, t);
    const c = Math.cos(bank);
    const s = Math.sin(bank);
    const acrossB: Vec3 = [
      across[0] * c + up[0] * s,
      across[1] * c + up[1] * s,
      across[2] * c + up[2] * s,
    ];
    up = norm(cross(acrossB, tan));

    fr.pos.set(p, i * 3);
    fr.across.set(acrossB, i * 3);
    fr.up.set(up, i * 3);
    fr.tan.set(tan, i * 3);
    fr.halfWidth[i] = along(strand.halfWidth, t);
    fr.thickness[i] = along(strand.thickness, t);
    fr.density[i] = along(strand.density, t);
    fr.glow[i] = along(strand.glow, t);
    fr.core[i] = along(strand.core, t);
  }
  return fr;
}

/** A point on the ribbon surface, for anchoring HTML to it. */
function pointOn(fr: Frames, samples: number, s: number, u: number, lift = 0.04): Vec3 {
  const x = Math.min(Math.max(s, 0), 1) * (samples - 1);
  const i0 = Math.floor(x);
  const i1 = Math.min(i0 + 1, samples - 1);
  const f = x - i0;
  const out: Vec3 = [0, 0, 0];
  const hw = fr.halfWidth[i0] + (fr.halfWidth[i1] - fr.halfWidth[i0]) * f;
  for (let k = 0; k < 3; k++) {
    const p = fr.pos[i0 * 3 + k] + (fr.pos[i1 * 3 + k] - fr.pos[i0 * 3 + k]) * f;
    const a = fr.across[i0 * 3 + k] + (fr.across[i1 * 3 + k] - fr.across[i0 * 3 + k]) * f;
    const up = fr.up[i0 * 3 + k] + (fr.up[i1 * 3 + k] - fr.up[i0 * 3 + k]) * f;
    out[k] = p + a * u * hw + up * lift;
  }
  return out;
}

/** Seeded, so the field is the same on every load. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ── Shaders ──────────────────────────────────────────────────────────── */

const vertex = `#version 300 es
precision highp float;

in vec4 aSU;    // strand, s, u (across), v (up)
in vec4 aRand;
in float aKind; // 0 surface, 1 inner stream, 2 scatter, 3 bokeh, 4 dust

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uFrames;
uniform int uSamples;
uniform float uTime;
uniform float uFlow;
uniform float uReveal;
uniform float uRevealMode;   // 0 sweep out from each strand's origin, 1 plain fade
uniform vec2 uRevealFrom;    // per strand
uniform float uDpr;
uniform float uSize;
uniform float uRefDist;
uniform float uFogNear;
uniform float uFogFar;
uniform float uBrightness;
uniform vec2 uMouse;
uniform float uAspect;
uniform float uPointerIn;
uniform float uPointerRadius;
uniform float uPointerForce;
uniform vec3 uHi;     // strand, s, amount — the selected milestone
uniform vec3 uHover;  // strand, s, amount — the one under the pointer
uniform vec4 uGuard;  // the copy block, in ndc: right edge, bottom edge, softness x, softness y

out float vAlpha;
out float vSoft;
out vec3 vColor;

vec4 frameAt(int strand, int row, float s) {
  float x = s * float(uSamples - 1);
  int i0 = int(floor(x));
  int i1 = min(i0 + 1, uSamples - 1);
  int y = strand * 5 + row;
  return mix(texelFetch(uFrames, ivec2(i0, y), 0), texelFetch(uFrames, ivec2(i1, y), 0), x - floor(x));
}

float bump(float s, float at, float w) {
  float d = (s - at) / w;
  return exp(-d * d);
}

void main() {
  int strand = int(aSU.x + 0.5);
  int kind = int(aKind + 0.5);

  /* Flow. Every particle travels along the strand at its own slow speed and
     wraps at the ends; both ends sit off screen and are faded, so the
     recycling is never seen. */
  float speed = uFlow * (0.55 + aRand.x * 0.9);
  float s = fract(aSU.y + uTime * speed);

  vec4 f0 = frameAt(strand, 0, s); // centre, half width
  vec4 f1 = frameAt(strand, 1, s); // across, thickness
  vec4 f2 = frameAt(strand, 2, s); // up, density
  vec4 f3 = frameAt(strand, 3, s); // tangent, glow
  float core = frameAt(strand, 4, s).x;

  /* Small surface fluctuation — the ribbon breathes, its silhouette does not
     move. */
  // The inner stream is placed relative to the core, which moves across the
  // band along the strand; everything else keeps its own place.
  float u = aSU.z + (kind == 1 ? core : 0.0) + 0.03 * sin(uTime * 0.35 + aRand.y * 6.2832 + s * 31.0);
  float v = aSU.w + 0.35 * sin(uTime * 0.5 + aRand.z * 6.2832 + s * 23.0);
  vec3 pos = f0.xyz + f1.xyz * (u * f0.w) + f2.xyz * (v * f1.w);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  float dist = max(-mv.z, 0.1);

  /* The pointer parts the field: mostly sideways, a little outward, with a
     gaussian falloff so there is no edge to the effect and no hole. */
  vec2 d = ndc - uMouse;
  d.x *= uAspect;
  float r2 = dot(d, d);
  float infl = exp(-r2 / max(uPointerRadius * uPointerRadius, 1e-4)) * uPointerIn;
  if (infl > 0.002) {
    float r = sqrt(r2);
    vec2 dir = r > 1e-4 ? d / r : vec2(0.0);
    vec2 push = (vec2(-dir.y, dir.x) * 0.6 + dir * 0.4) * infl * uPointerForce * clamp(uRefDist / dist, 0.4, 1.6);
    push.x /= uAspect;
    ndc += push;
  }
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float hi = uHi.z * bump(s, uHi.y, 0.045) * (strand == int(uHi.x + 0.5) ? 1.0 : 0.0);
  float hov = uHover.z * bump(s, uHover.y, 0.035) * (strand == int(uHover.x + 0.5) ? 1.0 : 0.0);
  float lift = hi + hov * 0.6;

  float grow = kind == 3 ? 5.0 + aRand.w * 7.0 : (kind == 1 ? 0.9 : 1.0);
  gl_PointSize = clamp(uSize * uDpr * (0.55 + aRand.w * 0.9) * (uRefDist / dist) * grow * (1.0 + lift * 0.3),
                       0.6, 30.0 * uDpr);

  /* Brightness by layer. */
  float glow = f3.w;
  float a;
  if (kind == 0) {
    // Brighter toward the middle of the band, so the surface has a core and
    // falls off to its edges instead of ending at a hard line.
    float dc = aSU.z - core;
    a = mix(0.14, 0.55, aRand.y) * (0.5 + glow * 0.22) * (0.35 + 0.65 * exp(-dc * dc * 1.8));
  } else if (kind == 1) {
    // The inner stream carries the light, and concentrates at the bend.
    a = mix(0.75, 1.45, aRand.y) * glow * exp(-aSU.z * aSU.z * 5.0);
  } else if (kind == 2) {
    float out_ = abs(aSU.z) - 1.0;
    a = mix(0.08, 0.32, aRand.y) * exp(-out_ * 2.2);
  } else if (kind == 3) {
    a = mix(0.025, 0.065, aRand.y);
  } else {
    a = mix(0.08, 0.28, aRand.y);
  }

  /* Density: a soft threshold rather than a count, so as particles flow through
     a denser or sparser stretch they fade instead of popping. */
  a *= smoothstep(aRand.z - 0.2, aRand.z + 0.2, f2.w);

  // Both ends of every strand sit off screen; fade there so wrapping is silent.
  a *= smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.93, 1.0, s));

  // The far ribbon softens into the dark.
  a *= 1.0 - smoothstep(uFogNear, uFogFar, dist) * 0.85;

  // Reveal.
  float from = strand == 0 ? uRevealFrom.x : uRevealFrom.y;
  float sweep = smoothstep(0.0, 1.0, uReveal * 1.6 - abs(aSU.y - from) * 1.25 - aRand.x * 0.25);
  a *= mix(sweep, uReveal, uRevealMode);

  // Keep the copy block in clean negative space.
  float gx = 1.0 - smoothstep(uGuard.x - uGuard.z, uGuard.x, ndc.x);
  float gy = smoothstep(uGuard.y - uGuard.w, uGuard.y, ndc.y);
  a *= 1.0 - 0.94 * gx * gy;

  a *= (1.0 + lift * 1.3) * uBrightness;
  vAlpha = a;
  vSoft = kind == 3 ? 1.0 : 0.0;

  vec3 silver = mix(vec3(0.8, 0.85, 0.95), vec3(1.0), aRand.w);
  // A very few warm specks; the rest stays neutral.
  if (aRand.x > 0.996) silver = vec3(1.0, 0.84, 0.66);
  vColor = mix(silver, vec3(0.7, 0.84, 1.0), clamp(hi * 0.45, 0.0, 0.6));
}
`;

const fragment = `#version 300 es
precision highp float;
in float vAlpha;
in float vSoft;
in vec3 vColor;
out vec4 fragColor;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q) * 4.0;
  if (r > 1.0) discard;
  float a = vSoft > 0.5 ? exp(-r * 3.0) * (1.0 - r) : 1.0 - smoothstep(0.3, 1.0, r);
  a *= vAlpha;
  if (a < 0.002) discard;
  fragColor = vec4(vColor * a, a);
}
`;

/* ── The figure ───────────────────────────────────────────────────────── */

/* Seen from behind, standing, facing along the path. Drawn in a 20×56 box
   with the feet at the bottom centre, which is the point pinned to the ribbon. */
const Figure = () => (
  <svg viewBox="0 0 20 56" width="100%" height="100%" aria-hidden style={{ display: "block", overflow: "visible" }}>
    <g fill="#050608">
      <ellipse cx="10" cy="5.2" rx="3.6" ry="4.2" />
      <path d="M6.6 10.2 Q10 9.2 13.4 10.2 L15.2 12.4 L16 25.5 L14.2 26 L13.4 18.5 L13 30.5 L12.6 54.6 L10.7 55 L10.2 33 L9.8 33 L9.3 55 L7.4 54.6 L7 30.5 L6.6 18.5 L5.8 26 L4 25.5 L4.8 12.4 Z" />
    </g>
  </svg>
);

/* ── Component ────────────────────────────────────────────────────────── */

export interface AboutJourneyProps {
  id?: string;
  /** Section number, so the label can match the page's own order. */
  index?: string;
  label?: string;
  heading?: ReactNode;
  body?: ReactNode;
  milestones?: Milestone[];
  /** id of the milestone expanded on first view. */
  initial?: string;
  /** Overrides merged over JOURNEY. */
  config?: Partial<JourneyConfig>;
  /** Caption in the lower-left corner. null hides it. */
  scrollHint?: string | null;
}

const CARD_W = 296;

export default function AboutJourney({
  id = "journey",
  index = "02",
  label = "ABOUT + JOURNEY",
  heading = (
    <>
      Curiosity sets
      <br />
      the direction.
    </>
  ),
  body = (
    <>
      The experiences and turning points
      <br />
      that shape how I think and build.
    </>
  ),
  milestones = MILESTONES,
  initial = "experience",
  config,
  scrollHint = "SCROLL TO EXPLORE",
}: AboutJourneyProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const figureRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const [active, setActive] = useState(() => Math.max(0, milestones.findIndex((m) => m.id === initial)));
  const [revealed, setRevealed] = useState(false);
  const [glFailed, setGlFailed] = useState(false);

  // The loop reads these rather than React state, so it never re-renders.
  const activeRef = useRef(active);
  activeRef.current = active;
  const hoverRef = useRef(-1);
  const overUiRef = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const host = hostRef.current;
    if (!section || !stage || !host) return;

    const C: JourneyConfig = { ...JOURNEY, ...config };
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrowMq = window.matchMedia("(max-width: 819px)");

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        dpr: Math.min(window.devicePixelRatio || 1, C.maxDpr),
      });
    } catch {
      setGlFailed(true);
      setRevealed(true);
      return;
    }
    const gl = renderer.gl;
    // The shaders need WebGL2 (texelFetch, float textures). Without it, the
    // section keeps its copy and its markers over a still background.
    if (!gl || !renderer.isWebgl2) {
      setGlFailed(true);
      setRevealed(true);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, C.maxDpr);
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    host.appendChild(canvas);

    const camera = new Camera(gl, { fov: C.camera.fov, near: 0.5, far: 600 });
    const scene = new Transform();

    // ── Frames texture ──────────────────────────────────────────────────
    const S = C.samples;
    const frames = C.strands.map((st) => buildFrames(st, S));
    const ROWS = 5;
    const tex = new Float32Array(S * ROWS * frames.length * 4);
    frames.forEach((fr, si) => {
      for (let i = 0; i < S; i++) {
        const row = (r: number) => ((si * ROWS + r) * S + i) * 4;
        tex.set([fr.pos[i * 3], fr.pos[i * 3 + 1], fr.pos[i * 3 + 2], fr.halfWidth[i]], row(0));
        tex.set([fr.across[i * 3], fr.across[i * 3 + 1], fr.across[i * 3 + 2], fr.thickness[i]], row(1));
        tex.set([fr.up[i * 3], fr.up[i * 3 + 1], fr.up[i * 3 + 2], fr.density[i]], row(2));
        tex.set([fr.tan[i * 3], fr.tan[i * 3 + 1], fr.tan[i * 3 + 2], fr.glow[i]], row(3));
        tex.set([fr.core[i], 0, 0, 0], row(4));
      }
    });
    const frameTexture = new Texture(gl, {
      image: tex,
      width: S,
      height: frames.length * ROWS,
      type: gl.FLOAT,
      format: gl.RGBA,
      internalFormat: (gl as WebGL2RenderingContext).RGBA32F,
      generateMipmaps: false,
      flipY: false,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    });

    // ── Particles ───────────────────────────────────────────────────────
    const rnd = mulberry32(0x70a1);
    const q = narrowMq.matches ? C.narrowScale : 1;
    const P = C.particles;
    const total = Math.round((P.main + P.inner + P.scatter + P.dust) * q) + P.bokeh;
    const su = new Float32Array(total * 4);
    const rand = new Float32Array(total * 4);
    const kind = new Float32Array(total);
    const weights = C.strands.map((s) => s.weight);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const pickStrand = () => {
      let r = rnd() * wSum;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return 0;
    };
    const gauss = () => {
      const a = Math.max(rnd(), 1e-6);
      return Math.sqrt(-2 * Math.log(a)) * Math.cos(6.2831853 * rnd());
    };

    let w = 0;
    const emit = (strand: number, s: number, u: number, v: number, k: number) => {
      su.set([strand, s, u, v], w * 4);
      rand.set([rnd(), rnd(), rnd(), rnd()], w * 4);
      kind[w] = k;
      w++;
    };
    for (let i = 0; i < Math.round(P.main * q); i++) {
      const u = rnd() < 0.55 ? Math.max(-1, Math.min(1, gauss() * 0.42)) : rnd() * 2 - 1;
      emit(pickStrand(), rnd(), u, rnd() * 2 - 1, 0);
    }
    for (let i = 0; i < Math.round(P.inner * q); i++) {
      emit(pickStrand(), rnd(), Math.max(-0.7, Math.min(0.7, gauss() * 0.17)), (rnd() * 2 - 1) * 0.5, 1);
    }
    for (let i = 0; i < Math.round(P.scatter * q); i++) {
      const sign = rnd() < 0.5 ? -1 : 1;
      emit(pickStrand(), rnd(), sign * (1 + Math.pow(rnd(), 2.2) * 1.2), (rnd() * 2 - 1) * 2.5, 2);
    }
    for (let i = 0; i < P.bokeh; i++) {
      // Only in the near foreground, where a lens would actually lose focus.
      emit(0, rnd() * 0.24, (rnd() * 2 - 1) * 1.4, rnd() * 2.5, 3);
    }
    for (let i = 0; i < Math.round(P.dust * q); i++) {
      emit(pickStrand(), rnd(), (rnd() * 2 - 1) * 4.5, 1 + rnd() * 14, 4);
    }
    // Shuffled, so drawing fewer thins every layer evenly (see the quality guard).
    for (let i = w - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      for (let k = 0; k < 4; k++) {
        let t = su[i * 4 + k]; su[i * 4 + k] = su[j * 4 + k]; su[j * 4 + k] = t;
        t = rand[i * 4 + k]; rand[i * 4 + k] = rand[j * 4 + k]; rand[j * 4 + k] = t;
      }
      const t = kind[i]; kind[i] = kind[j]; kind[j] = t;
    }

    const geometry = new Geometry(gl, {
      aSU: { size: 4, data: su },
      aRand: { size: 4, data: rand },
      aKind: { size: 1, data: kind },
    });

    // Where along each strand the milestones sit, for the highlight.
    const program = new Program(gl, {
      vertex,
      fragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uFrames: { value: frameTexture },
        uSamples: { value: S },
        uTime: { value: 0 },
        uFlow: { value: reduceMotion ? 0 : C.flow },
        uReveal: { value: 0 },
        uRevealMode: { value: reduceMotion ? 1 : 0 },
        uRevealFrom: { value: new Float32Array([C.strands[0]?.revealFrom ?? 0.4, C.strands[1]?.revealFrom ?? 1]) },
        uDpr: { value: dpr },
        uSize: { value: C.pointSize },
        uRefDist: { value: 22 },
        uFogNear: { value: C.fogNear },
        uFogFar: { value: C.fogFar },
        uBrightness: { value: C.brightness },
        uMouse: { value: new Float32Array([0, -3]) },
        uAspect: { value: 1 },
        uPointerIn: { value: 0 },
        uPointerRadius: { value: C.pointerRadius },
        uPointerForce: { value: reduceMotion ? 0 : C.pointerForce },
        uHi: { value: new Float32Array([0, 0.6, 0]) },
        uHover: { value: new Float32Array([0, 0, 0]) },
        uGuard: { value: new Float32Array([-0.2, 0.15, 0.35, 0.3]) },
      },
    });
    program.setBlendFunc(gl.ONE, gl.ONE);
    new Mesh(gl, { geometry, program, mode: gl.POINTS }).setParent(scene);

    // ── Framing ─────────────────────────────────────────────────────────
    // The figure's own spot: the glow sits under it, so it stands on light.
    const bend = pointOn(frames[C.figure.strand] ?? frames[0], S, C.figure.s, C.figure.u);
    const baseCam = [...C.camera.position] as Vec3;
    const baseTgt = [...C.camera.target] as Vec3;
    let cam = baseCam;
    let tgt = baseTgt;
    let vw = 1;
    let vh = 1;
    let fullH = 1;
    const setSize = () => {
      const r = stage.getBoundingClientRect();
      vw = Math.max(1, Math.floor(r.width));
      vh = Math.max(1, Math.floor(r.height));
      fullH = section.getBoundingClientRect().height || vh;
      renderer.setSize(vw, vh);
      const aspect = vw / vh;
      if (aspect < 1.25) {
        /* A tall frame cannot hold the whole sweep, so it keeps the bend: aim
           at it, back off along the same line of sight, widen the lens. */
        const back = 1.25 + (1.25 - aspect) * 0.9;
        cam = [
          bend[0] + (baseCam[0] - baseTgt[0]) * 0.55 * back,
          bend[1] + (baseCam[1] - baseTgt[1]) * 0.55 * back,
          bend[2] + (baseCam[2] - baseTgt[2]) * 0.55 * back,
        ];
        tgt = [bend[0] + 2.5, bend[1], bend[2] - 3];
        camera.perspective({ fov: Math.min(C.camera.fov * 1.35, 60), aspect });
      } else {
        cam = baseCam;
        tgt = baseTgt;
        camera.perspective({ fov: C.camera.fov, aspect });
      }
      (program.uniforms.uAspect.value as number) = aspect;
      /* The copy block's extent in ndc: the stage covers the whole section on
         desktop, so the guard follows the copy's real size rather than a
         guessed box. On a phone the copy is above the scene, so no guard. */
      const intro = section.querySelector<HTMLElement>(".aj-intro");
      const guard = program.uniforms.uGuard.value as Float32Array;
      if (intro && !narrowMq.matches) {
        const ir = intro.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        guard[0] = ((ir.right - sr.left) / sr.width) * 2 - 1 + 0.08;
        guard[1] = 1 - ((ir.bottom - sr.top) / sr.height) * 2 - 0.06;
      } else {
        guard[0] = -3;
        guard[1] = 3;
      }
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(stage);
    setSize();

    // ── Pointer ─────────────────────────────────────────────────────────
    const mouse = new Float32Array([0, -3]);
    const mouseTarget = new Float32Array([0, -3]);
    let pointerIn = 0;
    let pointerInTarget = 0;
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      // No displacement while the pointer is on text or a control.
      const onUi = !!(e.target as Element | null)?.closest?.("[data-journey-ui]");
      overUiRef.current = onUi;
      pointerInTarget = inside && !onUi ? 1 : 0;
      mouseTarget[0] = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouseTarget[1] = 1 - ((e.clientY - r.top) / r.height) * 2;
    };
    const onLeave = () => { pointerInTarget = 0; };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    // ── Reveal ──────────────────────────────────────────────────────────
    let revealStart = -1;
    const revealIo = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && revealStart < 0) {
          revealStart = performance.now();
          setRevealed(true);
        }
      },
      { threshold: 0.2 },
    );
    revealIo.observe(section);

    // ── Loop ────────────────────────────────────────────────────────────
    const v3 = new OVec3();
    const hiState = new Float32Array([0, 0.6, 0]);
    let hiTarget = activeRef.current;
    let hiAmt = 0;
    let hoverAmt = 0;
    let hoverIdx = -1;
    let clock = 0;
    let last = performance.now();
    let raf = 0;
    let visible = false;
    let pageVisible = !document.hidden;
    const fullCount = w;
    let quality = 1;
    let frameAvg = 16.7;
    let lastQ = 0;

    const project = (p: Vec3) => {
      v3.set(p[0], p[1], p[2]);
      camera.project(v3);
      return { x: (v3.x * 0.5 + 0.5) * vw, y: (0.5 - v3.y * 0.5) * vh, ok: v3.z < 1 && v3.z > -1 };
    };

    const loop = (t: number) => {
      const rawDt = t - last;
      const dt = Math.min(rawDt / 1000, 0.1);
      last = t;
      if (!reduceMotion) clock += dt;

      // Quality guard: give density back until the frame fits.
      if (rawDt > 0 && rawDt < 500) frameAvg += (rawDt - frameAvg) * 0.05;
      if (t - lastQ > 500) {
        lastQ = t;
        if (frameAvg > 22 && quality > C.minQuality) quality = Math.max(C.minQuality, quality - 0.1);
        else if (frameAvg < 14 && quality < 1) quality = Math.min(1, quality + 0.05);
        geometry.setDrawRange(0, Math.round(fullCount * quality));
      }

      const reveal = revealStart < 0 ? 0 : Math.min(1, (t - revealStart) / 1000 / C.revealSeconds);

      const k = 1 - Math.exp(-dt * 5);
      mouse[0] += (mouseTarget[0] - mouse[0]) * k;
      mouse[1] += (mouseTarget[1] - mouse[1]) * k;
      pointerIn += (pointerInTarget - pointerIn) * (1 - Math.exp(-dt * 4));

      // Camera: a little parallax, a little lift with scroll, level horizon.
      const sr = section.getBoundingClientRect();
      const wh = window.innerHeight || 1;
      const scroll = Math.max(-1, Math.min(1, (wh / 2 - (sr.top + sr.height / 2)) / wh));
      const par = reduceMotion ? 0 : C.parallax;
      const px = pointerIn * mouse[0] * par;
      const py = pointerIn * mouse[1] * par * 0.45;
      camera.position.set(cam[0] + px, cam[1] + py + (reduceMotion ? 0 : scroll * C.scrollLift), cam[2]);
      camera.lookAt(tgt);
      camera.updateMatrixWorld();

      // Selection and hover, eased.
      if (activeRef.current !== hiTarget) {
        hiTarget = activeRef.current;
        hiAmt = 0;
      }
      const m = milestones[hiTarget];
      if (m) {
        hiState[0] = m.anchor.strand;
        hiState[1] = m.anchor.s;
      }
      hiAmt += (1 - hiAmt) * (1 - Math.exp(-dt * 3));
      hiState[2] = hiAmt * 0.9;
      if (hoverRef.current !== hoverIdx && hoverRef.current >= 0) hoverIdx = hoverRef.current;
      hoverAmt += ((hoverRef.current >= 0 && hoverRef.current !== hiTarget ? 1 : 0) - hoverAmt) * (1 - Math.exp(-dt * 6));

      const u = program.uniforms as any;
      u.uTime.value = clock;
      u.uReveal.value = reveal;
      (u.uMouse.value as Float32Array).set(mouse);
      u.uPointerIn.value = pointerIn;
      (u.uHi.value as Float32Array).set(hiState);
      const hm = milestones[hoverIdx];
      if (hm) (u.uHover.value as Float32Array).set([hm.anchor.strand, hm.anchor.s, hoverAmt * 0.7]);

      renderer.render({ scene, camera });

      // ── HTML, pinned to the projected anchors ─────────────────────────
      milestones.forEach((ms, i) => {
        const fr = frames[ms.anchor.strand];
        if (!fr) return;
        const p = project(pointOn(fr, S, ms.anchor.s, ms.anchor.u));
        const mk = markerRefs.current[i];
        if (mk) {
          mk.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
          mk.style.visibility = p.ok ? "visible" : "hidden";
        }
        const card = cardRefs.current[i];
        if (card) {
          const ch = card.offsetHeight || 104;
          const x = Math.max(12, Math.min(vw - CARD_W - 12, p.x - CARD_W / 2));
          const y = Math.max(12, p.y - ms.leader - ch);
          card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        }
      });

      const fr0 = frames[C.figure.strand] ?? frames[0];
      const feet = project(pointOn(fr0, S, C.figure.s, C.figure.u, 0.02));
      const ahead = project(pointOn(fr0, S, C.figure.s + 0.02, C.figure.u, 0.02));
      const fh = Math.max(14, C.figure.height * fullH);
      if (figureRef.current) {
        figureRef.current.style.height = `${fh.toFixed(1)}px`;
        figureRef.current.style.width = `${(fh * 20 / 56).toFixed(1)}px`;
        figureRef.current.style.transform =
          `translate3d(${(feet.x - (fh * 10) / 56).toFixed(1)}px, ${(feet.y - fh).toFixed(1)}px, 0)`;
      }
      if (shadowRef.current) {
        // A short shadow laid along the ribbon, away from the light at the bend.
        const ang = Math.atan2(ahead.y - feet.y, ahead.x - feet.x);
        shadowRef.current.style.width = `${(fh * 0.9).toFixed(1)}px`;
        shadowRef.current.style.height = `${(fh * 0.16).toFixed(1)}px`;
        shadowRef.current.style.transform =
          `translate3d(${feet.x.toFixed(1)}px, ${feet.y.toFixed(1)}px, 0) rotate(${(ang + Math.PI).toFixed(3)}rad) translateY(-50%)`;
      }
      if (glowRef.current) {
        const g = project(bend);
        glowRef.current.style.transform = `translate3d(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        glowRef.current.style.opacity = String(C.bendGlow * reveal);
      }

      raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (visible && pageVisible && raf === 0) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // Off screen or backgrounded, the section costs nothing.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      visible ? start() : stop();
    });
    io.observe(section);
    const onVis = () => {
      pageVisible = !document.hidden;
      pageVisible ? start() : stop();
    };
    document.addEventListener("visibilitychange", onVis);
    const onMq = () => setSize();
    narrowMq.addEventListener("change", onMq);

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      revealIo.disconnect();
      narrowMq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      try { host.removeChild(canvas); } catch {}
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // Milestone content changes do not need a new GL context; anchors are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  /* Arrow keys move between milestones, Home and End jump to the ends. */
  const onKey = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const n = milestones.length;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (active + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (active - 1 + n) % n;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = n - 1;
      if (next < 0) return;
      e.preventDefault();
      setActive(next);
      const target = e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next];
      target?.focus();
    },
    [active, milestones.length],
  );

  const sel = milestones[active];

  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`aj${revealed ? " aj-in" : ""}${glFailed ? " aj-nogl" : ""}`}
      /* The theme, handed to the stylesheet as custom properties. Layout lives
         in CSS rather than inline styles because it changes at a breakpoint,
         and an inline style would outrank the media query. */
      style={{
        ["--aj-display" as string]: font.display,
        ["--aj-body" as string]: font.body,
        ["--aj-mono" as string]: font.mono,
        ["--aj-ink" as string]: color.ink,
        ["--aj-text" as string]: color.text,
        ["--aj-muted" as string]: color.textMuted,
        ["--aj-accent" as string]: color.accentLight,
      }}
    >
      <div ref={stageRef} className="aj-stage">
        <div ref={glowRef} className="aj-glow" aria-hidden />
        <div ref={hostRef} className="aj-canvas" aria-hidden />

        <div className="aj-overlay">
          <div ref={shadowRef} className="aj-shadow" aria-hidden />
          <div ref={figureRef} className="aj-figure" aria-hidden>
            <Figure />
          </div>

          <div role="group" aria-label="Journey milestones" onKeyDown={onKey} className="aj-markers">
            {milestones.map((m, i) => (
              <button
                key={m.id}
                ref={(el) => { markerRefs.current[i] = el; }}
                type="button"
                data-journey-ui
                className={`aj-marker${i === active ? " is-active" : ""}`}
                aria-pressed={i === active}
                aria-label={`${m.index} ${m.label}`}
                aria-controls={`${id}-card`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                onPointerEnter={() => { hoverRef.current = i; }}
                onPointerLeave={() => { hoverRef.current = -1; }}
                onFocus={() => { hoverRef.current = i; }}
                onBlur={() => { hoverRef.current = -1; }}
                style={glFailed ? { left: `${m.fallback.x}%`, top: `${m.fallback.y}%` } : undefined}
              >
                <span className="aj-dot" />
                <span className="aj-leader" style={{ height: m.leader }} />
                <span className="aj-label" style={{ bottom: m.leader + 8 }}>
                  {m.index}<span className="aj-label-name"> / {m.label}</span>
                </span>
              </button>
            ))}
          </div>

          {milestones.map((m, i) => (
            <div
              key={m.id}
              ref={(el) => { cardRefs.current[i] = el; }}
              data-journey-ui
              className={`aj-card aj-card-float${i === active ? " is-active" : ""}`}
              aria-hidden
              style={
                glFailed
                  ? { left: `${m.fallback.x}%`, top: `${m.fallback.y}%`, transform: `translate(-50%, calc(-100% - ${m.leader}px))` }
                  : undefined
              }
            >
              <div className="aj-card-kicker">{m.index} / {m.label}</div>
              <div className="aj-card-title">{m.title}</div>
              <div className="aj-card-body">{m.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="aj-intro" data-journey-ui>
        <div className="aj-kicker">{index} / {label}</div>
        <h2 id={`${id}-title`} className="aj-title">{heading}</h2>
        <p className="aj-body">{body}</p>
      </div>

      {/* The selected milestone, for assistive tech everywhere and for
          everyone on a narrow screen, where a floating card would cover the
          scene. The floating cards are decoration over the same content. */}
      <div className="aj-below" data-journey-ui>
        <div id={`${id}-card`} className="aj-card aj-card-static" aria-live="polite">
          <div className="aj-card-kicker">{sel?.index} / {sel?.label}</div>
          <div className="aj-card-title">{sel?.title}</div>
          <div className="aj-card-body">{sel?.body}</div>
        </div>
        <div className="aj-tabs" role="group" aria-label="Choose a milestone" onKeyDown={onKey}>
          {milestones.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className={`aj-tab${i === active ? " is-active" : ""}`}
              aria-pressed={i === active}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
            >
              <span>{m.index}</span> {m.label}
            </button>
          ))}
        </div>
      </div>

      {scrollHint && (
        <div className="aj-hint" aria-hidden>
          <div>{scrollHint}</div>
          <svg width="16" height="20" viewBox="0 0 16 20" style={{ marginTop: 10, display: "block" }}>
            <path d="M8 1 V18 M2 12 L8 18 L14 12" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </div>
      )}
    </section>
  );
}
