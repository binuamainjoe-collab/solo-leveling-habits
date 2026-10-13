import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlatList, RectButton } from 'react-native-gesture-handler';

import { CollectibleCard } from '@/components/card/CollectibleCard';
import { Card } from '@/components/system/Card';
import { useContentWidth } from '@/components/system/Screen';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { CARDS, rarityMeta, type CardDef, type Rarity } from '@/data/cards';
import { useProgress } from '@/store/progress';

type Filter = 'all' | 'owned' | 'locked' | Rarity;

const FILTERS: { key: Filter; label: string; color: string }[] = [
  { key: 'all', label: 'ALL', color: palette.accent },
  { key: 'owned', label: 'OWNED', color: palette.positive },
  { key: 'locked', label: 'LOCKED', color: palette.textMuted },
  { key: 'rare', label: 'RARE', color: rarityMeta.rare.color },
  { key: 'epic', label: 'EPIC', color: rarityMeta.epic.color },
  { key: 'legendary', label: 'LEGENDARY', color: rarityMeta.legendary.color },
  { key: 'mythic', label: 'MYTHIC', color: rarityMeta.mythic.color },
];

/** Rarest first, then owned before locked, so the good stuff leads. */
const RARITY_ORDER: Rarity[] = ['mythic', 'legendary', 'epic', 'rare', 'common'];

/**
 * The card collection, as one half of the Collection tab.
 *
 * Was its own tab until the Planner needed the slot; the content is
 * unchanged, only the screen wrapper and title moved up to the tab.
 */
export function CardsPanel() {
  const { state } = useProgress();
  const { width, columns } = useContentWidth();
  const [filter, setFilter] = useState<Filter>('all');

  const owned = useMemo(() => new Set(state.cards), [state.cards]);

  const data = useMemo(() => {
    const sorted = [...CARDS].sort((a, b) => {
      const oa = owned.has(a.id) ? 0 : 1;
      const ob = owned.has(b.id) ? 0 : 1;
      if (oa !== ob) return oa - ob;
      return RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
    });

    switch (filter) {
      case 'all':
        return sorted;
      case 'owned':
        return sorted.filter((c) => owned.has(c.id));
      case 'locked':
        return sorted.filter((c) => !owned.has(c.id));
      default:
        return sorted.filter((c) => c.rarity === filter);
    }
  }, [filter, owned]);

  // Cards are portraits, so the grid runs one column tighter than elsewhere.
  const gridColumns = columns === 1 ? 2 : columns + 1;
  const gap = space.md;
  const cardWidth = (width - gap * (gridColumns - 1)) / gridColumns;

  const renderItem = useCallback(
    ({ item }: { item: CardDef }) => (
      <View style={{ width: cardWidth, marginBottom: gap }}>
        <CollectibleCard card={item} owned={owned.has(item.id)} />
      </View>
    ),
    [owned, cardWidth, gap],
  );

  const mythics = CARDS.filter((c) => c.rarity === 'mythic' && owned.has(c.id)).length;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Card contentStyle={styles.summary}>
          <View style={styles.summaryItem}>
            <SystemText variant="label">COLLECTED</SystemText>
            <SystemText variant="numeral" numberOfLines={1} color={palette.accent} style={styles.summaryValue}>
              {owned.size}
              <SystemText variant="meta" style={styles.of}> / {CARDS.length}</SystemText>
            </SystemText>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryItem}>
            <SystemText variant="label">MYTHIC</SystemText>
            <SystemText variant="numeral" numberOfLines={1} color={rarityMeta.mythic.color} style={styles.summaryValue}>
              {mythics}
            </SystemText>
          </View>
          <View style={styles.divider} />
          <View style={styles.summaryItem}>
            <SystemText variant="label">COMPLETION</SystemText>
            <SystemText variant="numeral" numberOfLines={1} color={palette.gold} style={styles.summaryValue}>
              {Math.round((owned.size / CARDS.length) * 100)}%
            </SystemText>
          </View>
        </Card>
      </View>

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
        key={`cols-${gridColumns}`}
        data={data}
        renderItem={renderItem}
        keyExtractor={(c) => c.id}
        numColumns={gridColumns}
        columnWrapperStyle={{ gap }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={6}
        windowSize={5}
        ListEmptyComponent={
          <Card>
            <SystemText variant="body">Nothing here yet.</SystemText>
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
  summaryValue: { fontSize: 24, lineHeight: 30, letterSpacing: -0.8 },
  of: { fontSize: 12, color: palette.textFaint },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: space.md,
    backgroundColor: palette.border,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  list: { paddingBottom: space.xxl * 2 },
});
