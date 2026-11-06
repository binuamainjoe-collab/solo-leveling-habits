import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { MotionScroll } from '@/components/motion/MotionScroll';
import Animated, { FadeIn, ReduceMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { DayClock, PART_META, type ClockIcon } from '@/components/charts/DayClock';
import { Ring } from '@/components/charts/Ring';
import { DayWeekZoom } from '@/components/planner/DayWeekZoom';
import { Timeline, formatMinutes, type LiveTimeline } from '@/components/planner/Timeline';
import { WeekView, weekAnchor, type WeekDay } from '@/components/planner/WeekView';
import { QuestIcon } from '@/components/quest/QuestIcon';
import { Card } from '@/components/system/Card';
import { Pressable as SafePressable } from '@/components/system/Pressable';
import { Screen, useContentWidth } from '@/components/system/Screen';
import { Segmented } from '@/components/system/Segmented';
import { WordReveal } from '@/components/motion/WordReveal';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, HIT, palette, radius, space } from '@/constants/theme';
import { blockIsDone } from '@/data/assistant';
import { firstFreeTime, nudge, overlap, partAt, partsOf, placeQuests, spanOf, weekOf, type Part, type Slots } from '@/data/dayClock';
import {
  isResumable,
  plannerConfigured,
  taskIdForBlock,
  type PlannerSession,
} from '@/data/planner';
import { questIconKey } from '@/data/questIcons';
import type { QuestDef } from '@/data/quests';
import {
  addDays,
  busyMinutes,
  clockNow,
  dayMinutes,
  defaultPlanDate,
  fromMinutes,
  prettyDate,
  weekdayOf,
  type DraftPlan,
  type PlanBlock,
} from '@/data/timeline';
import { feedback, playSound } from '@/lib/feedback';
import { SPRING } from '@/lib/motion';
import { loadSession } from '@/lib/plannerSession';
import { isCeilingQuest, isComplete, useActiveQuests, useDayLog, useProgress, useQuestLookup } from '@/store/progress';

type Day = 'today' | 'tomorrow';

/** One empty list, so a day with no plan does not hand the clock a new array every render. */
const NO_BLOCKS: PlanBlock[] = [];
const NO_SLOTS: Slots = {};

/** The zoom between day and week settles like a tab landing, or at once with reduced motion. */
const ZOOM_SPRING = { ...SPRING.page, reduceMotion: ReduceMotion.System };

/**
 * The day as a clock — today's to work through, tomorrow's to look ahead.
 *
 * The waking day wraps once around a ring cut into morning, noon and
 * evening; the plan's blocks are slices of it and every quest on the board
 * sits on it as an icon, at its time or, with no time, inside. The hour by
 * hour list below is the same day in words, with the tasks to tick off.
 *
 * "Today" is the store's today, not the 4am-rollover today: the Quests board
 * is what you tick quests off on, and this view must agree with it to the
 * minute, or a task checked here would not be checked there.
 */
