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

`ParticleMountain` is a second, self-contained scene: a generative range drawn
in ~240,000 points and ~900 draped lines, with its own camera, interactions, HUD
and — the part that makes it read as a landscape rather than a lattice — an
invisible surface underneath it that writes depth. It owns section 02; the shared
field stands down across that stretch (`yieldRange`) and returns for the dunes,
with both ends of the cross-fade sitting inside a handover where the splash
already whites out the composition.

**Built on `ogl`, not three.js.** The brief for it named three's APIs, but this
project has no three and no R3F, and adding them would mean a second 3D
framework, a second set of conventions and a second bundle alongside a renderer
that already does all of it — GPU-side geometry, custom shaders, explicit
disposal.

### The shape is designed, not discovered

A noise plane under a mask can only ever produce whatever silhouette the noise
happens to have that day. The large forms here are an explicit table —
`MOUNTAIN.masses` (oriented ellipses with heights) and `MOUNTAIN.ridges` (spines
that taper from one point to another) — unrolled into GLSL at build time and
evaluated analytically in the vertex shader. One tall narrow summit, teeth around
it, a shoulder left, a secondary peak right, branching spines descending toward
the camera with the valleys between them left empty.

Forms combine by `max`, never by sum. Summing means every spine meeting at the
summit contributes its full height there, and the peak leaves frame as an
80-unit spire; taking the greater of the two merges them the way ground does, and
each number in the table is then literally how tall that form is.

Detail comes from domain-warped ridged noise that **carves rather than piles**.
Adding ridged noise puts a spire on every crest it finds — a bed of nails.
Subtracting `(1 - ridged)` cuts gullies down into the designed mass instead,
which is what erosion does: long branching channels between ridges. The carve
scales in proportion to how much mass is underneath, so the summit erodes hard
and the open ground barely at all.

### Three surfaces, because lines and points want opposite things

- `terrainFlow` — skeleton plus three carved octaves. What the **lines** follow.
- `terrainBase` — the above with a fine gully octave cut in. What the **points**
  sit on, and what the **depth occluder** copies.
- `terrainDetail` — one octave finer again, points only.

A slice taken across close-set gullies zigzags, and a family of zigzagging slices
reads as a triangulated mesh — the one thing this must never look like. So the
lines get the smooth surface and the points get the detail. The fine octave is
carve-only, which guarantees `terrainBase ≤ terrainFlow`: a line can never sink
beneath the ground it is drawn on.

### Depth, so the range cannot show through itself

A triangulated copy of the surface is drawn first with the colour mask closed. It
contributes no colour; it exists so points and lines on the far side of a ridge
fail the depth test. It sits `occluderDrop` below the drawn surface, which has to
clear the finest octave or a point in a crevice would be hidden by its own
ground. It takes the same pointer displacement the visible layers do — a surface
that did not move with them would occlude the wrong things the moment the cursor
arrived.

Everything else is additive, and with the back faces gone that stays a bright
accumulation on crests rather than a white cloud.

### The draped lines

Families of independent strips running across the landscape, separated in depth
and wandering in it so they never read as ruled rows. Projected, they become the
long nested arcs and hanging curtains of the reference: a constant-depth cut over
a ridge rises and falls exactly where the ridge does. Adjacent paths are never
joined — no cross-connections, no triangle edges, no grid. Each thins and returns
on its own slow interval, and dotted samples taken along the same curves (a coin
flip per sample, not a fixed stride) give the beading.

### Motion that leaves the composition alone

The octaves that carry the shape are sampled at a **fixed** time. Drifting them
moved the summit by a fifteenth of the frame inside a minute; the skyline is the
composition and it has to stay where it was tuned. The idle animation lives in
the octaves that only texture the surface, in the finest octave the points read —
which cannot reach the silhouette — and in the shimmer, the path breathing, the
drift grains and the parallax. Measured over 45 seconds of animation, the median
skyline column moves 1px in 563 and the 90th percentile moves 6.

Pointer displacement is tangential rather than radial: pushing straight outward
opens a circular hole, sliding the surface sideways deforms it without punching
through it.

