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

const hexToRgb = (hex: string): [number, number, number] => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!r) return [1, 1, 1];
  return [parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255];
};

const densityToCount = (d: "low" | "medium" | "high") =>
  d === "low" ? 48000 : d === "high" ? 180000 : 110000;

/* ── Shared GLSL ─────────────────────────────────────────────────────────── */

/* Ashima simplex noise, trimmed to the 3D case. Drives the turbulence that
   crumples the lattice into cloth at the waist and dust at the base. */
const NOISE = `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

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

out float vAlpha;
out float vHeat;
out float vDepth;
out float vSeed;

${NOISE}
${POINTER}

const float TAU = 6.28318530718;

void main() {
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

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vec4 clip = projectionMatrix * mv;

  float heat;
  vec2 ndc = clip.xy / clip.w;
  // Nearer particles answer the cursor harder, so the field gains depth.
  float depthScale = clamp(6.0 / max(-mv.z, 0.5), 0.35, 1.6);
  ndc += pointerOffset(ndc, depthScale, heat);
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float dist = max(-mv.z, 0.1);
  // Fine at the mouth of the funnel, coarse through the waist.
  // Peaks at the waist (the readable dot grid) and thins toward the mouth,
  // which is what separates the veil from the cloth in the reference.
  float sizeCurve = mix(0.95, 1.5, band) * mix(1.0, 0.55, smoothstep(0.5, 1.0, v));
  gl_PointSize = uSize * uDpr * sizeCurve * (0.62 + aRand.x * 0.8) * (uCamDist * 0.62 / dist);
  gl_PointSize = clamp(gl_PointSize, 0.6, 14.0);

  // Depth fog plus a light dimming of the far wall, which keeps the front of
  // the column readable instead of washing into a solid mass.
  float fog = clamp((uCamDist + 6.0 - dist) / 10.0, 0.0, 1.0);
  float facing = mix(0.3, 1.0, smoothstep(uCamDist + 2.6, uCamDist - 3.0, dist));
  float veil = mix(1.0, 1.65, smoothstep(uWaist, 0.95, v));
  vAlpha = fog * facing * uBrightness * veil * (0.55 + aRand.y * 0.6) * (1.0 - dust * 0.3);
  vHeat = heat;
  vDepth = clamp(dist / 18.0, 0.0, 1.0);
  vSeed = aRand.z;
}
`;

const pointFragment = `#version 300 es
precision highp float;

in float vAlpha;
in float vHeat;
in float vDepth;
in float vSeed;

uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;

out vec4 fragColor;

void main() {
  // Soft round sprite with a hot core — dense regions stack into the bright
  // crests that define the silhouette under additive blending.
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p);
  if (r > 0.5) discard;
  float mask = smoothstep(0.5, 0.06, r);
  mask *= mask;

  // Faint prismatic bloom on the deep particles, matching the blue/gold
  // fringing that creeps into the lower half of the reference.
  vec3 tint = mix(uColor, uAccent, smoothstep(0.45, 1.0, vDepth) * 0.55 * vSeed);
  vec3 col = mix(tint, vec3(1.0), clamp(vHeat, 0.0, 1.0) * 0.8);

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
  style,
  className,
}: ParticleVortexProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<{ points: Program; lines: Program } | null>(null);

  const propsRef = useRef({
    color, accentColor, lineColor, flowSpeed, spinSpeed, turbulence,
    brightness, opacity, parallaxStrength, repelStrength, showVitrine, clickPulse,
  });
  propsRef.current = {
    color, accentColor, lineColor, flowSpeed, spinSpeed, turbulence,
    brightness, opacity, parallaxStrength, repelStrength, showVitrine, clickPulse,
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
    const set = (arr: Float32Array, hex: string) => {
      const v = hexToRgb(hex);
      arr[0] = v[0]; arr[1] = v[1]; arr[2] = v[2];
    };
    set(u.uColor.value, p.color);
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
        uMouse: { value: new Float32Array([0, 0]) },
        uAspect: { value: 1 },
        uRepel: { value: repelStrength },
        uRepelRadius: { value: 0.34 },
        uPointerIn: { value: 0 },
        uPulse: { value: 0 },
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

    ctxRef.current = { points: pointProgram, lines: lineProgram };
    applyProps();

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const aspect = w / h;
      camera.perspective({ aspect });
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

      (pointProgram.uniforms.uCamDist.value as number) = camera.position.z;
      (pointProgram.uniforms.uAspect.value as number) = aspect;
      (lineProgram.uniforms.uAspect.value as number) = aspect;
    };
    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    /* Pointer: parallax target, repulsion origin, and press pulses. */
    const mouse = new Float32Array([0, 0]);
    const mouseTarget = new Float32Array([0, 0]);
    let pointerIn = 0;
    let pointerInTarget = 0;
    let pulse = 0;

    const host = (container.parentElement || container) as HTMLElement;

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      mouseTarget[0] = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseTarget[1] = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      pointerInTarget = 1;
    };
    const onLeave = () => { pointerInTarget = 0; };
    const onDown = (e: PointerEvent) => {
      if (!propsRef.current.clickPulse) return;
      onMove(e);
      mouse[0] = mouseTarget[0];
      mouse[1] = mouseTarget[1];
      pulse = 1;
    };

    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave, { passive: true });
    host.addEventListener("pointerdown", onDown, { passive: true });

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    let last = performance.now();
    // Reduced motion still gets a still frame plus pointer response, never drift.
    let clock = reduceMotion ? 6 : 0;

    const render = () => {
      renderer.render({ scene, camera });
    };

    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      if (!reduceMotion) clock += dt;

      const p = propsRef.current;
      mouse[0] += (mouseTarget[0] - mouse[0]) * 0.07;
      mouse[1] += (mouseTarget[1] - mouse[1]) * 0.07;
      pointerIn += (pointerInTarget - pointerIn) * 0.06;
      pulse = Math.max(0, pulse - dt * 0.85);

      const parallax = reduceMotion ? 0 : p.parallaxStrength;
      scene.rotation.y = mouse[0] * parallax * 0.32;
      scene.rotation.x = -mouse[1] * parallax * 0.14;

      const pu = pointProgram.uniforms as any;
      pu.uTime.value = clock;
      pu.uPointerIn.value = pointerIn;
      pu.uPulse.value = pulse;
      (pu.uMouse.value as Float32Array).set(mouse);

      const lu = lineProgram.uniforms as any;
      lu.uPointerIn.value = pointerIn;
      lu.uPulse.value = pulse;
      lu.uOpacity.value = p.showVitrine ? 0.3 : 0;
      (lu.uMouse.value as Float32Array).set(mouse);

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
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
      ctxRef.current = null;
      try { container.removeChild(canvas); } catch (e) {}
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}
    />
  );
}
