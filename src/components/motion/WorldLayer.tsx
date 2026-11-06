import { useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { onLanding } from '@/components/motion/flight';
import type { TabsMotion } from '@/components/motion/SwipeTabs';
import { WORLD_FRAGMENT, WORLD_VERTEX } from '@/components/motion/worldShader';
import { RANKS } from '@/constants/theme';
import { clamp } from '@/lib/motion';
import { SKY_STARS, skyFor } from '@/lib/moments';
import { coldFor, heatForRank, missedDays, skyAt, type Sky } from '@/lib/world';
import { useDayStats, useProgress, useRecentDays } from '@/store/progress';

/** World units between one tab and the next. The shader uses the same figure. */
const STEP = 0.7;
/** How far the scene lifts over a long scroll, as a share of the screen. */
const RISE = 0.12;
const SCROLL_SPAN = 1800;
const TILT = 0.014;
/** Sharpness falls first, then the idle shimmer. The canvas is scaled up softly. */
const TIERS = [
  { scale: 0.5, ambient: 12 },
  { scale: 0.38, ambient: 6 },
  { scale: 0.28, ambient: 0 },
];
const MAX_WIDTH = 640;

/** Test copies only: runs the day, the ranks and missed days as a time-lapse. */
const LAPSE = process.env.EXPO_PUBLIC_WORLD_DEMO === '1';

interface Frame {
  width: number;
  height: number;
  camX: number;
  camY: number;
  sky: Sky;
  heat: number;
  cold: number;
  forge: number;
  flare: number;
  /** x, y, size for each star, and how dark the night is, 0 to 1. */
  stars: Float32Array;
  starCount: number;
  night: number;
  time: number;
}

function startGl(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (!gl) return null;

  const shader = (type: number, source: string) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const vertex = shader(gl.VERTEX_SHADER, WORLD_VERTEX);
  // As many stars as this GPU has room for alongside everything else; a
  // phone that can hold none still draws the world, just without them.
  const room = Number(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)) || 16;
  const starRoom = Math.max(1, Math.min(SKY_STARS, room - 24));
  const fragment = shader(gl.FRAGMENT_SHADER, WORLD_FRAGMENT.replace('#define STARS 40', `#define STARS ${starRoom}`));
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const at = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    res: at('uRes'),
    cam: at('uCam'),
    sun: at('uSun'),
    top: at('uTop'),
    low: at('uLow'),
    light: at('uLight'),
    heat: at('uHeat'),
    cold: at('uCold'),
    time: at('uTime'),
    forge: at('uForge'),
    flare: at('uFlare'),
    stars: at('uStars'),
    starCount: at('uStarCount'),
    night: at('uNight'),
  };

  return (f: Frame) => {
    gl.viewport(0, 0, f.width, f.height);
    gl.uniform2f(u.res, f.width, f.height);
    gl.uniform2f(u.cam, f.camX, f.camY);
    gl.uniform3f(u.sun, f.sky.x, f.sky.y, f.sky.power);
    gl.uniform3fv(u.top, f.sky.top);
    gl.uniform3fv(u.low, f.sky.low);
    gl.uniform3fv(u.light, f.sky.light);
    gl.uniform1f(u.heat, f.heat);
    gl.uniform1f(u.cold, f.cold);
    gl.uniform1f(u.time, f.time);
    gl.uniform1f(u.forge, f.forge);
    gl.uniform1f(u.flare, f.flare);
    gl.uniform3fv(u.stars, f.stars.subarray(0, starRoom * 3));
    gl.uniform1f(u.starCount, Math.min(f.starCount, starRoom));
    gl.uniform1f(u.night, f.night);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

/** How dark the sky is for the stars, 0 at midday to 1 in the dead of night. */
function nightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 21 || h < 5) return 1;
  if (h >= 19 || h < 7) return 0.55;
  return 0.12;
}

const hourNow = () => {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
};

/**
 * One world behind every tab: it follows the real clock, grows from ash at
 * E rank to blazing at S, loses a little colour on missed days and warms back
 * up as soon as a quest is cleared. The forge on Quests heats as the day's
 * quests clear and flares as each one lands in the ring. Swiping moves through
 * it and scrolling lifts it slowly, so the cards float over something that
 * has depth.
 *
 * It is a backdrop and never the point. The app is on screen first and this
 * fades in behind it. It draws small and only when something changed, a slow
 * phone gets a softer picture by itself, and Low power holds it still.
 */
