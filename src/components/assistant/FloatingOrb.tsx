import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { sparkTrail } from '@/components/assistant/sparkTrail';
import { home, summon } from '@/components/assistant/summon';
import { space } from '@/constants/theme';
import { haptic } from '@/lib/feedback';
import { clamp, project, SPRING } from '@/lib/motion';

const SIZE = 60;
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
 */
export function FloatingOrb({
  bottom,
  top,
  label,
  onPress,
  hidden = false,
  children,
}: {
  /** Clear space to keep at the bottom, above the tab bar. */
  bottom: number;
  top: number;
  label: string;
  onPress: () => void;
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
    return Gesture.Race(drag, tap);
  }, [held, lowest, margin, onPress, rightEdge, startX, startY, top, width, x, y]);

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
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  orb: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE },
});
