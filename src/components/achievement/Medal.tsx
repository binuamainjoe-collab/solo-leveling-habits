import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  cubicBezier,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Defs, G, Line, LinearGradient as SvgGradient, RadialGradient, Stop, Text } from 'react-native-svg';

import { useTabsMotion } from '@/components/motion/SwipeTabs';
import { Icon } from '@/components/system/Icon';
import { display, palette } from '@/constants/theme';
import type { Tier } from '@/data/achievements';
import { restTurn } from '@/lib/collection';
import { haptic } from '@/lib/feedback';

/** Light, body and shadow of each metal. Locked medals are plain iron. */
const METAL: Record<Tier | 'iron', [string, string, string]> = {
  bronze: ['#F3BE8A', '#C8763C', '#6E3C1C'],
  silver: ['#F6F9FD', '#B8C6DC', '#66768F'],
  gold: ['#FFE9A8', '#D9A441', '#7E540F'],
  mythic: ['#FFD3A3', '#FF7020', '#8C280B'],
  iron: ['#62544A', '#3B3029', '#1D1712'],
};

/** How thick the coin is, as a share of its width. */
const THICK = 0.1;
/** Degrees a medal turns per px a finger drags it. */
const PER_PX = 2.2;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

interface FaceProps {
  size: number;
  metal: [string, string, string];
  /** What is struck on the front: the trophy's glyph, or '?' for a secret. */
  glyph?: string;
  /** What is struck on the back. */
  back?: { label: string; xp: string };
}

/**
 * One face of a medal, struck in its metal: a bevelled rim catching the light
 * from the upper left, a ring of fine notches, and the glyph in the field.
 * The back carries the tier and what it was worth.
 */
function Face({ size, metal, glyph, back }: FaceProps) {
  const id = useId().replace(/:/g, '');
  const [light, body, shadow] = metal;
  const notches = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * Math.PI * 2;
        return { x1: 50 + Math.cos(a) * 41, y1: 50 + Math.sin(a) * 41, x2: 50 + Math.cos(a) * 43.2, y2: 50 + Math.sin(a) * 43.2 };
      }),
    [],
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <SvgGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={light} />
          <Stop offset="0.45" stopColor={body} />
          <Stop offset="1" stopColor={shadow} />
        </SvgGradient>
        <SvgGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={shadow} />
          <Stop offset="0.55" stopColor={body} />
          <Stop offset="1" stopColor={light} />
        </SvgGradient>
        <RadialGradient id={`${id}f`} cx="40%" cy="34%" r="72%">
          <Stop offset="0" stopColor={light} stopOpacity={0.9} />
          <Stop offset="0.5" stopColor={body} />
          <Stop offset="1" stopColor={shadow} />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="48" fill={`url(#${id}r)`} />
      <Circle cx="50" cy="50" r="44.5" fill={`url(#${id}b)`} />
      <Circle cx="50" cy="50" r="40" fill={`url(#${id}f)`} />
      <G stroke={shadow} strokeOpacity={0.45} strokeWidth={0.9}>
        {notches.map((n, i) => (
          <Line key={i} {...n} />
        ))}
      </G>
      <Circle cx="50" cy="50" r="34" fill="none" stroke={light} strokeOpacity={0.35} strokeWidth={0.8} />
      {glyph ? (
        <Text x="50" y="50" dy="11" textAnchor="middle" fontSize={glyph === '?' ? 34 : 30} fontFamily={display.bold} fill={shadow}>
          {glyph}
        </Text>
      ) : null}
      {back ? (
        <>
          <Text x="50" y="42" textAnchor="middle" fontSize={9} letterSpacing={1.6} fontFamily={display.semibold} fill={shadow}>
            {back.label}
          </Text>
          {/* Struck: a light edge under the figures, so they sit in the metal. */}
          <Text x="50" y="63.8" textAnchor="middle" fontSize={15} fontFamily={display.bold} fill={light} fillOpacity={0.55}>
            {back.xp}
          </Text>
          <Text x="50" y="63" textAnchor="middle" fontSize={15} fontFamily={display.bold} fill={shadow}>
            {back.xp}
          </Text>
        </>
      ) : null}
    </Svg>
  );
}

export interface MedalProps {
  size: number;
  tier: Tier;
  glyph: string;
  xp: number;
  unlocked: boolean;
  /** A secret not yet found: a question mark, no glyph. */
  hidden?: boolean;
  /** Turns it starts at and spins down from, for the forging; 0 to stand still. */
  arrive?: { from: number; delay: number; duration: number };
  /** Whether a finger may spin it. */
  spinnable?: boolean;
  /** Fresh from the forge: it starts white-hot and cools to its metal over this long, in ms. */
  cooling?: { delay: number; duration: number };
}

/** White-hot to nothing, as the metal underneath shows through. */
const COOL = { from: { opacity: 1 }, to: { opacity: 0 } };
const COOL_EASE = cubicBezier(0.33, 1, 0.68, 1);

/**
 * A trophy as a medal you can spin: flick it sideways and it turns on its
 * edge, carrying the flick, and comes to rest on whichever face it was
 * heading for. Tapping gives it one full turn. As it turns, its edge shows,
 * light slides across its face, and the back tells the tier and the XP.
 */
