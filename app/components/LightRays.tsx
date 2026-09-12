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
  { angle: 14, width: 12, opacity: 0.16, blur: 52, duration: 11, delay: 0 },
  { angle: 23, width: 6, opacity: 0.22, blur: 30, duration: 8.5, delay: -2.4 },
  { angle: 30, width: 3, opacity: 0.26, blur: 16, duration: 13, delay: -5.1 },
  { angle: 37, width: 9, opacity: 0.13, blur: 46, duration: 9.7, delay: -1.2 },
  { angle: 45, width: 3.6, opacity: 0.17, blur: 22, duration: 15, delay: -7.6 },
  { angle: 53, width: 14, opacity: 0.08, blur: 62, duration: 12.4, delay: -3.8 },
  { angle: 62, width: 5, opacity: 0.1, blur: 34, duration: 10.3, delay: -6.2 },
];

export interface LightRaysProps {
  /** Light colour. */
  color?: string;
  /** Scales every beam's opacity. 0 hides the effect. */
  intensity?: number;
  /** Which corner the light comes from. */
  from?: "top right" | "top left";
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
  style,
}: LightRaysProps) {
  const leftSide = from === "top left";

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
        ...style,
      }}
    >
      {/* The source itself: a broad bloom at the corner the beams leave from.
          Without it the fan looks like it starts in mid-air. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: [
            `radial-gradient(50% 38% at 100% 0%, ${rgba(color, 0.11 * intensity)}, transparent 68%)`,
            `radial-gradient(115% 85% at 100% 0%, ${rgba(color, 0.035 * intensity)}, transparent 74%)`,
          ].join(","),
        }}
      />

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
              height: "210vmax",
              transformOrigin: "100% 0%",
              background: `linear-gradient(to bottom, ${rgba(color, b.opacity * intensity)} 0%, ${rgba(
                color,
                b.opacity * intensity * 0.3,
              )} 34%, transparent 70%)`,
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
