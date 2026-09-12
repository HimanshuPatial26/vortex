"use client";

/* HeroVortex — the full hero section from the reference poster: the particle
   sculpture in its vitrine, the soft key light behind it, film grain over
   everything, and the editorial HUD micro-typography pinned to the corners.

   ParticleVortex draws the sculpture; everything here is the frame around it.
   All copy is prop-driven so the same composition can front any page. */

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { useAdvanceScroll } from "./useAdvanceScroll";
import LightRays from "./LightRays";
import { color, font } from "../theme";
import type { CSSProperties, ReactNode } from "react";

const ParticleVortex = dynamic(() => import("./ParticleVortex"), { ssr: false });

/* Film grain, baked as an inline SVG turbulence tile — no network request and
   no per-frame cost, unlike a shader pass. */
const GRAIN_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.42'/%3E%3C/svg%3E\")";

const mono: CSSProperties = {
  fontFamily: font.mono,
  fontSize: 8.5,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  lineHeight: 1.75,
  // The HUD sits under the ray fan and over the sculpture, both of which lift
  // the ground behind it. At this weight the type needs the contrast back.
  textShadow: "0 1px 12px rgba(0,0,0,0.95)",
};

export interface HeroSpec {
  key: string;
  value: string;
}

export interface HeroVortexProps {
  /** Small mono label above the headline. */
  eyebrow?: string;
  /** Display headline. Accepts a node so parts can be tinted or broken. */
  headline?: ReactNode;
  /** Supporting line under the headline. */
  subline?: string;
  /** Call-to-action buttons rendered under the subline. */
  actions?: ReactNode;
  /** Paragraph in the top-left HUD block. */
  note?: string;
  /** Key/value readout under the top-left paragraph. */
  specs?: HeroSpec[];
  /** Right-hand HUD lines, top to bottom. */
  channels?: string[];
  /** Bottom-left and bottom-right footer captions. */
  footerLeft?: string;
  footerRight?: string;
  /** Particle count tier handed to ParticleVortex. */
  density?: "low" | "medium" | "high";
  /** Section height. Defaults to a full viewport. */
  height?: string;
  /** id of the element to scroll to when the field is clicked. Omit and the
   *  click still splashes, it just does not advance the page. */
  advanceToId?: string;
  /** Runs alongside the scroll on click, for anything else the click triggers. */
  onAdvance?: () => void;
  /** Milliseconds the advance scroll takes. Matched to the splash by default so
   *  the page travels with the particles instead of arriving ahead of them. */
  advanceDuration?: number;
  /** Draw the sculpture inside this section. Set false when the hero sits in a
   *  VortexScene, which owns one canvas spanning every section. */
  renderCanvas?: boolean;
  /** Sweep animated light beams in from the top-right corner of this section. */
  lightRays?: boolean;
  /** Scales the beams' opacity. */
  lightRaysIntensity?: number;
  style?: CSSProperties;
}

/* The dot matrix in the lower-left of the reference: a plain lattice whose
   opacity falls off from the top-left, so it reads as a fading readout. */
