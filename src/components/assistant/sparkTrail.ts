import { Platform } from 'react-native';

/** How long a throw leaves sparks behind, and how long each one burns. */
const TRAIL_MS = 650;
const LIFE_MS = 520;
const CAP = 90;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  size: number;
}

/** The trail burning now, if any, so a second throw extends it instead of stacking a canvas. */
let burning: { again: (where: () => { x: number; y: number }) => void } | null = null;

/**
 * Sparks thrown off Beerus as he flies after a throw. `where` reports his
 * centre on screen each frame; sparks are shed behind him against his motion,
 * drift, slow and burn out. One short burst per throw, never a loop: the
 * canvas exists only while it burns and is removed after.
 *
 * Skipped for reduced motion, and a second throw mid-trail just extends the
 * one already burning.
 */
export function sparkTrail(where: () => { x: number; y: number }) {
  if (Platform.OS !== 'web') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (burning) {
    burning.again(where);
    return;
  }

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:55';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const sparks: Spark[] = [];
  let start = performance.now();
  let then = start;
  let follow = where;
  let last = follow();
  burning = {
    again: (next) => {
      start = performance.now();
      follow = next;
    },
  };
  // A tiny seeded source keeps a throw's sparks varied without Math.random's cost.
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const frame = (now: number) => {
    const dt = Math.min(40, now - then) / 1000;
    then = now;
    const at = follow();
    const vx = (at.x - last.x) / Math.max(dt, 0.001);
    const vy = (at.y - last.y) / Math.max(dt, 0.001);
    const speed = Math.hypot(vx, vy);
    // Shed along the path just flown, more the faster he goes.
    if (now - start < TRAIL_MS && speed > 120) {
      const n = Math.min(4, Math.ceil(speed / 500));
      for (let i = 0; i < n && sparks.length < CAP; i++) {
        const f = rand();
        sparks.push({
          x: last.x + (at.x - last.x) * f + (rand() - 0.5) * 14,
          y: last.y + (at.y - last.y) * f + (rand() - 0.5) * 14,
          vx: -vx * 0.12 + (rand() - 0.5) * 170,
          vy: -vy * 0.12 + (rand() - 0.5) * 170 - 40,
          born: now,
          size: 1.2 + rand() * 1.8,
        });
      }
    }
    last = at;

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const age = (now - s.born) / LIFE_MS;
      if (age >= 1) {
        sparks.splice(i, 1);
        continue;
      }
      s.vx *= 0.92;
      s.vy = s.vy * 0.92 - 20 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // White-hot as it leaves him, then amber, then a dull ember red as it dies.
      const glow = (1 - age) * (1 - age);
      const g = Math.round(age < 0.25 ? 241 - age * 300 : 166 - (age - 0.25) * 120);
      const b = Math.round(age < 0.25 ? 218 - age * 540 : Math.max(20, 83 - (age - 0.25) * 80));
      const r = s.size * (1 - age * 0.5);
      ctx.fillStyle = `rgba(255,${g},${b},${glow * 0.22})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 2.6, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = `rgba(255,${g},${b},${glow})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, 6.2832);
      ctx.fill();
    }

    if (now - start < TRAIL_MS || sparks.length > 0) requestAnimationFrame(frame);
    else {
      canvas.remove();
      burning = null;
    }
  };
  requestAnimationFrame(frame);
}
