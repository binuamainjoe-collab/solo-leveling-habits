import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { BODY_FRAGMENT, EMBER_FRAGMENT, EMBER_VERTEX, EYES_FRAGMENT, QUAD_VERTEX } from '@/components/assistant/beerusShader';
import { emberLayout, moodColour, sleepiness, type Mood } from '@/lib/beerus';

/** The space around the orb for its glow and sparks, as a share of its size. */
const BLEED = 0.5;
/** His sphere, in the canvas's own -1 to 1 units: half the box, since the box is twice his size. */
const R = 0.5;

const EMBER: readonly [number, number, number] = [1, 0.44, 0.125];
const AMBER: readonly [number, number, number] = [1, 0.647, 0.322];
const HOT: readonly [number, number, number] = [1, 0.85, 0.66];

/** When anyone last touched the screen, shared by every Beerus, for falling asleep. */
let lastTouch = typeof performance === 'undefined' ? 0 : performance.now();
let watching = false;
function watchActivity() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const touched = () => {
    lastTouch = performance.now();
  };
  window.addEventListener('pointerdown', touched, { passive: true, capture: true });
  window.addEventListener('keydown', touched, { passive: true, capture: true });
  window.addEventListener('wheel', touched, { passive: true, capture: true });
}

let support: boolean | null = null;
/** Whether this browser can draw him on the GPU. Without it he is the plain orb. */
export function canDrawEmbers(): boolean {
  if (support !== null) return support;
  if (Platform.OS !== 'web' || typeof document === 'undefined') return (support = false);
  try {
    const probe = document.createElement('canvas').getContext('webgl');
    support = Boolean(probe);
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    support = false;
  }
  return support;
}

export interface EmberState {
  /** Thinking: he swirls faster. */
  busy?: boolean;
  mood?: Mood;
  /** How loud the call is right now, 0 to 1: his body ripples with it. */
  voice?: () => number;
  /** Whether he may doze off when nobody has touched the screen for a while. */
  canSleep?: boolean;
  /** Hidden for now: stop drawing until shown again. */
  paused?: boolean;
  /** Low power: when nothing is happening to him, he idles at a few frames a second. */
  slow?: boolean;
  /** How eagerly he is being called, 0 to 1: he brightens as a pull reaches him. */
  lift?: () => number;
  /** The GPU would not draw him; show the plain orb instead. */
  onFail?: () => void;
  /** His first frame is on screen: anything waiting to show him can go ahead. */
  onDrawn?: () => void;
}

type Gl = WebGLRenderingContext;