export function Medal({ size, tier, glyph, xp, unlocked, hidden, arrive, spinnable = true, cooling }: MedalProps) {
  const metal = METAL[unlocked ? tier : 'iron'];
  const turn = useSharedValue(arrive ? arrive.from : 0);
  const start = useSharedValue(0);
  const reduced = useReducedMotion();
  const pager = useTabsMotion()?.pager ?? null;
  const thick = size * THICK;

  useEffect(() => {
    if (!arrive) return;
    if (reduced) {
      turn.set(0);
      return;
    }
    turn.set(withDelay(arrive.delay, withTiming(0, { duration: arrive.duration, easing: EASE_OUT })));
  }, [arrive, reduced, turn]);

  const gesture = useMemo(() => {
    const spin = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetX([-8, 8])
      .failOffsetY([-10, 10])
      .onStart(() => {
        cancelAnimation(turn);
        start.set(turn.get());
      })
      .onUpdate((e) => {
        turn.set(start.get() + e.translationX * PER_PX);
      })
      .onEnd((e) => {
        const velocity = e.velocityX * PER_PX;
        turn.set(withSpring(restTurn(turn.get(), velocity), { duration: 700, dampingRatio: 0.85, velocity }));
        scheduleOnRN(haptic, 'tick');
      });
    const tap = Gesture.Tap().onEnd((_e, ok) => {
      if (!ok) return;
      // One whole turn from whichever face is showing.
      const from = Math.round(turn.get() / 180) * 180;
      turn.set(withTiming(from + 360, { duration: 900, easing: EASE_OUT }));
    });
    const both = Gesture.Race(pager ? spin.blocksExternalGesture(pager) : spin, tap);
    return both;
  }, [pager, start, turn]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: size * 6 }, { rotateY: `${turn.get()}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => {
    const s = Math.sin((turn.get() * Math.PI) / 180);
    return { transform: [{ translateX: -thick * s }, { perspective: size * 6 }, { rotateY: `${turn.get() + 180}deg` }] };
  });
  // The coin's body behind whichever face shows: as wide as the face seen at
  // this angle plus the edge, so turning it shows its thickness.
  const bodyStyle = useAnimatedStyle(() => {
    const r = (turn.get() * Math.PI) / 180;
    const c = Math.abs(Math.cos(r));
    const s = Math.sin(r);
    const w = Math.min(1, c + (THICK * Math.abs(s)) * 1.0);
    return { transform: [{ translateX: (-thick * s) / 2 }, { scaleX: Math.max(0.02, w) }] };
  });
  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -Math.sin((turn.get() * Math.PI) / 180) * size * 0.9 }, { rotate: '18deg' }],
  }));

  // The heat sits on each face, so it turns with the medal as it cools.
  const heat =
    cooling && !reduced ? (
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            animationName: COOL,
            animationDuration: `${cooling.duration}ms`,
            animationDelay: `${cooling.delay}ms`,
            animationTimingFunction: COOL_EASE,
            animationFillMode: 'both',
          } as object,
        ]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id="medal-heat" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFF8EC" />
              <Stop offset="0.55" stopColor="#FFD08A" />
              <Stop offset="1" stopColor="#FF7020" />
            </RadialGradient>
          </Defs>
          <Circle cx="50" cy="50" r="50" fill="url(#medal-heat)" />
        </Svg>
      </Animated.View>
    ) : null;

  const sheen = (
    <Animated.View pointerEvents="none" style={[styles.sheen, { width: size * 0.5, left: size * 0.25 }, sheenStyle]}>
      <LinearGradient
        colors={['rgba(255,248,236,0)', 'rgba(255,248,236,0.42)', 'rgba(255,248,236,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );

  const coin = (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={spinnable ? 'Spin the medal' : undefined}>
      <Animated.View style={[styles.layer, styles.round, { width: size, height: size }, bodyStyle]}>
        <LinearGradient colors={[metal[2], metal[1], metal[2]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[styles.layer, styles.face, styles.round, { width: size, height: size }, backStyle]}>
        <Face size={size} metal={metal} back={{ label: tier.toUpperCase(), xp: `+${xp >= 1000 ? `${Math.round(xp / 100) / 10}k` : xp}` }} />
        {heat}
      </Animated.View>
      <Animated.View style={[styles.layer, styles.face, styles.round, { width: size, height: size }, frontStyle]}>
        <Face size={size} metal={metal} glyph={hidden ? '?' : unlocked ? glyph : undefined} />
        {!unlocked && !hidden ? (
          <View style={[styles.layer, styles.centre, { width: size, height: size }]}>
            <Icon name="lock" size={Math.round(size * 0.34)} color={metal[2]} />
          </View>
        ) : null}
        {heat}
        {sheen}
      </Animated.View>
    </View>
  );

  if (!spinnable) return coin;
  return (
    <GestureDetector gesture={gesture} touchAction="pan-y">
      {coin}
    </GestureDetector>
  );
}

/** A medal's soft light behind it, in its metal, standing still. */
export function medalGlow(tier: Tier, unlocked: boolean): string {
  return unlocked ? METAL[tier][1] : palette.border;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
  face: { backfaceVisibility: 'hidden' },
  round: { borderRadius: 999, overflow: 'hidden' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  sheen: { position: 'absolute', top: '-30%', bottom: '-30%' },
});
