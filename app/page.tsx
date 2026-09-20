/* Demo page.

   Both sections sit inside one VortexScene, which owns a single fixed canvas
   behind them. Clicking the hero bursts the field and scrolls down; as the
   second section rises, the same particles collect out of the scatter into the
   terrain. They are never handed off between two canvases — it is one field
   throughout, morphing between two target forms. */

"use client";

import dynamic from "next/dynamic";
import VortexScene from "./components/VortexScene";
import HeroVortex from "./components/HeroVortex";
import MountainHUD from "./components/MountainHUD";
import { color, font } from "./theme";
import { TRANSITION, transitionProgress, unravelProgress, smoothstep } from "./components/transition";
import { useCallback, useEffect, useRef } from "react";

// Its own WebGL context, so it only mounts on the client.
const ParticleMountain = dynamic(() => import("./components/ParticleMountain"), { ssr: false });

const mono = {
  fontFamily: font.mono,
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
};


const DUNE_READOUT = [
  { key: "FORM", value: "TRAVELLING SWELL" },
  { key: "SHADING", value: "SLOPE / CREST" },
  { key: "LENS", value: "SHALLOW FOCUS" },
];

/* Drives both fades from one loop, straight off scroll. A React state update
   per scroll event would re-render the page dozens of times a second to change
   two numbers, and a loop each would double the layout reads for no reason. */
