import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

import { AreaTrend, shortDate } from '@/components/charts/AreaTrend';
import { DayStrip, KIND } from '@/components/charts/DayStrip';
import { HeatMap } from '@/components/charts/HeatMap';
import { WeekBars } from '@/components/charts/WeekBars';
import { BalanceRings, GROUP_META } from '@/components/dashboard/BalanceRings';
import { TodayHero, type NextStep } from '@/components/dashboard/TodayHero';
import { QuestCard } from '@/components/quest/QuestCard';
import { Card } from '@/components/system/Card';
import { Icon } from '@/components/system/Icon';
import { Panel, PanelLink, RangeSwitch } from '@/components/system/Panel';
import { Screen, useContentWidth } from '@/components/system/Screen';
import { PlanNudge } from '@/components/planner/PlanNudge';
import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, HIT, icon, palette, radius, space, type CategoryId } from '@/constants/theme';
import { plannerConfigured } from '@/data/planner';
import {
  balance,
  bestDay,
  compare,
  GROUP_OF,
  heatmap,
  nextBlock,
  salutation,
  series,
  thisWeek,
  type Group,
} from '@/data/insights';
import type { QuestDef } from '@/data/quests';
import { clockNow, dayMinutes, defaultPlanDate, prettyDate, type PlanBlock } from '@/data/timeline';
import { openAssistant } from '@/lib/assistantBus';
import { playSound } from '@/lib/feedback';
import {
  isCeilingQuest,
  isComplete,
  useActiveQuests,
  useDayLog,
  useDayStats,
  useProgress,
  windowState,
} from '@/store/progress';

type Page = 'todo' | 'done';
type Range = '14' | '30';

