import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Timeline, formatMinutes, type LiveTimeline } from '@/components/planner/Timeline';
import { Card } from '@/components/system/Card';
import { Screen } from '@/components/system/Screen';
import { Segmented } from '@/components/system/Segmented';
import { SystemText } from '@/components/system/SystemText';
import { palette, radius, space } from '@/constants/theme';
import {
  isResumable,
  plannedToQuest,
  plannerConfigured,
  taskIdForBlock,
  type PlannerSession,
} from '@/data/planner';
import { QUESTS_BY_ID } from '@/data/quests';
import {
  addDays,
  busyMinutes,
  clockNow,
  dayMinutes,
  defaultPlanDate,
  prettyDate,
  unplacedQuests,
  weekdayOf,
  type DailyQuestRef,
  type DraftPlan,
  type PlanBlock,
} from '@/data/timeline';
import { feedback, playSound } from '@/lib/feedback';
import { loadSession } from '@/lib/plannerSession';
import { isComplete, useProgress } from '@/store/progress';

type Day = 'today' | 'tomorrow';

/**
 * The day as a timeline — today's to work through, tomorrow's to look ahead.
 *
 * "Today" is the store's today, not the 4am-rollover today: the Quests board
 * is what you tick quests off on, and this view must agree with it to the
 * minute, or a task checked here would not be checked there.
 */
