import { StyleSheet, View } from 'react-native';

import { BLOCK_FILL } from '@/components/charts/DayClock';
import { Ring } from '@/components/charts/Ring';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius } from '@/constants/theme';
import { fractionOf, spanOf } from '@/data/dayClock';
import { dayMinutes, type PlanBlock } from '@/data/timeline';
import { playSound } from '@/lib/feedback';

/** One day of the week, as the week draws it. */
export interface WeekDay {
  date: string;
  /** "Mon". */
  weekday: string;
  /** "Today", "Tomorrow", or the day of the month. */
  sub: string;
  cleared: number;
  total: number;
  perfect: boolean;
  future: boolean;
  /** The day's plan, when one was made. */
  plan: { wake: string; sleep: string; blocks: PlanBlock[] } | null;
  /** Minutes since waking, on today only: where the day has got to. */
  now: number | null;
  /** The Planner can open it: today and tomorrow. */
  opens: boolean;
}

/** The ring at the start of each row, and the room around it. */
const RING = 34;
const PAD = 6;

/**
 * Where a day's ring sits in the week, so the day's clock can shrink into it
 * and grow back out of it.
 */
export function weekAnchor(index: number, size: number): { x: number; y: number } {
  return { x: PAD + RING / 2 + 4, y: ((index + 0.5) * size) / 7 };
}

/**
 * The week, flat: seven rows, Monday first. Each day has its ring of quests
 * cleared, its plan laid along the waking day as a strip, and its count.
 * Days gone are dimmer; today shows where it has got to. Today and tomorrow
 * open on the clock when tapped.
 */
export function WeekView({
  days,
  selected,
  size,
  onOpen,
}: {
  days: WeekDay[];
  /** The day the Planner had open, which the clock shrank into. */
  selected: string;
  size: number;
  onOpen: (date: string) => void;
}) {
  const rowH = size / 7;
  return (
    <View style={{ width: size, height: size }}>
      {days.map((d) => {
        const on = d.date === selected;
        const past = !d.future && d.now === null;
        const ratio = d.total > 0 ? Math.min(1, d.cleared / d.total) : 0;
        const colour = d.perfect ? palette.gold : palette.accent;
        const row = (
          <View style={[styles.row, { height: rowH - 4 }, on && styles.rowOn, past && styles.past]}>
            <View style={styles.ringBox}>
              <Ring size={RING} stroke={4} ratio={d.future ? 0 : ratio} color={colour} track={alpha(palette.text, 0.08)}>
                <SystemText variant="meta" color={d.future ? palette.textMuted : palette.text} style={styles.ringText}>
                  {d.date.slice(8).replace(/^0/, '')}
                </SystemText>
              </Ring>
            </View>
            <View style={styles.label}>
              <SystemText variant="title" style={styles.weekday}>
                {d.weekday}
              </SystemText>
              <SystemText variant="meta" color={d.now !== null ? palette.accentSoft : undefined} style={styles.sub}>
                {d.sub}
              </SystemText>
            </View>
            <Strip day={d} />
            <SystemText variant="title" color={d.perfect ? palette.gold : d.future ? palette.textMuted : palette.text} style={styles.count}>
              {d.future ? (d.plan ? 'Planned' : '–') : d.total ? `${d.cleared}/${d.total}` : '–'}
            </SystemText>
          </View>
        );
        const words = `${d.weekday} ${d.sub}: ${d.future ? (d.plan ? 'planned' : 'not planned') : `${d.cleared} of ${d.total} cleared${d.perfect ? ', a perfect day' : ''}`}`;
        return d.opens ? (
          <Pressable
            key={d.date}
            onPress={() => {
              playSound('tap');
              onOpen(d.date);
            }}
            accessibilityRole="button"
            accessibilityLabel={`${words}. Open it on the clock`}
            style={styles.slot}>
            {row}
          </Pressable>
        ) : (
          <View key={d.date} accessible accessibilityLabel={words} style={styles.slot}>
            {row}
          </View>
        );
      })}
    </View>
  );
}

/** A day's plan laid flat along its waking day, as the clock lays it round. */
function Strip({ day }: { day: WeekDay }) {
  const wake = day.plan?.wake ?? '07:00';
  const span = spanOf(wake, day.plan?.sleep ?? '23:00');
  const at = (hhmm: string) => fractionOf(dayMinutes(hhmm, wake), span);
  const nowF = day.now === null ? null : fractionOf(day.now, span);
  return (
    <View style={styles.strip}>
      {day.plan?.blocks.map((b) => {
        const f0 = at(b.start);
        const f1 = Math.max(f0 + 0.01, at(b.end));
        return (
          <View
            key={b.id}
            style={[styles.block, { left: `${f0 * 100}%`, width: `${(f1 - f0) * 100}%`, backgroundColor: BLOCK_FILL[b.kind] }]}
          />
        );
      })}
      {/* Today: what is already behind you, veiled as on the clock, and now. */}
      {nowF !== null && nowF > 0 ? <View style={[styles.veil, { width: `${nowF * 100}%` }]} /> : null}
      {nowF !== null ? <View style={[styles.now, { left: `${nowF * 100}%` }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: PAD,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: alpha(palette.accent, 0.55), backgroundColor: alpha(palette.accent, 0.06) },
  past: { opacity: 0.62 },
  ringBox: { width: RING + 8, alignItems: 'center' },
  ringText: { fontSize: 12, fontVariant: ['tabular-nums'] },
  label: { width: 64 },
  weekday: { fontSize: 15 },
  sub: { fontSize: 11 },
  strip: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: alpha(palette.text, 0.06),
    overflow: 'hidden',
  },
  block: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2, opacity: 0.9 },
  veil: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: alpha(palette.bg, 0.62) },
  now: { position: 'absolute', top: -2, bottom: -2, width: 2, marginLeft: -1, backgroundColor: palette.text },
  count: { width: 62, textAlign: 'right', fontSize: 14, fontVariant: ['tabular-nums'] },
});
