"use client";

/* MountainHUD — the technical annotation around the terrain.

   DOM and CSS rather than WebGL geometry: hairline rules stay crisp at any DPR,
   the labels are real text, and the whole layer costs one paint instead of
   competing with 60k particles for the GPU.

   Positions are authored, not generated, and kept off the summit — the range is
   the subject and the annotation reads as a margin around it. */

import type { CSSProperties, ReactNode } from "react";
import { color, font } from "../theme";

const mono: CSSProperties = {
  fontFamily: font.mono,
  fontSize: 8.5,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  lineHeight: 1.9,
  whiteSpace: "nowrap",
};

/** A short rule with a tick at one end — the annotation's leader line. */
const Leader = ({
  width = 90,
  flip = false,
}: {
  width?: number;
  flip?: boolean;
}) => (
  <svg width={width} height="7" style={{ display: "block", opacity: 0.55 }} aria-hidden>
    <line x1={flip ? width : 0} y1="3.5" x2={flip ? 6 : width - 6} y2="3.5" stroke={color.textMono} strokeWidth="1" />
    <line x1={flip ? 5 : width - 5} y1="0.5" x2={flip ? 5 : width - 5} y2="6.5" stroke={color.textFaint} strokeWidth="1" />
  </svg>
);

/** A crosshair marker: four ticks around a gap, no enclosing circle. */
const Crosshair = ({ size = 15 }: { size?: number }) => {
  const c = size / 2;
  const g = size * 0.28;
  return (
    <svg width={size} height={size} style={{ display: "block", opacity: 0.6 }} aria-hidden>
      <line x1={c} y1="0" x2={c} y2={c - g} stroke={color.textFaint} strokeWidth="1" />
      <line x1={c} y1={c + g} x2={c} y2={size} stroke={color.textFaint} strokeWidth="1" />
      <line x1="0" y1={c} x2={c - g} y2={c} stroke={color.textFaint} strokeWidth="1" />
      <line x1={c + g} y1={c} x2={size} y2={c} stroke={color.textFaint} strokeWidth="1" />
    </svg>
  );
};

/** A run of measurement ticks, every fourth one long. */
const TickRule = ({ n = 13, vertical = false }: { n?: number; vertical?: boolean }) => (
  <svg
    width={vertical ? 8 : n * 7}
    height={vertical ? n * 7 : 8}
    style={{ display: "block", opacity: 0.4 }}
    aria-hidden
  >
    {Array.from({ length: n }, (_, i) => {
      const p = i * 7 + 0.5;
      const len = i % 4 === 0 ? 7 : 3.5;
      return vertical ? (
        <line key={i} x1="0" y1={p} x2={len} y2={p} stroke={color.textMono} strokeWidth="1" />
      ) : (
        <line key={i} x1={p} y1="0" x2={p} y2={len} stroke={color.textMono} strokeWidth="1" />
      );
    })}
  </svg>
);

