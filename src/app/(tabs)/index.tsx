import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';

import { QuestCard } from '@/components/quest/QuestCard';
import { Card } from '@/components/system/Card';
import { Screen, useContentWidth } from '@/components/system/Screen';
import { StatusHeader } from '@/components/system/StatusHeader';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, palette, radius, space, type CategoryId } from '@/constants/theme';
import type { QuestDef } from '@/data/quests';
import { playSound } from '@/lib/feedback';
import { isCeilingQuest, isComplete, useActiveQuests, useProgress } from '@/store/progress';

type Page = 'todo' | 'done';

export default function QuestBoardScreen() {
  const { state, setProgress } = useProgress();
  const active = useActiveQuests();
  const { width, columns } = useContentWidth();

  // Always open on To do — that is the page with work on it.
  const [page, setPage] = useState<Page>('todo');
  // Which way the incoming page should slide from, so switching reads as
  // moving between two pages laid side by side, not as content swapping.
  const [direction, setDirection] = useState<1 | -1>(1);

  const { todo, done } = useMemo(() => {
    const t: QuestDef[] = [];
    const d: QuestDef[] = [];
    for (const q of active) {
      if (isComplete(q, state.values[q.id] ?? 0)) d.push(q);
      else t.push(q);
    }
    return { todo: t, done: d };
  }, [active, state.values]);

  const groups = useMemo(() => {
    const map = new Map<CategoryId, QuestDef[]>();
    for (const q of todo) {
      const list = map.get(q.category) ?? [];
      list.push(q);
      map.set(q.category, list);
    }
    return [...map.entries()];
  }, [todo]);

  const gridColumns = columns === 1 ? 2 : columns + 1;
  const gap = space.md;
  const cardWidth = (width - gap * (gridColumns - 1)) / gridColumns;

  const mandatory = active.filter((q) => q.penalty);
  const mandatoryDone = mandatory.filter((q) => isComplete(q, state.values[q.id] ?? 0)).length;

  const go = (next: Page) => {
    if (next === page) return;
    playSound('tap');
    setDirection(next === 'done' ? 1 : -1);
    setPage(next);
  };

  const renderCard = (quest: QuestDef, delayIndex: number) => (
    <Animated.View
      key={quest.id}
      // Duration-based, not springify(): spring layout animations are
      // unsupported on web.
      entering={FadeInDown.duration(300).delay(Math.min(420, delayIndex * 35))}
      exiting={FadeOut.duration(180)}
      // Closes the gap a cleared quest leaves, rather than snapping shut.
      layout={LinearTransition.duration(240)}
      style={{ width: cardWidth }}>
      <QuestCard
        quest={quest}
        value={state.values[quest.id] ?? 0}
        ceiling={isCeilingQuest(quest)}
        onChange={(next) => setProgress(quest.id, next)}
      />
    </Animated.View>
  );

  // Slides in from the side the page lives on: Done sits to the right of To do.
  const pageEnter = (direction === 1 ? FadeInRight : FadeInLeft).duration(260);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <StatusHeader />

        {mandatory.length > 0 ? (
          <Card
            tint={mandatoryDone === mandatory.length ? palette.positive : palette.negative}
            style={styles.warning}>
            <SystemText
              variant="title"
              color={mandatoryDone === mandatory.length ? palette.positive : palette.negative}
              style={styles.warningTitle}>
              ⚠ DAILY QUEST — {mandatoryDone === mandatory.length ? 'CLEARED' : 'INCOMPLETE'}
            </SystemText>
            <SystemText variant="body" style={styles.warningBody}>
              {mandatoryDone === mandatory.length
                ? 'All mandatory objectives cleared. The penalty zone remains sealed.'
                : `Preparation to become strong. ${mandatoryDone} of ${mandatory.length} mandatory objectives cleared. Failure to complete the daily quest will result in an appropriate penalty.`}
            </SystemText>
          </Card>
        ) : null}

        <PageSwitcher
          page={page}
          todoCount={todo.length}
          doneCount={done.length}
          onChange={go}
        />

        {/* Keyed by page, so switching mounts a fresh page with its entrance. */}
        <Animated.View key={page} entering={pageEnter} collapsable={false}>
          {page === 'todo' ? (
            todo.length > 0 ? (
              groups.map(([categoryId, quests], groupIndex) => {
                const cat = categoryMeta[categoryId];
                return (
                  <Animated.View
                    key={categoryId}
                    style={styles.group}
                    layout={LinearTransition.duration(240)}
                    exiting={FadeOut.duration(180)}
                    collapsable={false}>
                    <View style={styles.groupHead}>
                      <SystemText variant="title" color={cat.color} style={styles.groupGlyph}>
                        {cat.glyph}
                      </SystemText>
                      <SystemText variant="title" color={cat.color} style={styles.groupTitle}>
                        {cat.label.toUpperCase()}
                      </SystemText>
                      <View style={[styles.rule, { backgroundColor: alpha(cat.color, 0.3) }]} />
                      <SystemText variant="label" style={styles.groupCount}>
                        {quests.length}
                      </SystemText>
                    </View>
                    <View style={[styles.grid, { gap }]}>
                      {quests.map((q, i) => renderCard(q, groupIndex * 3 + i))}
                    </View>
                  </Animated.View>
                );
              })
            ) : active.length > 0 ? (
              <EmptyPage
                tint={palette.positive}
                title="BOARD CLEARED"
                body="Every quest on today's board is done. Check the Done page to see what you finished."
              />
            ) : (
              <EmptyPage
                tint={palette.textMuted}
                title="NO ACTIVE QUESTS"
                body="Open the Archive and accept quests to populate your board."
              />
            )
          ) : done.length > 0 ? (
            <View style={[styles.grid, { gap }]}>{done.map((q, i) => renderCard(q, i))}</View>
          ) : (
            <EmptyPage
              tint={palette.accent}
              title="NOTHING DONE YET"
              body="Quests you clear today land here. Unmark one to send it back to To do."
            />
          )}
        </Animated.View>

        {/* Archive gave up its tab slot to Goal, so this is the way in. It
            sits at the foot of the board because adding quests is something
            you do occasionally, not every day. */}
        <Pressable
          onPress={() => {
            playSound('tap');
            router.push('/archive');
          }}
          accessibilityRole="button"
          accessibilityLabel="Browse the quest archive">
          <View style={styles.archiveLink}>
            <SystemText variant="label" color={palette.textMuted} style={styles.archiveLabel}>
              ☰ BROWSE THE ARCHIVE
            </SystemText>
          </View>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/**
 * Two pills that switch between the To do and Done pages — Life Reset's
 * "To-dos 7 | Done 1" pattern.
 */
function PageSwitcher({
  page,
  todoCount,
  doneCount,
  onChange,
}: {
  page: Page;
  todoCount: number;
  doneCount: number;
  onChange: (next: Page) => void;
}) {
  return (
    <View style={styles.switcher} accessibilityRole="tablist">
      <SwitchPill
        label="To do"
        count={todoCount}
        selected={page === 'todo'}
        tint={palette.accent}
        onPress={() => onChange('todo')}
      />
      <SwitchPill
        label="Done"
        count={doneCount}
        selected={page === 'done'}
        tint={palette.positive}
        onPress={() => onChange('done')}
      />
    </View>
  );
}

function SwitchPill({
  label,
  count,
  selected,
  tint,
  onPress,
}: {
  label: string;
  count: number;
  selected: boolean;
  tint: string;
  onPress: () => void;
}) {
  // Clearing a quest removes it from the page you're looking at, so without
  // this it just vanishes. A pulse on the other page's count shows where it
  // went — the kind of cause-and-effect link that matters for ADHD.
  const [pulse, setPulse] = useState(false);
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current && !selected) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 420);
      prev.current = count;
      return () => clearTimeout(t);
    }
    prev.current = count;
  }, [count, selected]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.pillWrap}
      accessibilityRole="tab"
      accessibilityLabel={`${label}, ${count}`}
      accessibilityState={{ selected }}>
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: selected ? tint : alpha(palette.text, 0.04),
            borderColor: selected ? tint : palette.border,
            transform: [{ scale: pulse ? 1.07 : 1 }],
            transitionProperty: ['backgroundColor', 'borderColor', 'transform'],
            transitionDuration: ['180ms', '180ms', '200ms'],
            transitionTimingFunction: ['ease-out', 'ease-out', 'ease-out'],
          },
        ]}>
        <SystemText variant="title" color={selected ? palette.bg : palette.textMuted} style={styles.pillLabel}>
          {label}
        </SystemText>
        <View
          style={[
            styles.pillCount,
            { backgroundColor: selected ? alpha(palette.bg, 0.22) : alpha(tint, 0.16) },
          ]}>
          <SystemText variant="label" color={selected ? palette.bg : tint} style={styles.pillCountText}>
            {count}
          </SystemText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

function EmptyPage({ tint, title, body }: { tint: string; title: string; body: string }) {
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Card tint={tint}>
        <SystemText variant="hero" color={tint} style={styles.emptyTitle}>
          {title}
        </SystemText>
        <SystemText variant="body" style={styles.warningBody}>
          {body}
        </SystemText>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2 },
  warning: { marginBottom: space.lg },
  warningTitle: { fontSize: 13, letterSpacing: 1.4 },
  warningBody: { fontSize: 14, lineHeight: 19, marginTop: space.sm },

  archiveLink: {
    marginTop: space.xl,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.md,
  },
  archiveLabel: { fontSize: 10, letterSpacing: 1.6 },
  switcher: { flexDirection: 'row', gap: space.sm, marginBottom: space.xl },
  pillWrap: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 11,
  },
  pillLabel: { fontSize: 15 },
  pillCount: {
    minWidth: 22,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
    alignItems: 'center',
  },
  pillCountText: { fontSize: 10, letterSpacing: 0 },

  group: { marginBottom: space.xl },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  groupGlyph: { fontSize: 13 },
  groupTitle: { fontSize: 11, letterSpacing: 2 },
  rule: { flex: 1, height: 1 },
  groupCount: { fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  emptyTitle: { fontSize: 24 },
});
