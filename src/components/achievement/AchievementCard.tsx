import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Medal, medalGlow } from '@/components/achievement/Medal';
import { Card } from '@/components/system/Card';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, icon, palette, radius, space } from '@/constants/theme';
import { tierMeta, type AchievementDef } from '@/data/achievements';

interface Props {
  achievement: AchievementDef;
  unlocked: boolean;
  current: number;
  goal: number;
}

function AchievementCardBase({ achievement: a, unlocked, current, goal }: Props) {
  const tier = tierMeta[a.tier];
  const ratio = goal > 0 ? Math.min(1, current / goal) : 0;
  const hidden = Boolean(a.secret) && !unlocked;

  const title = hidden ? '???' : a.title;
  const requirement = hidden ? 'Hidden objective' : a.requirement;

  return (
    <Card
      // An unlocked card takes its tier's tint across the whole frame, the way
      // Life Reset tints its Gold rank card.
      tint={unlocked ? tier.color : undefined}
      style={[styles.card, !unlocked && styles.locked]}
      contentStyle={styles.inner}>
      <View style={styles.row}>
        {/* The trophy as a medal in its metal, the glyph struck on its face.
            Flick it to spin it; it stands still otherwise. Locked ones are
            iron with a lock, secrets carry a question mark. */}
        <View style={styles.medallion}>
          {unlocked ? (
            <View
              pointerEvents="none"
              style={[styles.halo, { backgroundColor: alpha(medalGlow(a.tier, true), 0.16), boxShadow: `0px 0px 22px ${alpha(medalGlow(a.tier, true), 0.4)}` } as object]}
            />
          ) : null}
          <Medal size={52} tier={a.tier} glyph={a.glyph} xp={a.xp} unlocked={unlocked} hidden={hidden} />
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
              <View style={styles.unlockedTag}>
                <Icon name="check" size={icon.small} color={palette.positive} />
                <SystemText variant="label" color={palette.positive}>
                  Unlocked
                </SystemText>
              </View>
              <SystemText variant="label" color={palette.accent}>
                +{a.xp.toLocaleString('en-US')} XP
              </SystemText>
            </View>
          ) : hidden ? (
            // A hidden objective shows no bar: revealing progress toward a
            // secret would give the secret away.
            <SystemText variant="label" color={alpha(tier.color, 0.75)} style={styles.hiddenNote}>
              Discover to reveal
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

const styles = StyleSheet.create({
  card: { marginBottom: space.md },
  locked: { opacity: 0.75 },
  inner: { padding: space.lg },
  row: { flexDirection: 'row', gap: space.lg, alignItems: 'center' },
  medallion: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 44, height: 44, borderRadius: 22 },
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
  unlockedTag: { flexDirection: 'row', alignItems: 'center', gap: 3 },
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