const Dots = ({ cols = 7, rows = 5 }: { cols?: number; rows?: number }) => (
  <div
    aria-hidden
    style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 6px)`, gap: "4px 0" }}
  >
    {Array.from({ length: cols * rows }, (_, i) => {
      const x = i % cols;
      const y = Math.floor(i / cols);
      // Deterministic thinning — SSR and the first client render must agree.
      const on = (x * 5 + y * 11 + ((x * y) % 3)) % 3 !== 0;
      return (
        <span
          key={i}
          style={{
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: color.text,
            opacity: on ? Math.max(0.08, 0.4 - y * 0.06) : 0.06,
          }}
        />
      );
    })}
  </div>
);

export interface MountainHUDProps {
  /** Top-left title, and the keywords stacked under it. */
  title?: string;
  keywords?: string[];
  /** Top-right column. */
  channels?: string[];
  /** The callout on the summit. */
  peakLabel?: string;
  peakValue?: string;
  /** Coordinate readouts to the left and right of the range. */
  latLabel?: string;
  lonLabel?: string;
  /** Foreground readouts. */
  altLabel?: string;
  gridLabel?: string;
  children?: ReactNode;
}

export default function MountainHUD({
  title = "PARTICLE TERRAIN // V1",
  keywords = ["GENERATIVE", "TOPOGRAPHY", "REALTIME", "WEBGL", "EXPLORATION"],
  channels = ["PARTICLES", "LINES", "FIELDS", "MOTION", "BEAUTY"],
  peakLabel = "PEAK_01",
  peakValue = "ELEV. 8.341",
  latLabel = "46.8527° N",
  lonLabel = "121.7603° W",
  altLabel = "ALT 3.280",
  gridLabel = "GRID // 1000M",
  children,
}: MountainHUDProps) {
  const dim = { color: color.textMono, opacity: 0.9 };

  return (
    <div
      aria-hidden
      className="pm-hud"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2 }}
    >
      {/* Top left: title, keyword stack, dot matrix. */}
      <div style={{ position: "absolute", top: "clamp(22px, 4vh, 40px)", left: "clamp(18px, 3vw, 40px)" }}>
        <div style={{ ...mono, color: color.textDim, marginBottom: 10 }}>{title}</div>
        <div style={{ ...mono, ...dim }}>
          {keywords.map((k) => (
            <div key={k}>{k}</div>
          ))}
        </div>
        <div style={{ marginTop: 12, opacity: 0.5 }}>
          <Leader width={26} />
        </div>
        <div style={{ marginTop: 22 }}>
          <Dots />
        </div>
      </div>

      {/* Top right: channel column. */}
      <div
        className="pm-hud-right"
        style={{
          position: "absolute",
          top: "clamp(22px, 4vh, 40px)",
          right: "clamp(18px, 3vw, 40px)",
          textAlign: "right",
        }}
      >
        <div style={{ ...mono, color: color.textDim }}>
          {channels.map((c) => (
            <div key={c}>{c}</div>
          ))}
        </div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", opacity: 0.5 }}>
          <Leader width={22} flip />
        </div>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
          <TickRule n={9} vertical />
        </div>
      </div>

      {/* Summit callout. Sits to the right of the peak, never over it. */}
      <div
        className="pm-hud-peak"
        style={{ position: "absolute", top: "21%", left: "58%", display: "flex", alignItems: "flex-start", gap: 8 }}
      >
        <div style={{ marginTop: 2 }}>
          <Leader width={86} />
        </div>
        <div style={{ ...mono, ...dim, lineHeight: 1.7 }}>
          <div style={{ color: color.textFaint }}>{peakLabel}</div>
          <div>{peakValue}</div>
        </div>
      </div>

      {/* Latitude, left of the range. */}
      <div
        className="pm-hud-lat"
        style={{ position: "absolute", top: "24%", left: "clamp(60px, 13vw, 210px)", display: "flex", alignItems: "center", gap: 8 }}
      >
        <div style={{ ...mono, ...dim }}>{latLabel}</div>
        <Leader width={70} />
        <Crosshair size={13} />
      </div>

      {/* Longitude, right of the range. */}
      <div
        className="pm-hud-lon"
        style={{ position: "absolute", top: "41%", right: "clamp(60px, 10vw, 170px)", display: "flex", alignItems: "center", gap: 8 }}
      >
        <Crosshair size={13} />
        <Leader width={64} flip />
        <div style={{ ...mono, ...dim }}>{lonLabel}</div>
      </div>

      {/* Foreground readouts. */}
      <div
        className="pm-hud-alt"
        style={{ position: "absolute", bottom: "12%", left: "clamp(30px, 7vw, 120px)", display: "flex", alignItems: "center", gap: 8 }}
      >
        <div style={{ ...mono, ...dim }}>{altLabel}</div>
        <Leader width={74} />
        <span style={{ width: 4, height: 4, border: `1px solid ${color.textFaint}`, opacity: 0.7 }} />
      </div>

      <div
        className="pm-hud-grid"
        style={{ position: "absolute", bottom: "7%", right: "clamp(30px, 6vw, 110px)", display: "flex", alignItems: "center", gap: 8 }}
      >
        <Crosshair size={11} />
        <div style={{ ...mono, ...dim }}>{gridLabel}</div>
      </div>

      {/* A tick rule anchored mid-left, as a scale reference. */}
      <div className="pm-hud-scale" style={{ position: "absolute", top: "16%", left: "clamp(140px, 26vw, 430px)" }}>
        <TickRule n={7} vertical />
      </div>

      {children}
    </div>
  );
}
