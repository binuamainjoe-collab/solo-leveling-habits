import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, Keyframe } from 'react-native-reanimated';

import { CollectibleCard } from '@/components/card/CollectibleCard';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { feedback } from '@/lib/feedback';
import { rarityMeta, type CardDef } from '@/data/cardRules';

interface Props {
  card: CardDef;
  onDismiss: () => void;
}

/**
 * The card spins in edge-on, like a trading card flicked onto a table: one and
 * a half turns on its Y axis, decelerating hard into a face-on stop.
 *
 * `perspective` has to lead the transform array or the Y rotation renders flat
 * instead of receding. Every keyframe repeats the array in the same order —
 * Reanimated requires that, and silently misbehaves otherwise. Time-based
 * rather than `.springify()`, which is unsupported on web.
 */
const CARD_SPIN_IN = new Keyframe({
  0: {
    opacity: 0,
    transform: [{ perspective: 1000 }, { scale: 0.26 }, { rotateY: '-540deg' }, { rotate: '-10deg' }],
  },
  40: {
    opacity: 1,
    transform: [{ perspective: 1000 }, { scale: 1.14 }, { rotateY: '-90deg' }, { rotate: '5deg' }],
    easing: Easing.out(Easing.cubic),
  },
  72: {
    opacity: 1,
    transform: [{ perspective: 1000 }, { scale: 0.97 }, { rotateY: '22deg' }, { rotate: '-2deg' }],
    easing: Easing.out(Easing.quad),
  },
  88: {
    opacity: 1,
    transform: [{ perspective: 1000 }, { scale: 1.01 }, { rotateY: '-8deg' }, { rotate: '0.5deg' }],
  },
  100: {
    opacity: 1,
    transform: [{ perspective: 1000 }, { scale: 1 }, { rotateY: '0deg' }, { rotate: '0deg' }],
  },
});

/**
 * Once it lands the card never sits perfectly still — it keeps tilting, the way
 * a foil card does when you turn it under a light. Runs on a nested view so it
 * doesn't fight the entrance keyframe for the same transform.
 */
const CARD_TILT = {
  '0%': { transform: [{ perspective: 1000 }, { rotateY: '-8deg' }, { rotateX: '2.5deg' }] },
  '50%': { transform: [{ perspective: 1000 }, { rotateY: '8deg' }, { rotateX: '-2.5deg' }] },
  '100%': { transform: [{ perspective: 1000 }, { rotateY: '-8deg' }, { rotateX: '2.5deg' }] },
};

const RAYS_SPIN = {
  '0%': { transform: [{ rotate: '0deg' }] },
  '100%': { transform: [{ rotate: '360deg' }] },
};

const SHOCKWAVE = {
  '0%': { transform: [{ scale: 0.2 }], opacity: 0.85 },
  '100%': { transform: [{ scale: 3 }], opacity: 0 },
};

type Ms = `${number}ms`;

export function CardRevealOverlay({ card, onDismiss }: Props) {
  const rarity = rarityMeta[card.rarity];
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - space.xl * 2, 330);

  useEffect(() => {
    feedback('fanfare', 'success');
  }, []);

  const particles = useMemo(() => {
    const count = rarity.particles;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.2;
      const distance = 130 + ((i * 41) % 110);
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      return {
        id: i,
        size: 2 + (i % 3),
        color: i % 2 === 0 ? rarity.glow : rarity.color,
        duration: `${950 + ((i * 57) % 520)}ms` as Ms,
        delay: `${180 + (i % 6) * 45}ms` as Ms,
        keyframes: {
          '0%': { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0 }], opacity: 0 },
          '20%': {
            transform: [{ translateX: dx * 0.3 }, { translateY: dy * 0.3 }, { scale: 1 }],
            opacity: 1,
          },
          '100%': {
            transform: [{ translateX: dx }, { translateY: dy }, { scale: 0 }],
            opacity: 0,
          },
        },
      };
    });
  }, [rarity]);

  return (
    <Animated.View
      entering={FadeIn.duration(240)}
      exiting={FadeOut.duration(200)}
      style={StyleSheet.absoluteFill}>
      <Pressable style={styles.scrim} onPress={onDismiss} accessibilityLabel="Add to collection">
        <View style={styles.stage} pointerEvents="none">
          <Animated.View
            style={[
              styles.rays,
              {
                animationName: RAYS_SPIN,
                animationDuration: '18000ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'linear',
              },
            ]}>
            {Array.from({ length: 14 }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.ray,
                  { backgroundColor: alpha(rarity.glow, 0.14), transform: [{ rotate: `${i * 12.85}deg` }] },
                ]}
              />
            ))}
          </Animated.View>

          <Animated.View
            style={[
              styles.shockwave,
              {
                borderColor: alpha(rarity.glow, 0.75),
                animationName: SHOCKWAVE,
                animationDuration: '1200ms',
                animationIterationCount: 1,
                animationTimingFunction: 'ease-out',
                animationFillMode: 'forwards',
              },
            ]}
          />

          {particles.map((p) => (
            <Animated.View
              key={p.id}
              style={[
                styles.particle,
                {
                  width: p.size,
                  height: p.size,
                  backgroundColor: p.color,
                  animationName: p.keyframes,
                  animationDuration: p.duration,
                  animationDelay: p.delay,
                  animationIterationCount: 1,
                  animationTimingFunction: 'ease-out',
                  animationFillMode: 'forwards',
                },
              ]}
            />
          ))}
        </View>

        <Animated.View entering={FadeIn.delay(120).duration(360)}>
          <SystemText variant="label" color={rarity.color} style={styles.kicker}>
            ◆ New card acquired ◆
          </SystemText>
        </Animated.View>

        <Animated.View entering={CARD_SPIN_IN.duration(1150)} style={{ width: cardWidth }}>
          <Animated.View
            style={{
              animationName: CARD_TILT,
              animationDuration: '5200ms',
              animationIterationCount: 'infinite',
              animationTimingFunction: 'ease-in-out',
              // Holds off until the spin has settled, so the two don't overlap.
              animationDelay: '1150ms',
            }}>
            <CollectibleCard card={card} owned size="hero" />
          </Animated.View>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(1250).duration(420)} style={styles.footer}>
          <View style={[styles.addPill, { borderColor: alpha(rarity.color, 0.6) }]}>
            <SystemText variant="label" color={rarity.color}>
              Added to your collection
            </SystemText>
          </View>
          <SystemText variant="label" style={styles.dismiss}>
            Tap anywhere to continue
          </SystemText>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.bg, 0.94),
    padding: space.xl,
    gap: space.lg,
  },
  stage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rays: { position: 'absolute', width: 520, height: 520, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 1.5, height: 520 },
  shockwave: { position: 'absolute', width: 220, height: 220, borderRadius: 110, borderWidth: 2 },
  particle: { position: 'absolute', borderRadius: 2 },
  kicker: { fontSize: 10, letterSpacing: 3 },
  footer: { alignItems: 'center', gap: space.md },
  addPill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 7,
  },
  dismiss: { fontSize: 9, letterSpacing: 2.5 },
});
