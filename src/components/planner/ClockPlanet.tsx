import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useReducedMotion, type SharedValue } from 'react-native-reanimated';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { PLANET_FRAGMENT, PLANET_VERTEX } from '@/components/planner/planetShader';
import { hourAt, planetLight } from '@/lib/planet';

type Gl = WebGLRenderingContext;

function compile(gl: Gl) {
  const make = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = make(gl.VERTEX_SHADER, PLANET_VERTEX);
  const f = make(gl.FRAGMENT_SHADER, PLANET_FRAGMENT);
  const program = gl.createProgram();
  if (!v || !f || !program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}

function setUp(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;
  const program = compile(gl);
  if (!program) return null;
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const known = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!known.has(name)) known.set(name, gl.getUniformLocation(program, name));
    return known.get(name) ?? null;
  };
  return {
    gl,
    program,
    quad,
    at,
    pos: gl.getAttribLocation(program, 'aPos'),
    free() {
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}

/**
 * The planet behind the Planner's clock, with the sun behind the ring at the
 * time it is showing: now, or wherever a finger is on the ring. Spin the
 * clock and the sun swings with the hand, the light sweeping across the
 * planet; past sunset it slips behind, leaving the lava veins glowing.
 *
 * It only draws when something moves. A touch anywhere wakes it; it eases the
 * sun after the finger and goes back to sleep once the sun is at rest, so the
 * screen sitting still costs nothing. Web only, like Beerus: without WebGL
 * the clock is simply as it was.
 */
export function ClockPlanet({
  size,
  radius,
  band,
  gap,
  scrub,
  restF,
  restHour,
  span,
  paused,
}: {
  size: number;
  /** The planet's radius, in px. */
  radius: number;
  /** How far out the sun sits: the ring's band. */
  band: number;
  /** The gap at twelve o'clock, in radians, as the ring leaves it. */
  gap: number;
  /** 0–1 round the day while a finger sets the time, otherwise -1. */
  scrub: SharedValue<number>;
  /** Where the sun rests when nothing touches the ring, 0–1. */
  restF: number;
  /** The hour that light belongs to: now's, which may be past bedtime. */
  restHour: number;
  span: { start: number; end: number };
  paused: boolean;
}) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const aim = useRef({ restF, restHour, span, paused, scrub });
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    aim.current = { restF, restHour, span, paused, scrub };
    kickRef.current();
  });

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent || !canDrawEmbers()) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `width:${size}px;height:${size}px;display:block`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    let gpu = setUp(canvas);
    if (!gpu) return;
    parent.appendChild(canvas);

    const c = size / 2;
    const turn = 2 * Math.PI - 2 * gap;
    let shown = aim.current.restF;
    let drawnKey = '';
    let frame = 0;
    let last = 0;
    let touching = false;

    const draw = (f: number, hour: number) => {
      if (!gpu) return;
      const { gl } = gpu;
      const angle = -Math.PI / 2 + gap + f * turn;
      const light = planetLight(angle, hour);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(gpu.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.quad);
      gl.enableVertexAttribArray(gpu.pos);
      gl.vertexAttribPointer(gpu.pos, 2, gl.FLOAT, false, 0, 0);
      // The canvas counts y up from the bottom; the clock counts it down from the top.
      gl.uniform2f(gpu.at('uCentre'), c * dpr, c * dpr);
      gl.uniform1f(gpu.at('uR'), radius * dpr);
      gl.uniform2f(gpu.at('uSun'), (c + Math.cos(angle) * band) * dpr, (c - Math.sin(angle) * band) * dpr);
      gl.uniform1f(gpu.at('uSunR'), 24 * dpr);
      gl.uniform1f(gpu.at('uSunShow'), light.sun);
      gl.uniform3f(gpu.at('uL'), light.dir[0], light.dir[1], light.dir[2]);
      gl.uniform3f(gpu.at('uLight'), light.colour[0], light.colour[1], light.colour[2]);
      gl.uniform1f(gpu.at('uPower'), light.power);
      gl.uniform1f(gpu.at('uTurn'), f * 0.9);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const step = (t: number) => {
      frame = 0;
      const now = aim.current;
      if (document.hidden || now.paused) return;
      const dt = last ? Math.min(50, t - last) : 16;
      last = t;
      const held = now.scrub.get();
      const target = held >= 0 ? held : now.restF;
      // Close behind a finger; an unhurried glide home once it lets go.
      const tau = reduced ? 0 : held >= 0 ? 55 : 260;
      shown = tau ? shown + (target - shown) * (1 - Math.exp(-dt / tau)) : target;
      if (Math.abs(target - shown) < 0.0004) shown = target;
      // Away from rest the light belongs to the hour on the ring; at rest, to
      // now's hour, which past bedtime is later than the ring goes.
      const nearRest = 1 - Math.min(1, Math.abs(shown - now.restF) * 20);
      const ringHour = hourAt(shown, now.span);
      const hour = ringHour + (now.restHour - hourAt(now.restF, now.span)) * nearRest;
      const key = `${shown.toFixed(4)}|${hour.toFixed(3)}`;
      if (key !== drawnKey) {
        drawnKey = key;
        draw(shown, hour);
      }
      if (touching || shown !== target) frame = requestAnimationFrame(step);
      else last = 0;
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(step);
    };
    kickRef.current = kick;

    // Any touch might be a finger on the ring, a quest being carried or a
    // pinch: watch until it lifts and the sun has settled.
    const down = () => {
      touching = true;
      kick();
    };
    const up = () => {
      touching = false;
      kick();
    };
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    document.addEventListener('visibilitychange', kick);

    const onLost = (ev: Event) => {
      ev.preventDefault();
      gpu = null;
    };
    const onRestored = () => {
      gpu = setUp(canvas);
      drawnKey = '';
      kick();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    kick();

    return () => {
      cancelAnimationFrame(frame);
      kickRef.current = () => {};
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.removeEventListener('visibilitychange', kick);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gpu?.free();
      canvas.remove();
    };
  }, [size, radius, band, gap, reduced]);

  return <View ref={host} aria-hidden pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }} />;
}
