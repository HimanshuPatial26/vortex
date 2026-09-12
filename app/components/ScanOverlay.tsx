"use client";

/* ScanOverlay — technical measurement marks in the field around the sculpture.

   Straight segments only, and no closed shapes: the object is never ringed or
   boxed. Marks sit in the outer band — a few reaching in toward the silhouette
   to take a width, the rest holding station in the margins — so the centre of
   the frame stays the object's.

   The layout is authored rather than generated. Random placement reads as
   scatter; what makes an instrument look intelligent is that nothing is
   mirrored, lengths never repeat, and the spacing is uneven but deliberate. The
   table below is that composition, and it is kept clear of the hero's own HUD
   columns on both sides.

   SVG, not WebGL. Hairline strokes have to stay crisp at any DPR and the labels
   are real text — both free in the DOM, both a project in a shader.

   Each mark owns a path rather than being batched into a shared one, because
   each runs its own slow cycle: draw on, hold, fade, repeat. Offsets are
   scattered so only two or three are ever in transition — the field should read
   as being re-measured, not as blinking.

   Fixed to the viewport rather than flowed with the hero, because the sculpture
   it annotates is drawn on a fixed canvas — anchored in the document, the marks
   would slide off the object the moment the page scrolled. They fade over the
   first half-viewport instead. */

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

/* Half-width of the sculpture against height, sampled off a render and
   smoothed. An envelope, not a trace: the column is irregular and animated, and
   measurement geometry belongs just outside the subject anyway. */
const PROFILE: Array<[number, number]> = [
  [0.10, 0.19],
  [0.18, 0.25],
  [0.26, 0.21],
  [0.34, 0.16],
  [0.42, 0.15],
  [0.50, 0.19],
  [0.56, 0.20],
  [0.64, 0.13],
  [0.72, 0.05],
];

const envelope = (y: number): number => {
  if (y <= PROFILE[0][0]) return PROFILE[0][1];
  const last = PROFILE[PROFILE.length - 1];
  if (y >= last[0]) return last[1];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [y0, w0] = PROFILE[i];
    const [y1, w1] = PROFILE[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return w0 + (w1 - w0) * (t * t * (3 - 2 * t));
    }
  }
  return last[1];
};

type Cap = "dot" | "square" | "none";

interface Mark {
  /** "edge" starts at the silhouette and reaches outward; "field" is placed in
   *  viewport coordinates and holds station. */
  kind: "edge" | "field";
  /** edge: height fraction on the profile. field: x as a fraction of width. */
  a: number;
  /** edge: -1 left of the object, +1 right. field: y as a fraction of height. */
  b: number;
  /** Length as a fraction of the smaller viewport dimension. */
  len: number;
  /** Degrees clockwise from pointing right. Ignored for edge marks, which
   *  always run horizontally away from the object. */
  angle?: number;
  dotted?: boolean;
  cap?: Cap;
  /** Perpendicular measurement ticks spaced along the segment. */
  ticks?: number;
  label?: string;
  /** Relative weight; the composition needs a few marks to sit back. */
  op?: number;
}

/* The composition. Deliberately asymmetric — no height is used twice, no two
   lengths match, and the two sides carry different counts. Field marks live in
   x 0.19–0.31 and 0.69–0.83, the clear bands between the hero's HUD columns
   and the object itself. */
