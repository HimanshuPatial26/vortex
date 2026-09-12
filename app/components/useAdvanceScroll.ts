"use client";

/* The scroll that runs alongside the particle splash.

   Deliberately not scrollIntoView({ behavior: "smooth" }): that lands in
   roughly 200ms, so the page would arrive long before the particles had
   finished leaving. easeInOutCubic puts peak velocity at the midpoint, which is
   exactly where the burst reaches full extension and where the field is halfway
   between the two forms. */

import { useCallback, useEffect, useRef } from "react";

export function useAdvanceScroll(targetId?: string, duration = 1100) {
  const raf = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  return useCallback(() => {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return;

    const startY = window.scrollY;
    const targetY = Math.round(startY + el.getBoundingClientRect().top);
    const delta = targetY - startY;
    if (delta === 0) return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || duration <= 0) {
      window.scrollTo(window.scrollX, targetY);
      return;
    }

    if (raf.current !== null) cancelAnimationFrame(raf.current);

    // Hand the scroll straight back if the visitor takes over mid-flight.
    const detach = () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
    function cancel() {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
      detach();
    }
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("keydown", cancel);

    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - t0) / duration, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(window.scrollX, startY + delta * e);
      if (t < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        raf.current = null;
        detach();
      }
    };
    raf.current = requestAnimationFrame(step);
  }, [targetId, duration]);
}
