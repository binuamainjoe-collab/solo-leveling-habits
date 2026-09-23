import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { tierMeta, type AchievementDef } from '@/data/achievements';

interface Props {
  achievement: AchievementDef;
  unlocked: boolean;
  current: number;
  goal: number;
}

/* Keyframes at module scope so they aren't rebuilt on every render. */

/** Diagonal highlight that sweeps across an unlocked card, forever. */
const SHIMMER = {
  '0%': { transform: [{ translateX: -280 }, { rotate: '16deg' }], opacity: 0 },
  '15%': { transform: [{ translateX: -150 }, { rotate: '16deg' }], opacity: 1 },
  '85%': { transform: [{ translateX: 220 }, { rotate: '16deg' }], opacity: 1 },
  '100%': { transform: [{ translateX: 340 }, { rotate: '16deg' }], opacity: 0 },
};

/** Slow breathing glow behind the tier glyph. */
const PULSE = {
  '0%': { opacity: 0.28, transform: [{ scale: 1 }] },
  '50%': { opacity: 0.72, transform: [{ scale: 1.14 }] },
  '100%': { opacity: 0.28, transform: [{ scale: 1 }] },
};

function AchievementCardBase({ achievement: a, unlocked, current, goal }: Props) {
  const tier = tierMeta[a.tier];
  const ratio = goal > 0 ? Math.min(1, current / goal) : 0;
  const hidden = Boolean(a.secret) && !unlocked;

  const title = hidden ? '???' : a.title;
  const requirement = hidden ? 'Hidden objective' : a.requirement;

  // Stagger the sweep so a grid of cards doesn't shimmer in lockstep.
  const delay = useMemo<`${number}ms`>(() => `${(hashCode(a.id) % 24) * 190}ms`, [a.id]);

  return (
    <Card
      // An unlocked card takes its tier's tint across the whole frame, the way
      // Life Reset tints its Gold rank card.
      tint={unlocked ? tier.color : undefined}
      style={[styles.card, !unlocked && styles.locked]}
      contentStyle={styles.inner}>
      {unlocked ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={[
              styles.shimmer,
              {
                animationName: SHIMMER,
                animationDuration: '2800ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
                animationDelay: delay,
              },
            ]}>
            <LinearGradient
              colors={['transparent', alpha(tier.glowA, 0.3), 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        </View>
      ) : null}

      <View style={styles.row}>
        <View style={styles.medallion}>
          {unlocked ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.halo,
                {
                  backgroundColor: alpha(tier.glowA, 0.45),
                  animationName: PULSE,
                  animationDuration: '2600ms',
                  animationIterationCount: 'infinite',
                  animationTimingFunction: 'ease-in-out',
                },
              ]}
            />
          ) : null}
          <SystemText variant="heading" style={[styles.glyph, !unlocked && styles.glyphLocked]}>
            {hidden ? '?' : unlocked ? a.glyph : '🔒'}
          </SystemText>
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <SystemText
              variant="title"
              color={unlocked ? tier.color : palette.textMuted}
              numberOfLines={2}
              style={styles.title}>
              {title}
            </SystemText>
            <View
              style={[
                styles.tierChip,
                { borderColor: alpha(tier.color, unlocked ? 0.6 : 0.22) },
                unlocked && { backgroundColor: alpha(tier.color, 0.16) },
              ]}>
              <SystemText variant="label" color={unlocked ? tier.color : palette.textFaint}>
                {tier.label}
              </SystemText>
            </View>
          </View>

          <SystemText variant="body" numberOfLines={2} style={styles.requirement}>
            {requirement}
          </SystemText>

          {unlocked ? (
            <View style={styles.unlockedRow}>
              <SystemText variant="label" color={palette.positive}>
                ✓ Unlocked
              </SystemText>
              <SystemText variant="label" color={palette.accent}>
                +{a.xp.toLocaleString('en-US')} XP
              </SystemText>
            </View>
          ) : hidden ? (
            // A hidden objective shows no bar: revealing progress toward a
            // secret would give the secret away.
            <SystemText variant="label" color={alpha(tier.color, 0.75)} style={styles.hiddenNote}>
              ✦ Discover to reveal
            </SystemText>
          ) : (
            <View style={styles.progressWrap}>
              <View style={styles.track}>
                <Animated.View
                  style={[
                    styles.fill,
                    {
                      backgroundColor: tier.color,
                      transform: [{ scaleX: ratio }],
                      transformOrigin: 'left center',
                      transitionProperty: 'transform',
                      transitionDuration: 520,
                      transitionTimingFunction: 'ease-out',
                    },
                  ]}
                />
              </View>
              <SystemText variant="label" style={styles.progressText}>
                {compact(current)} / {compact(goal)}
              </SystemText>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}

function compact(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

/** Tiny deterministic hash, used only to stagger animation delays. */
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

const styles = StyleSheet.create({
  card: { marginBottom: space.md },
  locked: { opacity: 0.75 },
  inner: { padding: space.lg },
  shimmer: { position: 'absolute', top: -60, bottom: -60, width: 100 },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  medallion: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    // A real blur is costly per-card in a long list; a soft disc reads the
    // same at this size.
  },
  glyph: { fontSize: 28, lineHeight: 34 },
  glyphLocked: { opacity: 0.45 },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1, minWidth: 0 },
  tierChip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  requirement: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  unlockedRow: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  hiddenNote: { marginTop: space.sm },
  progressWrap: { marginTop: space.sm, gap: space.xs },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: alpha(palette.text, 0.12),
    overflow: 'hidden',
  },
  fill: { height: '100%', width: '100%' },
  progressText: { fontSize: 10, color: palette.textMuted },
});

export const AchievementCard = memo(AchievementCardBase);