/** The clock, ticking once a minute, so "now" on the timeline stays true. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function QuestBoardScreen() {
  const { state, setProgress, addProgress } = useProgress();
  const active = useActiveQuests();
  const log = useDayLog();
  const { done: doneCount, total, level, into, need } = useDayStats();
  const { width, columns, wide } = useContentWidth();
  const now = useMinute();

  // Always open on To do — that is the page with work on it.
  const [page, setPage] = useState<Page>('todo');
  // Which way the incoming page should slide from, so switching reads as
  // moving between two pages laid side by side, not as content swapping.
  const [direction, setDirection] = useState<1 | -1>(1);
  /** Body, mind or life: tapping a balance ring narrows the board to it. */
  const [group, setGroup] = useState<Group | null>(null);
  /** The day the charts are pointing at. Every chart shares it. */
  const [selected, setSelected] = useState<string>(state.date);
  const [range, setRange] = useState<Range>('14');

  const allTodo = useMemo(
    () => active.filter((q) => !isComplete(q, state.values[q.id] ?? 0)),
    [active, state.values],
  );

  const { todo, done } = useMemo(() => {
    const t: QuestDef[] = [];
    const d: QuestDef[] = [];
    for (const q of active) {
      if (group && GROUP_OF[q.category] !== group) continue;
      if (isComplete(q, state.values[q.id] ?? 0)) d.push(q);
      else t.push(q);
    }
    return { todo: t, done: d };
  }, [active, state.values, group]);

  const tallies = useMemo(() => balance(active, (q) => isComplete(q, state.values[q.id] ?? 0)), [active, state.values]);
  const week = useMemo(() => thisWeek(log, state.date), [log, state.date]);
  const trend = useMemo(() => series(log, state.date, Number(range)), [log, state.date, range]);
  const change = useMemo(() => compare(log, state.date, Number(range)), [log, state.date, range]);
  // Enough weeks to fill the row: half a year on a desktop, two months on a phone.
  const weeks = useMemo(() => heatmap(log, state.date, wide ? 26 : 8), [log, state.date, wide]);
  const best = bestDay(trend);

  const plan = state.plans[state.date]?.timeline;
  const clock = clockNow(now);

  // The one next step the hero offers: what the plan says is happening, or
  // the next open quest (mandatory first), or planning tomorrow.
  const step = useMemo<NextStep>(() => {
    const block = plan ? nextBlock(plan.blocks, clock, plan.wake) : null;
    const doable = allTodo.filter((q) => q.kind !== 'value' && !isCeilingQuest(q) && windowState(q, now).open);
    const quest = doable.find((q) => q.penalty) ?? doable[0];
    if (block && (block.status === 'now' || block.minutes <= 30 || !quest)) return { kind: 'block', next: block };
    if (quest) return { kind: 'quest', quest, value: state.values[quest.id] ?? 0 };
    const planDate = defaultPlanDate(now);
    if (plannerConfigured() && !state.plans[planDate]) {
      return { kind: 'plan', label: planDate === state.date ? 'Plan the rest of today' : 'Plan tomorrow' };
    }
    return { kind: 'clear' };
  }, [plan, clock, allTodo, now, state.values, state.plans, state.date]);

  const runStep = () => {
    if (step.kind === 'block') router.push('/planner');
    else if (step.kind === 'plan') router.push({ pathname: '/planner-chat', params: { date: defaultPlanDate(now) } });
    else if (step.kind === 'quest') {
      const q = step.quest;
      if (q.kind === 'binary' || q.kind === 'window') setProgress(q.id, q.target);
      else addProgress(q.id, q.step ?? 1);
    }
  };

  const name = state.profile?.name?.trim();
  const greeting = `${salutation(now.getHours())}${name ? `, ${name}` : ''}`;

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

  const cleared = mandatoryDone === mandatory.length;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <View style={[styles.row, wide && styles.rowWide]}>
          <View style={wide ? styles.colWide : null}>
            <TodayHero
              greeting={greeting}
              done={doneCount}
              total={total}
              level={level}
              into={into}
              need={need}
              streak={state.streak}
              week={week}
              today={state.date}
              selected={selected}
              onSelectDay={setSelected}
              step={step}
              onStep={runStep}
              onAsk={() => openAssistant('chat')}
              compact={!wide}
            />
          </View>
          <Panel
            iconName="planner"
            title="Today's plan"
            sub={plan ? `${plan.blocks.length} blocks, ${plan.wake} to ${plan.sleep}` : 'No timeline for today yet'}
            right={plan ? <PanelLink label="Open" onPress={() => router.push('/planner')} /> : null}
            style={wide ? styles.colNarrow : null}>
            {plan ? (
              <>
                <DayStrip
                  blocks={plan.blocks}
                  wake={plan.wake}
                  sleep={plan.sleep}
                  now={clock}
                  hour={wide ? 120 : 84}
                  onOpen={() => router.push('/planner')}
                />
                <UpNext blocks={plan.blocks} wake={plan.wake} now={clock} onOpen={() => router.push('/planner')} />
              </>
            ) : (
              <EmptyAction
                strip={
                  <DayStrip
                    blocks={[]}
                    wake={state.settings.wake ?? '07:00'}
                    sleep={state.settings.sleep ?? '23:00'}
                    now={clock}
                    onOpen={() => router.push('/planner')}
                  />
                }
                body="Lay today out hour by hour, so you never have to decide what comes next."
                action="Plan today"
                onPress={() => router.push({ pathname: '/planner-chat', params: { date: state.date } })}
              />
            )}
          </Panel>
        </View>

        {/* In the small hours the nudge would offer today, which the plan panel above already does. */}
        {defaultPlanDate(now) !== state.date ? <PlanNudge /> : null}

        <SystemText variant="heading" style={styles.sectionTitle}>
          Today’s quests
        </SystemText>

        <BalanceRings tallies={tallies} selected={group} onSelect={setGroup} />

        {mandatory.length > 0 ? (
          <View style={[styles.mandatory, { borderColor: alpha(cleared ? palette.positive : palette.negative, 0.35) }]}>
            <View style={styles.warningHead}>
              <Icon name={cleared ? 'check' : 'warning'} size={icon.body} color={cleared ? palette.positive : palette.negative} />
              {/* The System's announcement keeps its own words and capitals. */}
              <SystemText variant="title" color={cleared ? palette.positive : palette.negative} style={styles.warningTitle}>
                DAILY QUEST — {cleared ? 'CLEARED' : 'INCOMPLETE'}
              </SystemText>
              <SystemText variant="title" color={palette.text}>
                {mandatoryDone}/{mandatory.length}
              </SystemText>
            </View>
            <View style={styles.mandatoryTrack}>
              {mandatory.map((q) => (
                <View
                  key={q.id}
                  style={[
                    styles.mandatorySeg,
                    { backgroundColor: isComplete(q, state.values[q.id] ?? 0) ? palette.positive : alpha(palette.text, 0.1) },
                  ]}
                />
              ))}
            </View>
            <SystemText variant="meta" style={styles.warningBody}>
              {cleared
                ? 'All mandatory objectives cleared. The penalty zone remains sealed.'
                : 'Failure to complete the daily quest will result in an appropriate penalty.'}
            </SystemText>
          </View>
        ) : null}

        {group ? (
          <Pressable
            onPress={() => {
              playSound('tap');
              setGroup(null);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Showing ${GROUP_META[group].label} quests only. Show all`}>
            <View style={[styles.filter, { backgroundColor: alpha(GROUP_META[group].color, 0.14) }]}>
              <SystemText variant="meta" color={palette.text} style={styles.filterText}>
                Showing {GROUP_META[group].label.toLowerCase()} quests
              </SystemText>
              <Icon name="close" size={icon.small} color={palette.text} />
            </View>
          </Pressable>
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
                      {/* The category's own glyph is part of the game's art and stays. */}
                      <SystemText variant="title" color={cat.color} style={styles.groupGlyph}>
                        {cat.glyph}
                      </SystemText>
                      <SystemText variant="title" style={styles.groupTitle}>
                        {cat.label}
                      </SystemText>
                      <SystemText variant="meta">{quests.length}</SystemText>
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

        <SystemText variant="heading" style={styles.sectionTitle}>
          Your week
        </SystemText>
        <SystemText variant="meta" style={styles.sectionSub}>
          {readout(log[selected], selected, state.date)}
        </SystemText>

        <View style={[styles.row, wide && styles.rowWide]}>
          <Panel iconName="bars" title="This week" sub="Pale bar: on the board. Ember: cleared." style={wide ? styles.colHalf : null}>
            <WeekBars points={week} selected={selected} onSelect={setSelected} />
          </Panel>
          <Panel
            iconName="trend"
            title="Momentum"
            sub={
              change.change === null
                ? `${change.now} cleared in ${range} days`
                : `${change.now} cleared, ${change.change >= 0 ? 'up' : 'down'} ${Math.abs(change.change)}% on the ${range} days before`
            }
            right={
              <RangeSwitch
                options={[
                  { value: '14', label: '2 wk' },
                  { value: '30', label: '30 d' },
                ]}
                value={range}
                onChange={setRange}
              />
            }
            style={wide ? styles.colHalf : null}>
            <AreaTrend points={trend} selected={selected} onSelect={setSelected} />
            {best ? (
              <Pressable
                onPress={() => {
                  playSound('tap');
                  setSelected(best.date);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Best day: ${shortDate(best.date)}, ${best.cleared} cleared. Show it`}>
                <View style={styles.best}>
                  <Icon name="flame" size={icon.small} color={palette.accentSoft} />
                  <SystemText variant="meta" color={palette.text}>
                    Best day: {shortDate(best.date)}, {best.cleared} cleared
                  </SystemText>
                </View>
              </Pressable>
            ) : null}
          </Panel>
        </View>

        <Panel
          iconName="calendar"
          title="Consistency"
          sub={`The last ${weeks.length} weeks. Brighter means more of the day got done.`}
          style={styles.consistency}>
          <HeatMap weeks={weeks} today={state.date} selected={selected} onSelect={setSelected} />
        </Panel>

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
            <Icon name="archive" size={icon.body} color={palette.accent} />
            <SystemText variant="body" color={palette.text} style={styles.archiveLabel}>
              Browse the Archive
            </SystemText>
            <Icon name="chevron" size={icon.small} color={palette.textMuted} />
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
    <View style={styles.switcher}>
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
      accessibilityRole="button"
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

/** The rest of today's plan as a short list: what is left, in order. */
function UpNext({ blocks, wake, now, onOpen }: { blocks: PlanBlock[]; wake: string; now: string; onOpen: () => void }) {
  const t = dayMinutes(now, wake);
  const left = blocks
    .filter((b) => {
      let e = dayMinutes(b.end, wake);
      if (e <= dayMinutes(b.start, wake)) e += 1440;
      return e > t;
    })
    .sort((a, b) => dayMinutes(a.start, wake) - dayMinutes(b.start, wake));
  const shown = left.slice(0, 4);
  return (
    <View style={styles.upNext}>
      <SystemText variant="label">{left.length ? 'Still to come' : 'Nothing else planned today'}</SystemText>
      {shown.map((b) => (
        <Pressable
          key={b.id}
          onPress={() => {
            playSound('tap');
            onOpen();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${b.start} ${b.title}. Open the planner`}>
          <View style={styles.upRow}>
            <SystemText variant="meta" color={palette.text} style={styles.upTime}>
              {b.start}
            </SystemText>
            <View style={[styles.upDot, { backgroundColor: KIND[b.kind].fill, borderColor: KIND[b.kind].border }]} />
            <SystemText variant="body" color={palette.text} numberOfLines={1} style={styles.upTitle}>
              {b.title}
            </SystemText>
          </View>
        </Pressable>
      ))}
      {left.length > shown.length ? <SystemText variant="meta">and {left.length - shown.length} more</SystemText> : null}
    </View>
  );
}

/** What the selected day was, in one sentence under "Your week". */
function readout(rec: { cleared: number; total: number; perfect: boolean } | undefined, date: string, today: string): string {
  const day = date === today ? 'Today' : prettyDate(date);
  if (date > today) return `${day} has not happened yet.`;
  if (!rec || rec.total === 0) return `${day}: nothing was on the board. Tap any day in the charts to read it.`;
  const pct = Math.round((rec.cleared / rec.total) * 100);
  return `${day}: ${rec.cleared} of ${rec.total} cleared (${pct}%)${rec.perfect ? ', a perfect day' : ''}. Tap any day in the charts to read it.`;
}

/** An empty panel says what it is for and offers the one action that fills it. */
function EmptyAction({
  strip,
  body,
  action,
  onPress,
}: {
  /** The empty day, drawn: the hours ahead with nothing in them yet. */
  strip?: ReactNode;
  body: string;
  action: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.emptyAction}>
      {strip}
      <SystemText variant="body" style={styles.emptyBody}>
        {body}
      </SystemText>
      <Pressable
        onPress={() => {
          playSound('tap');
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={action}>
        <View style={styles.emptyButton}>
          <SystemText variant="body" color={palette.bg} style={styles.filterText}>
            {action}
          </SystemText>
        </View>
      </Pressable>
    </View>
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
  scroll: { paddingBottom: space.xxl * 3 },
  row: { gap: space.lg, marginBottom: space.lg },
  rowWide: { flexDirection: 'row', alignItems: 'stretch' },
  colWide: { flex: 1.55, minWidth: 0 },
  colNarrow: { flex: 1, minWidth: 0 },
  colHalf: { flex: 1, minWidth: 0 },
  sectionTitle: { marginTop: space.xl, marginBottom: space.md },
  sectionSub: { marginTop: -space.sm, marginBottom: space.md },
  consistency: { marginBottom: space.lg },

  mandatory: {
    marginTop: space.md,
    marginBottom: space.lg,
    borderWidth: 1,
    borderRadius: radius.lg,
    backgroundColor: palette.surface,
    padding: space.lg,
    gap: space.sm,
  },
  mandatoryTrack: { flexDirection: 'row', gap: 3 },
  mandatorySeg: { flex: 1, height: 6, borderRadius: 3 },
  warningHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  warningTitle: { flex: 1, fontWeight: '700', letterSpacing: 0.4 },
  warningBody: { fontSize: 15, lineHeight: 20, marginTop: space.sm },

  filter: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    marginBottom: space.md,
  },
  filterText: { fontWeight: '600' },
  best: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },

  upNext: { gap: 2, marginTop: space.xs },
  upRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 40 },
  upTime: { width: 44, fontVariant: ['tabular-nums'], fontWeight: '600' },
  upDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  upTitle: { flex: 1, fontSize: 15 },

  emptyAction: { gap: space.md, paddingVertical: space.sm },
  emptyBody: { fontSize: 15, lineHeight: 20 },
  emptyButton: {
    alignSelf: 'flex-start',
    minHeight: HIT,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    justifyContent: 'center',
  },

  // An inset list row, the way iOS Settings does a link.
  archiveLink: {
    marginTop: space.xl,
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  archiveLabel: { flex: 1 },
  switcher: { flexDirection: 'row', gap: space.sm, marginBottom: space.xl },
  pillWrap: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    // 12 + a 20pt line = Apple's 44pt target.
    paddingVertical: 12,
  },
  pillLabel: { fontSize: 15 },
  pillCount: {
    minWidth: 22,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
    alignItems: 'center',
  },
  pillCountText: { fontSize: 11, letterSpacing: 0 },

  group: { marginBottom: space.xl },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  groupGlyph: { fontSize: 17 },
  groupTitle: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  emptyTitle: { fontSize: 22 },
});
