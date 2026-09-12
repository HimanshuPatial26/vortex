# Particle Vortex Hero

An interactive WebGL hero section for React: a particle sculpture suspended in a
hairline vitrine, with editorial HUD micro-typography and film grain over
near-black.

The sculpture is a single GPU-resident lattice of ~110,000 points. Every
particle is addressed by its index as `(strand, sample)` on a cylindrical grid
wrapped onto an hourglass profile — a flared, draped mouth at the top, a waist
that billows sideways into a folded sheet, and a base that sheds into dust.
Position, size and brightness are all derived in the vertex shader from that
index alone, so the whole field costs **one draw call** and nothing is simulated
on the CPU.

```bash
npm install
npm run dev      # http://localhost:3000
```

## Using it in your own project

Copy `app/components/ParticleVortex.tsx` and `app/components/HeroVortex.tsx`
into your project and install the one dependency:

```bash
npm install ogl
```

`ParticleVortex` is fully self-contained — it imports only `react` and `ogl`,
and takes its colours as props, so it drops in unchanged.

`HeroVortex` imports tokens from `app/theme.ts`. Either copy that file too or
point the import at your own tokens; it uses a handful of greys, one accent and
three font stacks.

The three HUD media queries live in `app/globals.css` under
`── HeroVortex HUD ──`. Copy them across or the micro-type will crowd the
sculpture on phones.

### Just the sculpture

`ParticleVortex` renders into whatever box you give it, so you can skip the
hero chrome entirely:

```tsx
import dynamic from "next/dynamic";
const ParticleVortex = dynamic(() => import("./ParticleVortex"), { ssr: false });

<div style={{ position: "relative", height: "70vh", background: "#06070C" }}>
  <ParticleVortex density="medium" />
</div>
```

Import it dynamically with `ssr: false`. It touches `window` and a WebGL
context on mount, so it cannot render on the server.

## Interaction

Three layers, all driven from the same pointer state so they stay in register:

- **Repulsion** — the cursor parts the field in screen space, with nearer
  particles pushing harder, so the void it carves has depth.
- **Pulse** — pressing fires an expanding ring that displaces and brightens
  particles as it sweeps through them.
- **Splash + advance** — the same press bursts the entire field across the
  screen and scrolls to the next section at the same time. The burst propagates
  outward from the click, so particles nearest your cursor leave first, then
  reconverges as the page settles.
- **Morph** — while that happens the field's target form migrates from the
  vortex to a ridged terrain, so the particles that scattered out of the hero
  are the ones that collect into the landscape below. See *Carrying the field*.
- **Parallax** — the scene takes a slow yaw and pitch from the pointer. The
  vitrine flexes at a third of the particle response, so the cage reads as
  rigid rather than billowing with the cloud.

`prefers-reduced-motion: reduce` renders a composed still — no drift, no flow —
that still answers the pointer, and drops to the `low` particle count. Clicking
still advances the page, but it jumps rather than bursting and gliding.

## Light and dispersion

The hero is lit from one corner rather than by a key light behind the
sculpture. `LightRays` is a fan of beams pinned at that corner by
`transform-origin`, masked to an ellipse over the sculpture so they read as
landing on it instead of washing the section. `focus` moves and resizes that
ellipse; `intensity` scales the fan; `from` mirrors it to the other corner.

CSS rather than a shader pass, deliberately: the particle canvas is shared
across every section, so anything drawn into it would follow the page down.
These live inside the hero's element and are clipped by its overflow, which is
what keeps the effect to that one section.

The light's counterpart in the field is `spectrumStrength` — a dispersion ramp
(blue through violet and rose to gold) swept across the flank the light leaves
through, over the dense lower body, and faded out entirely as the field becomes
terrain.

Two things matter if you retune it. The hue must vary *spatially*, not per
particle: under additive blending, neighbouring points carrying different hues
sum straight back to grey. And the sweep is clamped rather than wrapped with
`fract`, which would put a hard seam where pale meets blue.

## The scan overlay

`ScanOverlay` draws a computer-vision read-out over the sculpture: anchor nodes
just outside its silhouette, chained into an irregular polygon, callipers
spanning it at a few heights, corner brackets on the bounding box, scale ticks
down both edges, and coordinate labels on a handful of nodes. A slow sweep
passes down the box and brightens the nodes it crosses; the node nearest the
cursor takes a focus mark and its read-out goes accent-coloured.

