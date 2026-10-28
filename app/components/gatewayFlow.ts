/* Gateway Flow — the Constellation Field variant, ported from its authored
   Canvas 2D source.

   The drawing is the source's own: eighty dotted bezier streams, alternating
   from the left and right edges, converging on the centre, one square particle
   riding each, and a click sending a shockwave ring through them. Every
   constant below is the authored value; the options only scale them, and at
   their defaults of 1 the output is the original.

   What changed is the host boundary only:
   - It draws into a given canvas sized to its parent, not the window, and
     takes clicks in that canvas's coordinates.
   - Steps are scaled by elapsed time against the 60fps the source was timed
     at, so a 120Hz display does not run it twice as fast.
   - Stream heights are kept as fractions of the canvas height, so a resize
     keeps the composition instead of leaving streams where the old height
     put them.
   - It can pause (offscreen, background tab), draw a single still frame
     (reduced motion), and survive a lost 2D context. */

export interface GatewayFlowOptions {
  /** Multiplies how fast particles travel the streams. */
  speed?: number;
  /** Multiplies the number of streams (80 at 1). */
  density?: number;
  /** Multiplies the particle size (3px at 1). */
  size?: number;
  /** Multiplies the stream line width (1.2px at 1). */
  strokeWidth?: number;
  /** Multiplies the opacity of streams and particles. */
  opacity?: number;
  /** "dark" draws white on dark; "light" draws black on light. */
  mode?: "dark" | "light";
}

export interface GatewayFlowHandle {
  /** Starts or resumes the animation loop. */
  start(): void;
  /** Stops the loop; the last frame stays on the canvas. */
  stop(): void;
  /** Re-reads the canvas's size. Call when its box changes. */
  resize(): void;
  /** Sends a shockwave from a point in canvas CSS pixels. */
  pulse(x: number, y: number): void;
  /** Draws one frame without advancing anything. */
  still(): void;
  /** Releases the loop and listeners. */
  destroy(): void;
}

/* Authored constants. */
const NUM_PATHS = 80;
const LINE_ALPHA = 0.35;
const LINE_WIDTH = 1.2;
const DASH = [1, 4];
const DOT_ALPHA = 0.7;
const DOT_SIZE = 3;
const SPEED_MIN = 0.0015;
const SPEED_RANGE = 0.002;
const RESPAWN_JITTER = 10; // px
const WAVE_GROWTH = 15; // px per frame
const WAVE_DECAY = 0.015; // life per frame
const WAVE_BAND = 120; // px either side of the ring
const WAVE_PUSH = 80; // px at full force

const FRAME = 1000 / 60;

interface Particle { t: number; speed: number }
interface Path { isLeft: boolean; startY: number; particles: Particle[] }
interface Wave { x: number; y: number; radius: number; life: number }

function bezier(t: number, p0x: number, p0y: number, p1x: number, p1y: number,
  p2x: number, p2y: number, p3x: number, p3y: number) {
  const u = 1 - t;
  return {
    x: u ** 3 * p0x + 3 * u ** 2 * t * p1x + 3 * u * t ** 2 * p2x + t ** 3 * p3x,
    y: u ** 3 * p0y + 3 * u ** 2 * t * p1y + 3 * u * t ** 2 * p2y + t ** 3 * p3y,
  };
}