### Everything else

`MOUNTAIN` holds every tunable: field extent, lattice size and packing, the mass
and ridge tables, noise amplitudes, occluder resolution and drop, particle size
and thinning, path count and opacity, drift, haze, camera and motion. Pass
`config` to override any of them. `debugSurface` draws the depth occluder as a
shaded solid, which is how the silhouette was tuned before a single particle was
drawn.

Sample placement packs the lattice toward the centre and toward the camera, where
the frame actually spends its pixels. The curve is `u(k + (1-k)u²)` rather than a
power — a power's derivative goes to zero at the origin, which stacks a whole
column of the lattice onto x = 0 and leaves a bright seam up the middle of the
frame.

Mobile drops to a coarser everything, no pointer displacement, and lines the
camera up on the summit rather than the range's centre — a narrow frame has no
room for an off-axis peak. DPR is capped, and the render loop is gated by
`IntersectionObserver` and page visibility, so the section costs nothing
off-screen.

## The transition

The hero's field bursts, the burst fills the frame, and the landscape gathers
out of it. Between the two resting states sits `TRANSITION.scrollVh` viewports
of scroll with the stage pinned — about one screen — and then
`TRANSITION.restVh` more with it still pinned, holding the finished landscape
under its own copy. A sticky element scrolls out over its own height, so without
that second stretch the stage unpins the instant the transformation ends: the
composed landscape exists for one frame and then slides straight up out of the
viewport, leaving the copy sitting under a half-visible foreground. A pin is a stall: the page
stops moving while the transformation runs, and two viewports of that reads as
the scroll having jammed between two sections rather than as one section
becoming the next. Every knob for the choreography lives in one object in
`components/transition.ts`, because the sequence is split across three places
that all have to agree: the hero's field, the mountain, and the page's copy.

### The scatter is in screen space

A splash is something that happens to the picture. Spreading the field in scene
units piles its far half into the middle of the frame and leaves the corners
empty; a disc in normalised device coordinates covers exactly what the viewer
can see. The disc reaches past 1.414 — the corner of the frame in those
coordinates — so the burst spills off every edge.

Each particle starts at a point on that disc and travels to wherever its terrain
position happens to project, along a bowed and slightly swept path rather than a
straight one: a field of points each sliding down its own straight line reads as
a wipe. Its depth travels too, from somewhere much nearer or much further than
the landscape to the landscape's own, so the field has size and haze variation
on the way in instead of reading as flat confetti.

Low ground gathers first and the summit last, so the landscape builds upward out
of the scatter rather than fading in all at once. Delays are short and each
particle's journey long, so the field is visibly in flight across the whole
middle of the transformation instead of landing in the first half and waiting.

### Why this hands over cleanly

There are two canvases — the hero's field and the mountain's — and the
transformation reaches `TRANSITION.leadVh` viewports back into the hero's tail
so they change hands while the hero is still on screen. Both are scattered
particles at that moment, and a scattered field has no structure to recognise,
so there is nothing for the crossfade to give away. The handover itself sits
just past the point where the stage finishes pinning: earlier than that the
stage covers only part of the viewport, and a field fading up inside it shows
the canvas's own top edge as a hard line across the frame.

### What had to be coordinated

- **Lines do not scatter — they wait.** A strip only reads as a line while its
  vertices stay in order, and scattering each one independently turns it into a
  tangle. A line stays on the ground it describes and is simply not drawn until
  that ground has arrived.
- **The depth occluder** stays off until the ground under it exists, then rises
  into place. A finished terrain writing depth beneath a field still in flight
  would cull the travelling particles outright.
- **Shading** crosses over with the shape. Slope and ridge terms describe
  ground; a particle still in the air has none, so it carries a flat weight
  until it lands.
- **Exposure.** A quarter of a million points spread over the whole frame is a
  grey wash at full strength, so the scattered field is held well down and comes
  up as it lands. A narrow frame runs fewer particles over the same area, so it
  gets a tighter disc and brighter grains.
- **Cursor displacement** stands down while the field is in flight.

