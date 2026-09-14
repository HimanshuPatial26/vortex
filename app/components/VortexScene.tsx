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
  /** Fraction of a viewport of scrolling per morph stage. Used only when a
   *  section id cannot be measured. */
  morphSpan?: number;
  /** Where a click advances to, if that is not the morph stops themselves. */
  advanceTo?: string[];
  /** Progress through the hero's release, read once per frame. */
  releaseSource?: () => number;
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
  /** Morph range over which the shared field stands down because a section owns
   *  its own visual. Both ends sit inside a handover, so the cross-fade happens
   *  under the splash. */
  yieldRange?: [number, number] | null;
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
  advanceTo,
  releaseSource,
  advanceDuration = 1100,
  onSplash,
  background = "#06070C",
  travelDepth = 0.72,
  yieldRange = null,
  style,
}: VortexSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollTo = useAdvanceScroll(undefined, advanceDuration);

  /* Read once per frame by the render loop rather than pushed in as a prop from
     a scroll listener — a React render per scroll event would cost far more
     than the field itself. */
  const morphSource = useCallback(() => {
    /* Measured from where the stops actually are rather than assuming one
       viewport each. A section that owns a long scroll-driven transition is
       several viewports tall, and a fixed span would run the morph off the end
       of it long before the reader got there. */
    const y = window.scrollY;
    let prev = 0;
    for (let i = 0; i < sections.length; i++) {
      const el = document.getElementById(sections[i]);
      const top = el
        ? el.getBoundingClientRect().top + y
        : window.innerHeight * morphSpan * (i + 1);
      if (y < top) return i + (y - prev) / Math.max(top - prev, 1);
      prev = top;
    }
    return sections.length;
  }, [morphSpan, sections]);

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
    const stops = advanceTo ?? sections;
    if (!stops.length) return;
    const here = Math.round(window.scrollY / Math.max(window.innerHeight, 1));
    const id = stops[Math.min(here, stops.length - 1)];
    if (id) scrollTo(id);
  }, [onSplash, sections, advanceTo, scrollTo]);

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
            releaseSource={releaseSource}
            splashAt={splashAt}
            travelDepth={travelDepth}
            yieldRange={yieldRange}
            pointerScope="window"
          />
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}
