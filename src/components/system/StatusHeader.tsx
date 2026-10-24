import { StyleSheet, View } from 'react-native';

import { Ring } from '@/components/charts/Ring';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, icon, palette, radius, rankMeta, space } from '@/constants/theme';
import { useDayStats, useProgress } from '@/store/progress';

/**
 * The Player's status window: the level, as a ring that fills toward the
 * next one, with the rank, total XP and the three numbers that matter day
 * to day beside it.
 */
export function StatusHeader() {
  const { state } = useProgress();
  const { done, total, level, into, need, rank } = useDayStats();
  const ratio = need > 0 ? Math.min(1, into / need) : 0;
  const rankColor = rankMeta[rank].color;

  return (
    <View style={styles.card}>
      <Ring size={132} stroke={12} ratio={ratio} colors={[gradient.ember[0], gradient.ember[2]]}>
        <SystemText variant="meta">Level</SystemText>
        <SystemText variant="numeral" style={styles.level} accessibilityLabel={`Level ${level}`}>
          {level}
        </SystemText>
      </Ring>

      <View style={styles.side}>
        <View style={styles.rankRow}>
          <View style={[styles.rank, { borderColor: alpha(rankColor, 0.6), backgroundColor: alpha(rankColor, 0.12) }]}>
            <SystemText variant="title" color={rankColor} style={styles.rankText}>
              {rank}-rank
            </SystemText>
          </View>
          <SystemText variant="meta">{state.xp.toLocaleString('en-US')} XP in all</SystemText>
        </View>
        <SystemText variant="body" color={palette.text}>
          {(need - into).toLocaleString('en-US')} XP to level {level + 1}
        </SystemText>

        <View style={styles.stats}>
          <Stat label="Streak" value={`${state.streak} ${state.streak === 1 ? 'day' : 'days'}`} flame tint={palette.accentSoft} />
          <Stat label="Best" value={`${state.bestStreak} ${state.bestStreak === 1 ? 'day' : 'days'}`} tint={palette.gold} />
          <Stat label="Today" value={`${done} of ${total}`} tint={done === total && total > 0 ? palette.positive : palette.text} />
        </View>
      </View>
    </View>
  );
}

function Stat({ label, value, tint, flame }: { label: string; value: string; tint: string; flame?: boolean }) {
  return (
    <View style={styles.stat}>
      <SystemText variant="meta">{label}</SystemText>
      <View style={styles.statValue}>
        {flame ? <Icon name="flame" size={icon.small} color={tint} /> : null}
        <SystemText variant="title" color={tint} numberOfLines={1}>
          {value}
        </SystemText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xl,
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.18),
    padding: space.xl,
    marginBottom: space.lg,
  },
  level: { fontSize: 40, lineHeight: 44 },
  side: { flex: 1, minWidth: 200, gap: space.sm },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  rank: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
  rankText: { fontSize: 15 },
  stats: {
    flexDirection: 'row',
    gap: space.lg,
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.borderStrong,
  },
  stat: { flex: 1, gap: 2 },
  statValue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