export function createGatewayFlow(
  canvas: HTMLCanvasElement,
  options: GatewayFlowOptions = {},
): GatewayFlowHandle {
  const {
    speed = 1,
    density = 1,
    size = 1,
    strokeWidth = 1,
    opacity = 1,
    mode = "dark",
  } = options;

  let ctx = canvas.getContext("2d");
  const rgb = mode === "light" ? "0, 0, 0" : "255, 255, 255";
  const lineStyle = `rgba(${rgb}, ${LINE_ALPHA * opacity})`;
  const dotStyle = `rgba(${rgb}, ${DOT_ALPHA * opacity})`;
  const dot = DOT_SIZE * size;

  let width = 0;
  let height = 0;
  let raf = 0;
  let last = 0;
  let waves: Wave[] = [];

  const numPaths = Math.max(2, Math.round(NUM_PATHS * density));
  const paths: Path[] = [];
  for (let i = 0; i < numPaths; i++) {
    paths.push({
      isLeft: i % 2 === 0,
      // (i / numPaths) * height * 1.4 - height * 0.2, as a fraction of height.
      startY: (i / numPaths) * 1.4 - 0.2,
      particles: [{ t: Math.random(), speed: SPEED_MIN + Math.random() * SPEED_RANGE }],
    });
  }

  function resize() {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    // Setting the size resets the transform, so this never compounds.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** One frame. `k` is elapsed time in source frames; 0 draws in place. */
  function draw(k: number) {
    if (!ctx || width === 0 || height === 0) return;
    ctx.clearRect(0, 0, width, height);
    const centerX = width / 2;
    const centerY = height / 2;

    for (const w of waves) {
      w.radius += WAVE_GROWTH * k;
      w.life -= WAVE_DECAY * k;
    }
    waves = waves.filter((w) => w.life > 0);

    for (const path of paths) {
      const sy = path.startY * height;
      const p0x = path.isLeft ? 0 : width;
      const p1x = path.isLeft ? centerX * 0.5 : width - centerX * 0.5;
      const p2x = path.isLeft ? centerX * 0.8 : width - centerX * 0.8;

      ctx.beginPath();
      ctx.moveTo(p0x, sy);
      ctx.bezierCurveTo(p1x, sy, p2x, centerY, centerX, centerY);
      ctx.strokeStyle = lineStyle;
      ctx.lineWidth = LINE_WIDTH * strokeWidth;
      ctx.setLineDash(DASH);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const p of path.particles) {
        p.t += p.speed * speed * k;
        if (p.t > 1) {
          p.t = 0;
          path.startY += ((Math.random() - 0.5) * RESPAWN_JITTER) / height;
        }

        // The control points were fixed before the jitter, as in the source.
        const pos = bezier(p.t, p0x, sy, p1x, sy, p2x, centerY, centerX, centerY);

        let dxTotal = 0;
        let dyTotal = 0;
        for (const w of waves) {
          const dx = pos.x - w.x;
          const dy = pos.y - w.y;
          const dist = Math.hypot(dx, dy);
          // dist > 0: the source divides by it, which is NaN at the epicentre.
          if (dist > 0 && dist < w.radius + WAVE_BAND && dist > w.radius - WAVE_BAND) {
            const force = (1 - Math.abs(dist - w.radius) / WAVE_BAND) * w.life;
            dxTotal += (dx / dist) * force * WAVE_PUSH;
            dyTotal += (dy / dist) * force * WAVE_PUSH;
          }
        }
        pos.x += dxTotal;
        pos.y += dyTotal;

        ctx.fillStyle = dotStyle;
        ctx.fillRect(pos.x - dot / 2, pos.y - dot / 2, dot, dot);
      }
    }
  }

  function loop(now: number) {
    // Long gaps (a paused tab, a dropped frame) are capped so nothing jumps.
    const k = last ? Math.min((now - last) / FRAME, 3) : 1;
    last = now;
    draw(k);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* A 2D context can be dropped by the browser under memory pressure. Hold
     the loop until it comes back, then restore the transform it lost. */
  let wasRunning = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    wasRunning = raf !== 0;
    stop();
  };
  const onRestored = () => {
    ctx = canvas.getContext("2d");
    resize();
    if (wasRunning) start();
    else draw(0);
  };
  canvas.addEventListener("contextlost", onLost);
  canvas.addEventListener("contextrestored", onRestored);

  resize();

  return {
    start,
    stop,
    resize() {
      resize();
      if (!raf) draw(0);
    },
    pulse(x, y) {
      waves.push({ x, y, radius: 0, life: 1 });
    },
    still() {
      draw(0);
    },
    destroy() {
      stop();
      canvas.removeEventListener("contextlost", onLost);
      canvas.removeEventListener("contextrestored", onRestored);
      waves = [];
    },
  };
}
