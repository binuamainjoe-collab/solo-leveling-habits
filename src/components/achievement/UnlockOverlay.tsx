import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, FadeIn, FadeOut, Keyframe } from 'react-native-reanimated';

import { ForgedMedal } from '@/components/achievement/ForgedMedal';
import { Scramble } from '@/components/motion/Scramble';
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

/**
 * A trophy won: its plaque arrives and the medal is forged at its head, out
 * of the fire white-hot and spinning, cooling to its metal as it comes to
 * face you. Once it has landed it can be spun like the ones in the hall.
 * Tap anywhere else to continue.
 */
export function UnlockOverlay({ achievement: a, onDismiss }: Props) {
  const tier = tierMeta[a.tier];
  const { width } = useWindowDimensions();
  const plaqueWidth = Math.min(width - space.xl * 2, 420);

  useEffect(() => {
    feedback('fanfare', 'success');
  }, []);

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(200)}
      style={StyleSheet.absoluteFill}>
      <View style={styles.scrim}>
        {/* Tapping anywhere continues; the medal above it takes its own taps, to spin. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Dismiss" />
        <Animated.View
          pointerEvents="box-none"
          entering={PLAQUE_ENTER.duration(720)}
          style={[styles.plaque, { width: plaqueWidth, borderColor: alpha(tier.color, 0.6) }]}>
          <LinearGradient
            colors={[alpha(tier.color, 0.22), alpha(palette.surface, 0.97), alpha(tier.glowB, 0.16)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />

          <Animated.View pointerEvents="none" entering={FadeIn.delay(260).duration(400)}>
            <Scramble variant="label" color={tier.color} style={styles.kicker} delay={260}>
              Achievement unlocked
            </Scramble>
          </Animated.View>

          <View style={styles.plaqueGlyph}>
            <ForgedMedal achievement={a} size={104} />
          </View>

          <Animated.View pointerEvents="none" entering={FadeIn.delay(360).duration(420)} style={styles.plaqueBody}>
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

          <Animated.View pointerEvents="none" entering={FadeIn.delay(900).duration(500)}>
            <SystemText variant="label" style={styles.dismiss}>
              Tap anywhere to continue
            </SystemText>
          </Animated.View>
        </Animated.View>
      </View>
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
