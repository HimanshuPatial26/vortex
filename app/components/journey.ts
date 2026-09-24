/* AboutJourney — configuration and content.

   Everything that shapes the section lives here, split into two objects so
   they can be edited independently: JOURNEY is the scene (camera, the strands
   the ribbon is built from, particle budget, motion), and MILESTONES is the
   content that sits on it.

   The control points are world coordinates. They were authored the other way
   round — each one was placed where it should appear on a 16:9 screen, at a
   chosen height, and cast back along the camera ray onto the ground — which is
   why they look irregular as numbers but land the bend, the markers and the
   foreground where the reference has them. Moving a point here moves the
   silhouette; nothing else needs to change. */

export type Vec3 = [number, number, number];

/** One continuous band of the ribbon. Every per-point array has the same
 *  length as `points` and is interpolated along the strand. */
export interface JourneyStrand {
  /** Centreline control points, from the near end to the far end. */
  points: Vec3[];
  /** Half the ribbon's width at each point, in scene units. */
  halfWidth: number[];
  /** How thick the surface is, top to bottom. Small: this is a surface of
   *  light, not a tube. */
  thickness: number[];
  /** Relative particle density along the strand, 0 to ~1.5. */
  density: number[];
  /** Strength of the luminous inner stream along the strand. */
  glow: number[];
  /** Where that stream runs across the band, -1 to 1. At a bend it belongs
   *  on the inside of the curve, not down the middle. */
  core: number[];
  /** Banking around the direction of travel, in radians. A little tilt at
   *  the bend is what keeps the ribbon from reading as a flat painted S. */
  bank: number[];
  /** Share of the particle budget this strand receives. */
  weight: number;
  /** Where along the strand the reveal starts, 0 to 1. */
  revealFrom: number;
}

