"use client";

/* The vortex → terrain transition.
 *
 * Every tunable for the transformation lives here, in one object, because the
 * choreography is split across three places that all have to agree: the hero's
 * field (which releases the vortex), the mountain (which performs the unravel),
 * and the page (which fades the copy). A number that lived in only one of them
 * would drift out of step with the other two.
 *
 * Progress is 0 at the moment the transition section reaches the top of the
 * viewport and 1 when the transformation is complete. It is read per frame from
 * scroll position rather than pushed through React state — a re-render per
 * scroll event would cost more than the field it is driving — and it is a pure
 * function of scrollY, so scrolling backwards reconstructs the vortex exactly.
 */

export const TRANSITION = {
  /** Viewports of scroll the transformation occupies.
   *
   *  Roughly one screen. The stage is pinned for exactly this long, and a pin
   *  is a stall: the page stops moving while the transformation runs. Two
   *  viewports of that reads as the scroll having jammed between two sections
   *  rather than as one section becoming the next. */
  scrollVh: 0.65,
  /** Viewports the finished landscape is held on screen, still pinned, before
   *  the stage releases and scrolls away. Kept short: a pin is a stall, and a
   *  full viewport of it after the landscape has already arrived is a lot of
   *  wheel for a picture that has stopped changing.
   *
   *  Without this the stage unpins the instant the transformation ends, so the
   *  composed landscape exists for one frame and then slides straight up out of
   *  the viewport — leaving the section's copy sitting under a half-visible
   *  foreground. A sticky element scrolls out over its own height, so the
   *  section has to be this much taller than the stage for the landscape to
   *  hold still at all. */
  restVh: 0.6,
  /** Viewports of the hero's own tail that the transformation reaches back
   *  into. The handover has to happen while the hero is still on screen: park
   *  it after the hero and the reader gets a second full-screen vortex, framed
   *  and captionless, which reads as the hero all over again. */
  leadVh: 0.35,
  /** Where the field changes hands. Must sit past LEAD_FRACTION, where the
   *  stage finishes pinning: before that the stage covers only part of the
   *  viewport, and a field fading up inside it shows the canvas's own top edge
   *  as a hard line across the frame. */
  handover: [0.26, 0.34] as [number, number],

  /* ── Per-particle travel ────────────────────────────────────────────────
     Each particle leaves on its own schedule. The bottom of the column goes
     first and becomes the foreground; the summit holds its height until last,
     which is what keeps a recognisable peak standing while everything below it
     spreads out. */
  /** When the lowest strands start, as progress. Zero: the base begins shedding
   *  the instant the field changes hands, so there is never a beat where a
   *  fresh vortex simply stands there. */
  delayLow: 0.0,
  /** When the summit strands start. */
  delayHigh: 0.28,
  /** How much of the transition one particle's journey takes. Long, and the
   *  delays short: the field should be visibly in flight across the whole
   *  middle of the transformation rather than landing in the first half and
   *  then waiting. */
  travelSpan: 0.66,
  /** Deterministic per-particle scatter on that schedule. */
  jitter: 0.07,

  /* ── The scatter ────────────────────────────────────────────────────────
     Screen space, not scene units. The disc has to reach past 1.414 — the
     corner of the frame in normalised device coordinates — or the burst leaves
     the corners empty. */
  scatter: 1.55,
  /** How far either side of the landscape's own depth the scattered field is
   *  thrown, for size and haze variation on the way in. */
  scatterDepth: 1.0,
  /** How far down the scattered field is held. A quarter of a million points
   *  spread over the whole frame is a grey wash at full strength. */
  scatterFade: 0.4,
  /** Slow rotation of the scattered field while it hangs there. */
  drift: 0.18,

  /* ── Trajectory shaping ─────────────────────────────────────────────────
     A field of points each sliding down its own straight line reads as a wipe.
     These bend the approach. */
  /** Radians the scatter rotates about the frame centre as it comes in. */
  swirl: 0.55,
  /** How far a path bows off the straight line to its destination, in ndc. */
  bow: 0.18,

  /* ── Camera ─────────────────────────────────────────────────────────────
     Expressed as an offset from the resting station rather than an absolute
     one, so it holds at every viewport: a short push toward the landscape while
     the field is still loose, easing back as it lands. The aim never moves, so
     the horizon cannot roll and there is nothing to snap at the end. */
  camPush: 16,
  camLift: 3.5,
  /** Progress range the camera travels over. */
  camRange: [0.05, 0.95] as [number, number],

  /* ── Reveals ────────────────────────────────────────────────────────────
     Keyed to each particle's own settle, not to global progress, so a line only
     appears over ground that has actually arrived. */
  lineReveal: [0.7, 0.99] as [number, number],
  /** Progress at which the invisible depth surface starts occluding, and the
   *  range over which it rises to its final height. Before this it is off
   *  entirely: a finished terrain writing depth under an unfinished vortex
   *  would cull the travelling particles. */
  occluderOn: 0.56,
  occluderRamp: [0.58, 0.93] as [number, number],
  /** How far below the surface the occluder starts, before settling to
   *  MOUNTAIN.occluderDrop. */
  occluderDropFrom: 13,

  /* ── Text ───────────────────────────────────────────────────────────────── */
  copyFade: [0.86, 1.0] as [number, number],
  hudFade: [0.9, 1.0] as [number, number],

  /* ── Pointer ────────────────────────────────────────────────────────────
     Softened to nothing while the field is in flight, so cursor displacement
     never fights the choreography. */
  pointerFade: [0.86, 1.0] as [number, number],

  /* ── Reduced motion ─────────────────────────────────────────────────────
     The same transformation, done briefly and without camera travel. */
  reducedSpan: 0.3,
};

export type TransitionConfig = typeof TRANSITION;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
};

/** Fraction of the whole progress window that is the hero's tail. The unravel
 *  proper runs over what is left. */
export const LEAD_FRACTION =
  TRANSITION.leadVh / (TRANSITION.scrollVh + TRANSITION.leadVh);

/** Progress through the transformation, from the transition section's position.
 *  Starts `leadVh` viewports before the section reaches the top, so the hero
 *  releases and the field changes hands while the hero is still leaving.
 *  Pure in scrollY: reversing scroll retraces the same path. */
/* Memoised across the frame. Four separate things read this every frame — the
   hero's field, the landscape, and the two copy fades — and each read is a
   getBoundingClientRect, which forces the browser to lay the page out again.
   Seven forced layouts a frame during a scroll is enough to cost frames on its
   own, and dropped frames are exactly what makes a pinned stretch feel like
   hard work. */
let cachedAt = -1;
let cachedFor = "";
let cachedValue = 0;

export const transitionProgress = (
  sectionId: string,
  scrollVh = TRANSITION.scrollVh,
  leadVh = TRANSITION.leadVh,
) => {
  const now = performance.now();
  if (cachedFor === sectionId && now - cachedAt < 6) return cachedValue;

  const el = document.getElementById(sectionId);
  if (!el) return 1;
  const top = el.getBoundingClientRect().top;
  const vh = window.innerHeight;
  const lead = vh * leadVh;
  const v = clamp01((lead - top) / Math.max(vh * scrollVh + lead, 1));

  cachedAt = now;
  cachedFor = sectionId;
  cachedValue = v;
  return v;
};

/** The gather's own progress, with the handover lead taken back off. */
export const unravelProgress = (raw: number) =>
  clamp01((raw - LEAD_FRACTION) / (1 - LEAD_FRACTION));
