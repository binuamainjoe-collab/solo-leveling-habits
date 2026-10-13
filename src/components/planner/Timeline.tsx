import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import {
  blockMinutes,
  dayMinutes,
  fromMinutes,
  groupByPeriod,
  NOON_STARTS,
  EVENING_STARTS,
  PERIOD_LABEL,
  type DraftPlan,
  type Period,
  type PlanBlock,
} from '@/data/timeline';

/** "45 min", "1h", "1h 15m". */
export function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** What the timeline needs to show today's plan as a working checklist. */
export interface LiveTimeline {
  /** Minutes into the day, from dayMinutes(). Drives the NOW marker. */
  now: number;
  isDone: (block: PlanBlock) => boolean;
  /** Habit progress, e.g. "15 / 60 min". */
  progressOf: (block: PlanBlock) => string | null;
  onToggleTask: (block: PlanBlock) => void;
}

/**
 * A day, top to bottom, in its three sections.
 *
 * Colour is rationed per the README: orange marks only where you are now,
 * gold marks only genuine priorities, and everything else is cream and grey
 * so a full day still reads calmly. Fixed commitments are drawn hollow —
 * present, but not yours to tick off.
 */
export function Timeline({
  plan,
  compact = false,
  live,
}: {
  plan: DraftPlan;
  /** The small version shown inside the chat. */
  compact?: boolean;
  live?: LiveTimeline;
}) {
  const groups = groupByPeriod(plan);
  const now = live ? nowPlacement(plan, live.now) : null;

  if (compact) return <CompactTimeline plan={plan} />;

  return (
    <View style={styles.root}>
      {groups.map((g, gi) => (
        <View key={g.period} style={styles.section}>
          <SectionHead period={g.period} plan={plan} />

          {g.blocks.length === 0 ? (
            <SystemText variant="meta" style={styles.free}>
              Free
            </SystemText>
          ) : (
            g.blocks.map((b, i) => (
              <Animated.View
                key={b.id}
                entering={FadeInDown.duration(260).delay(Math.min(360, (gi * 3 + i) * 40))}>
                {now?.beforeId === b.id ? <NowMarker minutes={live!.now} /> : null}
                <Row block={b} plan={plan} live={live} current={now?.insideId === b.id} />
              </Animated.View>
            ))
          )}

          {g.period === 'evening' && now?.atEnd ? <NowMarker minutes={live!.now} /> : null}
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- pieces */

function SectionHead({ period, plan }: { period: Period; plan: DraftPlan }) {
  const range =
    period === 'morning'
      ? `${plan.wake}–${fromMinutes(NOON_STARTS)}`
      : period === 'noon'
        ? `${fromMinutes(NOON_STARTS)}–${fromMinutes(EVENING_STARTS)}`
        : `${fromMinutes(EVENING_STARTS)}–${plan.sleep}`;

  return (
    <View style={styles.sectionHead}>
      <SystemText variant="label" color={palette.textMuted} style={styles.sectionLabel}>
        {PERIOD_LABEL[period].toUpperCase()}
      </SystemText>
      <View style={styles.hairline} />
      <SystemText variant="label" color={palette.textFaint} style={styles.sectionRange}>
        {range}
      </SystemText>
    </View>
  );
}

function NowMarker({ minutes }: { minutes: number }) {
  return (
    <View style={styles.now} accessibilityLabel={`Now, ${fromMinutes(minutes)}`}>
      <SystemText variant="label" color={palette.accent} style={styles.nowLabel}>
        NOW {fromMinutes(minutes)}
      </SystemText>
      <View style={styles.nowLine} />
    </View>
  );
}

function Row({
  block,
  plan,
  live,
  current,
}: {
  block: PlanBlock;
  plan: DraftPlan;
  live?: LiveTimeline;
  current: boolean;
}) {
  const minutes = Math.max(0, blockMinutes(block, plan.wake));

  if (block.kind === 'break') {
    return (
      <View style={styles.breakRow}>
        <View style={styles.timeCol} />
        <View style={styles.railCol}>
          <View style={styles.breakTick} />
        </View>
        <SystemText variant="meta" style={styles.breakText}>
          {block.title} · {formatMinutes(minutes)}
        </SystemText>
      </View>
    );
  }

  const done = live ? live.isDone(block) : false;
  const progress = live && block.kind === 'habit' ? live.progressOf(block) : null;

  const body = (
    <View
      style={[
        styles.card,
        block.kind === 'fixed' ? styles.cardFixed : styles.cardFilled,
        current && styles.cardCurrent,
      ]}>
      <View style={styles.cardTop}>
        <SystemText
          variant="title"
          numberOfLines={2}
          style={[
            styles.title,
            { color: block.kind === 'fixed' ? palette.textMuted : done ? palette.textFaint : palette.text },
            done && styles.titleDone,
          ]}>
          {block.title}
        </SystemText>
        <KindTag block={block} done={done} />
      </View>
      {block.focus ? (
        <SystemText variant="body" numberOfLines={2} style={[styles.focus, done && styles.titleDone]}>
          {block.focus}
        </SystemText>
      ) : null}
      <SystemText variant="meta" style={styles.cardMeta}>
        {formatMinutes(minutes)}
        {progress ? ` · ${progress}` : ''}
        {block.kind === 'task' && live && !done ? ' · tap when done' : ''}
      </SystemText>
    </View>
  );

  return (
    <View style={styles.row}>
      <View style={styles.timeCol}>
        <SystemText variant="numeral" style={styles.start}>
          {block.start}
        </SystemText>
        <SystemText variant="meta" style={styles.end}>
          {block.end}
        </SystemText>
      </View>
      <View style={styles.railCol}>
        <View
          style={[
            styles.dot,
            dotStyle(block, done),
          ]}
        />
        <View style={styles.railLine} />
      </View>
      <View style={styles.bodyCol}>
        {block.kind === 'task' && live ? (
          // One flat pressable around the card; nothing inside it presses.
          <Pressable
            onPress={() => live.onToggleTask(block)}
            accessibilityRole="checkbox"
            accessibilityLabel={block.title}
            accessibilityState={{ checked: done }}>
            {body}
          </Pressable>
        ) : (
          body
        )}
      </View>
    </View>
  );
}

function KindTag({ block, done }: { block: PlanBlock; done: boolean }) {
  if (done) {
    return (
      <SystemText variant="label" color={palette.positive} style={styles.tag}>
        ✓ DONE
      </SystemText>
    );
  }
  if (block.kind === 'fixed') {
    return (
      <SystemText variant="label" color={palette.textFaint} style={styles.tag}>
        FIXED
      </SystemText>
    );
  }
  if (block.kind === 'habit') {
    return (
      <SystemText variant="label" color={palette.violet} style={styles.tag}>
        DAILY
      </SystemText>
    );
  }
  if (block.priority === 'high') {
    return (
      <View style={styles.priority}>
        <SystemText variant="label" color={palette.gold} style={styles.tag}>
          PRIORITY
        </SystemText>
      </View>
    );
  }
  if (block.priority === 'low') {
    return (
      <SystemText variant="label" color={palette.textFaint} style={styles.tag}>
        OPTIONAL
      </SystemText>
    );
  }
  return null;
}

function dotStyle(block: PlanBlock, done: boolean) {
  if (done) return { backgroundColor: palette.positive, borderColor: palette.positive };
  if (block.kind === 'fixed') return { backgroundColor: palette.bg, borderColor: palette.textFaint };
  if (block.kind === 'habit') return { backgroundColor: alpha(palette.violet, 0.25), borderColor: palette.violet };
  if (block.priority === 'high') return { backgroundColor: alpha(palette.gold, 0.25), borderColor: palette.gold };
  return { backgroundColor: palette.bg, borderColor: palette.text };
}

/* ---------------------------------------------------------------- compact */

/**
 * One line per block, for the draft card inside the chat. Big enough to read
 * the day at a glance, small enough not to push the conversation away.
 */
function CompactTimeline({ plan }: { plan: DraftPlan }) {
  return (
    <View style={styles.compact}>
      {groupByPeriod(plan).map((g) =>
        g.blocks.length === 0 ? null : (
          <View key={g.period} style={styles.compactGroup}>
            <SystemText variant="label" color={palette.textFaint} style={styles.compactPeriod}>
              {PERIOD_LABEL[g.period].toUpperCase()}
            </SystemText>
            {g.blocks.map((b) => (
              <View key={b.id} style={styles.compactRow}>
                <SystemText variant="meta" style={styles.compactTime}>
                  {b.start}
                </SystemText>
                <SystemText
                  variant="body"
                  numberOfLines={1}
                  style={[
                    styles.compactTitle,
                    b.kind === 'break' && styles.compactBreak,
                    b.kind === 'fixed' && { color: palette.textMuted },
                  ]}>
                  {b.kind === 'break'
                    ? `${b.title} · ${formatMinutes(blockMinutes(b, plan.wake))}`
                    : b.focus
                      ? `${b.title} — ${b.focus}`
                      : b.title}
                </SystemText>
                {b.kind === 'task' && b.priority === 'high' ? (
                  <SystemText variant="label" color={palette.gold} style={styles.compactTag}>
                    ◆
                  </SystemText>
                ) : b.kind === 'habit' ? (
                  <SystemText variant="label" color={palette.violet} style={styles.compactTag}>
                    ◇
                  </SystemText>
                ) : null}
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/* ------------------------------------------------------------------- now */

/**
 * Where "now" falls: inside a block (highlight it), just before one (draw
 * the marker above it), or after everything (draw it at the end).
 */
function nowPlacement(
  plan: DraftPlan,
  now: number,
): { insideId?: string; beforeId?: string; atEnd: boolean } {
  const sorted = [...plan.blocks].sort(
    (a, b) => dayMinutes(a.start, plan.wake) - dayMinutes(b.start, plan.wake),
  );
  for (const b of sorted) {
    const s = dayMinutes(b.start, plan.wake);
    const e = dayMinutes(b.end, plan.wake);
    if (now >= s && now < e && b.kind !== 'break') return { insideId: b.id, atEnd: false };
    if (now < s) return { beforeId: b.id, atEnd: false };
  }
  return { atEnd: true };
}

/* ---------------------------------------------------------------- styles */

const TIME_COL = 52;
const RAIL_COL = 18;

const styles = StyleSheet.create({
  root: { gap: space.lg },

  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 2 },
  sectionLabel: { fontSize: 10, letterSpacing: 2.4 },
  sectionRange: { fontSize: 9, letterSpacing: 0.6 },
  hairline: { flex: 1, height: 1, backgroundColor: palette.border },
  free: { fontSize: 12, color: palette.textFaint, paddingLeft: TIME_COL + RAIL_COL + space.sm },

  row: { flexDirection: 'row', alignItems: 'stretch' },
  timeCol: { width: TIME_COL, paddingTop: 10, alignItems: 'flex-end', paddingRight: space.sm },
  start: { fontSize: 14, lineHeight: 17, letterSpacing: -0.3 },
  end: { fontSize: 10, color: palette.textFaint, marginTop: 1 },

  railCol: { width: RAIL_COL, alignItems: 'center' },
  dot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, marginTop: 13 },
  railLine: { flex: 1, width: 1, backgroundColor: palette.border, marginTop: 3 },

  bodyCol: { flex: 1, paddingLeft: space.sm, paddingBottom: space.sm },
  card: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2, gap: 3 },
  cardFilled: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  cardFixed: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.border, borderStyle: 'dashed' },
  cardCurrent: { borderColor: alpha(palette.accent, 0.6), borderStyle: 'solid' },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1, fontSize: 15, lineHeight: 19 },
  titleDone: { textDecorationLine: 'line-through' },
  focus: { fontSize: 12, lineHeight: 16, color: palette.textMuted, marginTop: 2 },
  cardMeta: { fontSize: 11, color: palette.textMuted },
  tag: { fontSize: 8, letterSpacing: 1.4, marginTop: 4 },
  priority: {},

  breakRow: { flexDirection: 'row', alignItems: 'center', minHeight: 28, marginBottom: space.xs },
  breakTick: { width: 1, height: 24, backgroundColor: palette.border },
  breakText: { flex: 1, paddingLeft: space.sm, fontSize: 11, fontStyle: 'italic', color: palette.textFaint },

  now: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginVertical: space.xs },
  nowLabel: { width: TIME_COL + RAIL_COL - 4, textAlign: 'right', fontSize: 9, letterSpacing: 1.2 },
  nowLine: { flex: 1, height: 1.5, backgroundColor: palette.accent, borderRadius: 1 },

  compact: { gap: space.sm },
  compactGroup: { gap: 3 },
  compactPeriod: { fontSize: 8, letterSpacing: 1.8, marginBottom: 1 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  compactTime: { width: 38, fontSize: 11, color: palette.textMuted },
  compactTitle: { flex: 1, fontSize: 13, lineHeight: 17 },
  compactBreak: { fontStyle: 'italic', color: palette.textFaint, fontSize: 11 },
  compactTag: { fontSize: 10 },
});