export const JOURNEY = {
  camera: {
    position: [0, 7, 18] as Vec3,
    target: [2, -0.9, -12] as Vec3,
    fov: 38,
  },

  strands: [
    {
      /* The main band. Enters past the lower-right edge, sweeps in to the bend
         left of centre, then runs away toward the upper right. */
      points: [
        [11.03, -0.6, 10.29],
        [8.26, 0, 7.61],
        [5.84, 0, 4.25],
        [3.28, 0, 0.32],
        [1.16, 0.2, -3.56], // the bend
        [2.31, 0.4, -7.02],
        [6.43, 0.7, -11.37], // EXPERIENCE
        [12.67, 1.0, -17.44],
        [22.72, 1.3, -27.83], // NEXT CHAPTER
        [47.18, 1.6, -49.52],
        [119.33, 2.0, -110.31],
      ],
      halfWidth: [5.6, 4.6, 3.6, 2.8, 2.25, 2.1, 2.15, 2.45, 2.95, 4.0, 6.5],
      thickness: [0.34, 0.3, 0.26, 0.22, 0.2, 0.2, 0.22, 0.26, 0.34, 0.5, 0.8],
      density: [1.25, 1.25, 1.2, 1.2, 1.45, 1.3, 1.1, 0.95, 0.85, 0.7, 0.5],
      glow: [0.7, 0.8, 1.0, 1.4, 2.1, 1.8, 1.3, 1.0, 0.75, 0.5, 0.3],
      core: [0.1, 0.15, 0.25, 0.38, 0.45, 0.4, 0.25, 0.12, 0.05, 0, 0],
      bank: [0.05, 0.04, 0.02, -0.05, -0.12, -0.08, -0.02, 0.02, 0.03, 0.03, 0.03],
      weight: 1,
      revealFrom: 0.4,
    },
    {
      /* The fainter outer sweep, reaching down to the lower left and joining
         the main band at the bend. */
      points: [
        [-10.3, -0.3, 4.7],
        [-7.62, 0, 3.59],
        [-5.24, 0, 1.69], // BEGINNINGS
        [-2.8, 0.1, -0.38],
        [-0.47, 0.2, -2.21],
        [1.15, 0.2, -3.31],
      ],
      halfWidth: [3.6, 3.1, 2.7, 2.35, 2.05, 1.9],
      thickness: [0.4, 0.34, 0.3, 0.26, 0.22, 0.2],
      density: [0.55, 0.65, 0.75, 0.85, 0.95, 1.0],
      glow: [0.05, 0.08, 0.12, 0.2, 0.35, 0.6],
      core: [0, 0, 0, 0, 0, 0],
      bank: [0.0, 0.0, 0.02, 0.04, 0.06, 0.06],
      weight: 0.18,
      revealFrom: 1,
    },
  ] as JourneyStrand[],

  /** Samples per strand in the frame texture. The shader interpolates
   *  between them, so this only needs to resolve the curve, not the points. */
  samples: 256,

  /* Particle budget, desktop. Phones get `narrowScale` of it. */
  particles: {
    /** The surface itself. */
    main: 62000,
    /** The narrower luminous stream down the middle. */
    inner: 36000,
    /** Sparse points drifting past the ribbon's edges. */
    scatter: 14000,
    /** Soft out-of-focus highlights in the near foreground. */
    bokeh: 160,
    /** A thin haze of points hanging above the surface. */
    dust: 1400,
  },
  narrowScale: 0.5,

  /* Look */
  pointSize: 1.45,
  brightness: 1.3,
  /** Distance over which the far ribbon fades. */
  fogNear: 26,
  fogFar: 150,
  /** Strength of the soft glow laid under the bend. */
  bendGlow: 0.62,

  /* Motion */
  /** Fraction of a strand a particle travels per second. Slow: a particle
   *  takes most of a minute to cross the frame. */
  flow: 0.0045,
  parallax: 0.7,
  /** How much the camera rises as the section scrolls through. */
  scrollLift: 0.9,
  pointerRadius: 0.2,
  pointerForce: 0.035,
  /** Seconds the reveal takes once the section is in view. */
  revealSeconds: 1.6,

  /* Quality */
  maxDpr: 1.75,
  minQuality: 0.5,

  /** The figure: which strand, how far along, and its height as a fraction
   *  of the section height. */
  figure: { strand: 0, s: 0.43, u: 0.42, height: 0.028 },
};

export type JourneyConfig = typeof JOURNEY;

export interface Milestone {
  id: string;
  /** Ordinal shown before the label, e.g. "02". */
  index: string;
  /** Compact uppercase label. */
  label: string;
  /** Card title, set in the serif. */
  title: string;
  /** One short line under the title. */
  body: string;
  /** Where the marker sits: strand, position along it, offset across it. */
  anchor: { strand: number; s: number; u: number };
  /** Length of the leader line, in px. */
  leader: number;
  /** Position used if WebGL is unavailable, as percentages of the scene. */
  fallback: { x: number; y: number };
}

/* The copy for EXPERIENCE is as supplied. BEGINNINGS and NEXT CHAPTER are
   deliberately general placeholders — they make no claims about employers,
   dates or qualifications, and are meant to be replaced with real content. */
export const MILESTONES: Milestone[] = [
  {
    id: "beginnings",
    index: "01",
    label: "BEGINNINGS",
    title: "Where the questions started.",
    body: "The first curiosities that pointed the way.",
    anchor: { strand: 1, s: 0.4, u: 0 },
    leader: 56,
    fallback: { x: 20, y: 73 },
  },
  {
    id: "experience",
    index: "02",
    label: "EXPERIENCE",
    title: "Learning through doing.",
    body: "Every challenge adds a new perspective.",
    anchor: { strand: 0, s: 0.6, u: 0 },
    leader: 64,
    fallback: { x: 62, y: 43 },
  },
  {
    id: "next",
    index: "03",
    label: "NEXT CHAPTER",
    title: "What comes next.",
    body: "New problems worth exploring.",
    anchor: { strand: 0, s: 0.8, u: 0 },
    leader: 64,
    fallback: { x: 84, y: 30 },
  },
];
