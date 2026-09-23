import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, Keyframe } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { feedback } from '@/lib/feedback';
import { tierMeta, type AchievementDef } from '@/data/achievements';

interface Props {
  achievement: AchievementDef;
  onDismiss: () => void;
}

/**
 * Entrance for the plaque. Time-based rather than `.springify()` — spring
 * layout animations are unsupported on web, and web is a first-class target.
 */
const PLAQUE_ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.55 }, { rotate: '-5deg' }] },
  55: {
    opacity: 1,
    transform: [{ scale: 1.06 }, { rotate: '1.5deg' }],
    easing: Easing.out(Easing.cubic),
  },
  100: { opacity: 1, transform: [{ scale: 1 }, { rotate: '0deg' }] },
});

const RAYS_SPIN = {
  '0%': { transform: [{ rotate: '0deg' }] },
  '100%': { transform: [{ rotate: '360deg' }] },
};

const SHOCKWAVE = {
  '0%': { transform: [{ scale: 0.2 }], opacity: 0.9 },
  '100%': { transform: [{ scale: 2.7 }], opacity: 0 },
};

const GLYPH_PULSE = {
  '0%': { transform: [{ scale: 1 }] },
  '50%': { transform: [{ scale: 1.09 }] },
  '100%': { transform: [{ scale: 1 }] },
};

/** Reanimated's TimeUnit accepts `${number}ms`, not a widened `string`. */
type Ms = `${number}ms`;

export function UnlockOverlay({ achievement: a, onDismiss }: Props) {
  const tier = tierMeta[a.tier];
  const { width } = useWindowDimensions();
  const plaqueWidth = Math.min(width - space.xl * 2, 420);

  useEffect(() => {
    feedback('fanfare', 'success');
  }, []);

  // One keyframe set per particle: each flies out along its own angle.
  const particles = useMemo(() => {
    const count = tier.particles;
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.18;
      const distance = 110 + ((i * 37) % 90);
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;
      return {
        id: i,
        size: 2 + (i % 3),
        color: i % 2 === 0 ? tier.glowA : tier.color,
        duration: `${900 + ((i * 53) % 500)}ms` as Ms,
        delay: `${(i % 6) * 45}ms` as Ms,
        keyframes: {
          '0%': { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0 }], opacity: 0 },
          '18%': {
            transform: [{ translateX: dx * 0.28 }, { translateY: dy * 0.28 }, { scale: 1 }],
            opacity: 1,
          },
          '100%': {
            transform: [{ translateX: dx }, { translateY: dy }, { scale: 0 }],
            opacity: 0,
          },
        },
      };
    });
  }, [tier]);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(200)}
      style={StyleSheet.absoluteFill}>
      <Pressable style={styles.scrim} onPress={onDismiss} accessibilityLabel="Dismiss">
        <View style={styles.stage} pointerEvents="none">
          <Animated.View
            style={[
              styles.rays,
              {
                animationName: RAYS_SPIN,
                animationDuration: '15000ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'linear',
              },
            ]}>
            {Array.from({ length: 12 }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.ray,
                  { backgroundColor: alpha(tier.glowA, 0.12), transform: [{ rotate: `${i * 15}deg` }] },
                ]}
              />
            ))}
          </Animated.View>

          <Animated.View
            style={[
              styles.shockwave,
              {
                borderColor: alpha(tier.glowA, 0.7),
                animationName: SHOCKWAVE,
                animationDuration: '1100ms',
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

        <Animated.View
          entering={PLAQUE_ENTER.duration(720)}
          style={[styles.plaque, { width: plaqueWidth, borderColor: alpha(tier.color, 0.6) }]}>
          <LinearGradient
            colors={[alpha(tier.color, 0.22), alpha(palette.surface, 0.97), alpha(tier.glowB, 0.16)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          <Animated.View entering={FadeIn.delay(260).duration(400)}>
            <SystemText variant="label" color={tier.color} style={styles.kicker}>
              Achievement unlocked
            </SystemText>
          </Animated.View>

          <Animated.View
            style={[
              styles.plaqueGlyph,
              {
                animationName: GLYPH_PULSE,
                animationDuration: '2000ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
              },
            ]}>
            <SystemText variant="hero" style={styles.bigGlyph}>
              {a.glyph}
            </SystemText>
          </Animated.View>

          <Animated.View entering={FadeIn.delay(360).duration(420)} style={styles.plaqueBody}>
            <SystemText variant="hero" color={tier.color} glow style={styles.plaqueTitle}>
              {a.title}
            </SystemText>

            <View style={[styles.divider, { backgroundColor: alpha(tier.color, 0.45) }]} />

            <SystemText variant="body" style={styles.flavor}>
              {a.flavor}
            </SystemText>

            <View style={styles.rewardRow}>
              <View style={[styles.tierPill, { backgroundColor: alpha(tier.color, 0.18), borderColor: alpha(tier.color, 0.5) }]}>
                <SystemText variant="label" color={tier.color}>
                  {tier.label} tier
                </SystemText>
              </View>
              <View style={styles.xpPill}>
                <SystemText variant="label" color={palette.bg}>
                  +{a.xp.toLocaleString('en-US')} XP
                </SystemText>
              </View>
            </View>
          </Animated.View>

          <Animated.View entering={FadeIn.delay(900).duration(500)}>
            <SystemText variant="label" style={styles.dismiss}>
              Tap anywhere to continue
            </SystemText>
          </Animated.View>
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
    backgroundColor: alpha(palette.bg, 0.92),
    padding: space.xl,
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
  rays: { position: 'absolute', width: 460, height: 460, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 1.5, height: 460 },
  shockwave: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 2 },
  particle: { position: 'absolute', borderRadius: 2 },
  plaque: {
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    overflow: 'hidden',
    boxShadow: '0px 24px 70px rgba(0,0,0,0.65)',
  },
  kicker: { fontSize: 10, letterSpacing: 3 },
  plaqueGlyph: { marginVertical: space.lg },
  bigGlyph: { fontSize: 60, lineHeight: 72 },
  plaqueBody: { alignItems: 'center', gap: space.md },
  plaqueTitle: { fontSize: 30, textAlign: 'center', letterSpacing: 0.5 },
  divider: { width: 64, height: 2, borderRadius: 1 },
  flavor: { fontSize: 15, lineHeight: 21, textAlign: 'center', color: palette.textMuted },
  rewardRow: { flexDirection: 'row', gap: space.md, marginTop: space.sm, alignItems: 'center' },
  tierPill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 5 },
  xpPill: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  dismiss: { marginTop: space.xxl, fontSize: 9, letterSpacing: 2.5 },
});
