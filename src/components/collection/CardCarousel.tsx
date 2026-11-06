import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, Pressable } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { CollectibleCard } from '@/components/card/CollectibleCard';
import { openCard, useOpenCardId } from '@/components/collection/CardViewer';
import { useDeviceTilt, type Tilt } from '@/components/collection/tilt';
import { usePageOnScreen, useTabsMotion } from '@/components/motion/SwipeTabs';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import type { CardDef } from '@/data/cardRules';
import { restIndex, ringPose, ringWindow } from '@/lib/collection';
import { haptic, playSound } from '@/lib/feedback';
import { rubberband, SPRING } from '@/lib/motion';
import { useProgress } from '@/store/progress';

/**
 * The collection as a ring of cards you turn with a finger: the card in front
 * faces you, its neighbours turn away round the ring and sink into the dark.
 * A flick carries on and settles on a card; past either end the ring resists.
 * The arrows and tapping a side card do the same without a swipe.
 *
 * The card in front is the only one alive: its foil follows the phone's tilt
 * and, if it is rare, its art drifts and embers rise. The others hold still,
 * their foil sliding only as the ring turns them.
 */
export function CardCarousel({ cards, owned, width }: { cards: CardDef[]; owned: Set<string>; width: number }) {
  const cardW = Math.min(232, Math.round(width * 0.6));
  // How far a finger moves to turn the ring by one card.
  const spacing = cardW * 0.55;
  const [index, setIndex] = useState(0);
  const pos = useSharedValue(0);
  const start = useSharedValue(0);
  const pager = useTabsMotion()?.pager ?? null;
  const onScreen = usePageOnScreen();
  const { state } = useProgress();
  const lowPower = state.settings?.lowPower ?? false;
  const gyro = useDeviceTilt(onScreen);
  const count = cards.length;
  // A new filter starts the ring over at its first card.
  const [deck, setDeck] = useState(cards);
  if (deck !== cards) {
    setDeck(cards);
    setIndex(0);
  }
  useEffect(() => {
    cancelAnimation(pos);
    pos.set(0);
  }, [cards, pos]);

  useAnimatedReaction(
    // Pulled past an end, the ring still counts the end card as in front.
    () => Math.max(0, Math.min(count - 1, Math.round(pos.get()))),
    (now, prev) => {
      if (prev !== null && now !== prev) scheduleOnRN(setIndex, now);
    },
  );

  const pan = useMemo(() => {
    const g = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .onStart(() => {
        cancelAnimation(pos);
        start.set(pos.get());
      })
      .onUpdate((e) => {
        const raw = start.get() - e.translationX / spacing;
        const last = Math.max(0, count - 1);
        // Past the ends it follows the finger grudgingly, then springs back.
        if (raw < 0) pos.set(-rubberband(-raw, 1, 0.35));
        else if (raw > last) pos.set(last + rubberband(raw - last, 1, 0.35));
        else pos.set(raw);
      })
      .onEnd((e) => {
        const velocity = -e.velocityX / spacing;
        const target = restIndex(pos.get(), velocity, count);
        pos.set(withSpring(target, { ...SPRING.snap, velocity }));
        scheduleOnRN(haptic, 'tick');
      });
    return pager ? g.blocksExternalGesture(pager) : g;
  }, [count, pager, pos, spacing, start]);

  const go = (i: number) => {
    const to = Math.max(0, Math.min(count - 1, i));
    if (to === Math.round(pos.get())) return;
    playSound('tap');
    pos.set(withSpring(to, SPRING.settle));
  };

  const [from, to] = ringWindow(index, count);
  const shown = cards
    .slice(from, to + 1)
    .map((card, k) => ({ card, i: from + k }))
    .sort((a, b) => Math.abs(b.i - index) - Math.abs(a.i - index));
  const cardH = 240 + 124;

  if (!count) {
    return (
      <View style={styles.empty}>
        <SystemText variant="body">Nothing here yet.</SystemText>
      </View>
    );
  }

  return (
    <View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <View style={[styles.stage, { height: cardH + space.lg }]}>
          {/* The light the cards stand in, low and warm, so the ring has a floor. */}
          <View pointerEvents="none" style={[styles.floor, { width: cardW * 1.6 }]} />
          {shown.map(({ card, i }) => {
            const front = i === index;
            return (
              <RingCard
                key={card.id}
                card={card}
                i={i}
                pos={pos}
                gyro={gyro}
                width={cardW}
                owned={owned.has(card.id)}
                alive={front && onScreen && !lowPower}
                front={front}
                onPick={() => go(i)}
              />
            );
          })}
        </View>
      </GestureDetector>

      <View style={styles.controls}>
        <Arrow glyph="back" hint="Previous card" disabled={index <= 0} onPress={() => go(index - 1)} />
        <SystemText variant="meta" style={styles.count}>
          {`${index + 1} of ${count}`}
        </SystemText>
        <Arrow glyph="chevron" hint="Next card" disabled={index >= count - 1} onPress={() => go(index + 1)} />
      </View>
    </View>
  );
}

