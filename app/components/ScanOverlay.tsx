"use client";

/* ScanOverlay — a computer-vision read-out drawn over the sculpture.

   Anchor nodes sit just outside the object's silhouette, chained into an
   irregular polygon and crossed by a few chords, with corner brackets marking
   the bounding box and coordinate labels on a handful of nodes. The intent is a
   system measuring the object, so the geometry is sparse and deliberate rather
   than a lattice: every line either follows the outline or spans it.

   SVG, not WebGL. The lines have to stay hairline-crisp at any DPR and the
   labels are real text, both of which the DOM does for free and a shader makes
   into a project. The cost is ~30 nodes' worth of attribute writes per frame,
   which is nothing.

   Fixed to the viewport rather than flowing with the hero, because the
   sculpture it annotates is drawn on a fixed canvas — anchored in the document
   instead, the overlay would slide off the object the moment the page scrolled.
   It fades out over the first half-viewport of scroll instead. */

import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

/* Half-width of the sculpture against height, sampled off a render and
   smoothed. The column is irregular and animated, so this is an envelope, not
   a trace — which is right for the effect: measurement geometry belongs just
   outside the subject, not painted onto it. */
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

/** Half-width at a given height fraction, linearly blended between samples. */
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

/* Deterministic, so the server and the first client render agree — the nodes
   are laid out at mount, not randomised per frame. */
const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Node {
  /** Height fraction of its anchor on the envelope. */
  y: number;
  /** -1 left of the axis, +1 right. */
  side: number;
  /** How far outside the envelope it sits, as a fraction of that half-width. */
  out: number;
  /** Drift phase and rate, so no two nodes breathe together. */
  phase: number;
  rate: number;
  amp: number;
  label: string | null;
}

const buildNodes = (count: number): Node[] => {
  const nodes: Node[] = [];
  // Every third node down one side carries a read-out; more than that and the
  // overlay starts to read as a caption rather than an instrument.
  for (let i = 0; i < count; i++) {
    const s = i / (count - 1);
    const side = i % 2 === 0 ? 1 : -1;
    // Spread down the profile with a little scatter, so the chain is irregular
    // rather than a pair of neat columns.
    const y = 0.12 + s * 0.56 + (rand(i * 3.1) - 0.5) * 0.035;
    nodes.push({
      y,
      side,
      out: 1.06 + rand(i * 7.7) * 0.1,
      phase: rand(i * 1.9) * Math.PI * 2,
      rate: 0.18 + rand(i * 5.3) * 0.3,
      amp: 0.03 + rand(i * 11.3) * 0.05,
      label: null,
    });
  }
  return nodes;
};

export interface ScanOverlayProps {
  /** Line and node colour. */
  color?: string;
  /** Colour of the active node and the sweep. */
  accentColor?: string;
  /** Master opacity. */
  opacity?: number;
  /** How many anchor nodes ring the object. */
  nodeCount?: number;
  /** Show the coordinate read-outs. */
  labels?: boolean;
  style?: CSSProperties;
}

