"use client";

/* LightRays — a slow fan of light sweeping in from a corner.

   Deliberately CSS rather than a shader pass: the particle field's canvas is
   shared across every section, so anything drawn into it would follow the page
   down. These rays live inside the hero's own element and are clipped by its
   overflow, which is what keeps the effect to that one section.

   Each beam is a tall rectangle pinned at the corner by its transform-origin
   and rotated into the fan. Only opacity and transform are animated, so the
   whole thing stays on the compositor and never triggers layout or paint. */

import type { CSSProperties } from "react";

interface Beam {
  /** Degrees clockwise from straight down. 0 hugs the right edge. */
  angle: number;
  /** Beam width as a percentage of the host's width. */
  width: number;
  /** Beam length in vmax. Long enough to reach the subject, no further. */
  length: number;
  opacity: number;
  blur: number;
  /** Seconds for one breathe cycle. Deliberately co-prime-ish so the fan
   *  never resolves into a single pulse. */
  duration: number;
  delay: number;
}

/* Widths and opacities fall off down the fan, so the beams nearest the corner
   read as the bright core and the rest as spill. */
const BEAMS: Beam[] = [
  { angle: 22, width: 9, length: 82, opacity: 0.3, blur: 40, duration: 11, delay: 0 },
  { angle: 30, width: 4.5, length: 94, opacity: 0.42, blur: 24, duration: 8.5, delay: -2.4 },
  { angle: 37, width: 2.4, length: 100, opacity: 0.5, blur: 13, duration: 13, delay: -5.1 },
  { angle: 44, width: 7, length: 90, opacity: 0.26, blur: 36, duration: 9.7, delay: -1.2 },
  { angle: 51, width: 3, length: 96, opacity: 0.32, blur: 18, duration: 15, delay: -7.6 },
  { angle: 59, width: 11, length: 78, opacity: 0.16, blur: 50, duration: 12.4, delay: -3.8 },
];

export interface LightRaysProps {
  /** Light colour. */
  color?: string;
  /** Scales every beam's opacity. 0 hides the effect. */
  intensity?: number;
  /** Which corner the light comes from. */
  from?: "top right" | "top left";
  /** The subject the light is aimed at, in percentages of the host. The fan is
   *  masked to this ellipse, so the beams read as landing on it rather than
   *  washing the whole section. */
  focus?: { x: number; y: number; rx: number; ry: number };
  style?: CSSProperties;
}

const rgba = (hex: string, a: number) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${a})`;
};

export default function LightRays({
  color = "#D6DAE6",
  intensity = 1,
  from = "top right",
  focus = { x: 50, y: 46, rx: 34, ry: 52 },
  style,
}: LightRaysProps) {
  const leftSide = from === "top left";

  /* Falls away well before the ellipse's edge, so there is no visible rim —
     the light simply stops having anything to fall on. */
  const mask = `radial-gradient(${focus.rx}% ${focus.ry}% at ${
    leftSide ? 100 - focus.x : focus.x
  }% ${focus.y}%, #000 0%, #000 48%, rgba(0,0,0,0.42) 76%, transparent 96%)`;

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        // Mirrored rather than re-angled, so one set of beam data serves both
        // corners.
        transform: leftSide ? "scaleX(-1)" : undefined,
        maskImage: mask,
        WebkitMaskImage: mask,
        ...style,
      }}
    >
      {BEAMS.map((b, i) => (
        <div
          key={i}
          className="hv-ray"
          style={
            {
              position: "absolute",
              top: "-14%",
              right: "-6%",
              width: `${b.width}%`,
              height: `${b.length}vmax`,
              transformOrigin: "100% 0%",
              background: `linear-gradient(to bottom, ${rgba(color, b.opacity * intensity)} 0%, ${rgba(
                color,
                b.opacity * intensity * 0.85,
              )} 42%, ${rgba(color, b.opacity * intensity * 0.4)} 68%, transparent 92%)`,
              filter: `blur(${b.blur}px)`,
              animationDuration: `${b.duration}s`,
              animationDelay: `${b.delay}s`,
              // Read by the keyframes so each beam breathes around its own
              // resting angle instead of a shared one.
              "--ray-angle": `${b.angle}deg`,
              transform: `rotate(${b.angle}deg)`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