function RingCard({
  card,
  i,
  pos,
  gyro,
  width,
  owned,
  alive,
  front,
  onPick,
}: {
  card: CardDef;
  i: number;
  pos: SharedValue<number>;
  gyro: Tilt;
  width: number;
  owned: boolean;
  alive: boolean;
  /** The card facing you: tapped, it opens; a side card turns the ring to it instead. */
  front: boolean;
  onPick: () => void;
}) {
  const box = useRef<View | null>(null);
  const out = useOpenCardId() === card.id;
  // The foil reads the ring's turn, and in front, the phone's tilt too.
  const x = useDerivedValue(() => {
    const off = i - pos.get();
    const front = Math.max(0, 1 - Math.abs(off));
    return Math.max(-1, Math.min(1, -off * 0.9 + gyro.x.get() * front));
  });
  const y = useDerivedValue(() => {
    const front = Math.max(0, 1 - Math.abs(i - pos.get()));
    return gyro.y.get() * front;
  });
  const tilt = useMemo(() => ({ x, y }), [x, y]);

  const style = useAnimatedStyle(() => {
    const p = ringPose(i - pos.get(), width);
    return {
      opacity: p.opacity,
      zIndex: p.zIndex,
      transform: [{ perspective: 900 }, { translateX: p.translateX }, { scale: p.scale }, { rotateY: `${p.angle}deg` }],
    };
  });
  const dimStyle = useAnimatedStyle(() => ({ opacity: ringPose(i - pos.get(), width).dim }));

  return (
    <Animated.View style={[styles.slot, { width, marginLeft: -width / 2 }, style, out && styles.out]}>
      <Pressable
        onPress={front ? () => openCard(card, owned, box.current) : onPick}
        accessibilityRole="button"
        accessibilityLabel={front ? `Open ${owned ? card.name : 'undiscovered card'}` : owned ? card.name : 'Undiscovered card'}>
        <View ref={box} collapsable={false}>
          <CollectibleCard card={card} owned={owned} size="focus" tilt={tilt} alive={alive && !out} />
        </View>
        <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
      </Pressable>
    </Animated.View>
  );
}

function Arrow({ glyph, hint, disabled, onPress }: { glyph: 'back' | 'chevron'; hint: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityLabel={hint} accessibilityState={{ disabled }}>
      <View style={[styles.arrow, disabled && styles.arrowOff]}>
        <Icon name={glyph} size={icon.body} color={palette.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'flex-start', userSelect: 'none', WebkitTouchCallout: 'none' } as object,
  slot: { position: 'absolute', top: space.sm, left: '50%' },
  out: { opacity: 0 },
  dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.bg, borderRadius: radius.lg },
  floor: {
    position: 'absolute',
    bottom: 0,
    height: 60,
    borderRadius: 999,
    backgroundColor: alpha(palette.accent, 0.08),
    boxShadow: `0px 0px 60px ${alpha(palette.accent, 0.16)}`,
  } as object,
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg, marginTop: space.sm },
  arrow: {
    width: HIT,
    height: HIT,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.text, 0.06),
  },
  arrowOff: { opacity: 0.35 },
  count: { minWidth: 64, textAlign: 'center' },
  empty: { padding: space.xl, alignItems: 'center' },
});
