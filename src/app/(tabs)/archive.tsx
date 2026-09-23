import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlatList, RectButton } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Screen, useContentWidth } from '@/components/system/Screen';
import { Card } from '@/components/system/Card';
import { SystemText } from '@/components/system/SystemText';
import {
  alpha,
  categoryMeta,
  CATEGORIES,
  palette,
  radius,
  rankMeta,
  space,
  statMeta,
  type CategoryId,
  type StatKey,
} from '@/constants/theme';
import { artFor } from '@/data/cardArt';
import { QUESTS, type QuestDef } from '@/data/quests';
import { useProgress } from '@/store/progress';

type Filter = CategoryId | 'all';

export default function ArchiveScreen() {
  const { state, toggleActive } = useProgress();
  const { width, columns } = useContentWidth();
  const [filter, setFilter] = useState<Filter>('all');

  const data = useMemo(
    () => (filter === 'all' ? QUESTS : QUESTS.filter((q) => q.category === filter)),
    [filter],
  );

  const gap = space.md;
  const cardWidth = columns === 1 ? undefined : (width - gap * (columns - 1)) / columns;

  const renderItem = useCallback(
    ({ item }: { item: QuestDef }) => (
      <View style={[styles.cell, cardWidth ? { width: cardWidth } : styles.cellFull]}>
        <ArchiveCard
          quest={item}
          accepted={state.activeQuestIds.includes(item.id)}
          onToggle={() => toggleActive(item.id)}
        />
      </View>
    ),
    [state.activeQuestIds, toggleActive, cardWidth],
  );

  return (
    <Screen>
      <View style={styles.head}>
        <SystemText variant="heading" style={styles.heading}>
          QUEST ARCHIVE
        </SystemText>
        <SystemText variant="body" style={styles.sub}>
          {QUESTS.length} objectives catalogued across {CATEGORIES.length} disciplines.
          {' '}Accept a quest to add it to your daily board.
        </SystemText>
      </View>

      {/* A wrapping row rather than a horizontal ScrollView: RN Web squeezes a
          horizontal scroller inside a flex column until its chips clip, and
          with this few filters wrapping shows them all at once anyway. */}
      <View style={styles.filters}>
        <FilterChip label="ALL" active={filter === 'all'} color={palette.accent} onPress={() => setFilter('all')} />
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            label={categoryMeta[c].short}
            active={filter === c}
            color={categoryMeta[c].color}
            onPress={() => setFilter(c)}
          />
        ))}
      </View>

      <FlatList
        // numColumns is baked into the list's layout, so a change needs a remount.
        key={`cols-${columns}`}
        data={data}
        renderItem={renderItem}
        keyExtractor={(q) => q.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap } : undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        initialNumToRender={8}
        windowSize={5}
        removeClippedSubviews
      />
    </Screen>
  );
}

function FilterChip({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    // a11y props go on the button itself: a nested View with
    // accessibilityRole="button" renders a real <button> in react-native-web,
    // which is invalid inside RectButton's own <button>.
    <RectButton
      onPress={onPress}
      rippleColor={alpha(color, 0.2)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[
        styles.chip,
        { borderColor: alpha(color, active ? 0.8 : 0.25) },
        active && { backgroundColor: alpha(color, 0.14) },
      ]}>
      <SystemText variant="label" color={active ? color : palette.textFaint}>
        {label}
      </SystemText>
    </RectButton>
  );
}

const ArchiveCard = memo(function ArchiveCard({
  quest,
  accepted,
  onToggle,
}: {
  quest: QuestDef;
  accepted: boolean;
  onToggle: () => void;
}) {
  const cat = categoryMeta[quest.category];
  const rank = rankMeta[quest.rank];

  return (
    <Animated.View entering={FadeIn.duration(240)}>
      {/* Frame signals board membership, not category — the category already
          has its own coloured chip below, and tinting whole frames by category
          turns a filtered list into a wall of one colour. */}
      <Card
        art={artFor(quest.id, quest.category)}
        tint={accepted ? palette.positive : undefined}
        contentStyle={styles.cardContent}>
        <View style={styles.cardHead}>
          <SystemText variant="heading" style={styles.cardGlyph}>
            {quest.glyph}
          </SystemText>
          <View style={styles.cardText}>
            <SystemText variant="title" numberOfLines={1} style={styles.cardTitle}>
              {quest.title}
            </SystemText>
            <SystemText variant="body" numberOfLines={2} style={styles.cardObjective}>
              {quest.objective}
            </SystemText>
          </View>
          <SystemText variant="label" color={rank.color} style={styles.cardRank}>
            {quest.rank}
          </SystemText>
        </View>

        <View style={styles.cardMeta}>
          <SystemText variant="label" color={cat.color}>
            {cat.short}
          </SystemText>
          <SystemText variant="label" color={palette.textFaint}>
            {quest.cadence.toUpperCase()}
          </SystemText>
          <SystemText variant="label" color={palette.gold}>
            +{quest.xp} XP
          </SystemText>
          {Object.entries(quest.stats).map(([k, v]) => (
            <SystemText key={k} variant="label" color={statMeta[k as StatKey].color}>
              {k}+{v}
            </SystemText>
          ))}
        </View>

        <RectButton
          onPress={onToggle}
          rippleColor={alpha(cat.color, 0.2)}
          accessibilityRole="button"
          accessibilityLabel={
            accepted ? `Remove ${quest.title} from board` : `Accept ${quest.title}`
          }
          accessibilityState={{ selected: accepted }}
          style={[
            styles.accept,
            {
              borderColor: alpha(accepted ? palette.positive : cat.color, 0.6),
              backgroundColor: accepted ? alpha(palette.positive, 0.12) : 'transparent',
            },
          ]}>
          <SystemText variant="label" color={accepted ? palette.positive : cat.color}>
            {accepted ? '✓ ON BOARD — TAP TO REMOVE' : '+ ACCEPT QUEST'}
          </SystemText>
        </RectButton>
      </Card>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  head: { marginBottom: space.lg },
  heading: { fontSize: 30, letterSpacing: -0.5 },
  sub: { fontSize: 14, lineHeight: 19, marginTop: space.xs },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginBottom: space.lg,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  list: { paddingBottom: space.xxl * 2 },
  cell: { marginBottom: space.md },
  cellFull: { width: '100%' },
  cardContent: { padding: space.md, minHeight: 150, justifyContent: 'flex-end' },
  cardHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  cardGlyph: { fontSize: 20, lineHeight: 26 },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 12, letterSpacing: 1.2 },
  cardObjective: { fontSize: 13, lineHeight: 17, marginTop: 1 },
  cardRank: { fontSize: 12 },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm },
  accept: {
    borderWidth: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    marginTop: space.md,
  },
});
