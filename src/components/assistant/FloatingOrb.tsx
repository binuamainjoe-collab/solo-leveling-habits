import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { sparkTrail } from '@/components/assistant/sparkTrail';
import { home, summon } from '@/components/assistant/summon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { haptic, playSound } from '@/lib/feedback';
import { clamp, project, SPRING } from '@/lib/motion';

const SIZE = 60;
/** Hold him this long, without moving, to go live. */
export const HOLD_MS = 5_000;
/** A tap is over by then, so the ring never flickers on one. */
const RING_DELAY_MS = 250;
const RING = SIZE + 16;
const RING_STROKE = 4;
const WEB = Platform.OS === 'web';
/** A throw this fast (pixels a second) leaves a trail of sparks. */
const SPARKING = 700;

function rememberSpot(x: number, y: number) {
  home.x = x;
  home.y = y;
}

/**
 * The floating Beerus button. Tap to talk, or pick him up and throw him: he
 * follows the finger, then flies to the nearer side of the screen wherever the
 * flick was heading, so he is never stuck over something you need. A hard
 * throw leaves sparks behind him. Pulling down at the top of Today calls him
 * up toward your finger. While his window is open he is up there instead, so
 * this one steps aside.
 *
 * Hold him still and an ember ring fills around him; once it is full, let go
 * and a live voice call opens. The call starts on the lift, not at the five
 * seconds, because the browser only lets a page make sound after a real tap,
 * and lifting the finger is that tap. Moving the finger turns it into a
 * throw instead, and the ring empties.
 */
