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
  scrollVh: 1.0,
  /** Viewports of the hero's own tail that the transformation reaches back
   *  into. The handover has to happen while the hero is still on screen: park
   *  it after the hero and the reader gets a second full-screen vortex, framed
   *  and captionless, which reads as the hero all over again. */
  leadVh: 0.35,
  /** Where inside that lead the field changes hands — late enough that the
   *  pinned stage is almost in place, early enough that the hero's copy is
   *  still leaving. */
  handover: [0.12, 0.185] as [number, number],

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
  delayHigh: 0.44,
  /** How much of the transition one particle's journey takes. */
  travelSpan: 0.42,
  /** Deterministic per-particle scatter on that schedule. */
  jitter: 0.07,

  /* ── The vortex ─────────────────────────────────────────────────────────
     The hero's own hourglass profile, scaled into terrain units and stood on
     the summit's axis. */
  vortexScale: 3.9,
  vortexCenterY: 13.5,
  /** Turns of twist between waist and mouth, unwound as the strands settle. */
  vortexTwist: 14,
  vortexSpin: 0.34,
  /** Terrain radius from the summit that maps to the bottom of the column. */
  fieldRadius: 118,

  /* ── Trajectory shaping ─────────────────────────────────────────────────
     Straight interpolation makes the vortex look like it is being pulled apart
     mechanically. These bend every path. */
  /** Extra turns a strand sweeps through on its way out. */
  swirlTurns: 0.5,
  /** How far a strand bows past its destination radius mid-flight. */
  bow: 0.26,
  /** How high a strand arcs mid-flight, in scene units. */
  arc: 5,

  /* ── Camera ─────────────────────────────────────────────────────────────
     One continuous path: a short push toward the column, then a long pull back
     as the landscape opens out. Interpolated with lookAt, so the horizon never
     rolls. */
  camStart: [5, 14, 12] as [number, number, number],
  aimStart: [5, 13, -50] as [number, number, number],
  /** Scene units the camera presses forward over the release phase. */
  camPush: 7,
  /** Progress range the camera travels over. */
  camRange: [0.1, 0.94] as [number, number],

  /* ── Reveals ────────────────────────────────────────────────────────────
     Keyed to each particle's own settle, not to global progress, so a line only
     appears over ground that has actually arrived. */
  lineReveal: [0.68, 0.99] as [number, number],
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
export const transitionProgress = (
  sectionId: string,
  scrollVh = TRANSITION.scrollVh,
  leadVh = TRANSITION.leadVh,
) => {
  const el = document.getElementById(sectionId);
  if (!el) return 1;
  const top = el.getBoundingClientRect().top;
  const vh = window.innerHeight;
  const lead = vh * leadVh;
  return clamp01((lead - top) / Math.max(vh * scrollVh + lead, 1));
};

/** The unravel's own progress, with the handover lead taken back off. */
export const unravelProgress = (raw: number) =>
  clamp01((raw - LEAD_FRACTION) / (1 - LEAD_FRACTION));
