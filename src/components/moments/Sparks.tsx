import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export interface Burst {
  /** When it goes off, in ms after the sparks start. */
  at: number;
  /** Where, as a share of the width and the height. */
  x: number;
  y: number;
  count: number;
  /** How hard the sparks are thrown out. */
  power?: number;
}

type Tone = 'ember' | 'gold';

/** White-hot to its tone's colour to a dying red, by age 0–1. */
const RAMPS: Record<Tone, (age: number) => [number, number, number]> = {
  ember: (a) => (a < 0.25 ? [255, 241 - a * 300, 218 - a * 540] : [255, 166 - (a - 0.25) * 120, Math.max(20, 83 - (a - 0.25) * 80)]),
  gold: (a) => (a < 0.25 ? [255, 246 - a * 120, 222 - a * 400] : [255, 216 - (a - 0.25) * 110, Math.max(40, 122 - (a - 0.25) * 110)]),
};

const CAP = 220;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
}

/**
 * The sparks of a big moment: bursts thrown out at set times, and embers
 * drifting up the screen while it lasts. Big moments are the only place
 * sparks cross the screen. Capped, drawn as light, and the canvas is gone
 * when the last spark is. With reduced motion there are none: the moment is
 * still told by what is on the screen.
 */
export function Sparks({ bursts, drift = true, tone = 'ember', duration }: { bursts: Burst[]; drift?: boolean; tone?: Tone; duration: number }) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const plan = useRef({ bursts, drift, tone, duration });

  useEffect(() => {
    if (Platform.OS !== 'web' || reduced) return;
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent) return;
    const { bursts: shots, drift: rising, tone: t, duration: length } = plan.current;
    const ramp = RAMPS[t];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    parent.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const sparks: Spark[] = [];
    const fired = new Set<number>();
    const start = performance.now();
    let then = start;
    let owed = 0;
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min(40, now - then) / 1000;
      then = now;
      const age = now - start;

      shots.forEach((b, i) => {
        if (fired.has(i) || age < b.at) return;
        fired.add(i);
        const power = b.power ?? 1;
        for (let k = 0; k < b.count && sparks.length < CAP; k++) {
          const a = rand() * Math.PI * 2;
          const speed = (140 + rand() * 420) * power;
          sparks.push({
            x: b.x * w,
            y: b.y * h,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 60,
            born: now,
            life: 700 + rand() * 700,
            size: 1.2 + rand() * 2.2,
          });
        }
      });
      // Embers drift up through the whole moment, a few a second.
      if (rising && age < length) {
        owed += dt * 9;
        while (owed >= 1 && sparks.length < CAP) {
          owed -= 1;
          sparks.push({
            x: rand() * w,
            y: h + 10,
            vx: (rand() - 0.5) * 30,
            vy: -(60 + rand() * 90),
            born: now,
            life: 1800 + rand() * 1400,
            size: 1 + rand() * 1.6,
          });
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        const life = (now - s.born) / s.life;
        if (life >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        s.vx *= 1 - 2.2 * dt;
        s.vy = s.vy * (1 - 2.2 * dt) - 26 * dt;
        s.x += s.vx * dt + Math.sin(now / 300 + s.born) * 6 * dt;
        s.y += s.vy * dt;
        const [r, g, b] = ramp(life);
        const glow = (1 - life) * (1 - life);
        const size = s.size * (1 - life * 0.5);
        ctx.fillStyle = `rgba(${r},${Math.round(g)},${Math.round(b)},${glow * 0.2})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size * 2.6, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = `rgba(${r},${Math.round(g)},${Math.round(b)},${glow})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, size, 0, 6.2832);
        ctx.fill();
      }

      if (age < length || sparks.length > 0) frame = requestAnimationFrame(tick);
      else canvas.remove();
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      canvas.remove();
    };
  }, [reduced]);

  return <View ref={host} pointerEvents="none" aria-hidden style={StyleSheet.absoluteFill} />;
}