const DotMatrix = ({ cols = 6, rows = 11 }: { cols?: number; rows?: number }) => (
  <div
    aria-hidden
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 7px)`,
      gap: "5px 0",
      marginTop: 18,
    }}
  >
    {Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols;
      const y = Math.floor(i / cols);
      // Deterministic thinning — keeps SSR and client markup identical.
      const on = (x * 7 + y * 13 + ((x * y) % 5)) % 4 !== 0;
      const fade = 1 - (x / cols) * 0.45 - (y / rows) * 0.5;
      return (
        <span
          key={i}
          style={{
            width: 2.5,
            height: 2.5,
            borderRadius: "50%",
            background: color.text,
            opacity: on ? Math.max(0.06, fade * 0.5) : 0.05,
          }}
        />
      );
    })}
  </div>
);

const DotColumn = ({ n = 9 }: { n?: number }) => (
  <div aria-hidden style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, marginTop: 16 }}>
    {Array.from({ length: n }, (_, i) => (
      <span
        key={i}
        style={{
          width: 2.5,
          height: 2.5,
          borderRadius: "50%",
          background: color.text,
          opacity: Math.max(0.08, 0.42 - i * 0.04),
        }}
      />
    ))}
  </div>
);

export default function HeroVortex({
  eyebrow = "PARTICLE VORTEX",
  headline = (
    <>
      A hundred thousand points,
      <br />
      <em style={{ fontStyle: "italic", color: color.textDim }}>one draw call.</em>
    </>
  ),
  subline = "A GPU-resident lattice streamed through a noise volume. Move the cursor to part it; click anywhere to burst it and read on.",
  actions,
  note = "A live particle field: a cylindrical lattice streamed through a noise volume, flared at the mouth and dispersed at the base. Rendered on the GPU in a single draw call.",
  specs = [
    { key: "FIELD", value: "LATTICE / CYLINDRICAL" },
    { key: "SHADING", value: "ADDITIVE" },
    { key: "INPUT", value: "POINTER + PRESS" },
    { key: "FRAME", value: "5 SHELL VITRINE" },
  ],
  channels = ["SIGNAL / STABLE", "DRIFT / CONTINUOUS", "RESPONSE / REALTIME"],
  footerLeft = "HERO SYSTEM — PARTICLE VORTEX",
  footerRight = "CLICK THE FIELD TO CONTINUE ↓",
  density = "medium",
  height = "100svh",
  advanceToId,
  onAdvance,
  advanceDuration = 1100,
  renderCanvas = true,
  lightRays = true,
  lightRaysIntensity = 1,
  style,
}: HeroVortexProps) {
  const advance = useAdvanceScroll(advanceToId, advanceDuration);
  const handleSplash = useCallback(() => {
    onAdvance?.();
    advance();
  }, [onAdvance, advance]);

  return (
    <section
      style={{
        position: "relative",
        width: "100%",
        minHeight: height,
        background: renderCanvas ? color.ink : "transparent",
        color: color.text,
        overflow: "hidden",
        isolation: "isolate",
        ...style,
      }}
    >
      {/* Ground. Flat, and the same ink every other section sits on — the hero
          used to carry its own graded wash, which made it read as a lighter
          band above the rest of the page. Standalone it still has to paint the
          ground itself; inside a VortexScene the scene owns it and this stays
          out of the way of the shared field behind the section. */}
      {renderCanvas && (
        <div aria-hidden style={{ position: "absolute", inset: 0, background: color.ink }} />
      )}

      {/* Directional light, replacing the old centred key light: it comes from
          one corner, so the sculpture is lit across rather than haloed. */}
      {lightRays && <LightRays intensity={lightRaysIntensity} from="top right" />}

      {/* The sculpture. Sized to the section so the vitrine breathes on tall
          viewports and still clears the copy on short ones. */}
      {renderCanvas && (
      <div style={{ position: "absolute", inset: 0 }}>
        <ParticleVortex
          density={density}
          color={color.text}
          accentColor={color.accentLight}
          lineColor={color.textDim}
          brightness={1}
          opacity={0.95}
          parallaxStrength={0.5}
          repelStrength={0.09}
          splashOnClick
          onSplash={handleSplash}
        />
      </div>
      )}

      {/* Grain over the render, under the type. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: GRAIN_URI,
          backgroundSize: "160px 160px",
          opacity: 0.22,
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />

      {/* ── HUD: top-left ── */}
      <div
        aria-hidden
        className="hv-hud hv-hud-tl"
        style={{
          ...mono,
          position: "absolute",
          top: "clamp(18px, 3vh, 34px)",
          left: "clamp(16px, 2.6vw, 34px)",
          maxWidth: 190,
          color: color.textMono,
          pointerEvents: "none",
        }}
      >
        <div style={{ color: color.textFaint, marginBottom: 12 }}>{eyebrow} / VISUAL SYSTEM</div>
        <p style={{ margin: 0, textTransform: "none", letterSpacing: "0.03em", fontSize: 8.5, lineHeight: 1.85, color: color.textMono }}>
          {note}
        </p>
        <div style={{ marginTop: 20, display: "grid", gap: 2 }}>
          {specs.map((s) => (
            <div key={s.key} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: color.textMono2, minWidth: 52 }}>{s.key}</span>
              <span style={{ color: color.textFaint }}>{s.value}</span>
            </div>
          ))}
        </div>
        <DotMatrix />
      </div>

      {/* ── HUD: top-right ── */}
      <div
        aria-hidden
        className="hv-hud hv-hud-tr"
        style={{
          ...mono,
          position: "absolute",
          top: "clamp(18px, 3vh, 34px)",
          right: "clamp(16px, 2.6vw, 34px)",
          textAlign: "right",
          // Lighter than its left-hand counterpart: this block sits inside the
          // lit wedge, where textMono matches the ground the rays lift it to.
          color: color.textFaint,
          pointerEvents: "none",
        }}
      >
        <div style={{ color: color.textDim, marginBottom: 14 }}>REALTIME / WEBGL</div>
        <div style={{ display: "grid", gap: 6 }}>
          {channels.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <DotColumn />
      </div>

      {/* ── Hero copy ── */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          minHeight: height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "center",
          textAlign: "center",
          padding: "clamp(80px, 14vh, 150px) clamp(20px, 5vw, 48px) clamp(64px, 11vh, 110px)",
          pointerEvents: "none",
        }}
      >
        <div style={{ maxWidth: 660 }}>
          <div style={{ ...mono, color: color.textFaint, marginBottom: 18 }}>{eyebrow}</div>
          <h1
            style={{
              fontFamily: font.display,
              fontWeight: 300,
              fontSize: "clamp(34px, 6.4vw, 62px)",
              lineHeight: 1.06,
              letterSpacing: "-0.025em",
              margin: 0,
              // Lifts the type off the densest part of the cloud without a slab.
              textShadow: "0 2px 40px rgba(0,0,0,0.85)",
            }}
          >
            {headline}
          </h1>
          {subline && (
            <p
              style={{
                margin: "20px auto 0",
                maxWidth: 470,
                fontSize: "clamp(13px, 1.5vw, 15px)",
                lineHeight: 1.65,
                color: color.textMuted,
                textShadow: "0 2px 24px rgba(0,0,0,0.9)",
              }}
            >
              {subline}
            </p>
          )}
          {actions && (
            <div
              style={{
                marginTop: 30,
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
                pointerEvents: "auto",
              }}
            >
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer captions ── */}
      <div
        aria-hidden
        className="hv-foot"
        style={{
          ...mono,
          position: "absolute",
          left: "clamp(16px, 2.6vw, 34px)",
          right: "clamp(16px, 2.6vw, 34px)",
          bottom: "clamp(14px, 2.2vh, 24px)",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          color: color.textMono2,
          zIndex: 3,
          pointerEvents: "none",
        }}
      >
        <span>{footerLeft}</span>
        <span>{footerRight}</span>
      </div>

    </section>
  );
}