export default function PlannerScreen() {
  const { state, setProgress, addProgress, setSlot } = useProgress();
  const log = useDayLog();
  const lookup = useQuestLookup();
  const board = useActiveQuests();
  const { width, wide } = useContentWidth();

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
  const isToday = day === 'today';

  // A minute tick so the clock's hand keeps up while the screen is open.
  const [minute, setMinute] = useState(() => clockNow());
  useEffect(() => {
    const id = setInterval(() => setMinute(clockNow()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** A part of the day picked on the legend: the clock and the list narrow to it. */
  const [focusPart, setFocusPart] = useState<Part | null>(null);
  /** The quest picked on the clock, shown below it with its buttons. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The week, flat, in the clock's place: pinch the clock, or the Week button. 0 is the day, 1 the week. */
  const [week, setWeek] = useState(false);
  const zoom = useSharedValue(0);

  const [session, setSession] = useState<PlannerSession | null>(null);
  // On focus, not mount: this tab stays mounted under the chat, and coming
  // back from a half-finished conversation should offer to resume it.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadSession().then((s) => {
        if (alive) setSession(s);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  const stored = state.plans[date];
  const plan: DraftPlan | null = stored?.timeline ? { ...stored.timeline, note: stored.note } : null;
  const wake = plan?.wake ?? state.settings.wake ?? '07:00';
  const sleep = plan?.sleep ?? state.settings.sleep ?? '23:00';
  const blocks = stored?.timeline?.blocks ?? NO_BLOCKS;

  // The board's quests on the clock. Planned tasks are already the plan's
  // own blocks, so they are not drawn twice. (The React Compiler memoises these.)
  const quests = board.filter((q) => q.category !== 'planned');
  const slots = state.slots?.[date] ?? NO_SLOTS;
  const { placed, floating } = placeQuests(quests, blocks, wake, sleep, slots);
  const progressOf = (q: QuestDef) => {
    const v = isToday ? (state.values[q.id] ?? 0) : 0;
    const done = isToday && isComplete(q, v);
    const ratio = isCeilingQuest(q) ? (v > 0 ? 1 : 0) : Math.min(1, v / Math.max(1, q.target));
    return { v, done, ratio };
  };
  const toIcon = (q: QuestDef, minutes: number | null): ClockIcon => {
    const { done, ratio } = progressOf(q);
    return { id: q.id, label: q.title, icon: questIconKey(q), color: categoryMeta[q.category].color, ratio, done, minutes };
  };
  const icons: ClockIcon[] = [
    ...placed.map((p) => toIcon(p.quest, p.minutes)),
    ...floating.map((q) => toIcon(q, null)),
  ].filter((i) => {
    // With a part picked, the timed icons of the other parts step back.
    if (!focusPart || i.minutes === null) return true;
    return partAt(i.minutes) === focusPart;
  });

  const span = spanOf(wake, sleep);
  const parts = partsOf(span).map((p) => {
    const planned = blocks.filter((b) => b.kind !== 'break').reduce((n, b) => n + overlap(b, wake, p.from, p.to), 0);
    const count = placed.filter((x) => partAt(x.minutes) === p.part).length;
    const doneCount = placed.filter((x) => partAt(x.minutes) === p.part && progressOf(x.quest).done).length;
    return { ...p, planned, count, doneCount };
  });

  const live: LiveTimeline | undefined =
    isToday && plan
      ? {
          now: dayMinutes(minute, plan.wake),
          isDone: (b) => blockIsDone(b, state.values, lookup),
          progressOf: (b) => {
            const q = b.questId ? lookup(b.questId) : undefined;
            if (!q) return null;
            return `${state.values[q.id] ?? 0} / ${q.target} ${q.unit}`;
          },
          onToggleTask: (b) => {
            const id = taskIdForBlock(b);
            const done = blockIsDone(b, state.values, lookup);
            if (done) playSound('tap');
            else feedback('complete', 'success');
            setProgress(id, done ? 0 : 1);
          },
        }
      : undefined;

  const tasks = blocks.filter((b) => b.kind === 'task');
  const tasksDone = live ? tasks.filter((b) => live.isDone(b)).length : 0;
  const resumable = isResumable(session, date);
  const doneToday = quests.filter((q) => progressOf(q).done).length;

  const nowM = dayMinutes(minute, wake);
  const centreTop = isToday ? minute : weekdayOf(date).slice(0, 3);
  const centreSub = isToday
    ? nowM >= span.start && nowM <= span.end
      ? `${PART_META[partAt(nowM)].label}, ${doneToday} of ${quests.length} done`
      : `${doneToday} of ${quests.length} done`
    : plan
      ? `${blocks.length} blocks planned`
      : 'Not planned yet';

  const pickedQuest = picked ? quests.find((q) => q.id === picked) ?? null : null;
  const pickedWhere = (() => {
    if (!pickedQuest) return '';
    const p = placed.find((x) => x.quest.id === pickedQuest.id);
    if (!p) return 'Any time today';
    const part = PART_META[partAt(p.minutes)].label.toLowerCase();
    if (p.source === 'slot') return `At ${fromMinutes(p.minutes)}, your time, ${part}`;
    if (p.source === 'plan') return `At ${fromMinutes(p.minutes)} in your plan, ${part}`;
    if (p.source === 'window') return `Around ${fromMinutes(p.minutes)}, ${part}`;
    return `Usually in the ${part}`;
  })();

  const pickedPlace = pickedQuest ? (placed.find((x) => x.quest.id === pickedQuest.id) ?? null) : null;
  const nowMinutes = isToday ? dayMinutes(minute, wake) : null;
  const schedule = (id: string, minutes: number | null) => setSlot(date, id, minutes);

  const showWeek = useCallback((on: boolean) => {
    setWeek(on);
    if (on) setPicked(null);
  }, []);
  function openWeek() {
    zoom.set(withSpring(1, ZOOM_SPRING));
    showWeek(true);
  }
  function openDay(next: Day) {
    setDay(next);
    setPicked(null);
    setFocusPart(null);
    setWeek(false);
    zoom.set(withSpring(0, ZOOM_SPRING));
  }

  const weekDays: WeekDay[] = weekOf(date).map((d) => {
    const rec = log[d];
    const future = d > today;
    const timeline = state.plans[d]?.timeline;
    return {
      date: d,
      weekday: weekdayOf(d).slice(0, 3),
      sub: d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : '',
      cleared: future ? 0 : (rec?.cleared ?? 0),
      total: future ? 0 : (rec?.total ?? 0),
      perfect: !future && Boolean(rec?.perfect),
      future,
      plan: timeline ? { wake: timeline.wake, sleep: timeline.sleep, blocks: timeline.blocks } : null,
      now: d === today ? dayMinutes(minute, timeline?.wake ?? wake) : null,
      opens: d === today || d === tomorrow,
    };
  });
  const weekIndex = Math.max(0, weekDays.findIndex((d) => d.date === date));

  function openChat() {
    playSound('tap');
    router.push({ pathname: '/planner-chat', params: { date } });
  }

  const clockSize = wide ? Math.min(460, width * 0.52) : Math.min(width, 420);

  return (
    <Screen>
      <MotionScroll showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <SystemText variant="label" color={palette.textMuted}>
          Planner
        </SystemText>
        <WordReveal screen="planner" variant="hero" style={styles.hero}>
          {weekdayOf(date)}
        </WordReveal>
        <SystemText variant="meta" style={styles.dateLine}>
          {prettyDate(date).replace(`${weekdayOf(date)} `, '')}
          {plan
            ? `, ${formatMinutes(busyMinutes(plan))} planned${tasks.length ? `, ${live ? `${tasksDone} of ` : ''}${tasks.length} task${tasks.length === 1 ? '' : 's'}${live ? ' done' : ''}` : ''}`
            : ''}
        </SystemText>

        <View style={styles.switch}>
          <Segmented<Day | 'week'>
            segments={[
              { key: 'today', label: 'Today' },
              { key: 'tomorrow', label: 'Tomorrow' },
              { key: 'week', label: 'Week' },
            ]}
            value={week ? 'week' : day}
            onChange={(d) => (d === 'week' ? openWeek() : openDay(d))}
          />
        </View>

        {!plannerConfigured() ? (
          <Card tint={palette.negative} style={styles.block}>
            <SystemText variant="title" color={palette.negative}>
              Planner offline
            </SystemText>
            <SystemText variant="body" style={styles.cardBody}>
              There is no planner server configured, so plans cannot be made yet.
            </SystemText>
          </Card>
        ) : null}

        <Animated.View key={date} entering={FadeIn.duration(220)} style={[styles.top, wide && styles.topWide]}>
          <View style={styles.clockWrap}>
            <DayWeekZoom
              size={clockSize}
              zoom={zoom}
              week={week}
              anchor={weekAnchor(weekIndex, clockSize)}
              onWeek={showWeek}
              day={
                <DayClock
                  size={clockSize}
                  wake={wake}
                  sleep={sleep}
                  blocks={blocks}
                  now={isToday ? minute : null}
                  icons={icons}
                  selected={picked}
                  onSelect={(id) => setPicked((p) => (p === id ? null : id))}
                  onSchedule={schedule}
                  focusPart={focusPart}
                  centreTop={centreTop}
                  centreSub={centreSub}
                  paused={week}
                />
              }
              weekView={
                <WeekView
                  days={weekDays}
                  selected={date}
                  size={clockSize}
                  onOpen={(d) => openDay(d === today ? 'today' : 'tomorrow')}
                />
              }
            />
          </View>

          <View style={[styles.side, wide && styles.sideWide]}>
            {/* The three parts: how full each is, and how many quests live there. Tap one to narrow to it. */}
            <View style={styles.parts}>
              {parts.map((p) => {
                const on = focusPart === p.part;
                const meta = PART_META[p.part];
                const fill = Math.min(1, p.planned / Math.max(1, p.to - p.from));
                return (
                  <SafePressable
                    key={p.part}
                    onPress={() => {
                      playSound('tap');
                      setFocusPart(on ? null : p.part);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${meta.label}, ${fromMinutes(p.from)} to ${fromMinutes(p.to)}: ${formatMinutes(p.planned)} planned, ${p.doneCount} of ${p.count} quests done. ${on ? 'Show the whole day' : 'Show only this part'}`}>
                    <View style={[styles.part, on && { borderColor: meta.color, backgroundColor: alpha(meta.color, 0.08) }]}>
                      <View style={[styles.partDot, { backgroundColor: meta.color }]} />
                      <View style={styles.partText}>
                        <View style={styles.partHead}>
                          <SystemText variant="title" style={styles.partTitle}>
                            {meta.label}
                          </SystemText>
                          <SystemText variant="meta">
                            {fromMinutes(p.from)}–{fromMinutes(p.to)}
                          </SystemText>
                        </View>
                        <View style={styles.partTrack}>
                          <View style={[styles.partFill, { width: `${fill * 100}%`, backgroundColor: meta.color }]} />
                        </View>
                      </View>
                      <View style={styles.partNums}>
                        <SystemText variant="title" color={palette.text} style={styles.partNum}>
                          {p.count ? `${p.doneCount}/${p.count}` : '0'}
                        </SystemText>
                        <SystemText variant="meta" style={styles.partNumLabel}>
                          {formatMinutes(p.planned) || '0 min'}
                        </SystemText>
                      </View>
                    </View>
                  </SafePressable>
                );
              })}
            </View>

            {pickedQuest ? (
              <PickedQuest
                quest={pickedQuest}
                value={progressOf(pickedQuest).v}
                done={progressOf(pickedQuest).done}
                where={pickedWhere}
                live={isToday}
                time={pickedPlace?.minutes ?? null}
                mine={pickedPlace?.source === 'slot'}
                onTime={(m) => {
                  playSound('tap');
                  schedule(pickedQuest.id, m === undefined ? firstFreeTime(nowMinutes, span) : m === null ? null : nudge(m.from, m.by, span));
                }}
                onAdd={(by) => {
                  if (by > 0 && isComplete(pickedQuest, (state.values[pickedQuest.id] ?? 0) + by)) feedback('complete', 'success');
                  else playSound('tap');
                  addProgress(pickedQuest.id, by);
                }}
                onSet={(v) => {
                  if (v >= pickedQuest.target) feedback('complete', 'success');
                  else playSound('tap');
                  setProgress(pickedQuest.id, v);
                }}
              />
            ) : (
              <View style={styles.hint}>
                <SystemText variant="meta">
                  {week
                    ? 'Tap today or tomorrow to open it on the clock, or spread two fingers on the week.'
                    : quests.length
                      ? 'Tap a quest’s icon on the clock to see it and log it. Inside the ring: the ones with no set time. Hold one to carry it onto the ring and give it a time. Pinch the clock to see the week.'
                      : 'No quests on the board. Add some from the Archive.'}
                </SystemText>
              </View>
            )}

            {plan?.note ? (
              <SystemText variant="body" style={styles.note}>
                {plan.note}
              </SystemText>
            ) : null}
          </View>
        </Animated.View>

        {plan ? (
          <View style={styles.list}>
            <View style={styles.listHead}>
              <SystemText variant="heading" style={styles.listTitle}>
                {focusPart ? PART_META[focusPart].label : 'Hour by hour'}
              </SystemText>
              {focusPart ? (
                <SafePressable
                  onPress={() => {
                    playSound('tap');
                    setFocusPart(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Show the whole day">
                  <View style={styles.showAll}>
                    <SystemText variant="button" color={palette.accentSoft}>
                      Whole day
                    </SystemText>
                  </View>
                </SafePressable>
              ) : null}
            </View>
            <Timeline plan={plan} live={live} only={focusPart} />
            <GhostButton label={`Re-plan ${isToday ? 'today' : weekdayOf(date)}`} onPress={openChat} />
          </View>
        ) : plannerConfigured() ? (
          <Animated.View key={`empty-${date}`} entering={FadeIn.duration(220)} style={styles.empty}>
            {stored ? (
              // A plan from the first planner, which had no times.
              <SystemText variant="body" style={styles.cardBody}>
                This plan was made before the timeline. Its tasks are on the Quests board.
              </SystemText>
            ) : (
              <SystemText variant="body" style={styles.cardBody}>
                {resumable
                  ? 'You were in the middle of planning this. Your conversation is saved.'
                  : `No plan for ${isToday ? 'today' : weekdayOf(date)} yet. Beerus asks a few questions, then fills the clock with breathing room built in.`}
              </SystemText>
            )}
            <PrimaryButton
              label={stored ? 'Make a timeline for it' : resumable ? 'Resume planning' : `Plan ${isToday ? 'today' : weekdayOf(date)}`}
              onPress={openChat}
            />
          </Animated.View>
        ) : null}
      </MotionScroll>
    </Screen>
  );
}

/**
 * The quest picked on the clock: its icon and progress, when it happens,
 * and the buttons that log it — the same steps as its card on the board.
 */
function PickedQuest({
  quest,
  value,
  done,
  where,
  live,
  time,
  mine,
  onTime,
  onAdd,
  onSet,
}: {
  quest: QuestDef;
  value: number;
  done: boolean;
  where: string;
  /** Only today's quests can be logged. */
  live: boolean;
  /** Its time on the clock in day-minutes, or null when it has none. */
  time: number | null;
  /** The time is one you gave it, so it can be taken away again. */
  mine: boolean;
  /**
   * Move it: `undefined` gives it a first time, `{ from, by }` moves it, and
   * `null` takes your time away. The buttons do what carrying it onto the
   * clock does, for anyone who can't or would rather not drag.
   */
  onTime: (move: { from: number; by: number } | null | undefined) => void;
  onAdd: (by: number) => void;
  onSet: (value: number) => void;
}) {
  const color = categoryMeta[quest.category].color;
  const binary = quest.kind === 'binary' || quest.kind === 'window';
  const step = quest.step ?? 1;
  const ratio = Math.min(1, value / Math.max(1, quest.target));
  return (
    <Animated.View entering={FadeIn.duration(180)} style={[styles.picked, { borderColor: alpha(color, 0.45) }]}>
      <View style={styles.pickedHead}>
        <Ring size={48} stroke={4} ratio={done ? 1 : ratio} color={color}>
          <QuestIcon name={questIconKey(quest)} size={20} color={color} />
        </Ring>
        <View style={styles.pickedText}>
          <SystemText variant="title" numberOfLines={2}>
            {quest.title}
          </SystemText>
          <SystemText variant="meta">{where}</SystemText>
        </View>
        <SystemText variant="title" color={done ? palette.positive : palette.text} style={styles.pickedCount}>
          {binary ? (done ? 'Done' : '') : `${value}/${quest.target}`}
        </SystemText>
      </View>
      {live && !isCeilingQuest(quest) && quest.kind !== 'value' ? (
        <View style={styles.pickedButtons}>
          {binary ? (
            <ActionPill label={done ? 'Undo' : 'Mark done'} primary={!done} onPress={() => onSet(done ? 0 : quest.target)} />
          ) : (
            <>
              <ActionPill label={`−${step}`} onPress={() => onAdd(-Math.min(step, value))} disabled={value <= 0} />
              <ActionPill label={`+${step} ${quest.unit}`} primary onPress={() => onAdd(step)} />
            </>
          )}
        </View>
      ) : live ? (
        <SystemText variant="meta">Log this one on its card on the Today screen.</SystemText>
      ) : null}
      <View style={styles.pickedButtons}>
        {time === null ? (
          <ActionPill label="Give it a time" onPress={() => onTime(undefined)} />
        ) : (
          <>
            <ActionPill label="Earlier" onPress={() => onTime({ from: time, by: -15 })} />
            <ActionPill label="Later" onPress={() => onTime({ from: time, by: 15 })} />
            {mine ? <ActionPill label="No set time" onPress={() => onTime(null)} /> : null}
          </>
        )}
      </View>
    </Animated.View>
  );
}

function ActionPill({ label, onPress, primary, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <SafePressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: Boolean(disabled) }}>
      <View style={[styles.pill, primary ? styles.pillPrimary : styles.pillGhost, disabled && styles.off]}>
        <SystemText variant="button" color={primary ? palette.bg : palette.text}>
          {label}
        </SystemText>
      </View>
    </SafePressable>
  );
}

/* --------------------------------------------------------------- buttons */

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.primary}>
        <SystemText variant="button" color={palette.bg}>
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
        <SystemText variant="button" color={palette.text}>
          {label}
        </SystemText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl * 3 },
  hero: { marginTop: 2 },
  dateLine: { marginTop: 2 },
  switch: { marginTop: space.lg, marginBottom: space.lg },
  block: { marginBottom: space.lg },

  top: { gap: space.lg, alignItems: 'center' },
  topWide: { flexDirection: 'row', alignItems: 'flex-start' },
  clockWrap: { alignItems: 'center' },
  side: { width: '100%', gap: space.md },
  sideWide: { flex: 1, width: undefined, minWidth: 0 },

  parts: { gap: space.sm },
  part: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  partDot: { width: 12, height: 12, borderRadius: 6 },
  partText: { flex: 1, minWidth: 0, gap: 6 },
  partHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  partTitle: { fontSize: 16 },
  partTrack: { height: 6, borderRadius: 3, backgroundColor: alpha(palette.text, 0.07), overflow: 'hidden' },
  partFill: { height: 6, borderRadius: 3 },
  partNums: { alignItems: 'flex-end', minWidth: 54 },
  partNum: { fontSize: 17, fontVariant: ['tabular-nums'] },
  partNumLabel: { fontSize: 11 },

  hint: { paddingHorizontal: space.xs },
  picked: {
    borderWidth: 1,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    padding: space.lg,
    gap: space.md,
  },
  pickedHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pickedText: { flex: 1, minWidth: 0, gap: 2 },
  pickedCount: { fontVariant: ['tabular-nums'] },
  pickedButtons: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  pill: { minHeight: HIT, paddingHorizontal: space.xl, borderRadius: radius.pill, justifyContent: 'center' },
  pillPrimary: { backgroundColor: palette.accent },
  pillGhost: { backgroundColor: alpha(palette.text, 0.08) },
  off: { opacity: 0.35 },

  note: { fontSize: 15, lineHeight: 21, fontStyle: 'italic', color: palette.textMuted },

  list: { marginTop: space.xl, gap: space.lg },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listTitle: {},
  showAll: { minHeight: HIT, justifyContent: 'center', paddingHorizontal: space.sm },

  empty: { marginTop: space.xl, gap: space.md },
  cardBody: { fontSize: 15, lineHeight: 21, color: palette.textMuted },

  primary: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  ghost: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: HIT,
  },
});
