import { useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CollectibleCard } from '@/components/card/CollectibleCard';
import { useDeviceTilt } from '@/components/collection/tilt';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import type { CardDef } from '@/data/cardRules';
import { tiltAt } from '@/lib/collection';
import { haptic, playSound } from '@/lib/feedback';
import { SPRING } from '@/lib/motion';
import { useProgress } from '@/store/progress';

interface Open {
  card: CardDef;
  owned: boolean;
  /** Where the card sat on screen when it was tapped, px. */
  from: { x: number; y: number; w: number; h: number };
}

let current: Open | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Grows a card out of the element it sits in, to fill the screen. */
export function openCard(card: CardDef, owned: boolean, el: unknown): void {
  const box = (el as HTMLElement | null)?.getBoundingClientRect?.();
  if (!box) return;
  playSound('tap');
  current = { card, owned, from: { x: box.left, y: box.top, w: box.width, h: box.height } };
  emit();
}

function closed(): void {
  current = null;
  emit();
}

/** The card that is open right now, so its slot can stand empty while it is out. */
export function useOpenCardId(): string | null {
  return useSyncExternalStore(subscribe, () => current?.card.id ?? null, () => null);
}

/** Opening: the iOS sheet's curve, quick to leave and soft to land. */
const GROW = { duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1) };
/** Closing is quicker than opening, as a way out should be. */
const SHRINK = { duration: 300, easing: Easing.bezier(0.32, 0.72, 0, 1) };

/**
 * A card, opened: it grows out of its place in the carousel or the grid to
 * fill the screen, the collection dimming behind it, and there it can be
 * looked at properly: tip it with a finger or the phone, and a rare card's
 * art moves. Drag it down, tap outside it or press close, and it shrinks
 * back into its slot.
 */
export function CardViewerHost() {
  const open = useSyncExternalStore(subscribe, () => current, () => null);
  if (!open) return null;
  return <Viewer key={`${open.card.id}-${open.from.x}-${open.from.y}`} open={open} />;
}

function Viewer({ open }: { open: Open }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { state } = useProgress();
  const lowPower = state.settings?.lowPower ?? false;
  const cardW = Math.min(width - space.xl * 2, 330);
  // The card's own height, once laid out; until then it waits, unseen.
  const [cardH, setCardH] = useState(0);
  const p = useSharedValue(0);
  const drop = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const [leaving, setLeaving] = useState(false);
  const gyro = useDeviceTilt(cardH > 0 && !leaving);
  const x = useDerivedValue(() => Math.max(-1, Math.min(1, fx.get() + gyro.x.get())));
  const y = useDerivedValue(() => Math.max(-1, Math.min(1, fy.get() + gyro.y.get())));
  const tilt = useMemo(() => ({ x, y }), [x, y]);

  const top = Math.max(insets.top + space.xxl * 2, (height - cardH) / 2 - space.lg);
  const fromScale = open.from.w / cardW;
  const dx = open.from.x + open.from.w / 2 - width / 2;
  const dy = open.from.y + open.from.h / 2 - (top + cardH / 2);

  const measured = (h: number) => {
    if (cardH) return;
    setCardH(h);
    p.set(reduced ? 1 : withTiming(1, GROW));
    haptic('light');
  };
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    drop.set(withTiming(0, SHRINK));
    p.set(reduced ? 0 : withTiming(0, SHRINK, (done) => {
      if (done) scheduleOnRN(closed);
    }));
    if (reduced) closed();
  };

  // Down drags it away; any other drag tips it toward the finger.
  const pan = useMemo(() => {
    const tip = (ex: number, ey: number) => {
      'worklet';
      const t = tiltAt(ex, ey, cardW, cardH || 1);
      fx.set(withSpring(t.x, { duration: 160, dampingRatio: 1 }));
      fy.set(withSpring(t.y, { duration: 160, dampingRatio: 1 }));
    };
    const drag = Gesture.Pan()
      .maxPointers(1)
      .minDistance(4)
      .onStart((e) => tip(e.x, e.y))
      .onUpdate((e) => {
        if (e.translationY > 12) drop.set(e.translationY - 12);
        else tip(e.x, e.y);
      })
      .onEnd((e) => {
        if (drop.get() > 110 || e.velocityY > 700) scheduleOnRN(close);
        else drop.set(withSpring(0, { ...SPRING.snap, velocity: e.velocityY }));
      })
      .onFinalize(() => {
        fx.set(withSpring(0, SPRING.settle));
        fy.set(withSpring(0, SPRING.settle));
      });
    return drag;
    // close only reads state it sets itself; rebuilding per render would drop a drag mid-way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardH, cardW, drop, fx, fy]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: p.get() * Math.max(0.4, 1 - drop.get() / 400) }));
  const cardStyle = useAnimatedStyle(() => {
    const k = p.get();
    const pull = drop.get();
    const shrink = 1 - Math.min(0.12, pull / 1600);
    return {
      opacity: cardH ? 1 : 0,
      transform: [
        { translateX: dx * (1 - k) },
        { translateY: dy * (1 - k) + pull },
        { scale: (fromScale + (1 - fromScale) * k) * shrink },
        { perspective: 1000 },
        { rotateY: `${x.get() * 10}deg` },
        { rotateX: `${-y.get() * 10}deg` },
      ],
    };
  });
  const chromeStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, (p.get() - 0.6) / 0.4) * (1 - Math.min(1, drop.get() / 160)) }));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close the card" />
      </Animated.View>

      <GestureDetector gesture={pan} touchAction="none">
        <Animated.View style={[styles.card, { width: cardW, left: (width - cardW) / 2, top }, cardStyle]}>
          <View onLayout={(e) => measured(Math.round(e.nativeEvent.layout.height))}>
            <CollectibleCard card={open.card} owned={open.owned} size="hero" tilt={tilt} alive={!leaving && !lowPower} />
          </View>
        </Animated.View>
      </GestureDetector>

      <Animated.View pointerEvents="box-none" style={[styles.close, { top: insets.top + space.md }, chromeStyle]}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close">
          <View style={styles.closeButton}>
            <Icon name="close" size={icon.body} color={palette.text} />
          </View>
        </Pressable>
      </Animated.View>
      {cardH ? (
        <Animated.View pointerEvents="none" style={[styles.hint, { top: top + cardH + space.lg }, chromeStyle]}>
          <SystemText variant="label" color={palette.textMuted}>
            Drag down or tap outside to put it back
          </SystemText>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: alpha(palette.bg, 0.92) },
  card: { position: 'absolute' },
  close: { position: 'absolute', right: space.lg },
  closeButton: {
    width: HIT,
    height: HIT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.text, 0.08),
  },
  hint: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
});