export function FloatingOrb({
  bottom,
  top,
  label,
  onPress,
  onHold,
  hidden = false,
  children,
}: {
  /** Clear space to keep at the bottom, above the tab bar. */
  bottom: number;
  top: number;
  label: string;
  onPress: () => void;
  /** Held for HOLD_MS, then let go. Leave out where a live call cannot run. */
  onHold?: () => void;
  hidden?: boolean;
  children: ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const margin = space.lg;
  const rightEdge = width - SIZE - margin;
  const lowest = height - bottom - SIZE;

  const x = useSharedValue(home.x < 0 ? rightEdge : home.x);
  const y = useSharedValue(home.y < 0 ? lowest : home.y);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const held = useSharedValue(0);
  // The hold: filling while the finger rests on him, full once it is time.
  // React state, set twice a hold, so nothing renders per frame.
  const [charging, setCharging] = useState(false);
  const [charged, setCharged] = useState(false);
  const beginCharge = useCallback(() => setCharging(true), []);
  const endCharge = useCallback(() => {
    setCharging(false);
    setCharged(false);
  }, []);
  const fullCharge = useCallback(() => {
    setCharged(true);
    haptic('success');
    playSound('tap');
  }, []);

  // A new window size can leave him off screen.
  useEffect(() => {
    const nx = clamp(home.x < 0 ? rightEdge : home.x, margin, rightEdge);
    const ny = clamp(home.y < 0 ? lowest : home.y, top, lowest);
    rememberSpot(nx, ny);
    x.set(withSpring(nx, SPRING.settle));
    y.set(withSpring(ny, SPRING.settle));
  }, [rightEdge, lowest, margin, top, x, y]);

  // Where he is right now, summons included, for the window to fly him from.
  useEffect(() => {
    home.read = () => {
      const s = Math.min(1.2, summon.get());
      return { x: x.get() + (width / 2 - SIZE / 2 - x.get()) * s * 0.85, y: y.get() + (top + 8 - y.get()) * s * 0.85 };
    };
    return () => {
      home.read = null;
    };
  }, [top, width, x, y]);

  const gesture = useMemo(() => {
    const centre = () => ({ x: x.get() + SIZE / 2, y: y.get() + SIZE / 2 });
    const trail = () => sparkTrail(centre);
    const drag = Gesture.Pan()
      .maxPointers(1)
      .minDistance(6)
      .onStart(() => {
        cancelAnimation(x);
        cancelAnimation(y);
        startX.set(x.get());
        startY.set(y.get());
        held.set(withSpring(1, SPRING.settle));
      })
      .onUpdate((e) => {
        x.set(startX.get() + e.translationX);
        y.set(startY.get() + e.translationY);
      })
      .onFinalize((e) => {
        held.set(withSpring(0, SPRING.settle));
        const landX = x.get() + project(e.velocityX);
        const targetX = landX + SIZE / 2 < width / 2 ? margin : rightEdge;
        const targetY = clamp(y.get() + project(e.velocityY), top, lowest);
        x.set(withSpring(targetX, { ...SPRING.snap, velocity: e.velocityX }));
        y.set(withSpring(targetY, { ...SPRING.snap, velocity: e.velocityY }));
        scheduleOnRN(rememberSpot, targetX, targetY);
        scheduleOnRN(haptic, 'light');
        if (Math.hypot(e.velocityX, e.velocityY) > SPARKING) scheduleOnRN(trail);
      });
    const tap = Gesture.Tap().onEnd((_e, finished) => {
      if (finished) scheduleOnRN(onPress);
    });
    if (!onHold) return Gesture.Race(drag, tap);
    const hold = Gesture.LongPress()
      .minDuration(HOLD_MS)
      .maxDistance(12)
      .onBegin(() => {
        scheduleOnRN(beginCharge);
      })
      .onStart(() => {
        scheduleOnRN(fullCharge);
      })
      .onEnd((_e, success) => {
        if (success) scheduleOnRN(onHold);
      })
      .onFinalize(() => {
        scheduleOnRN(endCharge);
      });
    return Gesture.Race(drag, hold, tap);
  }, [beginCharge, endCharge, fullCharge, held, lowest, margin, onHold, onPress, rightEdge, startX, startY, top, width, x, y]);

  const style = useAnimatedStyle(() => {
    // Pulled for: he rises toward the top of the screen as the pull grows.
    const s = Math.min(1.2, summon.get()) * 0.85;
    const atX = x.get() + (width / 2 - SIZE / 2 - x.get()) * s;
    const atY = y.get() + (top + 8 - y.get()) * s;
    return {
      opacity: hidden ? 0 : 1,
      transform: [{ translateX: atX }, { translateY: atY }, { scale: 1 + held.get() * 0.12 + s * 0.12 }],
    };
  });

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <GestureDetector gesture={gesture} touchAction="none">
        <Animated.View
          pointerEvents={hidden ? 'none' : 'auto'}
          style={[styles.orb, style]}
          accessibilityRole="button"
          accessibilityLabel={label}
          aria-hidden={hidden}>
          {onHold ? <HoldRing charging={charging} charged={charged} /> : null}
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * The ember ring around Beerus while he is held. It fills clockwise over the
 * hold with a CSS transition, the same way the progress rings do, so no
 * frame of it runs in JavaScript; let go early and it drains at once. A word
 * above him says what is happening, and what to do once it is full.
 */
function HoldRing({ charging, charged }: { charging: boolean; charged: boolean }) {
  const r = (RING - RING_STROKE) / 2;
  const length = 2 * Math.PI * r;
  const fill = WEB
    ? {
        strokeDashoffset: charging ? 0 : length,
        opacity: charging ? 1 : 0,
        transitionProperty: 'stroke-dashoffset, opacity',
        transitionDuration: charging ? `${HOLD_MS - RING_DELAY_MS}ms, 160ms` : '180ms, 180ms',
        transitionDelay: charging ? `${RING_DELAY_MS}ms, ${RING_DELAY_MS}ms` : '0ms, 0ms',
        transitionTimingFunction: 'linear',
      }
    : null;
  const hint = WEB
    ? {
        opacity: charging ? 1 : 0,
        transitionProperty: 'opacity',
        transitionDuration: '180ms',
        transitionDelay: charging && !charged ? '600ms' : '0ms',
      }
    : { opacity: charging ? 1 : 0 };
  return (
    <>
      <View pointerEvents="none" style={styles.ring}>
        <Svg width={RING} height={RING}>
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            stroke={charged ? palette.positive : palette.accent}
            strokeWidth={RING_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${length} ${length}`}
            strokeDashoffset={charging ? 0 : length}
            opacity={charging ? 1 : 0}
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
            {...(fill ? { style: fill as object } : null)}
          />
        </Svg>
      </View>
      <View pointerEvents="none" style={[styles.hint, hint as object]}>
        <SystemText variant="label" color={charged ? palette.bg : palette.text} style={[styles.hintText, charged && styles.hintReady]}>
          {charged ? 'Let go for live' : 'Hold for live'}
        </SystemText>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  orb: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE },
  ring: { position: 'absolute', left: (SIZE - RING) / 2, top: (SIZE - RING) / 2, width: RING, height: RING },
  hint: { position: 'absolute', bottom: SIZE + 12, left: -40, right: -40, alignItems: 'center' },
  hintText: {
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: alpha(palette.bg, 0.8),
  },
  hintReady: { backgroundColor: palette.positive },
});