The camera is an offset from the resting station rather than a path to it:
pressed forward and slightly raised while the field is loose, easing back as it
lands. The aim never moves, so the horizon cannot roll and the last frame of the
transformation is already the section's own composition.

Nothing is integrated: every term is a pure function of the particle's own
randoms and the scroll position, so holding still holds the shape and scrolling
back scatters it again along the same paths. Reduced motion gets the same
transformation inside the first `TRANSITION.reducedSpan` of the scroll, with the
camera left where it rests.

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
| `coverFrom` | — | id of an opaque section after the scene. As it slides up over the viewport the field fades out, and once it covers the screen the field stops drawing. |

Plus `density`, `color`, `accentColor` and `lineColor`, passed through.

## About + Journey

`AboutJourney` is a self-contained section: a curved pathway of silver
particles with three milestones on it, an intro block, and a card for whichever
milestone is selected. It owns its own canvas and background, so it sits
*after* the `VortexScene` rather than inside it. Point the scene's `coverFrom`
at it, and the shared field stops drawing once the journey fills the screen.

```tsx
<VortexScene sections={["next", "third"]} coverFrom="journey">…</VortexScene>
<AboutJourney id="journey" index="04" />
```

Everything you would want to change lives in `app/components/journey.ts`:

- `MILESTONES` is the content: label, card title, one line of body, and where
  each marker sits on the path. **The copy for BEGINNINGS and NEXT CHAPTER is a
  deliberately generic placeholder.** Replace it with your own; nothing there
  claims an employer, a date or a qualification.
- `JOURNEY` is the scene. The path is built from `strands`, which are
  Catmull-Rom centrelines with per-point width, thickness, density, glow, bank,
  and the position of the bright inner stream across the band. The control
  points were placed on screen and cast back onto the ground, so moving one
  moves the silhouette directly. The same object holds the particle budget per
  layer, the flow speed, parallax, pointer strength, fog, and the figure's
  position.

The intro copy, the section number and the fonts are props:

| `AboutJourney` prop | Default | What it does |
| --- | --- | --- |
| `id` | `"journey"` | Section id; also prefixes the heading and card ids. |
| `index` | `"02"` | The number before the kicker label. |
| `label` / `heading` / `body` | the reference copy | Intro text. `heading` and `body` take JSX, so use `<br />` to break a line. |
| `milestones` | `MILESTONES` | The milestones, in path order. |
| `initial` | `"experience"` | id of the milestone selected on load. |
| `config` | `JOURNEY` | Scene configuration. |
| `scrollHint` | `"SCROLL TO EXPLORE"` | Text at the lower left; `""` hides it. |

**How it is drawn.** The centreline is sampled once on the CPU into a small
float texture of frames: position, across, up, tangent, width and glow per
sample. Every particle is just a strand, a position along it, and an offset
across and above it. The vertex shader reads the frame at that position, so
the whole field drifts along the path on the GPU. Five layers share the
buffer: the surface, the brighter inner stream, scatter off the edges, soft
foreground bokeh, and a thin dust. Markers, the figure and the cards are HTML,
positioned each frame by projecting their 3D anchors. Cards are clamped
inside the viewport.

**Interaction.** Click or tap a marker to select it. The markers are a single
tab stop; the arrow keys, Home and End move between them. Hovering or
focusing a marker brightens its stretch of the path. The pointer gently parts
the particles near it, but not over the text or the controls. Below 820px the
intro sits above the scene, and the card and a row of tabs sit below it.

**Behaviour.** The section reveals itself once as it enters, and it never pins
the scroll. Reduced motion stops the flow, the parallax and the parting. DPR is
capped at `maxDpr`, and frame time drives a particle budget that sheds points
on a slow GPU. The loop pauses off-screen and in background tabs, and the GL
context is released on unmount. Without WebGL2 the markers fall back to fixed
positions over a static gradient, and all the content is still there.

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

All copy is prop-driven: `eyebrow`, `headline`, `subline`, `actions`,
`footerLeft`, `footerRight`. `headline` and `actions` take
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
