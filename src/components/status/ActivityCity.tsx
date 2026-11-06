import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { cancelAnimation, useReducedMotion, useSharedValue, withDecay } from 'react-native-reanimated';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { useTabsMotion } from '@/components/motion/SwipeTabs';
import { CITY_LOOK } from '@/components/status/facetShader';
import { makeCanvas, passage, scrollerOf, setUpFacets, type FacetGpu } from '@/components/status/facetGL';
import { cityCamera, cityDays, cityMesh, dayHeight, pickDay } from '@/lib/city';
import { identity, upper3 } from '@/lib/mat4';
import { rubberband } from '@/lib/motion';

/** Standing up takes a little over half a second; lying back down, less. */
const RISE_MS = 520;
const FALL_MS = 380;
/** How far a finger may turn the city either way before it resists. */
const SPIN = 0.8;
const SCROLL_TURN = 0.4;

/** Emil's ease-in-out for things moving on screen: cubic-bezier(0.77, 0, 0.175, 1). */
function easeInOut(x: number): number {
  // Solve the bezier's x for t by Newton's method, then read y.
  const ax = 3 * 0.77 - 3 * 0.175 + 1;
  const bx = 3 * 0.175 - 6 * 0.77;
  const cx = 3 * 0.77;
  let t = x;
  for (let i = 0; i < 6; i++) {
    const fx = ((ax * t + bx) * t + cx) * t - x;
    const d = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(d) < 1e-6) break;
    t -= fx / d;
  }
  t = Math.min(1, Math.max(0, t));
  const ay = 3 * 0 - 3 * 1 + 1;
  const by = 3 * 1 - 6 * 0;
  return ((ay * t + by) * t + 0) * t;
}

/**
 * The month's calendar stood up as a small city, one block per day, as tall
 * as that day went, with its windows lit as far as it was cleared.
 *
 * It starts as the calendar seen from straight above, so switching to it is
 * one camera move: the view tilts back and the days rise. Switching back
 * lays them down again before the calendar returns. A finger turns the city
 * a little either way, and tapping a block picks its day, as tapping the
 * calendar does. It draws only while something moves.
 */