const MARKS: Mark[] = [
  // Reaching in to the silhouette. Uneven, and not mirrored across the axis.
  { kind: "edge", a: 0.148, b: 1, len: 0.104, cap: "dot", label: "0.318" },
  { kind: "edge", a: 0.212, b: -1, len: 0.059, cap: "dot" },
  { kind: "edge", a: 0.286, b: 1, len: 0.038, cap: "square", dotted: true },
  { kind: "edge", a: 0.337, b: -1, len: 0.131, cap: "dot", label: "W·0412", ticks: 3 },
  { kind: "edge", a: 0.401, b: 1, len: 0.071, cap: "dot" },
  { kind: "edge", a: 0.463, b: -1, len: 0.033, cap: "none", dotted: true, op: 0.6 },
  { kind: "edge", a: 0.512, b: 1, len: 0.118, cap: "square", label: "0.774", ticks: 4 },
  { kind: "edge", a: 0.574, b: -1, len: 0.052, cap: "dot" },
  { kind: "edge", a: 0.628, b: 1, len: 0.087, cap: "dot", dotted: true, op: 0.7 },
  { kind: "edge", a: 0.671, b: -1, len: 0.044, cap: "dot" },

  // Holding station in the margins. Two long rules, the rest fragments.
  { kind: "field", a: 0.231, b: 0.206, len: 0.286, angle: 90, ticks: 5, cap: "square" },
  { kind: "field", a: 0.289, b: 0.585, len: 0.113, angle: 90, dotted: true, op: 0.55 },
  { kind: "field", a: 0.196, b: 0.702, len: 0.068, angle: 0, cap: "dot", label: "SEG·07" },
  { kind: "field", a: 0.781, b: 0.163, len: 0.219, angle: 90, ticks: 3, cap: "dot" },
  { kind: "field", a: 0.826, b: 0.492, len: 0.147, angle: 90, dotted: true, op: 0.5 },
  { kind: "field", a: 0.697, b: 0.318, len: 0.054, angle: 0, cap: "square" },
  { kind: "field", a: 0.714, b: 0.771, len: 0.096, angle: 0, cap: "dot", label: "0.914" },
  // Two diagonals, the only marks off the orthogonals — they stop the field
  // reading as a pair of rulers.
  { kind: "field", a: 0.243, b: 0.842, len: 0.079, angle: -34, op: 0.7 },
  { kind: "field", a: 0.806, b: 0.878, len: 0.061, angle: -146, dotted: true, op: 0.6 },
  { kind: "field", a: 0.259, b: 0.118, len: 0.042, angle: 26, cap: "dot", op: 0.8 },
];

/* Deterministic, so the server and the first client render agree. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export interface ScanOverlayProps {
  /** Line, marker and label colour. */
  color?: string;
  /** Colour of an acquisition blip and of the mark nearest the cursor. */
  accentColor?: string;
  /** Master opacity. */
  opacity?: number;
  /** Show the numeric read-outs. */
  labels?: boolean;
  style?: CSSProperties;
}

