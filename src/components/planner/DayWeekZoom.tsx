import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  Extrapolation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/feedback';
import { clamp, rubberband, SPRING } from '@/lib/motion';

/** How small the day's clock gets on its way into its row of the week. */
const MINI = 0.1;

/**
 * The day's clock and the week, in one square. Pinch the clock and it
 * follows your fingers down into its own day in the week; spread the week and
 * the day grows back out. Let go part way and it settles whichever way the
 * pinch was going. `zoom` is 0 on the day and 1 on the week, and the Week
 * button drives the same value, so a pinch is only ever a shortcut.
 *
 * The square stops the browser zooming the page while two fingers are on it,
 * and only there: everywhere else the page still zooms as usual.
 */
export function DayWeekZoom({
  size,
  zoom,
  week,
  anchor,
  onWeek,
  day,
  weekView,
}: {
  size: number;
  zoom: SharedValue<number>;
  /** Whether the week is the one showing, once any pinch has settled. */
  week: boolean;
  /** Where the day sits in the week, so it shrinks into the right row. */
  anchor: { x: number; y: number };
  onWeek: (week: boolean) => void;
  day: ReactNode;
  weekView: ReactNode;
}) {
  const c = size / 2;
  const from = useSharedValue(0);

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .onStart(() => {
          from.set(zoom.get() > 0.5 ? 1 : 0);
        })
        .onUpdate((e) => {
          // A pinch in to half the size goes all the way to the week; a
          // spread to 1.6 times comes all the way back. Past either end it
          // gives a little, then less, and never stops dead.
          const raw = from.get() === 0 ? (1 - e.scale) / 0.5 : 1 - (e.scale - 1) / 0.6;
          const z = raw < 0 ? -rubberband(-raw, 1) * 0.4 : raw > 1 ? 1 + rubberband(raw - 1, 1) * 0.4 : raw;
          zoom.set(z);
        })
        .onEnd((e) => {
          const z = zoom.get();
          // velocity is how fast the scale is changing: below 0 is pinching in.
          const toWeek = from.get() === 0 ? z > 0.35 || e.velocity < -0.6 : !(z < 0.65 || e.velocity > 0.6);
          zoom.set(withSpring(toWeek ? 1 : 0, { ...SPRING.page, reduceMotion: ReduceMotion.System }));
          if (toWeek !== (from.get() === 1)) scheduleOnRN(haptic, 'light');
          scheduleOnRN(onWeek, toWeek);
        }),
    [from, onWeek, zoom],
  );

  const dayStyle = useAnimatedStyle(() => {
    const z = zoom.get();
    const k = clamp(z, 0, 1);
    return {
      opacity: interpolate(z, [0.6, 1], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: (anchor.x - c) * k },
        { translateY: (anchor.y - c) * k },
        // Below 0 the pinch went the wrong way: the day swells a touch instead.
        { scale: z < 0 ? 1 - z * 0.25 : 1 - (1 - MINI) * k },
      ],
    };
  });

  const weekStyle = useAnimatedStyle(() => {
    const z = zoom.get();
    return {
      opacity: interpolate(z, [0.2, 0.85], [0, 1], Extrapolation.CLAMP),
      // The week comes from a little nearer, as if you had stepped back to see it.
      transform: [{ scale: z > 1 ? 1 - (z - 1) * 0.12 : interpolate(z, [0, 1], [1.06, 1], Extrapolation.CLAMP) }],
    };
  });

  return (
    <GestureDetector gesture={pinch} touchAction="pan-y">
      <View collapsable={false} style={{ width: size, height: size }}>
        <Animated.View pointerEvents={week ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, dayStyle]}>
          {day}
        </Animated.View>
        <Animated.View
          pointerEvents={week ? 'box-none' : 'none'}
          aria-hidden={!week}
          style={[StyleSheet.absoluteFill, weekStyle]}>
          {weekView}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