function compile(gl: Gl, vertex: string, fragment: string) {
  const make = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = make(gl.VERTEX_SHADER, vertex);
  const f = make(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!v || !f || !program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

/** Everything one canvas needs, or null when the GPU says no. */
function setUp(canvas: HTMLCanvasElement, count: number, sparks: number) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const body = compile(gl, QUAD_VERTEX, BODY_FRAGMENT);
  const embers = compile(gl, EMBER_VERTEX, EMBER_FRAGMENT);
  const eyes = compile(gl, QUAD_VERTEX, EYES_FRAGMENT);
  if (!body || !embers || !eyes) return null;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const seeds = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, seeds);
  gl.bufferData(gl.ARRAY_BUFFER, emberLayout(count, sparks), gl.STATIC_DRAW);

  // Each uniform is looked up once, then kept: asking the GPU every frame is slow.
  const where = (program: WebGLProgram) => {
    const known = new Map<string, WebGLUniformLocation | null>();
    return (name: string) => {
      if (!known.has(name)) known.set(name, gl.getUniformLocation(program, name));
      return known.get(name) ?? null;
    };
  };
  return {
    gl,
    body: { program: body, at: where(body), pos: gl.getAttribLocation(body, 'aPos') },
    embers: { program: embers, at: where(embers), seed: gl.getAttribLocation(embers, 'aSeed') },
    eyes: { program: eyes, at: where(eyes), pos: gl.getAttribLocation(eyes, 'aPos') },
    quad,
    seeds,
    points: count + sparks,
    free() {
      gl.deleteBuffer(quad);
      gl.deleteBuffer(seeds);
      gl.deleteProgram(body);
      gl.deleteProgram(embers);
      gl.deleteProgram(eyes);
      // Hand the context back now, not whenever the page gets round to it:
      // browsers allow only a few, and he opens and closes often.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

const lerp = (a: readonly number[], b: readonly number[], t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Beerus as a body of embers in 3D: a dark core inside hundreds of glowing
 * points that turn as a sphere, brightest at the rim, with his two cat's
 * eyes. He watches your finger wherever it is and leans toward it, embers
 * shy away from a touch, and he flares when pressed. Thinking, he swirls
 * faster; on a call, his body ripples with the voice; proud he burns gold,
 * angry he burns red; left alone he dozes off and wakes at a touch.
 *
 * The GPU does the drawing from a few numbers a frame. He idles at half
 * speed so he never competes with a swipe, slows right down asleep, stops
 * when hidden, and holds still when the system asks for reduced motion.
 */
export function EmberOrb({ size, ...state }: { size: number } & EmberState) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const box = size * (1 + BLEED * 2);
  const aim = useRef(state);
  useEffect(() => {
    aim.current = state;
  });

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent) return;
    watchActivity();
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `width:${box}px;height:${box}px;display:block`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(box * dpr);
    canvas.height = Math.round(box * dpr);
    const count = size < 70 ? 520 : size < 100 ? 800 : 1000;
    const sparks = size < 70 ? 10 : 14;
    let gpu = setUp(canvas, count, sparks);
    if (!gpu) {
      // A GPU that refuses the shaders refuses them for every Beerus after this one too.
      support = false;
      aim.current.onFail?.();
      return;
    }
    parent.appendChild(canvas);

    // Where the finger is, in the canvas's own units, and where he looks.
    const pointer = { x: 0, y: 0, near: 0, down: 0, seen: 0 };
    const look = { x: 0, y: 0 };
    let rect = canvas.getBoundingClientRect();
    let rectAge = 0;
    const track = (e: PointerEvent) => {
      const half = rect.width / 2 || 1;
      pointer.x = (e.clientX - (rect.left + half)) / half;
      pointer.y = -(e.clientY - (rect.top + half)) / half;
      pointer.near = Math.hypot(pointer.x, pointer.y) < R * 5 ? 1 : 0;
      pointer.seen = performance.now();
    };
    const press = (e: PointerEvent) => {
      track(e);
      if (Math.hypot(pointer.x, pointer.y) < R * 1.4) pointer.down = 1;
    };
    const lift = () => {
      pointer.down = 0;
    };
    window.addEventListener('pointermove', track, { passive: true });
    window.addEventListener('pointerdown', press, { passive: true });
    window.addEventListener('pointerup', lift, { passive: true });
    window.addEventListener('pointercancel', lift, { passive: true });

    const start = performance.now();
    let last = start;
    let energy = 0;
    let swirl = 0;
    let twist = 0;
    let turn = 0;
    let sparkT = 0;
    let swell = 0;
    let ripple = 0;
    let sleep = 0;
    let wasAsleep = false;
    let tint = 0;
    let colour = [...EMBER];
    let soft = [...AMBER];
    let hot = [...HOT];
    let angry = 0;
    let proud = 0;
    let frame = 0;
    let tick = 0;
    let shown = false;

    const draw = (t: number) => {
      if (!gpu) return;
      const { gl } = gpu;
      const dt = Math.min(50, t - last);
      last = t;
      const now = aim.current;
      const k = (ms: number) => 1 - Math.exp(-dt / ms);

      // Asleep once nobody has touched anything for a while; a touch wakes him with a start.
      const idle = now.canSleep && !now.busy && !now.voice ? t - lastTouch : 0;
      const wantSleep = sleepiness(idle, !now.canSleep);
      sleep += (wantSleep - sleep) * k(wantSleep > sleep ? 900 : 120);
      if (wasAsleep && wantSleep === 0) energy = 1;
      wasAsleep = sleep > 0.5;

      const level = now.voice ? Math.max(0, Math.min(1, now.voice())) : 0;
      ripple += (level - ripple) * k(level > ripple ? 60 : 180);
      const called = now.lift ? Math.max(0, Math.min(1, now.lift())) : 0;
      const want = Math.max(pointer.down, now.busy ? 0.75 : 0, pointer.near * 0.3, ripple * 0.6, called * 0.9);
      energy += (want - energy) * k(160);
      swell += (pointer.down - swell) * k(90);
      swirl += ((now.busy ? 1 : 0) - swirl) * k(300);
      // Thinking winds each band of embers round at its own pace; calm, they unwind.
      twist = swirl > 0.02 ? twist + dt * 0.0024 * swirl : twist * (1 - k(600));
      turn += dt * (0.00025 + energy * 0.0011 + swirl * 0.0016) * (1 - sleep * 0.8);
      sparkT += (dt / 1000) * (1 + energy * 1.4);

      // Always watching: the last place a finger was, anywhere on screen, eased toward.
      const quiet = t - pointer.seen > 6000;
      const lx = quiet || sleep > 0.5 ? 0 : Math.max(-1, Math.min(1, pointer.x / (R * 3)));
      const ly = quiet || sleep > 0.5 ? 0 : Math.max(-1, Math.min(1, -pointer.y / (R * 3)));
      look.x += (lx - look.x) * k(110);
      look.y += (ly - look.y) * k(110);

      // Mood colours ease in and out; the eyes narrow to match.
      const target = moodColour(now.mood ?? 'calm');
      tint += ((target ? 1 : 0) - tint) * k(380);
      if (target) {
        colour = lerp(EMBER, target, tint);
        // Highlights warm toward flame-yellow, not white, so red stays fire and not pink.
        soft = lerp(AMBER, lerp(target, [1, 0.75, 0.5], 0.5), tint);
        hot = lerp(HOT, lerp(target, [1, 0.95, 0.85], 0.7), tint);
      } else if (tint < 0.01) {
        colour = [...EMBER];
        soft = [...AMBER];
        hot = [...HOT];
      }
      angry += ((now.mood === 'angry' ? 1 : 0) - angry) * k(300);
      proud += ((now.mood === 'proud' ? 1 : 0) - proud) * k(300);

      const blink = 1 - Math.max(0, Math.sin(t * 0.0009 + 1.2) - 0.992) * 90;
      const lid = Math.max(0.06, Math.min(blink, 1 - sleep * 0.94));
      const scale = 1 + Math.sin(t * 0.0017) * 0.018 * (1 - sleep);
      const seconds = (t - start) / 1000;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);

      // His body and halo.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(gpu.body.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.quad);
      gl.enableVertexAttribArray(gpu.body.pos);
      gl.vertexAttribPointer(gpu.body.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(gpu.body.at('uR'), R);
      gl.uniform1f(gpu.body.at('uScale'), scale * (1 - swell * 0.07));
      gl.uniform1f(gpu.body.at('uEnergy'), energy);
      gl.uniform1f(gpu.body.at('uSleep'), sleep);
      gl.uniform3fv(gpu.body.at('uTint'), colour);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // The embers, added as light.
      gl.blendFunc(gl.ONE, gl.ONE);
      const e = gpu.embers;
      gl.useProgram(e.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.seeds);
      gl.enableVertexAttribArray(e.seed);
      gl.vertexAttribPointer(e.seed, 4, gl.FLOAT, false, 0, 0);
      gl.uniform1f(e.at('uTime'), seconds);
      gl.uniform1f(e.at('uSparkT'), sparkT);
      gl.uniform1f(e.at('uTurn'), turn);
      gl.uniform1f(e.at('uTwist'), twist);
      gl.uniform1f(e.at('uRipple'), ripple);
      gl.uniform1f(e.at('uEnergy'), energy);
      gl.uniform1f(e.at('uSleep'), sleep);
      gl.uniform1f(e.at('uScale'), scale);
      gl.uniform1f(e.at('uR'), R);
      gl.uniform1f(e.at('uDot'), (size < 70 ? 2.6 : 3) * dpr);
      gl.uniform1f(e.at('uSqueeze'), swell);
      gl.uniform2f(e.at('uLook'), look.x, look.y);
      gl.uniform3f(e.at('uPointer'), pointer.x, pointer.y, pointer.near);
      gl.uniform3fv(e.at('uTint'), colour);
      gl.uniform3fv(e.at('uTintSoft'), soft);
      gl.uniform3fv(e.at('uHot'), hot);
      gl.drawArrays(gl.POINTS, 0, gpu.points);

      // His eyes, over everything.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const y = gpu.eyes;
      gl.useProgram(y.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.quad);
      gl.enableVertexAttribArray(y.pos);
      gl.vertexAttribPointer(y.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(y.at('uR'), R);
      gl.uniform1f(y.at('uScale'), scale);
      gl.uniform1f(y.at('uLid'), lid);
      gl.uniform1f(y.at('uEnergy'), energy);
      gl.uniform1f(y.at('uPx'), 2 / canvas.width);
      gl.uniform1f(y.at('uAngry'), angry);
      gl.uniform1f(y.at('uProud'), proud);
      gl.uniform2f(y.at('uLook'), look.x, look.y);
      gl.uniform3fv(y.at('uRim'), colour);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown) {
        shown = true;
        aim.current.onDrawn?.();
      }
    };

    const loop = (t: number) => {
      frame = requestAnimationFrame(loop);
      if (document.hidden || aim.current.paused) {
        last = t;
        return;
      }
      if (++rectAge > 4) {
        rectAge = 0;
        rect = canvas.getBoundingClientRect();
      }
      // Half speed when nothing is happening to him, an eighth asleep, so he
      // leaves the frame to the app.
      const calm = energy < 0.05 && !aim.current.busy && ripple < 0.02 && !(aim.current.lift && aim.current.lift() > 0);
      const every = sleep > 0.9 ? 8 : calm ? (aim.current.slow ? 8 : 2) : 1;
      if (++tick % every !== 0) return;
      draw(t);
    };

    const onLost = (ev: Event) => {
      ev.preventDefault();
      gpu = null;
    };
    const onRestored = () => {
      gpu = setUp(canvas, count, sparks);
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    let still: ReturnType<typeof setInterval> | undefined;
    if (reduced) {
      // Still, but not stale: redrawn now and then so a mood or a state still shows.
      draw(performance.now());
      still = setInterval(() => {
        last = performance.now() - 16;
        if (!aim.current.paused) draw(last + 16);
      }, 500);
    } else frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(still);
      window.removeEventListener('pointermove', track);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', lift);
      window.removeEventListener('pointercancel', lift);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gpu?.free();
      canvas.remove();
    };
  }, [box, size, reduced]);

  return (
    <View
      ref={host}
      aria-hidden
      pointerEvents="none"
      style={{ position: 'absolute', left: -size * BLEED, top: -size * BLEED, width: box, height: box }}
    />
  );
}
