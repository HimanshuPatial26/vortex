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

`ScanOverlay` puts technical measurement marks in the field around the
sculpture. Straight segments only, and no closed shapes — the object is never
ringed or boxed. A few marks reach in to take a width off the silhouette; the
rest hold station in the margins, so the centre of the frame stays the
object's. Micro-detail comes from anchor dots, small square markers,
perpendicular measurement ticks, dotted guide fragments and sparse numeric
read-outs.

**The layout is authored, not generated.** Random placement reads as scatter;
what makes an instrument look intelligent is that nothing is mirrored, no two
lengths match, and the spacing is uneven but deliberate. The `MARKS` table at
the top of the file is that composition, kept clear of the hero's own HUD
columns on both sides.

Each mark runs its own slow cycle — draw on with an ease-out, hold, fade,
repeat — with a gentle breath across the held span and an acquisition blip on
its cap. Offsets are scattered so only two or three of the twenty are ever in
transition: the field should read as being re-measured, not as blinking.
Measured across a spread of samples, that holds at 0–2 changing at a time.

This is why each mark owns a path instead of being batched into a shared one.
Batching is cheaper, but a mark in a shared path cannot fade on its own, and
independent coming and going is the whole effect.

Nodes near the cursor give a little ground and settle back as it leaves, and the
whole rig leans a few pixels with the cursor the way the sculpture parallaxes,
so the marks read as sitting in the scene with it.

Two things it has to get right:

**It is fixed to the viewport, not flowed with the hero.** The sculpture is
drawn on a fixed canvas, so an overlay anchored in the document would slide off
the object the moment the page scrolled. It fades over the first half-viewport
instead.

**Its envelope follows the scene's own fit rule.** The sculpture fits by height
on a wide viewport and by width on a narrow one; an envelope in height units
alone leaves the edge marks hanging in space on a phone. Below aspect 0.679 it
shrinks with the scene. The margin bands the field marks occupy do not exist
under 760px, so those drop out, and the labels go under 620px.

| `HeroVortex` prop | Default | What it does |
| --- | --- | --- |
| `scanOverlay` | `true` | Draw the marks. |
| `scanOpacity` | `0.7` | Master opacity. |

`ScanOverlay` itself also takes `color`, `accentColor` and `labels`.

## The mountain

`ParticleMountain` is a second, self-contained scene: a generative range built
from ~80,000 points, contour slices and a haze bank, with its own camera,
interactions and HUD. It owns section 02; the shared field stands down across
that stretch (`yieldRange`) and returns for the dunes, with both ends of the
cross-fade sitting inside a handover where the splash already whites out the
composition.

**Built on `ogl`, not three.js.** The brief for it named three's APIs, but this
project has no three and no R3F, and adding them would mean a second 3D
framework, a second set of conventions and a second bundle alongside a renderer
that already does all of it — GPU-side geometry, custom shaders, explicit
disposal.

Three layers share one context and, critically, one `terrainHeight` function:
terrain points, contour lines, haze. They are layers rather than three
components because the lines have to sit exactly on the surface the points
describe; split across components they would need either three GL contexts or a
great deal of plumbing to stay in sync.

The height field is `fbm + ridged + medium + fine`, multiplied by a band that
places the mass in the middle distance and a peak mask that raises one summit
above the rest. It is evaluated in the vertex shader, never on the CPU — which
is what makes the idle deformation free: nothing is re-uploaded, the range
simply breathes because its noise is sampled against time.

Contours are slices at constant *depth*, not true iso-height curves. Marching an
isoline every frame over a terrain that moves would cost a rebuild per frame; a
depth slice is a static buffer whose height the shader supplies, and on a slope
the two are indistinguishable — rows crowd in screen space exactly where a
contour map tightens its bands.

Every tunable is in the exported `MOUNTAIN` object at the top of the file:
geometry, the four noise amplitudes, band and peak placement, particle size and
density, contour count and opacity, haze, camera, scroll push, pointer radius
and force. Pass `config` to override any of them.

Mobile drops to a coarser grid, fewer contours and no pointer displacement, and
lines the camera up on the summit rather than the range's centre — a narrow
frame has no room for an off-axis peak. DPR is capped, and the render loop is
gated by `IntersectionObserver` and page visibility, so the section costs
nothing off-screen.

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

### Travelling between sections

The handover is a camera move, not a cut. While the splash runs, the camera
travels along its own view axis toward the point it is already aimed at, so the
field opens and rushes past — you go *into* the sculpture and come out in the
next section's form. It is out and back on a half-sine: deepest at the midpoint,
which is where the scroll is fastest and the form is halfway between its two
shapes, and back at its station by the time the splash settles.

Moving toward the look-target and re-aiming at the same point is a true dolly —
the orientation never changes, only the distance. That is what separates
travelling *into* something from zooming *at* it.

The lens also widens by a few degrees at the deepest point. The dolly alone
reads as a slow push; the widening is what the eye takes as acceleration.

`travelDepth` (default `0.72`, on both `VortexScene` and `ParticleVortex`) is
the fraction of the distance covered; `0` disables the travel and leaves the
splash alone. Past about `0.9` the camera overshoots the target and the dive
inverts. `travelFov` on `ParticleVortex` sets the punch in degrees.

The scan overlay is DOM and cannot follow a 3D camera, so it scales outward
through the handover instead. Without that it sits perfectly still while
everything behind it rushes, and the travel reads as a video playing under a
sticker.

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
