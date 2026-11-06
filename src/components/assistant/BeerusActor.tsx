import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { BeerusOrb } from '@/components/assistant/BeerusOrb';
import type { EmberState } from '@/components/assistant/EmberOrb';
import { home } from '@/components/assistant/summon';

/** He is drawn once at this size and scaled to whichever spot he is in. */
const RENDER = 96;
/** How long he stays beside something he just changed before going back. */
const POINT_MS = 1600;
/** Where he lives in the window, most important first. */
const PLACES = ['live', 'hero', 'header'] as const;
/** A spring that arrives in about four tenths of a second with a little give. */
const STIFF = 272;
const DAMP = 27;
/** The spring is stepped in slices this short, so a slow frame can never throw him off course. */
const SLICE = 1 / 240;
/** If his first frame is slow to come, he sets off anyway after this long. */
const READY_MS = 450;

/** Marks a spot in the window where Beerus can sit. `key` names a passing one. */
export function beerusSlot(place: 'live' | 'hero' | 'header' | 'point', key?: string): object {
  return { dataSet: key ? { beerusSlot: place, beerusKey: key } : { beerusSlot: place }, 'aria-hidden': true };
}

/**
 * The one Beerus inside his window. He flies up from wherever the floating
 * button was and the window unrolls beneath him; then he goes where the
 * conversation is: the big welcome spot, the header once you are talking,
 * the call panel during a call, and for a moment beside anything he just
 * changed. When the window is dragged he rides it, and if it is pulled far
 * enough to leave, he hops off and flies home, and only then does the
 * window let go.
 *
 * He follows the spots on a spring each frame, so a keyboard opening, a
 * scroll or a drag never leaves him behind, and nothing in React renders
 * while he moves. He waits at the button until his first frame is drawn,
 * and only then does the button let him go, so he never blinks out mid-air.
 */
export function BeerusActor({
  leaving,
  onHome,
  onLaunch,
  ...state
}: {
  /** The window has gone: fly home, then say so. */
  leaving: boolean;
  onHome: () => void;
  /** He is drawn and setting off: the floating button can step aside. */
  onLaunch: () => void;
} & EmberState) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const aim = useRef({ leaving, onHome, onLaunch });
  useEffect(() => {
    aim.current = { leaving, onHome, onLaunch };
  });
  const drawn = useRef(false);

  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    if (!el) return;
    const fallback = { x: window.innerWidth - home.size - 16, y: window.innerHeight - home.size - 140 };
    const resting = () => ({
      x: home.x < 0 ? fallback.x : home.x,
      y: home.y < 0 ? fallback.y : home.y,
      s: home.size / RENDER,
    });
    const from = home.read?.() ?? resting();
    const pos = { x: from.x, y: from.y, s: home.size / RENDER };
    el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${pos.s})`;
    const vel = { x: 0, y: 0, s: 0 };

    // Changes already on screen when he arrives are old news.
    const seen = new Set<string>();
    for (const n of document.querySelectorAll<HTMLElement>('[data-beerus-slot="point"]')) seen.add(n.dataset.beerusKey ?? '');
    let pointing: { key: string; until: number } | null = null;
    const restTop = new Map<string, number>();
    let leftAt = 0;
    let done = false;
    let launched = false;
    const born = performance.now();
    let then = born;
    let frame = 0;

    const target = (now: number) => {
      if (aim.current.leaving) return resting();
      for (const n of document.querySelectorAll<HTMLElement>('[data-beerus-slot="point"]')) {
        const key = n.dataset.beerusKey ?? '';
        if (!seen.has(key)) {
          seen.add(key);
          pointing = { key, until: now + POINT_MS };
        }
      }
      let slot: HTMLElement | null = null;
      if (pointing && now < pointing.until) {
        slot = document.querySelector(`[data-beerus-slot="point"][data-beerus-key="${CSS.escape(pointing.key)}"]`);
      }
      for (const place of PLACES) {
        if (slot) break;
        slot = document.querySelector(`[data-beerus-slot="${place}"]`);
      }
      if (!slot) return resting();
      const r = slot.getBoundingClientRect();
      if (r.width < 1) return resting();
      const place = slot.dataset.beerusSlot ?? '';
      if (place !== 'point') {
        // He rides the window as it is dragged; past a third of the screen he lets go.
        const top = Math.min(restTop.get(place) ?? r.top, r.top);
        restTop.set(place, top);
        if (r.top - top > window.innerHeight * 0.3) return resting();
      }
      return { x: r.left, y: r.top, s: r.width / RENDER };
    };

    const step = (now: number) => {
      const dt = Math.min(48, now - then) / 1000;
      then = now;
      frame = requestAnimationFrame(step);
      if (!launched) {
        // Hold at the button, unseen, until he is drawn.
        if (!drawn.current && now - born < READY_MS) return;
        launched = true;
        aim.current.onLaunch();
      }
      const t = target(now);
      if (reduced) {
        pos.x = t.x;
        pos.y = t.y;
        pos.s = t.s;
      } else {
        for (let left = dt; left > 0; left -= SLICE) {
          const h = Math.min(SLICE, left);
          for (const k of ['x', 'y', 's'] as const) {
            vel[k] += (STIFF * (t[k] - pos[k]) - DAMP * vel[k]) * h;
            pos[k] += vel[k] * h;
          }
        }
      }
      el.style.transform = `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px) scale(${pos.s.toFixed(4)})`;
      el.style.opacity = '1';

      if (aim.current.leaving && !done) {
        if (!leftAt) leftAt = now;
        const there = Math.abs(t.x - pos.x) < 1.5 && Math.abs(t.y - pos.y) < 1.5 && Math.abs(t.s - pos.s) < 0.01;
        if (there || reduced || now - leftAt > 900) {
          done = true;
          aim.current.onHome();
        }
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  return (
    <View ref={host} pointerEvents="none" aria-hidden style={styles.actor}>
      <BeerusOrb
        size={RENDER}
        {...state}
        onDrawn={() => {
          drawn.current = true;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actor: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: RENDER,
    height: RENDER,
    opacity: 0,
    transformOrigin: '0 0',
    willChange: 'transform',
  } as object,
});