export function ActivityCity({
  width,
  height,
  top,
  cells,
  log,
  today,
  selected,
  onSelect,
  standing,
  onDown,
}: {
  width: number;
  height: number;
  /** The weekday row's height: where the calendar's grid begins. */
  top: number;
  cells: (string | null)[];
  log: Record<string, { cleared: number; total: number; perfect: boolean } | undefined>;
  today: string;
  selected: string | null;
  onSelect: (key: string) => void;
  /** Up as a city, or down as the calendar. */
  standing: boolean;
  /** Called once it has lain all the way back down. */
  onDown: () => void;
}) {
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const pager = useTabsMotion()?.pager ?? null;
  const spin = useSharedValue(0);
  const start = useSharedValue(0);

  const rows = Math.ceil(cells.length / 7);
  const colPx = width / 7;
  const grid = useMemo(() => ({ zp: (height - top) / rows / colPx, foot: 30 / colPx }), [colPx, height, rows, top]);
  const days = useMemo(() => cityDays(cells, log, today), [cells, log, today]);
  const tallest = useMemo(() => Math.max(0, ...days.map(dayHeight)), [days]);

  const aim = useRef({ days, grid, selected, standing, reduced, onDown, onSelect, rows, tallest });
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    aim.current = { days, grid, selected, standing, reduced, onDown, onSelect, rows, tallest };
    kickRef.current();
  });

  const drag = useMemo(() => {
    const perPx = Math.PI / width;
    const drag = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-10, 10])
      .failOffsetY([-10, 10])
      .onStart(() => {
        cancelAnimation(spin);
        start.set(spin.get());
      })
      .onUpdate((e) => {
        const raw = start.get() + e.translationX * perPx;
        const past = Math.abs(raw) - SPIN;
        spin.set(past > 0 ? Math.sign(raw) * (SPIN + rubberband(past, 1, 0.3)) : raw);
      })
      .onEnd((e) => {
        spin.set(withDecay({ velocity: e.velocityX * perPx, clamp: [-SPIN, SPIN], rubberBandEffect: true, rubberBandFactor: 0.6 }));
      });
    return pager ? drag.blocksExternalGesture(pager) : drag;
  }, [pager, spin, start, width]);

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent || !canDrawEmbers()) return;
    const { canvas } = makeCanvas(width, height, 2);
    let gpu: FacetGpu | null = setUpFacets(canvas);
    if (!gpu) return;
    parent.appendChild(canvas);
    const scroller = scrollerOf(parent);
    const model = identity();
    const turn = upper3(model);

    // p runs 0 (the calendar) to 1 (the city), eased by time from wherever it
    // was, so switching back halfway turns round smoothly.
    let p = 0;
    let from = 0;
    let goal = aim.current.standing ? 1 : 0;
    let began = performance.now();
    let frame = 0;
    let drawn = '';
    let idle = 0;
    let touching = false;
    let sentDown = false;
    // The camera and heights last drawn, so a tap can find what it landed on.
    let shown: { mvp: Float32Array; rise: (i: number) => number } | null = null;

    const riseOf = (q: number, count: number) => (i: number) => {
      // The days rise one after another across the month, each easing out.
      const k = Math.min(1, Math.max(0, (q - (0.3 * i) / Math.max(1, count)) / 0.7));
      return 1 - Math.pow(1 - k, 3);
    };

    const step = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      const a = aim.current;
      const want = a.standing ? 1 : 0;
      if (want !== goal) {
        goal = want;
        from = p;
        began = now;
        sentDown = false;
      }
      if (a.reduced) p = goal;
      else if (p !== goal) {
        const span = goal > from ? RISE_MS : FALL_MS;
        const k = Math.min(1, (now - began) / (span * Math.max(0.35, Math.abs(goal - from))));
        p = from + (goal - from) * easeInOut(k);
        if (k >= 1) p = goal;
      }
      if (p === 0 && goal === 0 && !sentDown) {
        sentDown = true;
        a.onDown();
      }
      const fly = a.reduced ? 0 : (passage(parent) - 0.5) * SCROLL_TURN * p;
      const yaw = spin.get() * p + fly;
      const key = `${p.toFixed(4)}|${yaw.toFixed(4)}|${a.selected}|${a.days.length}|${a.days[0]?.key}`;
      if (key !== drawn && gpu) {
        drawn = key;
        idle = 0;
        const rise = riseOf(p, a.days.length);
        const cam = cityCamera(p, yaw, { width, height, top }, a.rows, a.grid, a.tallest);
        shown = { mvp: cam.mvp, rise };
        gpu.load(cityMesh(a.days, a.grid, rise, a.selected));
        gpu.clear();
        gpu.draw({ mvp: cam.mvp, model, turn, eye: cam.eye }, CITY_LOOK, { inside: false, alpha: 1 });
      } else idle++;
      if (touching || p !== goal || idle < 4) frame = requestAnimationFrame(step);
    };
    const kick = () => {
      idle = 0;
      if (!frame) frame = requestAnimationFrame(step);
    };
    kickRef.current = kick;

    // A tap is a press that lifts soon and close to where it landed; a drag
    // that turns the city is not one.
    let press: { x: number; y: number; at: number } | null = null;
    const down = (e: PointerEvent) => {
      touching = true;
      press = { x: e.clientX, y: e.clientY, at: e.timeStamp };
      kick();
    };
    const up = (e: PointerEvent) => {
      touching = false;
      kick();
      const was = press;
      press = null;
      if (!was || !shown || e.type !== 'pointerup') return;
      if (e.timeStamp - was.at > 400 || Math.hypot(e.clientX - was.x, e.clientY - was.y) > 8) return;
      const box = parent.getBoundingClientRect();
      const { days: d, grid: g } = aim.current;
      const s = shown;
      const key = pickDay(d, g, (i) => dayHeight(d[i]) * s.rise(i), s.mvp, width, height, e.clientX - box.left, e.clientY - box.top);
      if (key) aim.current.onSelect(key);
    };
    parent.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    scroller?.addEventListener('scroll', kick, { passive: true });
    document.addEventListener('visibilitychange', kick);

    const onLost = (ev: Event) => {
      ev.preventDefault();
      gpu = null;
    };
    const onRestored = () => {
      gpu = setUpFacets(canvas);
      drawn = '';
      kick();
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    kick();

    return () => {
      cancelAnimationFrame(frame);
      kickRef.current = () => {};
      parent.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      scroller?.removeEventListener('scroll', kick);
      document.removeEventListener('visibilitychange', kick);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gpu?.free();
      canvas.remove();
    };
  }, [height, spin, top, width]);

  const logged = days.filter((d) => d.logged).length;
  const perfect = days.filter((d) => d.perfect).length;
  return (
    <GestureDetector gesture={drag} touchAction="pan-y">
      <View
        ref={host}
        style={[styles.box, { width, height }]}
        accessible
        accessibilityLabel={`The month as a city: ${logged} days logged, ${perfect} perfect. Switch to Calendar to pick a day by its date.`}
      />
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  box: { userSelect: 'none', WebkitTouchCallout: 'none', cursor: 'grab' } as object,
});