SVG, not WebGL. The lines have to stay hairline-crisp at any DPR and the labels
are real text — both of which the DOM does for free and a shader turns into a
project. It costs about thirty nodes' worth of attribute writes per frame.

Two things it has to get right:

**It is fixed to the viewport, not flowed with the hero.** The sculpture is
drawn on a fixed canvas, so an overlay anchored in the document would slide off
the object the moment the page scrolled. It fades over the first half-viewport
instead.

**Its envelope follows the scene's own fit rule.** The sculpture fits by height
on a wide viewport and by width on a narrow one, and an envelope measured in
height units alone leaves the overlay hanging off both edges of a phone. Below
aspect 0.679 it shrinks with the scene, about the object's centre rather than
the top of the frame, and the labels drop out under 560px where there is no room
outboard for them.

| `HeroVortex` prop | Default | What it does |
| --- | --- | --- |
| `scanOverlay` | `true` | Draw the scan geometry. |
| `scanNodeCount` | `22` | Anchor nodes around the object. |
| `scanOpacity` | `0.62` | Master opacity. |

`ScanOverlay` itself also takes `color`, `accentColor` and `labels`. The
silhouette it hugs is the `PROFILE` table at the top of the file — half-width
against height, sampled off a render and smoothed. It is an envelope, not a
trace: the column is irregular and animated, and measurement geometry belongs
just outside the subject anyway.

## Carrying the field between sections

`VortexScene` puts one canvas, fixed to the viewport, behind every section it
wraps. Scroll position drives a `morph` uniform on the field: `0` is the hero's
vortex, `1` is the terrain. Because it is one canvas and one particle buffer
throughout, the points that scatter out of the hero are literally the points
that reassemble below — not a second field that resembles the first.

```tsx
<VortexScene sections={["next", "third"]}>
  <HeroVortex renderCanvas={false} />
  <section id="next">…</section>
  <section id="third">…</section>
</VortexScene>
```

Each id in `sections` is a stop on the morph axis — `0` the hero's vortex, `1`
the terrain, `2` the dunes — and the scene advances to whichever comes next when
the field is clicked. Crossing a boundary scatters the field whether you click
or simply scroll; a click's own splash suppresses the one its scroll would
otherwise fire, so they never double up.

`renderCanvas={false}` tells `HeroVortex` to draw only its chrome — key light,
grain, HUD, copy — and leave the sculpture to the scene. Sections inside a
`VortexScene` must be transparent, or they paint over the field behind them;
the scene owns the page background.

### The third form

The dunes drop the camera onto the field itself: a wide plane read from just
above its own surface, rolling under two travelling octaves of noise. Three
details carry it.

Points are **jittered inside their own lattice cells**, turning the regular grid
into a stratified random scatter — a visible grid is the one thing this form
cannot have. Brightness comes off the **surface slope**, not its height: the
bright filament in the reference is the crest catching the light, which means
sampling neighbouring heights for a normal. And a **faked circle of confusion**
swells and dims whatever falls outside the focal band, which is what gives the
near field its soft dark mass.

The two earlier forms share a lattice but read its axes differently. In the vortex,
strand index is the angle and samples run along each strand. In the terrain,
samples wrap the circle — so every ring is drawn by hundreds of points and
bands into a contour line — while strand index steps outward as concentric
rings. Mapping it the other way gives ~220 points per ring, which scatters into
noise rather than banding.

| `VortexScene` prop | Default | What it does |
| --- | --- | --- |
| `sections` | `[]` | ids after the hero, in order. Each is a stop on the morph axis. |
| `morphSpan` | `1` | Viewports of scrolling per morph stage. |
| `advanceDuration` | `1100` | Milliseconds a click-advance scroll takes. |
| `background` | `#06070C` | The ground the field is drawn against. |
| `onSplash` | — | Fires on click; wire it to `useAdvanceScroll`. |

Plus `density`, `color`, `accentColor` and `lineColor`, passed through.

## Props

### `ParticleVortex`

