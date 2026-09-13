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
import { useCallback, useMemo, useRef } from "react";
import { useAdvanceScroll } from "./useAdvanceScroll";
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
  /** ids of the sections after the hero, in order. Each one is a stop on the
   *  morph axis: the field takes its next form as that section fills the
   *  screen, and a click advances to whichever comes next. */
  sections?: string[];
  /** Fraction of a viewport of scrolling per morph stage. */
  morphSpan?: number;
  /** Milliseconds a click-advance scroll takes. */
  advanceDuration?: number;
  /** Runs alongside the advance when the field is clicked. */
  onSplash?: () => void;
  /** Page ground. The sections above are transparent, so this is what the
   *  field is drawn against. */
  background?: string;
  /** How far the camera dives through the field on a handover, as a fraction of
   *  its distance to the look-target. 0 disables the travel. */
  travelDepth?: number;
  style?: CSSProperties;
}

export default function VortexScene({
  children,
  density = "medium",
  color = "#E8EAF2",
  accentColor = "#8FB4FF",
  lineColor = "#C8CEDE",
  sections = [],
  morphSpan = 1,
  advanceDuration = 1100,
  onSplash,
  background = "#06070C",
  travelDepth = 0.72,
  style,
}: VortexSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollTo = useAdvanceScroll(undefined, advanceDuration);

  /* Read once per frame by the render loop rather than pushed in as a prop from
     a scroll listener — a React render per scroll event would cost far more
     than the field itself. */
  const morphSource = useCallback(() => {
    const span = Math.max(window.innerHeight * morphSpan, 1);
    return Math.max(0, Math.min(sections.length, window.scrollY / span));
  }, [morphSpan, sections.length]);

  /* One just past every boundary, so a plain scroll scatters the field at each
     handover exactly as a click does. A click's own splash suppresses the one
     its scroll would otherwise trigger, so they never double up. */
  const splashAt = useMemo(
    () => sections.map((_, i) => i + 0.22),
    [sections],
  );

  // A click advances to whichever section comes next from where the page is.
  const handleSplash = useCallback(() => {
    onSplash?.();
    if (!sections.length) return;
    const here = Math.round(window.scrollY / Math.max(window.innerHeight, 1));
    const id = sections[Math.min(here, sections.length - 1)];
    if (id) scrollTo(id);
  }, [onSplash, sections, scrollTo]);

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
            onSplash={handleSplash}
            morphSource={morphSource}
            splashAt={splashAt}
            travelDepth={travelDepth}
            pointerScope="window"
          />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