function useTransitionFades() {
  const copy = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = unravelProgress(transitionProgress("next"));
      if (copy.current) {
        copy.current.style.opacity = String(
          smoothstep(TRANSITION.copyFade[0], TRANSITION.copyFade[1], p),
        );
      }
      if (hud.current) {
        hud.current.style.opacity = String(
          smoothstep(TRANSITION.hudFade[0], TRANSITION.hudFade[1], p),
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return { copy, hud };
}

export default function Page() {
  /* One source of truth for the whole choreography: the field, the hero's
     release and the copy all read the same number, so they cannot drift. */
  const progress = useCallback(() => transitionProgress("next"), []);
  const { copy: copyRef, hud: hudRef } = useTransitionFades();

  return (
    /* The morph stops are the resting states, not the section tops: the
       transformation owns the scroll between them, and the shared field must
       still be a vortex all the way through it. A click advances to the start
       of the transformation rather than skipping to its end. */
    <VortexScene
      sections={["rest", "third"]}
      /* A click continues to the landscape, and the transformation plays out
         under the scroll on the way — landing at its start would leave the
         reader with two more viewports to scroll before anything formed. */
      advanceTo={["rest", "third"]}
      /* The burst that opens the transformation, and the one that marks the
         dunes handover. The first is what throws the hero's field across the
         frame for the landscape to gather out of. */
      splashAt={[0.34, 1.9]}
      releaseSource={progress}
      /* The upper end has to clear its own ramp before the morph axis tops
         out, or the field only ever comes half way back for the dunes. */
      yieldRange={[0.72, 1.7]}
    >
      <HeroVortex renderCanvas={false} />

      {/* The transformation and the resting landscape share one section. Its
          first TRANSITION.scrollVh viewports gather the field with the stage
          pinned, the next TRANSITION.restVh hold the finished landscape still,
          and the last one is the stage scrolling away into the dunes. */}
      <section
        id="next"
        style={{
          position: "relative",
          height: `${(TRANSITION.scrollVh + TRANSITION.restVh + 1) * 100}svh`,
        }}
      >
        {/* Pinned for the transformation and then for the rest, so the finished
            landscape holds still under its own copy before the stage releases
            and scrolls away into the next section. */}
        <div style={{ position: "sticky", top: 0, height: "100svh", overflow: "hidden" }}>
        <ParticleMountain progressSource={progress} />
        <div ref={hudRef} style={{ position: "absolute", inset: 0, opacity: 0 }}>
          <MountainHUD />
        </div>

        {/* The foreground terrain runs straight through the copy, and a text
            shadow alone cannot hold a headline against a field of bright
            points. A soft scrim in that corner only. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            background:
              [
                "linear-gradient(to top, rgba(5,7,10,0.96) 0%, rgba(5,7,10,0.72) 14%, transparent 34%)",
                "radial-gradient(62% 52% at 2% 92%, rgba(5,7,10,0.95), rgba(5,7,10,0.55) 46%, transparent 76%)",
              ].join(","),
          }}
        />

        {/* Section copy sits under the range, clear of the summit. It arrives
            only once the landscape has, so nothing reads over a field still in
            flight. */}
        <div
          ref={copyRef}
          style={{
            position: "absolute",
            left: "clamp(20px, 5vw, 48px)",
            bottom: "clamp(40px, 7vh, 76px)",
            maxWidth: 430,
            zIndex: 3,
            opacity: 0,
          }}
        >
          <div style={{ ...mono, color: color.textFaint, marginBottom: 14 }}>
            02 / GENERATIVE TERRAIN
          </div>
          <h2
            style={{
              fontFamily: font.display,
              // Explicit: nothing upstream sets a text colour, so an unstyled
              // heading falls back to the UA default and renders black on black.
              color: color.text,
              fontWeight: 300,
              fontSize: "clamp(24px, 3.4vw, 36px)",
              lineHeight: 1.14,
              letterSpacing: "-0.02em",
              margin: 0,
              textShadow: "0 2px 40px rgba(0,0,0,0.9)",
            }}
          >
            A range that has never
            <br />
            <em style={{ fontStyle: "italic", color: color.textDim }}>
              existed anywhere.
            </em>
          </h2>
          <p
            style={{
              margin: "16px 0 0",
              fontFamily: font.body,
              fontSize: 13,
              lineHeight: 1.7,
              color: color.textMuted,
              textShadow: "0 2px 30px rgba(0,0,0,0.95)",
            }}
          >
            The range is designed, not discovered: a table of mountain masses
            and ridge paths that the shader evaluates directly, with erosion
            carved into it by ridged noise. Some two hundred thousand points
            and six hundred draped lines read the same surface, and an invisible
            copy of it writes depth so the far side never shows through.
          </p>
        </div>
        </div>

        {/* The stop the morph axis measures against: the moment the
            transformation is finished and the landscape is simply there. */}
        <div
          id="rest"
          aria-hidden
          style={{ position: "absolute", top: `${TRANSITION.scrollVh * 100}svh`, height: 1, width: 1 }}
        />
      </section>

      {/* Third stop. Scrolling past the boundary scatters the field again and
          it settles into the dune plane. */}
      <section
        id="third"
        style={{
          position: "relative",
          minHeight: "100svh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "clamp(40px, 7vh, 76px) clamp(20px, 5vw, 48px)",
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <div style={{ ...mono, color: color.textFaint, marginBottom: 16 }}>
            03 / DOWN ON THE SURFACE
          </div>
          <h2
            style={{
              fontFamily: font.display,
              // Explicit: nothing upstream sets a text colour, so an unstyled
              // heading falls back to the UA default and renders black on black.
              color: color.text,
              fontWeight: 300,
              fontSize: "clamp(26px, 4vw, 40px)",
              lineHeight: 1.14,
              letterSpacing: "-0.02em",
              margin: 0,
              textShadow: "0 2px 40px rgba(0,0,0,0.9)",
            }}
          >
            Close enough
            <br />
            <em style={{ fontStyle: "italic", color: color.textDim }}>
              to lose the horizon.
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
            The third stop drops the camera onto the field itself. Points are
            jittered inside their own lattice cells, so nothing reads as a grid;
            brightness comes off the surface slope rather than its height, which
            is what draws the light along the crests; and a faked circle of
            confusion swells whatever falls outside the focal band.
          </p>

          <div style={{ display: "grid", gap: 4 }}>
            {DUNE_READOUT.map((r) => (
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
