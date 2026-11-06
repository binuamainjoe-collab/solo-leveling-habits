import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { Medal } from '@/components/achievement/Medal';
import { Sparks } from '@/components/moments/Sparks';
import { makeCanvas, setUpQuad, type QuadGpu } from '@/components/status/facetGL';
import { FIRE_FRAGMENT, FIRE_VERTEX } from '@/components/status/rankFireShader';
import { tierMeta, type AchievementDef } from '@/data/achievements';
import { haptic } from '@/lib/feedback';
import { hexRgb } from '@/lib/status';

/** The forging, in ms: the fire catches, the medal spins down out of it, the fire dies. */
const CATCH_MS = 260;
const SPIN_AT = 120;
const SPIN_MS = 1300;
const LANDS = SPIN_AT + SPIN_MS;
const DIE_MS = 900;
/** Fire looks no worse at 30 frames a second, and it is gone in two. */
const FRAME_MS = 33;

/**
 * A trophy forged in fire: the medal comes out of the flames white-hot,
 * spinning, slows to face you and cools into its metal, and the fire round
 * it dies down behind a spray of sparks. The same fire the rank seal burns
 * with, round instead of six-sided, in the trophy's own colour of aura.
 * Under two and a half seconds, then the medal is still and yours to spin.
 */
export function ForgedMedal({ achievement: a, size }: { achievement: AchievementDef; size: number }) {
  const reduced = useReducedMotion();
  const box = Math.round(size * 2.3);

  useEffect(() => {
    if (reduced) return;
    const t = setTimeout(() => haptic('medium'), LANDS);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <View style={[styles.box, { width: box, height: box, marginVertical: -(box - size) / 2 }]}>
      {!reduced && canDrawEmbers() ? <Forge achievement={a} size={size} box={box} /> : null}
      <Medal
        size={size}
        tier={a.tier}
        glyph={a.glyph}
        xp={a.xp}
        unlocked
        arrive={{ from: 900, delay: SPIN_AT, duration: SPIN_MS }}
        cooling={{ delay: SPIN_AT + 150, duration: SPIN_MS }}
      />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Sparks
          duration={LANDS + 1200}
          drift={false}
          tone={a.tier === 'gold' ? 'gold' : 'ember'}
          bursts={[
            { at: CATCH_MS, x: 0.5, y: 0.5, count: 14, power: 0.5 },
            { at: LANDS - 40, x: 0.5, y: 0.5, count: 26, power: 0.75 },
          ]}
        />
      </View>
    </View>
  );
}

function Forge({ achievement: a, size, box }: { achievement: AchievementDef; size: number; box: number }) {
  const host = useRef<View | null>(null);

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent) return;
    const { canvas, dpr } = makeCanvas(box, box, 1.5);
    let gpu: QuadGpu | null = setUpQuad(canvas, FIRE_VERTEX, FIRE_FRAGMENT);
    if (!gpu) return;
    parent.appendChild(canvas);
    const aura = hexRgb(tierMeta[a.tier].glowA);
    const began = performance.now();
    let frame = 0;
    let last = 0;

    const draw = (t: number, life: number) => {
      if (!gpu) return;
      const { gl, at } = gpu;
      gpu.draw();
      gl.uniform2f(at('uRes'), canvas.width, canvas.height);
      gl.uniform2f(at('uC'), (box / 2) * dpr, (box / 2) * dpr);
      gl.uniform1f(at('uR'), size / 2);
      gl.uniform1f(at('uPx'), dpr);
      gl.uniform1f(at('uT'), t);
      gl.uniform1f(at('uLife'), life);
      gl.uniform3f(at('uAura'), aura[0], aura[1], aura[2]);
      gl.uniform1f(at('uAuraK'), 0.8);
      gl.uniform1f(at('uRound'), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const step = (now: number) => {
      frame = 0;
      // A frame's time can fall a moment before the effect ran; count from 0.
      const t = Math.max(0, now - began);
      // Catches fast, holds while the medal spins, dies once it has landed.
      const life =
        t < CATCH_MS ? 1 - Math.pow(1 - t / CATCH_MS, 3) : t < LANDS ? 1 : Math.max(0, 1 - (t - LANDS) / DIE_MS);
      if (now - last >= FRAME_MS || life === 0) {
        last = now;
        draw(now / 1000, life);
      }
      // Runs from the first spark to the last ember, then rests on that frame.
      if (t < LANDS + DIE_MS && !document.hidden) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    const onLost = (ev: Event) => {
      ev.preventDefault();
      gpu = null;
    };
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('webglcontextlost', onLost);
      gpu?.free();
      canvas.remove();
    };
  }, [a.tier, box, size]);

  return <View ref={host} aria-hidden pointerEvents="none" style={StyleSheet.absoluteFill} />;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
