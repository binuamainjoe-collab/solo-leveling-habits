import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlatList, RectButton } from 'react-native-gesture-handler';

import { AchievementCard } from '@/components/achievement/AchievementCard';
import { useContentWidth } from '@/components/system/Screen';
import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { ACHIEVEMENTS, tierMeta, type AchievementDef, type Tier } from '@/data/achievements';
import { achievementProgress, useProgress } from '@/store/progress';

type Filter = 'all' | 'unlocked' | 'locked' | Tier;

const FILTERS: { key: Filter; label: string; color: string }[] = [
  { key: 'all', label: 'ALL', color: palette.accent },
  { key: 'unlocked', label: 'UNLOCKED', color: palette.positive },
  { key: 'locked', label: 'LOCKED', color: palette.textMuted },
  { key: 'bronze', label: 'BRONZE', color: tierMeta.bronze.color },
  { key: 'silver', label: 'SILVER', color: tierMeta.silver.color },
  { key: 'gold', label: 'GOLD', color: tierMeta.gold.color },
  { key: 'mythic', label: 'MYTHIC', color: tierMeta.mythic.color },
];

/**
 * The trophy hall, as one half of the Collection tab.
 *
 * Was its own tab until the Planner needed the slot; the content is
 * unchanged, only the screen wrapper and title moved up to the tab.
 */
export function TrophiesPanel() {
  const { state } = useProgress();
  const { width, columns } = useContentWidth();
  const [filter, setFilter] = useState<Filter>('all');

  const unlockedSet = useMemo(() => new Set(state.unlocked), [state.unlocked]);

  const data = useMemo(() => {
    const sorted = [...ACHIEVEMENTS].sort((a, b) => {
      // Unlocked float to the top; within a group, closest to completion first.
      const ua = unlockedSet.has(a.id) ? 0 : 1;
      const ub = unlockedSet.has(b.id) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return ratioFor(b) - ratioFor(a);

      // Secrets sort last among locked: their tracks are placeholders, so a
      // real ratio would rank them above genuinely near-complete achievements.
      function ratioFor(x: AchievementDef) {
        if (x.secret && !unlockedSet.has(x.id)) return -1;
        const p = achievementProgress(x, state);
        return p.goal > 0 ? Math.min(1, p.current / p.goal) : 0;
      }
    });

    switch (filter) {
      case 'all':
        return sorted;
      case 'unlocked':
        return sorted.filter((a) => unlockedSet.has(a.id));
      case 'locked':
        return sorted.filter((a) => !unlockedSet.has(a.id));
      default:
        return sorted.filter((a) => a.tier === filter);
    }
  }, [filter, state, unlockedSet]);

  const gap = space.md;
  const cardWidth = columns === 1 ? undefined : (width - gap * (columns - 1)) / columns;

  const renderItem = useCallback(
    ({ item }: { item: AchievementDef }) => {
      const { current, goal } = achievementProgress(item, state);
      return (
        <View style={cardWidth ? { width: cardWidth } : styles.cellFull}>
          <AchievementCard
            achievement={item}
            unlocked={unlockedSet.has(item.id)}
            current={current}
            goal={goal}
          />
        </View>
      );
    },
    [state, unlockedSet, cardWidth],
  );

  const totalXp = ACHIEVEMENTS.filter((a) => unlockedSet.has(a.id)).reduce((s, a) => s + a.xp, 0);

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Card contentStyle={styles.summary}>
          <View style={styles.summaryItem}>
            <SystemText variant="label">UNLOCKED</SystemText>
            <SystemText variant="numeral" color={palette.gold} numberOfLines={1} style={styles.summaryValue}>
              {unlockedSet.size}
              <SystemText variant="label" style={styles.of}>
                {' '}
                / {ACHIEVEMENTS.length}
              </SystemText>
            </SystemText>
          </View>
          <View style={[styles.divider, { backgroundColor: alpha(palette.gold, 0.25) }]} />
          <View style={styles.summaryItem}>
            <SystemText variant="label">TROPHY XP</SystemText>
            <SystemText variant="numeral" color={palette.gold} numberOfLines={1} style={styles.summaryValue}>
              {totalXp.toLocaleString('en-US')}
            </SystemText>
          </View>
          <View style={[styles.divider, { backgroundColor: alpha(palette.gold, 0.25) }]} />
          <View style={styles.summaryItem}>
            <SystemText variant="label">MYTHIC</SystemText>
            <SystemText variant="numeral" color={tierMeta.mythic.color} numberOfLines={1} style={styles.summaryValue}>
              {ACHIEVEMENTS.filter((a) => a.tier === 'mythic' && unlockedSet.has(a.id)).length}
            </SystemText>
          </View>
        </Card>
      </View>

      {/* A wrapping row rather than a horizontal ScrollView: RN Web squeezes a
          horizontal scroller inside a flex column until its chips clip, and
          with this few filters wrapping shows them all at once anyway. */}
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <RectButton
            key={f.key}
            onPress={() => setFilter(f.key)}
            rippleColor={alpha(f.color, 0.2)}
            accessibilityRole="button"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: filter === f.key }}
            style={[
              styles.chip,
              { borderColor: alpha(f.color, filter === f.key ? 0.8 : 0.25) },
              filter === f.key && { backgroundColor: alpha(f.color, 0.14) },
            ]}>
            <SystemText variant="label" color={filter === f.key ? f.color : palette.textFaint}>
              {f.label}
            </SystemText>
          </RectButton>
        ))}
      </View>

      <FlatList
        key={`cols-${columns}`}
        data={data}
        renderItem={renderItem}
        keyExtractor={(a) => a.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap } : undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={8}
        windowSize={5}
        ListEmptyComponent={
          <Card>
            <SystemText variant="body">Nothing in this category yet.</SystemText>
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  head: { marginBottom: space.lg },
  summary: { flexDirection: 'row', alignItems: 'center', padding: space.lg },
  summaryItem: { flex: 1, gap: 2, minWidth: 0 },
  // 40px numerals overflow a third of a phone screen once XP hits four digits.
  summaryValue: { fontSize: 24, lineHeight: 30, letterSpacing: -0.8 },
  of: { fontSize: 12, color: palette.textFaint },
  divider: { width: 1, alignSelf: 'stretch', marginHorizontal: space.md },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.lg,
  },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 7 },
  list: { paddingBottom: space.xxl * 2 },
  cellFull: { width: '100%' },
});
