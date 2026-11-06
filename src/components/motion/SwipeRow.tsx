import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTabsMotion } from '@/components/motion/SwipeTabs';
import { Icon, type IconName } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, icon, palette } from '@/constants/theme';
import { haptic } from '@/lib/feedback';
import { project, rubberband, SPRING } from '@/lib/motion';

export interface SwipeAction {
  icon: IconName;
  label: string;
  /** The colour that fills behind the card. */
  color: string;
  /** Icon and label colour on top of it. */
  ink: string;
  onFire: () => void;
  /** Burn a trail of fire behind the card, hottest at its edge, over the fill. */
  trail?: boolean;
}

/** Share of the card's width that arms the action. */
const ARM = 0.34;
/** How far the card follows before it starts to resist. */
const TRAVEL = 0.62;
/** How much a card grows as it comes up under the finger. */
const LIFT = 0.03;
const LIFT_EASE = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Something you can throw sideways. It lifts a little as it comes up under
 * the finger, follows it, and the action fills in behind it. Past a line it
 * arms, with a small buzz and the icon growing, and letting go commits. A
 * quick flick commits from anywhere. It always springs back carrying the
 * finger's speed, so it feels thrown, and settles back down as it lands.
 * Vertical movement is left to the page, and a swipe that starts here beats
 * the swipe between tabs.
 */
export function SwipeRow({
  right,
  left,
  corner,
  children,
}: {
  /** What a drag to the right does. Leave out to make that direction resist. */
  right?: SwipeAction;
  left?: SwipeAction;
  corner: number;
  children: ReactNode;
}) {
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const wide = useSharedValue(160);
  const lift = useSharedValue(0);
  const pager = useTabsMotion()?.pager ?? null;

  const fireRight = right?.onFire;
  const fireLeft = left?.onFire;

  const pan = useMemo(() => {
    const swipe = Gesture.Pan()
      // A second finger landing mid-swipe must not make the card jump.
      .maxPointers(1)
      .activeOffsetX([-14, 14])
      .failOffsetY([-10, 10])
      .onStart(() => {
        cancelAnimation(x);
        start.set(x.get());
        // Only once it is really a swipe, so a touch that turns into a scroll never bobs.
        lift.set(withTiming(1, { duration: 160, easing: LIFT_EASE }));
      })
      .onUpdate((e) => {
        const raw = start.get() + e.translationX;
        const w = wide.get();
        const can = raw > 0 ? Boolean(fireRight) : Boolean(fireLeft);
        const free = can ? w * TRAVEL : 0;
        const past = Math.abs(raw) - free;
        const moved = past > 0 ? free + rubberband(past, w, can ? 0.3 : 0.2) : Math.abs(raw);
        x.set(raw > 0 ? moved : -moved);
      })
      .onEnd((e) => {
        const w = wide.get();
        const landing = x.get() + project(e.velocityX, 0.99);
        const line = w * ARM;
        if (landing > line && fireRight) scheduleOnRN(fireRight);
        else if (landing < -line && fireLeft) scheduleOnRN(fireLeft);
        x.set(withSpring(0, { ...SPRING.snap, velocity: e.velocityX }));
      })
      .onFinalize(() => {
        lift.set(withTiming(0, { duration: 260, easing: LIFT_EASE }));
      });
    return pager ? swipe.blocksExternalGesture(pager) : swipe;
  }, [fireLeft, fireRight, lift, pager, start, wide, x]);

  useAnimatedReaction(
    () => {
      const line = wide.get() * ARM;
      const now = x.get();
      if (now > line && fireRight) return 1;
      if (now < -line && fireLeft) return -1;
      return 0;
    },
    (armed, was) => {
      if (armed !== was && armed !== 0 && was !== null) scheduleOnRN(haptic, 'light');
    },
  );

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  // Above its neighbours while lifted, so its shadow falls on them.
  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + LIFT * lift.get() }],
    zIndex: lift.get() > 0.01 ? 1 : 0,
  }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: lift.get() }));
  // The trail stretches over the ground the card has covered: cold where it
  // started, hottest right behind its trailing edge.
  const trailStyle = useAnimatedStyle(() => {
    const w = wide.get();
    return {
      transform: [{ scaleX: Math.max(0.001, x.get()) / w }],
      opacity: interpolate(x.get(), [0, w * ARM], [0.7, 1], Extrapolation.CLAMP),
    };
  });
  const rightStyle = useAnimatedStyle(() => ({ opacity: x.get() > 1 ? 1 : 0 }));
  const leftStyle = useAnimatedStyle(() => ({ opacity: x.get() < -1 ? 1 : 0 }));
  const rightIcon = useAnimatedStyle(() => {
    const line = wide.get() * ARM;
    return {
      opacity: interpolate(x.get(), [line * 0.25, line * 0.8], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(x.get(), [line * 0.8, line], [0.8, 1.2], Extrapolation.CLAMP) }],
    };
  });
  const leftIcon = useAnimatedStyle(() => {
    const line = wide.get() * ARM;
    return {
      opacity: interpolate(-x.get(), [line * 0.25, line * 0.8], [0, 1], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(-x.get(), [line * 0.8, line], [0.8, 1.2], Extrapolation.CLAMP) }],
    };
  });

  return (
    <Animated.View style={liftStyle}>
      <Animated.View pointerEvents="none" style={[styles.shadow, { borderRadius: corner }, shadowStyle]} />
      <View
        collapsable={false}
        style={[styles.clip, { borderRadius: corner }]}
        onLayout={(e) => wide.set(e.nativeEvent.layout.width)}>
        {right ? (
          <Animated.View style={[styles.under, { backgroundColor: right.color }, rightStyle]}>
            {right.trail ? (
              <Animated.View pointerEvents="none" style={[styles.trail, trailStyle]}>
                <LinearGradient
                  colors={[alpha(palette.accentDeep, 0), alpha(palette.accentDeep, 0.55), palette.accent, palette.accentSoft]}
                  locations={[0, 0.45, 0.82, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </Animated.View>
            ) : null}
            <Animated.View style={[styles.action, rightIcon]}>
              <Icon name={right.icon} size={icon.bar} color={right.ink} />
              <SystemText variant="meta" color={right.ink} numberOfLines={1} style={styles.label}>
                {right.label}
              </SystemText>
            </Animated.View>
          </Animated.View>
        ) : null}
        {left ? (
          <Animated.View style={[styles.under, styles.underLeft, { backgroundColor: left.color }, leftStyle]}>
            <Animated.View style={[styles.action, leftIcon]}>
              <Icon name={left.icon} size={icon.bar} color={left.ink} />
              <SystemText variant="meta" color={left.ink} numberOfLines={1} style={styles.label}>
                {left.label}
              </SystemText>
            </Animated.View>
          </Animated.View>
        ) : null}
        <GestureDetector gesture={pan} touchAction="pan-y">
          <Animated.View style={cardStyle}>
            {/* What flies when the card is cleared: the face as it is, wherever the finger left it. */}
            <View {...({ dataSet: { swipe: 'face' } } as object)}>{children}</View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shadow: { ...StyleSheet.absoluteFill, backgroundColor: palette.bg, boxShadow: '0px 14px 26px rgba(0,0,0,0.5)' },
  trail: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '100%', transformOrigin: 'left center' },
  clip: { overflow: 'hidden', backgroundColor: palette.bg },
  under: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 18 },
  underLeft: { alignItems: 'flex-end' },
  action: { alignItems: 'center', gap: 2, minWidth: 48 },
  label: { fontSize: 12, fontWeight: '600' },
});