export function WorldLayer({ motion }: { motion: TabsMotion }) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const { state } = useProgress();
  const { rank, ratio } = useDayStats();
  const recent = useRecentDays(30);

  const lowPower = state.settings?.lowPower ?? false;
  // A star for every perfect day, fixed in its place in the sky.
  const perfect = state.perfectDays;
  const stars = useMemo(() => {
    const out = new Float32Array(SKY_STARS * 3);
    const sky = skyFor(perfect);
    sky.forEach((st, i) => out.set([st.x, st.y, st.size], i * 3));
    return { at: out, count: sky.length };
  }, [perfect]);
  const heat = heatForRank(rank);
  const cold = coldFor(missedDays(recent));

  const aim = useRef({ heat, cold, forge: ratio, stars, still: reduced || lowPower });
  useEffect(() => {
    aim.current = { heat, cold, forge: ratio, stars, still: reduced || lowPower };
  }, [heat, cold, ratio, stars, reduced, lowPower]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 1.4s cubic-bezier(0.23,1,0.32,1)';

    let draw: ReturnType<typeof startGl> = null;
    let tier = 0;
    let dirty = true;
    let frame = 0;
    let wait: ReturnType<typeof setTimeout> | undefined;
    let then = 0;
    let lastDraw = 0;
    let lastSky = 0;
    let drewLast = false;
    let slow = 0;
    let time = 0;

    let sky = skyAt(hourNow());
    let skyHour = hourNow();
    let drawnStars = aim.current.stars;
    let nowHeat = aim.current.heat;
    let nowCold = aim.current.cold;
    let nowForge = aim.current.forge;
    let flare = 0;
    let lift = 0;
    let lookX = 0;
    let lookY = 0;
    let tiltX = 0;
    let tiltY = 0;
    let drawnX = 0;
    let drawnY = 0;
    let drawnHeat = nowHeat;
    let drawnCold = nowCold;
    let drawnForge = nowForge;

    let lapse = LAPSE;
    let pill: HTMLButtonElement | null = null;

    const fit = () => {
      const scale = TIERS[tier].scale;
      const width = Math.min(parent.clientWidth * scale, MAX_WIDTH);
      if (width < 1) return;
      canvas.width = Math.ceil(width);
      canvas.height = Math.ceil((parent.clientHeight / parent.clientWidth) * width);
      dirty = true;
    };

    const tick = (now: number) => {
      const dt = Math.min(now - then, 100);
      const gap = now - then;
      then = now;
      const { still, heat: aimHeat, cold: aimCold, forge: aimForge, stars: aimStars } = aim.current;
      // A new star is a change worth drawing at once.
      if (aimStars !== drawnStars) dirty = true;
      let wantHeat = aimHeat;
      let wantCold = aimCold;

      if (lapse && pill) {
        const hour = ((now / 1000) % 40) * 0.6;
        const step = Math.floor(now / 6000);
        const shownRank = RANKS[step % RANKS.length];
        const missed = (Math.floor(step / RANKS.length) % 2) * 3;
        sky = skyAt(hour);
        skyHour = hour;
        wantHeat = heatForRank(shownRank);
        wantCold = coldFor(missed);
        dirty = true;
        pill.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:00 · ${shownRank} rank · ${missed} missed · tap to stop`;
      } else if (now - lastSky > 20000) {
        lastSky = now;
        skyHour = hourNow();
        sky = skyAt(skyHour);
        dirty = true;
      }

      if (still) {
        nowHeat = wantHeat;
        nowCold = wantCold;
        nowForge = aimForge;
        flare = 0;
      } else {
        // Colour comes back fast: a cleared quest warms the world within a second or so.
        const warm = 1 - Math.exp(-dt / 450);
        nowHeat += (wantHeat - nowHeat) * warm;
        nowCold += (wantCold - nowCold) * warm;
        nowForge += (aimForge - nowForge) * warm;
        flare = Math.max(0, flare - dt / 900);
        const ease = 1 - Math.exp(-dt / 140);
        lookX += (tiltX - lookX) * ease;
        lookY += (tiltY - lookY) * ease;
        lift += (Math.min(motion.scroll.get() / SCROLL_SPAN, 1) * RISE - lift) * ease;
        time += dt / 1000;
      }

      const camX = still ? 0 : motion.progress.get() * STEP + lookX;
      const camY = still ? 0 : lift + lookY;
      const shift = Math.max(Math.abs(camX - drawnX), Math.abs(camY - drawnY));
      const warming =
        Math.abs(nowHeat - drawnHeat) > 0.002 ||
        Math.abs(nowCold - drawnCold) > 0.002 ||
        Math.abs(nowForge - drawnForge) > 0.002 ||
        flare > 0;
      const ambient = still ? 0 : TIERS[tier].ambient;
      const due = ambient > 0 && now - lastDraw > 1000 / ambient;

      const should =
        dirty || warming || shift > 0.0015 || (shift > 0.0004 && now - lastDraw > 40) || due;

      if (should && draw) {
        draw({
          width: canvas.width,
          height: canvas.height,
          camX,
          camY,
          sky,
          heat: nowHeat,
          cold: nowCold,
          forge: nowForge,
          flare,
          stars: aimStars.at,
          starCount: aimStars.count,
          night: nightAt(skyHour),
          time,
        });
        drawnStars = aimStars;
        if (canvas.style.opacity !== '1') canvas.style.opacity = '1';
        // A phone that can't keep up through a whole swipe gets a softer picture.
        if (drewLast) {
          slow = gap > 34 ? slow + 1 : Math.max(0, slow - 1);
          if (slow > 40 && tier < TIERS.length - 1) {
            tier += 1;
            slow = 0;
            fit();
          }
        }
        dirty = false;
        lastDraw = now;
        drawnX = camX;
        drawnY = camY;
        drawnHeat = nowHeat;
        drawnCold = nowCold;
        drawnForge = nowForge;
      }
      drewLast = should;

      // Held still there is nothing to chase, so it only checks in now and then.
      if (still && !lapse) wait = setTimeout(() => tick(performance.now()), 1000);
      else frame = requestAnimationFrame(tick);
    };

    const onLost = (e: Event) => {
      e.preventDefault();
      draw = null;
    };
    const onRestored = () => {
      draw = startGl(canvas);
      dirty = true;
    };

    let baseG: number | null = null;
    let baseB = 0;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      if (baseG === null) {
        baseG = e.gamma;
        baseB = e.beta;
      }
      // Whatever angle the phone is held at slowly becomes the new level.
      baseG += (e.gamma - baseG) * 0.01;
      baseB += (e.beta - baseB) * 0.01;
      tiltX = (clamp((e.gamma - baseG) / 25, -1, 1) * TILT) as number;
      tiltY = (clamp((e.beta - baseB) / 25, -1, 1) * TILT * 0.6) as number;
    };
    const tilts = window.matchMedia('(pointer: coarse)').matches;

    const observer = new ResizeObserver(fit);
    const stopLanding = onLanding(() => {
      flare = 1;
    });

    // The first paint belongs to the app. This starts once it has settled.
    const begin = setTimeout(() => {
      draw = startGl(canvas);
      if (!draw) return;
      parent.appendChild(canvas);
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', onRestored);
      observer.observe(parent);
      fit();
      if (tilts) window.addEventListener('deviceorientation', onTilt, { passive: true });
      if (LAPSE) {
        pill = document.createElement('button');
        pill.style.cssText =
          'position:fixed;z-index:50;bottom:64px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:5px 11px;border-radius:14px;border:1px solid rgba(255,220,190,.2);background:rgba(27,21,17,.84);color:#F7ECDF;font:12px system-ui';
        pill.onclick = () => {
          lapse = !lapse;
          dirty = true;
          lastSky = 0;
          if (pill && !lapse) pill.textContent = 'Live · tap for time-lapse';
        };
        document.body.appendChild(pill);
      }
      then = performance.now();
      frame = requestAnimationFrame(tick);
    }, 700);

    return () => {
      clearTimeout(begin);
      clearTimeout(wait);
      cancelAnimationFrame(frame);
      observer.disconnect();
      stopLanding();
      window.removeEventListener('deviceorientation', onTilt);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      canvas.remove();
      pill?.remove();
    };
  }, [motion]);

  return <View ref={host} pointerEvents="none" style={StyleSheet.absoluteFill} />;
}
