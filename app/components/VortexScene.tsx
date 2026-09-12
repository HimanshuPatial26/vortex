"use client";

/* VortexScene — one particle field spanning two sections.

   The canvas is fixed to the viewport and sits behind everything, so the same
   particles that make up the hero sculpture are still on screen when the next
   section arrives. Scroll position drives a morph uniform: the field leaves the
   vortex, and collects into the terrain as the second section comes up.

   Without this the particles could not carry across the boundary — two
   canvases, one per section, would be two unrelated fields that happen to look
   alike. */

import dynamic from "next/dynamic";
import { useCallback, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

const ParticleVortex = dynamic(() => import("./ParticleVortex"), { ssr: false });

export interface VortexSceneProps {
  children: ReactNode;
  /** Particle count tier. */
  density?: "low" | "medium" | "high";
  /** Base tint of the field. */
  color?: string;
  /** Prismatic fringe on the deep particles. */
  accentColor?: string;
  /** Hairline colour of the hero's vitrine. */
  lineColor?: string;
  /** Fraction of a viewport of scrolling over which the field becomes terrain.
   *  1 means the morph completes exactly as the second section fills the screen. */
  morphSpan?: number;
  /** Fires when the field is clicked, for the page to scroll. */
  onSplash?: () => void;
  /** Page ground. The sections above are transparent, so this is what the
   *  field is drawn against. */
  background?: string;
  style?: CSSProperties;
}

export default function VortexScene({
  children,
  density = "medium",
  color = "#E8EAF2",
  accentColor = "#8FB4FF",
  lineColor = "#C8CEDE",
  morphSpan = 1,
  onSplash,
  background = "#06070C",
  style,
}: VortexSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  /* Read once per frame by the render loop rather than pushed in as a prop from
     a scroll listener — a React render per scroll event would cost far more
     than the field itself. */
  const morphSource = useCallback(() => {
    const span = Math.max(window.innerHeight * morphSpan, 1);
    return Math.max(0, Math.min(1, window.scrollY / span));
  }, [morphSpan]);

  return (
    <div ref={hostRef} style={{ position: "relative", background, ...style }}>
      {/* Fixed, so the field stays put while the sections travel over it. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
        }}
      >
        {/* Re-enabled only on the canvas itself, so the field takes clicks that
            fall through the transparent sections above it. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}>
          <ParticleVortex
            density={density}
            color={color}
            accentColor={accentColor}
            lineColor={lineColor}
            brightness={1}
            opacity={0.95}
            parallaxStrength={0.5}
            repelStrength={0.09}
            splashOnClick
            onSplash={onSplash}
            morphSource={morphSource}
            pointerScope="window"
          />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