export default function ScanOverlay({
  color = "#C8CEDE",
  accentColor = "#8FB4FF",
  opacity = 0.62,
  labels = true,
  style,
}: ScanOverlayProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const svg = svgRef.current;
    if (!host || !svg) return;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const NS = "http://www.w3.org/2000/svg";
    const make = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
    ) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      return el;
    };

    /* One path per mark, carrying its segment and its ticks together. Batching
       every segment into two shared paths is cheaper, but then a mark cannot
       fade on its own — and the whole point is that they come and go
       independently. Twenty paths is a handful of attribute writes a frame. */
    const segs = MARKS.map((m) =>
      make("path", {
        fill: "none",
        stroke: color,
        "stroke-width": 1,
        opacity: 0,
        ...(m.dotted ? { "stroke-dasharray": "1.5 4" } : {}),
      }),
    );
    segs.forEach((p) => svg.appendChild(p));

    // Caps and labels stay individual: each needs its own position and each
    // blips on its own schedule.
    const caps = MARKS.map((m) =>
      m.cap === "square"
        ? make("rect", { width: 3.4, height: 3.4, fill: "none", stroke: color, "stroke-width": 1, opacity: 0.8 })
        : m.cap === "dot"
          ? make("circle", { r: 1.5, fill: color, opacity: 0.8 })
          : null,
    );
    caps.forEach((c) => c && svg.appendChild(c));

    const blips = MARKS.map((m) =>
      m.cap && m.cap !== "none"
        ? make("circle", { r: 2, fill: "none", stroke: accentColor, "stroke-width": 1, opacity: 0 })
        : null,
    );
    blips.forEach((b) => b && svg.appendChild(b));

    const texts = MARKS.map((m) =>
      m.label && labels
        ? make("text", {
            fill: color,
            "font-size": 7.5,
            "letter-spacing": 1.2,
            opacity: 0.4,
            "font-family": "'JetBrains Mono', ui-monospace, monospace",
          })
        : null,
    );
    texts.forEach((t) => t && svg.appendChild(t));

    let w = 1;
    let h = 1;
    /* The scene fits by height on a wide viewport and by width on a narrow one.
       Below that crossover the sculpture shrinks, and an envelope measured in
       height units alone would leave the edge marks hanging in space. */
    let fit = 1;
    let showLabels = true;
    let showField = true;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      fit = Math.min(1, w / h / 0.679);
      showLabels = labels && w >= 620;
      // The margin bands the field marks live in do not exist on a phone.
      showField = w >= 760;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    });
    ro.observe(host);

    const mouse = { x: -9999, y: -9999, has: false };
    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.has = true;
    };
    const onLeave = () => { mouse.has = false; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });

    // Rendered start points, eased toward their targets so drift and cursor
    // reactions arrive smoothly.
    const sx = new Float64Array(MARKS.length);
    const sy = new Float64Array(MARKS.length);
    let seeded = false;
    let raf = 0;
    let last = performance.now();
    const t0 = performance.now();

    const frame = (now: number) => {
      const t = reduceMotion ? 4 : (now - t0) / 1000;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (w <= 2 || h <= 2) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // The sculpture is on a fixed canvas, so the overlay has to let go of it
      // deliberately rather than scrolling away with the section.
      const fade = Math.max(0, Math.min(1, 1 - window.scrollY / (h * 0.55)));
      svg.style.opacity = String(fade * opacity);
      if (fade <= 0.001) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const cx = w / 2;
      const unit = Math.min(w, h);
      // The whole rig leans a few pixels with the cursor the way the sculpture
      // parallaxes, so the marks read as sitting in the scene with it.
      const leanX = mouse.has ? ((mouse.x - cx) / w) * 7 : 0;
      const leanY = mouse.has ? ((mouse.y - h * 0.45) / h) * 4 : 0;

      for (let i = 0; i < MARKS.length; i++) {
        const m = MARKS[i];
        const hidden = m.kind === "field" && !showField;

        // Slow drift, two frequencies — one alone reads as a metronome.
        const ph = rand(i * 3.7) * Math.PI * 2;
        const rate = 0.13 + rand(i * 5.9) * 0.17;
        const drift =
          (Math.sin(t * rate + ph) + Math.sin(t * rate * 2.1 + ph * 0.7) * 0.4) * unit * 0.006;

        let x0: number;
        let y0: number;
        let dirX: number;
        let dirY: number;

        if (m.kind === "edge") {
          // Starts just off the silhouette and reaches outward, horizontally.
          y0 = (0.4 + (m.a - 0.4) * fit) * h + leanY;
          x0 = cx + m.b * (envelope(m.a) * h * fit + unit * 0.022) + leanX + m.b * drift;
          dirX = m.b;
          dirY = 0;
        } else {
          x0 = m.a * w + leanX + drift;
          y0 = m.b * h + leanY;
          const rad = ((m.angle ?? 0) * Math.PI) / 180;
          dirX = Math.cos(rad);
          dirY = Math.sin(rad);
        }

        /* Cursor nudge: marks give a little ground as it approaches and settle
           back as it leaves. They shift bodily — a straight line stays straight. */
        let heat = 0;
        if (mouse.has && !hidden) {
          const ddx = x0 - mouse.x;
          const ddy = y0 - mouse.y;
          const r2 = ddx * ddx + ddy * ddy;
          heat = Math.exp(-r2 / (140 * 140));
          if (heat > 0.004) {
            const r = Math.sqrt(r2) || 1;
            x0 += (ddx / r) * heat * 14;
            y0 += (ddy / r) * heat * 14;
          }
        }

        if (!seeded) {
          sx[i] = x0;
          sy[i] = y0;
        } else {
          const k = 1 - Math.exp(-dt * 7);
          sx[i] += (x0 - sx[i]) * k;
          sy[i] += (y0 - sy[i]) * k;
        }

        /* Each mark runs its own long cycle: draw on, hold, fade out, repeat.
           Offsets are scattered so only two or three are ever in transition —
           the field should feel like it is being re-read, not like it is
           blinking. */
        const period = 11 + rand(i * 7.3) * 9;
        const cyc = ((t / period) % 1 + rand(i * 23.1)) % 1;
        const DRAW = 0.1;
        const FADE = 0.86;
        let grow = 1;
        let alpha = 1;
        if (cyc < DRAW) {
          // easeOutCubic: the line arrives quickly and settles, which reads as
          // an instrument acquiring rather than an element animating in.
          const f = cyc / DRAW;
          grow = 1 - Math.pow(1 - f, 3);
          alpha = grow;
        } else if (cyc > FADE) {
          alpha = 1 - (cyc - FADE) / (1 - FADE);
        }
        // A slow breath across the held span, so nothing sits perfectly static.
        alpha *= 0.82 + 0.18 * Math.sin(t * (0.5 + rand(i * 31.7) * 0.4) + rand(i * 3.3) * 6.28);

        const len = m.len * unit * grow;
        const ex = sx[i] + dirX * len;
        const ey = sy[i] + dirY * len;

        if (hidden) {
          segs[i].setAttribute("opacity", "0");
          const cap = caps[i];
          if (cap) cap.setAttribute("opacity", "0");
          const bl = blips[i];
          if (bl) bl.setAttribute("opacity", "0");
          const tx = texts[i];
          if (tx) tx.style.display = "none";
          continue;
        }

        let d = `M${sx[i].toFixed(1)} ${sy[i].toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`;

        // Measurement ticks, only along the length drawn so far.
        if (m.ticks) {
          const nx = -dirY;
          const ny = dirX;
          const full = m.len * unit;
          for (let k = 1; k <= m.ticks; k++) {
            const f = k / (m.ticks + 1);
            if (f * full > len) break;
            const tpx = sx[i] + dirX * full * f;
            const tpy = sy[i] + dirY * full * f;
            const tl = k % 2 === 0 ? 4.5 : 2.5;
            d += `M${tpx.toFixed(1)} ${tpy.toFixed(1)}L${(tpx + nx * tl).toFixed(1)} ${(tpy + ny * tl).toFixed(1)}`;
          }
        }

        const base = (m.op ?? 1) * (m.dotted ? 0.4 : 0.58);
        segs[i].setAttribute("d", d);
        segs[i].setAttribute("opacity", Math.max(0, base * alpha + heat * 0.28).toFixed(3));
        segs[i].setAttribute("stroke", heat > 0.35 ? accentColor : color);

        /* Acquisition blip on the cap: a ring that expands and fades, as if
           that point had just been re-read. Staggered so only ever one or two
           of them fire at a time. */
        const blipPeriod = 6 + rand(i * 11.3) * 9;
        const blipCyc = ((t / blipPeriod) % 1 + rand(i * 17.9)) % 1;
        const WIN = 0.11;
        const prog = blipCyc < WIN ? blipCyc / WIN : -1;
        const blipAmt = prog >= 0 ? Math.sin(prog * Math.PI) : 0;
        const hot = heat > 0.35 || blipAmt > 0.4;

        const cap = caps[i];
        if (cap) {
          if (m.cap === "square") {
            cap.setAttribute("x", (sx[i] - 1.7).toFixed(1));
            cap.setAttribute("y", (sy[i] - 1.7).toFixed(1));
          } else {
            cap.setAttribute("cx", sx[i].toFixed(1));
            cap.setAttribute("cy", sy[i].toFixed(1));
            cap.setAttribute("r", (1.5 + blipAmt * 0.9).toFixed(2));
          }
          cap.setAttribute(
            "opacity",
            Math.max(0, Math.min(1, (0.62 + blipAmt * 0.38 + heat * 0.3) * alpha)).toFixed(2),
          );
          cap.setAttribute(m.cap === "square" ? "stroke" : "fill", hot ? accentColor : color);
        }

        const bl = blips[i];
        if (bl) {
          if (prog >= 0) {
            bl.setAttribute("cx", sx[i].toFixed(1));
            bl.setAttribute("cy", sy[i].toFixed(1));
            bl.setAttribute("r", (2.5 + prog * 8).toFixed(1));
            bl.setAttribute("opacity", ((1 - prog) * 0.45 * alpha).toFixed(2));
          } else {
            bl.setAttribute("opacity", "0");
          }
        }

        const tx = texts[i];
        if (tx) {
          tx.style.display = showLabels ? "" : "none";
          // Labels sit past the far end of their mark, reading outward.
          const outward = m.kind === "edge" ? m.b > 0 : dirX >= 0;
          tx.setAttribute("x", (ex + (outward ? 6 : -6)).toFixed(1));
          tx.setAttribute("y", (ey + 2.8).toFixed(1));
          tx.setAttribute("text-anchor", outward ? "start" : "end");
          tx.setAttribute(
            "opacity",
            Math.max(0, Math.min(0.95, (0.34 + blipAmt * 0.45 + heat * 0.4) * alpha)).toFixed(2),
          );
          tx.setAttribute("fill", hot ? accentColor : color);
          tx.textContent = m.label ?? "";
        }
      }
      seeded = true;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
    };
  }, [color, accentColor, opacity, labels]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2, ...style }}
    >
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", overflow: "visible" }} />
    </div>
  );
}
