import { useSyncExternalStore } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { cubicBezier, makeMutable, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, icon, palette, radius, space } from '@/constants/theme';
import { haptic } from '@/lib/feedback';
import { ringCentre, ringSpot } from '@/lib/moves';

export interface RingItem {
  key: string;
  label: string;
  icon: IconName;
  /** Gets where the ring was opened, for an action that grows out of that spot. */
  run: (at: { x: number; y: number }) => void;
}

interface Ring {
  x: number;
  y: number;
  title: string;
  items: RingItem[];
  id: number;
}

/** The item a held finger points at, written by the gesture every frame. */
export const ringHover = makeMutable(-1);

let current: Ring | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Opens the ring round a held finger at (x, y), screen px. */
export function openRing(x: number, y: number, title: string, items: RingItem[]): void {
  ringHover.set(-1);
  current = { x, y, title, items, id: ++seq };
  haptic('medium');
  emit();
}

/**
 * The finger has lifted. Pointing at an item picks it; lifted in the middle,
 * the ring stays open for a tap, so it never has to be used by dragging.
 */
export function releaseRing(index: number): void {
  const ring = current;
  if (!ring) return;
  const item = index >= 0 ? ring.items[index] : undefined;
  if (!item) return;
  closeRing();
  haptic('light');
  item.run({ x: ring.x, y: ring.y });
}

export function closeRing(): void {
  current = null;
  ringHover.set(-1);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const SIZE = 58;

/**
 * The ring menu a long press on a quest opens: its actions in a circle round
 * the finger. Slide to one and let go to do it, or let go in the middle and
 * tap one. Everything on it is also on the card, so it is a shortcut, never
 * the only way. The items open out from the finger in a quick stagger and
 * the one pointed at swells.
 */
export function RingMenuHost() {
  const ring = useSyncExternalStore(subscribe, () => current, () => null);
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  if (!ring) return null;
  const c = ringCentre(ring.x, ring.y, width, height);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={closeRing} accessibilityRole="button" accessibilityLabel="Close the menu" />
      <View pointerEvents="none" style={[styles.title, { left: c.x - 120, top: c.y - 78 - SIZE / 2 - 34 }]}>
        <SystemText variant="label" color={palette.textMuted} numberOfLines={1} style={styles.titleText}>
          {ring.title}
        </SystemText>
      </View>
      <View pointerEvents="none" style={[styles.anchor, { left: c.x - 5, top: c.y - 5 }]} />
      {ring.items.map((item, i) => (
        <RingButton key={`${ring.id}-${item.key}`} item={item} i={i} count={ring.items.length} cx={c.x} cy={c.y} reduced={reduced} />
      ))}
    </View>
  );
}

function RingButton({ item, i, count, cx, cy, reduced }: { item: RingItem; i: number; count: number; cx: number; cy: number; reduced: boolean }) {
  const spot = ringSpot(i, count);
  const hover = useAnimatedStyle(() => {
    const on = ringHover.get() === i;
    return {
      transform: [{ scale: withTiming(on ? 1.16 : 1, { duration: 120 }) }],
      backgroundColor: on ? palette.accent : palette.surfaceRaised,
      borderColor: on ? palette.accent : palette.borderStrong,
    };
  });
  // Out from the finger to its place, a beat after the one before.
  const open = reduced
    ? null
    : {
        animationName: {
          from: { opacity: 0, transform: [{ translateX: -spot.x * 0.7 }, { translateY: -spot.y * 0.7 }, { scale: 0.6 }] },
          to: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] },
        },
        animationDuration: '200ms',
        animationDelay: `${i * 25}ms`,
        animationTimingFunction: EASE_OUT,
        animationFillMode: 'both',
      };
  return (
    <Animated.View style={[styles.slot, { left: cx + spot.x - SIZE / 2, top: cy + spot.y - SIZE / 2 }, open as object]}>
      <Pressable
        onPress={() => {
          closeRing();
          haptic('light');
          item.run({ x: cx, y: cy });
        }}
        accessibilityRole="button"
        accessibilityLabel={item.label}>
        <Animated.View style={[styles.button, hover]}>
          <Icon name={item.icon} size={icon.bar} color={palette.text} />
        </Animated.View>
      </Pressable>
      <SystemText variant="label" color={palette.text} numberOfLines={1} style={styles.label}>
        {item.label}
      </SystemText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: alpha(palette.bg, 0.55) },
  title: { position: 'absolute', width: 240, alignItems: 'center' },
  titleText: { fontSize: 12 },
  anchor: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: alpha(palette.accent, 0.8) },
  slot: { position: 'absolute', width: SIZE, alignItems: 'center' },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0px 8px 24px ${alpha('#000000', 0.45)}`,
  } as object,
  label: { marginTop: space.xs, fontSize: 11, width: 90, textAlign: 'center' },
});