export default function PlannerScreen() {
  const { state, setProgress } = useProgress();

  const today = state.date;
  const tomorrow = addDays(today, 1);

  // Before 04:00 "plan tomorrow" means the day you are about to face, which
  // the store already calls today. After that, lead with whichever day has
  // something worth looking at.
  const [day, setDay] = useState<Day>(() => {
    if (defaultPlanDate() === today) return 'today';
    if (state.plans[today] && new Date().getHours() < 18) return 'today';
    return 'tomorrow';
  });
  const date = day === 'today' ? today : tomorrow;

  // A minute tick so the NOW marker keeps up while the screen is open.
  const [minute, setMinute] = useState(() => clockNow());
  useEffect(() => {
    const id = setInterval(() => setMinute(clockNow()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [session, setSession] = useState<PlannerSession | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSession().then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [date]);

  const stored = state.plans[date];
  const plan: DraftPlan | null = stored?.timeline
    ? { ...stored.timeline, note: stored.note }
    : null;

  const dailyQuests: DailyQuestRef[] = useMemo(
    () =>
      state.activeQuestIds
        .map((id) => QUESTS_BY_ID[id])
        .filter(Boolean)
        .map((q) => ({ id: q.id, title: q.title, kind: q.kind, target: q.target, unit: q.unit })),
    [state.activeQuestIds],
  );

  const live: LiveTimeline | undefined =
    day === 'today' && plan
      ? {
          now: dayMinutes(minute, plan.wake),
          isDone: (b) => blockDone(b, state),
          progressOf: (b) => {
            const q = b.questId ? QUESTS_BY_ID[b.questId] : undefined;
            if (!q) return null;
            return `${state.values[q.id] ?? 0} / ${q.target} ${q.unit}`;
          },
          onToggleTask: (b) => {
            const id = taskIdForBlock(b);
            const done = blockDone(b, state);
            if (done) playSound('tap');
            else feedback('complete', 'success');
            setProgress(id, done ? 0 : 1);
          },
        }
      : undefined;

  const tasks = plan ? plan.blocks.filter((b) => b.kind === 'task') : [];
  const tasksDone = live ? tasks.filter((b) => live.isDone(b)).length : 0;
  const allDay = plan ? unplacedQuests(plan, dailyQuests) : [];
  const resumable = isResumable(session, date);

  function openChat() {
    playSound('tap');
    router.push({ pathname: '/planner-chat', params: { date } });
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="label" color={palette.textMuted} style={styles.kicker}>
          ◷ PLANNER
        </SystemText>
        <SystemText variant="hero" style={styles.hero}>
          {weekdayOf(date).toUpperCase()}
        </SystemText>
        <SystemText variant="meta" style={styles.dateLine}>
          {prettyDate(date).replace(`${weekdayOf(date)} `, '')}
          {plan
            ? ` · ${formatMinutes(busyMinutes(plan))} planned${tasks.length ? ` · ${live ? `${tasksDone} of ` : ''}${tasks.length} task${tasks.length === 1 ? '' : 's'}${live ? ' done' : ''}` : ''}`
            : ''}
        </SystemText>

        <View style={styles.switch}>
          <Segmented<Day>
            segments={[
              { key: 'today', label: 'Today' },
              { key: 'tomorrow', label: 'Tomorrow' },
            ]}
            value={day}
            onChange={setDay}
          />
        </View>

        {!plannerConfigured() ? (
          <Card tint={palette.negative}>
            <SystemText variant="label" color={palette.negative}>
              Planner offline
            </SystemText>
            <SystemText variant="body" style={styles.cardBody}>
              The System has no planner configured, so plans cannot be made yet.
            </SystemText>
          </Card>
        ) : plan ? (
          <Animated.View key={date} entering={FadeIn.duration(220)} style={styles.planBlock}>
            {plan.note ? (
              <SystemText variant="body" style={styles.note}>
                {plan.note}
              </SystemText>
            ) : null}

            {allDay.length > 0 ? (
              <View style={styles.allDay}>
                <SystemText variant="label" color={palette.textFaint} style={styles.allDayLabel}>
                  ALL DAY
                </SystemText>
                <View style={styles.chips}>
                  {allDay.map((q) => {
                    const def = QUESTS_BY_ID[q.id];
                    const done = live && def ? isComplete(def, state.values[q.id] ?? 0) : false;
                    return (
                      <View key={q.id} style={[styles.chip, done && styles.chipDone]}>
                        <SystemText
                          variant="meta"
                          numberOfLines={1}
                          style={[styles.chipText, done && { color: palette.positive }]}>
                          {def?.glyph ? `${def.glyph} ` : ''}
                          {q.title}
                          {live ? `  ${state.values[q.id] ?? 0}/${q.target}` : ''}
                        </SystemText>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <Timeline plan={plan} live={live} />

            <GhostButton label={`Re-plan ${day === 'today' ? 'today' : weekdayOf(date)}`} onPress={openChat} />
          </Animated.View>
        ) : stored ? (
          // A plan from the first planner, which had no times.
          <Card>
            <SystemText variant="body" style={styles.cardBody}>
              This plan was made before the timeline. Its tasks are on the Quests board.
            </SystemText>
            <GhostButton label="Make a timeline for it" onPress={openChat} />
          </Card>
        ) : (
          <Animated.View key={`empty-${date}`} entering={FadeIn.duration(220)} style={styles.empty}>
            <Card>
              <SystemText variant="title" style={styles.emptyTitle}>
                {resumable ? 'You were in the middle of this.' : `No plan for ${day === 'today' ? 'today' : weekdayOf(date)} yet.`}
              </SystemText>
              <SystemText variant="body" style={styles.cardBody}>
                {resumable
                  ? 'Your conversation is saved. Pick it up where you left off.'
                  : 'Talk it through with The System. It asks a few questions, then lays the day out with breathing room built in.'}
              </SystemText>
            </Card>
            <PrimaryButton label={resumable ? 'Resume planning' : 'Create plan'} onPress={openChat} />
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

/** Whether a task or habit block is finished, read from the live board. */
function blockDone(block: PlanBlock, state: ReturnType<typeof useProgress>['state']): boolean {
  if (block.kind === 'task') {
    const id = taskIdForBlock(block);
    const task = state.planned[id];
    return task ? isComplete(plannedToQuest(task), state.values[id] ?? 0) : false;
  }
  if (block.kind === 'habit' && block.questId) {
    const q = QUESTS_BY_ID[block.questId];
    return q ? isComplete(q, state.values[q.id] ?? 0) : false;
  }
  return false;
}

/* --------------------------------------------------------------- buttons */

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.primary}>
        <SystemText variant="label" color={palette.bg} style={styles.buttonLabel}>
          {label}
        </SystemText>
      </View>
    </Pressable>
  );
}

function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.ghost}>
        <SystemText variant="label" color={palette.text} style={styles.buttonLabel}>
          {label}
        </SystemText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 2 },
  kicker: { fontSize: 10, letterSpacing: 3 },
  hero: { fontSize: 38, lineHeight: 42, marginTop: space.xs },
  dateLine: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  switch: { marginTop: space.lg, marginBottom: space.lg },

  planBlock: { gap: space.lg },
  note: { fontSize: 14, lineHeight: 20, fontStyle: 'italic', color: palette.textMuted },

  allDay: { gap: space.xs },
  allDayLabel: { fontSize: 9, letterSpacing: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chipDone: { borderColor: 'rgba(86,211,100,0.4)' },
  chipText: { fontSize: 11, color: palette.textMuted },

  empty: { gap: space.md },
  emptyTitle: { fontSize: 17, lineHeight: 22 },
  cardBody: { fontSize: 13, lineHeight: 19, marginTop: space.xs, color: palette.textMuted },

  primary: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.lg,
  },
  ghost: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.md,
  },
  buttonLabel: { fontSize: 11, letterSpacing: 2 },
});
