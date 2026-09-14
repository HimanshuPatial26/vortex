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
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  /** Morph positions that scatter the field as the page passes them. Defaults
   *  to one just past each stage boundary. */
  splashAt?: number[];
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
  splashAt: splashAtProp,
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
  /* Where each stop sits in the document. Measured from the stops themselves
     rather than assuming one viewport each — a section that owns a scroll-driven
     transformation is several viewports tall, and a fixed span would run the
     morph off the end of it long before the reader got there.

     Cached, because these only move when the page is laid out again: reading
     them per frame means a forced layout per stop on every frame of every
     scroll, which is pure waste for numbers that did not change. */
  const stopsRef = useRef<number[] | null>(null);
  useEffect(() => {
    const measure = () => {
      const y = window.scrollY;
      stopsRef.current = sections.map((id, i) => {
        const el = document.getElementById(id);
        return el
          ? el.getBoundingClientRect().top + y
          : window.innerHeight * morphSpan * (i + 1);
      });
    };
    measure();
    window.addEventListener("resize", measure);
    /* Section heights are in svh, so they also change when a mobile browser's
       toolbars slide away — which fires no resize event on some engines. */
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [sections, morphSpan]);

  const morphSource = useCallback(() => {
    const stops = stopsRef.current;
    if (!stops) return 0;
    const y = window.scrollY;
    let prev = 0;
    for (let i = 0; i < stops.length; i++) {
      if (y < stops[i]) return i + (y - prev) / Math.max(stops[i] - prev, 1);
      prev = stops[i];
    }
    return stops.length;
  }, []);

  /* One just past every boundary, so a plain scroll scatters the field at each
     handover exactly as a click does. A click's own splash suppresses the one
     its scroll would otherwise trigger, so they never double up. */
  const splashAt = useMemo(
    () => splashAtProp ?? sections.map((_, i) => i + 0.22),
    [splashAtProp, sections],
  );

  // A click advances to whichever section comes next from where the page is.
  const handleSplash = useCallback(() => {
    onSplash?.();
    const stops = advanceTo ?? sections;
    if (!stops.length) return;
    /* The first stop that is still meaningfully below the fold. Rounding
       scrollY into viewports picked the wrong one as soon as a section stopped
       being one viewport tall — which is how a click from the hero landed at
       the start of the transformation instead of at the landscape. */
    const id =
      stops.find((s) => {
        const el = document.getElementById(s);
        return el && el.getBoundingClientRect().top > window.innerHeight * 0.3;
      }) ?? stops[stops.length - 1];
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
