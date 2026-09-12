/* Demo page.

   Both sections sit inside one VortexScene, which owns a single fixed canvas
   behind them. Clicking the hero bursts the field and scrolls down; as the
   second section rises, the same particles collect out of the scatter into the
   terrain. They are never handed off between two canvases — it is one field
   throughout, morphing between two target forms. */

"use client";

import VortexScene from "./components/VortexScene";
import HeroVortex from "./components/HeroVortex";
import { useAdvanceScroll } from "./components/useAdvanceScroll";
import { color, font, radius } from "./theme";

const mono = {
  fontFamily: font.mono,
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
};

const READOUT = [
  { key: "FORM", value: "RIDGED TERRAIN" },
  { key: "GRID", value: "POLAR / 220 RINGS" },
  { key: "SOURCE", value: "CARRIED FROM 01" },
];

export default function Page() {
  // The scene owns the click, so the tween lives here and is handed down.
  const advance = useAdvanceScroll("next", 1100);

  return (
    <VortexScene onSplash={advance}>
      <HeroVortex renderCanvas={false} />

      {/* Where the hero's click lands, and where the scattered particles
          reassemble. A full viewport tall so the morph completes exactly as it
          fills the screen. */}
      <section
        id="next"
        style={{
          position: "relative",
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "clamp(40px, 7vh, 76px) clamp(20px, 5vw, 48px)",
        }}
      >
        {/* Type sits top and bottom; the middle band is left to the terrain. */}
        <div style={{ maxWidth: 520 }}>
          <div style={{ ...mono, color: color.textFaint, marginBottom: 16 }}>
            02 / THE FIELD REASSEMBLED
          </div>
          <h2
            style={{
              fontFamily: font.display,
              fontWeight: 300,
              fontSize: "clamp(26px, 4vw, 40px)",
              lineHeight: 1.14,
              letterSpacing: "-0.02em",
              margin: 0,
              textShadow: "0 2px 40px rgba(0,0,0,0.9)",
            }}
          >
            The same particles,
            <br />
            <em style={{ fontStyle: "italic", color: color.textDim }}>
              a different shape.
            </em>
          </h2>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          <p
            style={{
              margin: 0,
              maxWidth: 380,
              fontFamily: font.body,
              fontSize: 13.5,
              lineHeight: 1.7,
              color: color.textMuted,
              textShadow: "0 2px 30px rgba(0,0,0,0.95)",
            }}
          >
            Nothing is created or destroyed here — the field that made the
            column is the field that makes the range. The lattice re-reads its
            own two axes: samples along a strand wrap the circle as contour
            bands, strand index steps outward as rings, and ridged noise lifts
            the crests. The vitrine fades, because a cage has no business
            around a landscape.
          </p>

          <div style={{ display: "grid", gap: 4 }}>
            {READOUT.map((r) => (
              <div key={r.key} style={{ ...mono, display: "flex", gap: 10 }}>
                <span style={{ color: color.textMono2, minWidth: 58 }}>{r.key}</span>
                <span style={{ color: color.textFaint }}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </VortexScene>
  );
}
