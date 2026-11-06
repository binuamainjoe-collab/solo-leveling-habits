import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { canDrawEmbers } from '@/components/assistant/EmberOrb';
import { useTabsMotion } from '@/components/motion/SwipeTabs';
import { CRYSTAL_LOOK } from '@/components/status/facetShader';
import { makeCanvas, passage, scrollerOf, setUpFacets, type FacetGpu } from '@/components/status/facetGL';
import { multiply, orbitView, perspective, rotateY, upper3 } from '@/lib/mat4';
import { project, SPRING } from '@/lib/motion';
import { angleToFace, crystalMesh, facingAt, hexRgb } from '@/lib/status';

/** How far the crystal turns as it passes through the screen on a scroll. */
const SCROLL_TURN = 0.7;
const FOV = (30 * Math.PI) / 180;

/**
 * The ability scores as a crystal, in the radar's place and with the same
 * scores: each ability is a point that juts out as far as its score, in its
 * own colour, so a neglected side shows as a dent.
 *
 * Drag it sideways to turn it; let go and it carries on with the flick and
 * comes to rest facing the nearest ability, which becomes the one Beerus is
 * asked about. Tapping a score in the list turns it there too, so nothing
 * here needs the drag. Scrolling past turns it a little, as a camera would
 * see it flying by. It draws only while something moves.
 */
export function AbilityCrystal({
  size,
  values,
  colours,
  facing,
  onFacing,
}: {
  size: number;
  values: number[];
  colours: string[];
  facing: number;
  onFacing: (index: number) => void;
}) {
  const n = values.length;
  const host = useRef<View | null>(null);
  const reduced = useReducedMotion();
  const pager = useTabsMotion()?.pager ?? null;
  const angle = useSharedValue(angleToFace(facing, n, 0));
  const start = useSharedValue(0);
  // Where the crystal last came to rest, and a count of flicks: a flick
  // reports its face to the page, a tap on a score only moves it.
  const rested = useSharedValue({ index: facing, count: 0 });

  const mesh = useMemo(() => crystalMesh(values, colours.map(hexRgb)), [values, colours]);
  const aim = useRef({ mesh, reduced });
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    aim.current = { mesh, reduced };
    kickRef.current();
  });

  // A tap on a score turns the crystal to it. A flick that came to rest
  // there has already arrived, so it is left alone.
  useEffect(() => {
    const was = rested.get();
    if (was.index === facing) return;
    rested.set({ index: facing, count: was.count });
    angle.set(withSpring(angleToFace(facing, n, angle.get()), SPRING.settle));
    kickRef.current();
  }, [angle, facing, n, rested]);

  useAnimatedReaction(
    () => rested.get(),
    (now, prev) => {
      if (prev && now.count !== prev.count && now.index !== prev.index) scheduleOnRN(onFacing, now.index);
    },
  );

  const pan = useMemo(() => {
    const perPx = Math.PI / size;
    const g = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-10, 10])
      .failOffsetY([-10, 10])
      .onStart(() => {
        cancelAnimation(angle);
        start.set(angle.get());
      })
      .onUpdate((e) => {
        angle.set(start.get() + e.translationX * perPx);
      })
      .onEnd((e) => {
        // Rest on the face the flick was heading for, carrying its speed.
        const heading = angle.get() + project(e.velocityX, 0.996) * perPx;
        const index = facingAt(heading, n);
        angle.set(withSpring(angleToFace(index, n, heading), { ...SPRING.snap, velocity: e.velocityX * perPx }));
        rested.set({ index, count: rested.get().count + 1 });
      });
    return pager ? g.blocksExternalGesture(pager) : g;
  }, [angle, n, pager, rested, size, start]);

  useEffect(() => {
    const parent = host.current as unknown as HTMLElement | null;
    if (!parent || !canDrawEmbers()) return;
    const { canvas } = makeCanvas(size, size, 2);
    let gpu: FacetGpu | null = setUpFacets(canvas);
    if (!gpu) return;
    parent.appendChild(canvas);
    let loaded: Float32Array | null = null;
    const { view, eye } = orbitView([0, 0, 0], 0, 0.45, 4.6);
    const proj = perspective(FOV, 1, 0.1, 20);

    let frame = 0;
    let drawn = '';
    let touching = false;
    let idle = 0;
    const scroller = scrollerOf(parent);

    const draw = (turn: number) => {
      if (!gpu) return;
      if (loaded !== aim.current.mesh) {
        loaded = aim.current.mesh;
        gpu.load(loaded);
      }
      const model = rotateY(turn);
      const m = { mvp: multiply(proj, multiply(view, model)), model, turn: upper3(model), eye };
      gpu.clear();
      // The far side first, glowing through; then the near faces over it.
      gpu.draw(m, CRYSTAL_LOOK, { inside: true, alpha: 0.6 });
      gpu.draw(m, CRYSTAL_LOOK, { inside: false, alpha: 0.74 });
    };

    const step = () => {
      frame = 0;
      if (document.hidden) return;
      const fly = aim.current.reduced ? 0 : (passage(parent) - 0.5) * SCROLL_TURN;
      const turn = angle.get() + fly;
      const key = `${turn.toFixed(4)}|${aim.current.mesh.length}|${aim.current.mesh[9]}`;
      if (key !== drawn) {
        drawn = key;
        idle = 0;
        draw(turn);
      } else idle++;
      // Keep watching a few frames after the last change, so a spring that
      // pauses for a frame is not dropped.
      if (touching || idle < 4) frame = requestAnimationFrame(step);
    };
    const kick = () => {
      idle = 0;
      if (!frame) frame = requestAnimationFrame(step);
    };
    kickRef.current = kick;

    const down = () => {
      touching = true;
      kick();
    };
    const up = () => {
      touching = false;
      kick();
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
      loaded = null;
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
  }, [angle, size]);

  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <View style={[styles.box, { width: size, height: size }]} {...({ dataSet: { fly: 'object' } } as object)}>
        {/* The facing ability's light behind the glass: one glow per colour,
            crossfading, so a new face never flips the light at once. */}
        {colours.map((colour, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: i === facing ? 1 : 0,
                transitionProperty: 'opacity',
                transitionDuration: '260ms',
                transitionTimingFunction: 'ease',
              },
            ]}>
            <Svg width={size} height={size}>
              <Defs>
                <RadialGradient id={`crystal-glow-${i}`} cx="50%" cy="52%" r="50%">
                  <Stop offset="0" stopColor={colour} stopOpacity={0.26} />
                  <Stop offset="0.55" stopColor={colour} stopOpacity={0.07} />
                  <Stop offset="1" stopColor={colour} stopOpacity={0} />
                </RadialGradient>
              </Defs>
              <Circle cx={size / 2} cy={size * 0.52} r={size / 2} fill={`url(#crystal-glow-${i})`} />
            </Svg>
          </Animated.View>
        ))}
        <View ref={host} aria-hidden style={[StyleSheet.absoluteFill, styles.grab] as object} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'center', userSelect: 'none', WebkitTouchCallout: 'none' } as object,
  grab: { cursor: 'grab' } as object,
});
