/* Demo page. Everything visible in the hero comes from HeroVortex's props, so
   this doubles as the worked example for dropping it into your own site.

   Clicking the particle field bursts it across the screen and scrolls to the
   section below at the same time — `advanceToId` is the whole wiring. */

import HeroVortex from "./components/HeroVortex";
import { color, font, radius } from "./theme";

const mono = {
  fontFamily: font.mono,
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase" as const,
};

const FEATURES = [
  {
    key: "ONE DRAW CALL",
    body: "110,000 points, no per-frame CPU work. The vertex shader derives position, size and brightness from each particle's index alone.",
  },
  {
    key: "POINTER AWARE",
    body: "The cursor parts the field in screen space, with nearer particles pushing harder. Press and the whole field bursts, then reconverges.",
  },
  {
    key: "FITS ANYTHING",
    body: "The scene scales to the viewport instead of dollying the camera, so the vitrine keeps its perspective from ultrawide down to a phone.",
  },
  {
    key: "GATED IDLE",
    body: "An IntersectionObserver and a visibility listener stop the render loop when the hero scrolls away or the tab is backgrounded.",
  },
];

export default function Page() {
  return (
    <>
      <HeroVortex
        advanceToId="next"
        actions={
          <>
            <a
              href="https://github.com/HimanshuPatial26/vortex"
              style={{
                padding: "11px 22px",
                borderRadius: radius.pill,
                background: color.text,
                color: color.ink,
                fontFamily: font.body,
                fontSize: 13.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              View the source
            </a>
            <a
              href="#next"
              style={{
                padding: "11px 22px",
                borderRadius: radius.pill,
                border: `1px solid ${color.borderInput}`,
                color: color.textDim,
                fontFamily: font.body,
                fontSize: 13.5,
                textDecoration: "none",
              }}
            >
              How it works
            </a>
          </>
        }
      />

      {/* Where the hero's click lands. A full viewport tall, so the scroll
          finishes with the hero completely out of frame. */}
      <section
        id="next"
        style={{
          minHeight: "100svh",
          background: color.ink,
          color: color.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "clamp(64px, 12vh, 120px) clamp(20px, 5vw, 48px)",
          borderTop: `1px solid ${color.borderInput}`,
        }}
      >
        <div style={{ width: "100%", maxWidth: 880 }}>
          <div style={{ ...mono, color: color.textFaint, marginBottom: 20 }}>
            02 / WHAT IT IS
          </div>
          <h2
            style={{
              fontFamily: font.display,
              fontWeight: 300,
              fontSize: "clamp(28px, 4.4vw, 44px)",
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              margin: 0,
              maxWidth: 620,
            }}
          >
            A hero section that costs almost nothing to run.
          </h2>
          <p
            style={{
              margin: "18px 0 0",
              maxWidth: 560,
              fontFamily: font.body,
              fontSize: 15,
              lineHeight: 1.7,
              color: color.textMuted,
            }}
          >
            The sculpture is a single lattice of points wrapped onto an hourglass
            profile and streamed through a noise volume. Everything you see — the
            draped funnel, the billowing waist, the dust at the base — falls out
            of that one structure.
          </p>

          <div
            style={{
              marginTop: 52,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "32px 40px",
            }}
          >
            {FEATURES.map((f) => (
              <div key={f.key}>
                <div style={{ ...mono, color: color.textFaint, marginBottom: 10 }}>
                  {f.key}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontFamily: font.body,
                    fontSize: 13.5,
                    lineHeight: 1.65,
                    color: color.textMono,
                  }}
                >
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
