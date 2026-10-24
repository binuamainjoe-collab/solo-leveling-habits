import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { Ring } from '@/components/charts/Ring';
import { GROUP_META } from '@/components/dashboard/BalanceRings';
import { QuestCard } from '@/components/quest/QuestCard';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { Sheet } from '@/components/system/Sheet';
import { SystemText } from '@/components/system/SystemText';
import { HIT, icon, palette, radius, space } from '@/constants/theme';
import { GROUP_OF, GROUPS, type Group } from '@/data/insights';
import type { QuestDef } from '@/data/quests';
import { playSound } from '@/lib/feedback';
import { isCeilingQuest, isComplete, useProgress } from '@/store/progress';

/**
 * Body, Mind or Life, opened up: the group's ring, then every one of its
 * quests on today's board as cards you can work right here, still to do
 * first. The arrows step to the next group without closing.
 */
export function GroupSheet({
  group,
  quests,
  onChange,
  onClose,
}: {
  group: Group | null;
  /** Today's whole board; the sheet picks out the group's quests. */
  quests: QuestDef[];
  onChange: (group: Group) => void;
  onClose: () => void;
}) {
  const { state, setProgress } = useProgress();
  const { width } = useWindowDimensions();
  // The sheet's padding and its 1pt border on each side.
  const inner = Math.min(width, 820) - space.lg * 2 - 2;
  const columns = inner >= 620 ? 3 : 2;
  const gap = space.md;
  const cardWidth = Math.floor((inner - gap * (columns - 1)) / columns);

  const g = group ?? 'body';
  const meta = GROUP_META[g];
  const mine = quests.filter((q) => GROUP_OF[q.category] === g);
  const done = mine.filter((q) => isComplete(q, state.values[q.id] ?? 0));
  const todo = mine.filter((q) => !isComplete(q, state.values[q.id] ?? 0));
  const ratio = mine.length ? done.length / mine.length : 0;
  const at = GROUPS.indexOf(g);
  const step = (by: number) => {
    playSound('tap');
    onChange(GROUPS[(at + by + GROUPS.length) % GROUPS.length]);
  };

  const cards = (list: QuestDef[]) => (
    <View style={[styles.grid, { gap }]}>
      {list.map((q) => (
        <Animated.View key={q.id} layout={LinearTransition.duration(220)} style={{ width: cardWidth }}>
          <QuestCard
            quest={q}
            value={state.values[q.id] ?? 0}
            ceiling={isCeilingQuest(q)}
            onChange={(next) => setProgress(q.id, next)}
          />
        </Animated.View>
      ))}
    </View>
  );

  return (
    <Sheet
      visible={group !== null}
      onClose={onClose}
      header={
        <View style={styles.head}>
          <Ring size={64} stroke={7} ratio={ratio} color={meta.color}>
            <SystemText variant="meta" color={palette.text} style={styles.pct}>
              {Math.round(ratio * 100)}%
            </SystemText>
          </Ring>
          <View style={styles.headText}>
            <SystemText variant="heading">{meta.label}</SystemText>
            <SystemText variant="meta">
              {done.length} of {mine.length} done today
            </SystemText>
          </View>
          <Arrow name="back" label={`Show ${GROUP_META[GROUPS[(at + 2) % 3]].label}`} onPress={() => step(-1)} />
          <Arrow name="chevron" label={`Show ${GROUP_META[GROUPS[(at + 1) % 3]].label}`} onPress={() => step(1)} />
        </View>
      }>
      <Animated.View key={g} entering={FadeIn.duration(200)} style={styles.body}>
        {mine.length === 0 ? (
          <SystemText variant="body">No {meta.label.toLowerCase()} quests on today’s board. Add some from the Archive.</SystemText>
        ) : null}
        {todo.length ? (
          <>
            <SystemText variant="label">To do, {todo.length}</SystemText>
            {cards(todo)}
          </>
        ) : null}
        {done.length ? (
          <>
            <SystemText variant="label" color={palette.positive}>
              Done, {done.length}
            </SystemText>
            {cards(done)}
          </>
        ) : null}
      </Animated.View>
    </Sheet>
  );
}

function Arrow({ name, label, onPress }: { name: 'back' | 'chevron'; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.arrow}>
        <Icon name={name} size={icon.bar} color={palette.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, minWidth: 0 },
  pct: { fontSize: 13, fontWeight: '700' },
  arrow: {
    width: HIT,
    height: HIT,
    borderRadius: radius.pill,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