export default function ScanOverlay({
  color = "#C8CEDE",
  accentColor = "#8FB4FF",
  opacity = 0.62,
  nodeCount = 22,
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

    const nodes = buildNodes(nodeCount);
    const labelled = nodes.map((_, i) => i % 4 === 1).map((v, i) => v && i < nodeCount - 2);

    const NS = "http://www.w3.org/2000/svg";
    const make = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
    ) => {
      const el = document.createElementNS(NS, tag);
      for (const k in attrs) el.setAttribute(k, String(attrs[k]));
      return el;
    };

    /* Draw order matters: outline under chords under nodes under type, so the
       labels are never crossed by a line. */
    const chain = make("path", { fill: "none", stroke: color, "stroke-width": 1, opacity: 0.55 });
    const chords = make("path", {
      fill: "none",
      stroke: color,
      "stroke-width": 1,
      opacity: 0.3,
    });
    const brackets = make("path", {
      fill: "none",
      stroke: color,
      "stroke-width": 1.25,
      opacity: 0.5,
    });
    const ticks = make("path", { fill: "none", stroke: color, "stroke-width": 1, opacity: 0.3 });
    const sweep = make("line", { stroke: accentColor, "stroke-width": 1, opacity: 0 });
    svg.append(chords, chain, brackets, ticks, sweep);

    const dots = nodes.map(() =>
      make("circle", { r: 1.6, fill: "none", stroke: color, "stroke-width": 1, opacity: 0.75 }),
    );
    dots.forEach((d) => svg.appendChild(d));

    // Only the node nearest the cursor gets the focus square, so the overlay
    // has one point of attention rather than lighting up everywhere.
    const focus = make("rect", {
      width: 11,
      height: 11,
      fill: "none",
      stroke: accentColor,
      "stroke-width": 1,
      opacity: 0,
    });
    svg.appendChild(focus);

    const tag = make("text", {
      fill: color,
      "font-size": 8,
      "letter-spacing": 1.4,
      opacity: 0.55,
      "font-family": "'JetBrains Mono', ui-monospace, monospace",
    });
    const conf = make("text", {
      fill: accentColor,
      "font-size": 8,
      "letter-spacing": 1.4,
      opacity: 0.7,
      "font-family": "'JetBrains Mono', ui-monospace, monospace",
    });
    svg.append(tag, conf);

    const texts = nodes.map((_, i) => {
      if (!labels || !labelled[i]) return null;
      const t = make("text", {
        fill: color,
        "font-size": 7.5,
        "letter-spacing": 1.1,
        opacity: 0.42,
        "font-family": "'JetBrains Mono', ui-monospace, monospace",
      });
      svg.appendChild(t);
      return t;
    });

    let w = 1;
    let h = 1;
    /* The scene fits by height on a wide viewport and by width on a narrow one.
       Below that crossover the sculpture shrinks, and an envelope measured in
       height units alone would leave the overlay hanging off both edges. The
       ratio is the scene's own: its width constraint binds below aspect 0.679. */
    let fit = 1;
    let showLabels = true;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      fit = Math.min(1, w / h / 0.679);
      // Labels need room outboard of the geometry; on a phone there is none.
      showLabels = labels && w >= 560;
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

    const px = new Float64Array(nodes.length);
    const py = new Float64Array(nodes.length);
    let raf = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      const t = reduceMotion ? 4 : (now - t0) / 1000;

      // Fade with scroll: the sculpture is on a fixed canvas, so the overlay
      // has to let go of it deliberately rather than scrolling away.
      const fade = Math.max(0, Math.min(1, 1 - window.scrollY / (h * 0.55)));
      svg.style.opacity = String(fade * opacity);
      if (fade <= 0.001) {
        raf = requestAnimationFrame(frame);
        return;
      }

      const cx = w / 2;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        // Breathe along the outward normal, which keeps every node on its own
        // radius from the axis instead of wandering across the object.
        const drift = Math.sin(t * n.rate + n.phase) * n.amp;
        const hw = envelope(n.y) * (n.out + drift);
        const yf = n.y + Math.sin(t * n.rate * 0.7 + n.phase * 1.7) * 0.004;
        // Shrink about the sculpture's centre, not the top of the viewport.
        const y = (0.4 + (yf - 0.4) * fit) * h;
        const x = cx + n.side * hw * h * fit;
        px[i] = x;
        py[i] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      /* The chain walks down one side and back up the other, so it closes into
         a single irregular polygon around the object rather than two arcs. */
      const right: number[] = [];
      const left: number[] = [];
      for (let i = 0; i < nodes.length; i++) (nodes[i].side > 0 ? right : left).push(i);
      right.sort((a, b) => py[a] - py[b]);
      left.sort((a, b) => py[b] - py[a]);
      const ring = right.concat(left);
      let d = "";
      for (let k = 0; k < ring.length; k++) {
        const i = ring[k];
        d += `${k === 0 ? "M" : "L"}${px[i].toFixed(1)} ${py[i].toFixed(1)}`;
      }
      chain.setAttribute("d", d + "Z");

      /* Callipers: a span across the object at a few heights, capped with end
         ticks. A measurement, not a chord — long diagonals across the middle
         read as scribble and fight the sculpture. */
      let cd = "";
      const spans = Math.min(right.length, left.length);
      for (let k = 1; k < spans; k += 3) {
        const a = right[k];
        const b = left[left.length - 1 - k];
        if (a === undefined || b === undefined) continue;
        const my = (py[a] + py[b]) / 2;
        cd += `M${px[b].toFixed(1)} ${my.toFixed(1)}L${px[a].toFixed(1)} ${my.toFixed(1)}`;
        cd += `M${px[b].toFixed(1)} ${(my - 3).toFixed(1)}L${px[b].toFixed(1)} ${(my + 3).toFixed(1)}`;
        cd += `M${px[a].toFixed(1)} ${(my - 3).toFixed(1)}L${px[a].toFixed(1)} ${(my + 3).toFixed(1)}`;
      }
      chords.setAttribute("d", cd);

      // Corner brackets on the bounding box, drawn as four L marks.
      const pad = 14;
      const bx0 = minX - pad;
      const bx1 = maxX + pad;
      const by0 = minY - pad;
      const by1 = maxY + pad;
      const arm = Math.min(26, (bx1 - bx0) * 0.09);
      brackets.setAttribute(
        "d",
        `M${bx0} ${by0 + arm}L${bx0} ${by0}L${bx0 + arm} ${by0}` +
          `M${bx1 - arm} ${by0}L${bx1} ${by0}L${bx1} ${by0 + arm}` +
          `M${bx1} ${by1 - arm}L${bx1} ${by1}L${bx1 - arm} ${by1}` +
          `M${bx0 + arm} ${by1}L${bx0} ${by1}L${bx0} ${by1 - arm}`,
      );

      // Scale ticks down both edges of the box.
      let td = "";
      for (let k = 1; k < 8; k++) {
        const ty = by0 + ((by1 - by0) * k) / 8;
        const len = k % 2 === 0 ? 7 : 4;
        td += `M${bx0} ${ty.toFixed(1)}L${bx0 + len} ${ty.toFixed(1)}`;
        td += `M${bx1 - len} ${ty.toFixed(1)}L${bx1} ${ty.toFixed(1)}`;
      }
      ticks.setAttribute("d", td);

      // Sweep: one slow pass down the box, brightening the nodes it crosses.
      const sy = by0 + ((t * 0.11) % 1) * (by1 - by0);
      sweep.setAttribute("x1", String(bx0 + 6));
      sweep.setAttribute("x2", String(bx1 - 6));
      sweep.setAttribute("y1", sy.toFixed(1));
      sweep.setAttribute("y2", sy.toFixed(1));
      sweep.setAttribute("opacity", "0.16");

      // Nearest node to the cursor takes the focus mark.
      let near = -1;
      let nearD = 120 * 120;
      if (mouse.has) {
        for (let i = 0; i < nodes.length; i++) {
          const dx = px[i] - mouse.x;
          const dy = py[i] - mouse.y;
          const dd = dx * dx + dy * dy;
          if (dd < nearD) { nearD = dd; near = i; }
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        const dot = dots[i];
        dot.setAttribute("cx", px[i].toFixed(1));
        dot.setAttribute("cy", py[i].toFixed(1));
        const lit = Math.exp(-Math.pow((py[i] - sy) / 26, 2));
        const isNear = i === near;
        dot.setAttribute("r", isNear ? "3.2" : (1.6 + lit * 1.1).toFixed(2));
        dot.setAttribute("opacity", isNear ? "1" : (0.5 + lit * 0.45).toFixed(2));
        dot.setAttribute("stroke", isNear ? accentColor : color);

        const tx = texts[i];
        if (tx) {
          tx.style.display = showLabels ? "" : "none";
          const rightSide = nodes[i].side > 0;
          tx.setAttribute("x", (px[i] + (rightSide ? 9 : -9)).toFixed(1));
          tx.setAttribute("y", (py[i] + 3).toFixed(1));
          tx.setAttribute("text-anchor", rightSide ? "start" : "end");
          tx.setAttribute("opacity", isNear ? "0.9" : (0.28 + lit * 0.3).toFixed(2));
          tx.setAttribute("fill", isNear ? accentColor : color);
          tx.textContent = `${(px[i] / w).toFixed(3)}·${(py[i] / h).toFixed(3)}`;
        }
      }

      /* Confidence drifts slowly and never settles, which is what makes it
         read as a live estimate rather than a printed caption. */
      tag.style.display = showLabels ? "" : "none";
      conf.style.display = showLabels ? "" : "none";
      tag.setAttribute("x", (bx0 + 1).toFixed(1));
      tag.setAttribute("y", (by0 - 9).toFixed(1));
      tag.textContent = "OBJ·01 / PARTICLE FIELD";
      conf.setAttribute("x", (bx1 - 1).toFixed(1));
      conf.setAttribute("y", (by0 - 9).toFixed(1));
      conf.setAttribute("text-anchor", "end");
      conf.textContent = `CONF ${(0.93 + Math.sin(t * 0.31) * 0.035).toFixed(3)}`;

      if (near >= 0) {
        focus.setAttribute("x", (px[near] - 5.5).toFixed(1));
        focus.setAttribute("y", (py[near] - 5.5).toFixed(1));
        focus.setAttribute("opacity", "0.85");
      } else {
        focus.setAttribute("opacity", "0");
      }

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
  }, [color, accentColor, opacity, nodeCount, labels]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 2,
        ...style,
      }}
    >
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", overflow: "visible" }} />
    </div>
  );
}