| Prop | Default | What it does |
| --- | --- | --- |
| `density` | `"medium"` | `low` 48k, `medium` 110k, `high` 180k points. |
| `color` | `#E8EAF2` | Base tint of the sculpture. |
| `accentColor` | `#8FB4FF` | Prismatic fringe picked up by the deep particles. |
| `lineColor` | `#C8CEDE` | Hairline colour of the vitrine. |
| `flowSpeed` | `0.012` | Rate the lattice streams downward. |
| `spinSpeed` | `0.075` | Continuous rotation of the column. |
| `turbulence` | `0.72` | How hard the noise field crumples the lattice. |
| `brightness` | `1` | Overall particle brightness. |
| `opacity` | `1` | Master opacity of the particle pass. |
| `parallaxStrength` | `0.5` | Pointer parallax; `0` disables camera drift. |
| `repelStrength` | `0.09` | How far the cursor pushes particles aside. |
| `showVitrine` | `true` | Draw the nested wireframe prisms. |
| `clickPulse` | `true` | Emit a pulse ring on press. |
| `morph` | `0` | Static blend: `0` vortex, `1` terrain. |
| `morphSource` | — | Read once per frame instead, for scroll-driven blends. |
| `showRing` | `true` | Draw the eclipse ring at the centre of the terrain. |
| `splashAt` | — | Morph values that splash when the scroll crosses them going down. |
| `spectrumStrength` | `1` | Prismatic dispersion across the lit flank. `0` leaves the field monochrome. |
| `splashOnClick` | `false` | Burst the whole field across the screen on press. |
| `splashStrength` | `1.15` | How far the burst throws particles, in NDC units. |
| `splashDuration` | `1.15` | Seconds for the burst to travel out and settle. |
| `onSplash` | — | Fires the moment a burst starts. `HeroVortex` uses it to scroll. |

### `HeroVortex`

All copy is prop-driven: `eyebrow`, `headline`, `subline`, `actions`, `note`,
`specs`, `channels`, `footerLeft`, `footerRight`. `headline` and `actions` take
nodes, the rest take strings. Plus `density` (passed through), `height`
(default `100svh`) and `style`.

### Click to advance

Give `HeroVortex` the id of the section below it and clicking the field bursts
the particles and scrolls there in one gesture:

```tsx
<HeroVortex advanceToId="next" />
...
<section id="next">…</section>
```

| Prop | Default | What it does |
| --- | --- | --- |
| `advanceToId` | — | id of the element to scroll to. Omit and the click still splashes, it just does not move the page. |
| `advanceDuration` | `1100` | Milliseconds the scroll takes. |
| `onAdvance` | — | Runs alongside the scroll, for anything else the click should trigger. |

The scroll is a hand-written `requestAnimationFrame` tween rather than
`scrollIntoView({ behavior: "smooth" })`, which lands in roughly 200ms — the
page would arrive well before the particles had finished leaving. The tween uses
`easeInOutCubic`, so its velocity peaks at the midpoint, which is exactly where
the burst reaches full extension. It cancels itself the moment the visitor
scrolls, touches or presses a key, so it never fights them for control.

## Performance

110k additive points with two noise octaves per vertex is comfortable on a
modern discrete or integrated GPU. If you see frame drops on low-end mobile,
drop to `density="low"`.

The render loop is gated twice — an `IntersectionObserver` stops it when the
hero scrolls out of view, and a `visibilitychange` listener stops it when the
tab is backgrounded — so an off-screen hero costs nothing. Device pixel ratio
is capped at 2; the fill cost of additive blending at DPR 3 is not worth it.

## How the sculpture is built

Worth knowing if you want to retune it — the interesting parameters are the
uniform defaults near the bottom of `ParticleVortex.tsx`.

- **Profile.** `uWaist` sets where the hourglass pinches, `uFlare` how hard the
  mouth opens, `uSpread` the radius at the pinch.
- **Veil.** `uTwist` wraps each strand several turns between waist and mouth so
  neighbouring strands cross and moiré. Samples are biased toward the mouth
  (`pow(t, 0.74)`) because the funnel's surface area grows with height — an
  even split leaves the veil thin exactly where it should be densest.
- **Drapery.** A slow fold field wrapped around the profile pushes the wall in
  and out, so the funnel hangs like cloth instead of ruling a clean cone.
- **Cloth.** Turbulence peaks just below the waist and is weighted ~4:1 toward
  lateral displacement, throwing a folded sheet sideways past the vitrine.
- **Crests.** Additive blending does the shading. Where the lattice bunches at a
  silhouette or a fold, points stack and the crest goes bright on its own.

The scene scales to fit the viewport rather than dollying the camera, so the
vitrine keeps identical perspective from ultrawide down to a phone, and the
sculpture simply grows denser as it shrinks.

## Stack

Next.js 14 (App Router), React 18, TypeScript, [`ogl`](https://github.com/oframe/ogl)
for the WebGL layer, Tailwind for whatever you build around the hero. The noise
is Ashima's simplex implementation, trimmed to the 3D case.
