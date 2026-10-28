/* GatewayFlow — a closing section on the Gateway Flow constellation field.

   The background is the authored renderer in gatewayFlowRenderer.ts, untouched apart
   from its host boundary. The card follows the reference's styling: a near-
   opaque panel with a hairline border that turns into a moving highlight on
   hover, and a title whose words rise out of a mask as it enters.

   The reference demo puts a login form on this card. A portfolio has nothing
   to sign in to, so the card carries a short closing note and one action
   instead. */

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createGatewayFlow, type GatewayFlowOptions } from "./gatewayFlowRenderer";
import { color, font } from "../theme";

export interface GatewayFlowProps extends GatewayFlowOptions {
  id?: string;
  /** Section number shown before the label. */
  index?: string;
  label?: string;
  /** The title, one entry per word; each rises on its own. */
  title?: string[];
  body?: ReactNode;
  /** The card's button. Without an href it scrolls back to the top. */
  action?: { label: string; href?: string };
  /** The line under the card; "" hides it. */
  hint?: string;
  /** Ground colour behind the field. */
  background?: string;
}

function ChipIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9 2.5v3.5M15 2.5v3.5M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
      <path d="M12.6 8.8 10.4 12.2h3.2l-2.2 3.4" />
    </svg>
  );
}

export default function GatewayFlow({
  id = "gateway",
  index = "05",
  label = "GATEWAY",
  title = ["Every", "path", "converges."],
  body = "Ideas arrive from every direction and meet in the work. If something here resonated, this is where the paths come together.",
  action = { label: "Back to the start" },
  hint = "TAP OR CLICK TO SEND A PULSE",
  background = color.ink,
  speed,
  density,
  size,
  strokeWidth,
  opacity,
  mode = "dark",
}: GatewayFlowProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /* Bumped to replace the canvas when the browser loses its context and does
     not give it back; a new element gets a new context. */
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    if (!section || !canvas) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let flow: ReturnType<typeof createGatewayFlow>;
    try {
      flow = createGatewayFlow(canvas, { speed, density, size, strokeWidth, opacity, mode });
    } catch {
      return; // No 2D canvas: the card and the ground still stand.
    }

    let visible = false;
    const sync = () => {
      if (reduceMotion) {
        flow.still();
        return;
      }
      if (visible && !document.hidden) flow.start();
      else flow.stop();
    };

    // A batch can hold several crossings for the section; only the last is current.
    const io = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1].isIntersecting;
      sync();
    });
    io.observe(section);
    document.addEventListener("visibilitychange", sync);

    const ro = new ResizeObserver(() => flow.resize());
    ro.observe(canvas);

    // The source listens on the window; here only clicks on this section count.
    const onClick = (e: MouseEvent) => {
      if (reduceMotion) return;
      const r = canvas.getBoundingClientRect();
      flow.pulse(e.clientX - r.left, e.clientY - r.top);
    };
    section.addEventListener("click", onClick);

    /* The browser normally restores a lost context by itself. If it has not
       within a couple of seconds, start over on a fresh canvas — a few times
       at most, so a GPU that keeps failing doesn't spin. */
    let lostTimer = 0;
    const onLost = () => {
      window.clearTimeout(lostTimer);
      lostTimer = window.setTimeout(() => {
        setCanvasEpoch((n) => (n < 3 ? n + 1 : n));
      }, 2000);
    };
    const onRestored = () => window.clearTimeout(lostTimer);
    canvas.addEventListener("contextlost", onLost);
    canvas.addEventListener("contextrestored", onRestored);

    sync();

    return () => {
      window.clearTimeout(lostTimer);
      canvas.removeEventListener("contextlost", onLost);
      canvas.removeEventListener("contextrestored", onRestored);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", sync);
      section.removeEventListener("click", onClick);
      flow.destroy();
    };
  }, [speed, density, size, strokeWidth, opacity, mode, canvasEpoch]);

  /* The title's masked reveal, once, as it enters (the source's ScrollTrigger
     at "top 95%"). */
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("gf-in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -5% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onAction = () => {
    if (action.href) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  };

  const buttonInner = (
    <>
      <span className="gf-edge" aria-hidden />
      <span className="gf-glint" aria-hidden />
      <span className="gf-btn-label">{action.label}</span>
    </>
  );

  return (
    <section
      ref={sectionRef}
      id={id}
      aria-labelledby={`${id}-title`}
      className={`gf${mode === "light" ? " gf-light" : ""}`}
      style={{
        ["--gf-bg" as string]: mode === "light" ? "#ffffff" : background,
        ["--gf-display" as string]: "'Inter', " + font.body,
        ["--gf-mono" as string]: font.mono,
      }}
    >
      <div className="gf-field" aria-hidden>
        <div className="gf-vignette" />
        <canvas key={canvasEpoch} ref={canvasRef} className="gf-canvas" />
      </div>

      <div className="gf-main">
        <div className="gf-kicker">{index} / {label}</div>

        <div className="gf-card">
          <span className="gf-edge" aria-hidden />
          <span className="gf-glint" aria-hidden />

          <div className="gf-head">
            <div className="gf-icon"><ChipIcon /></div>
            <h2 ref={titleRef} id={`${id}-title`} className="gf-title">
              {title.map((w, i) => (
                <span key={i} className="gf-mask">
                  <span className="gf-word" style={{ transitionDelay: `${i * 0.15}s` }}>{w}</span>
                </span>
              ))}
            </h2>
            <p className="gf-body">{body}</p>
          </div>

          {action.href ? (
            <a className="gf-btn" href={action.href}>{buttonInner}</a>
          ) : (
            <button type="button" className="gf-btn" onClick={onAction}>{buttonInner}</button>
          )}
        </div>

        {hint && <p className="gf-hint">{hint}</p>}
      </div>

      {/* The source's 2px dither, kept to this section rather than the page. */}
      <div className="gf-dither" aria-hidden />
    </section>
  );
}
