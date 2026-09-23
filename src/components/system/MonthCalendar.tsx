import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { FadeIn } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, categoryMeta, palette, radius, space } from '@/constants/theme';
import { QUESTS_BY_ID } from '@/data/quests';
import { isComplete } from '@/data/completion';
import { todayKey, useDayLog, useProgress } from '@/store/progress';

/** Monday-first, to match how most of the world reads a week. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function MonthCalendar() {
  const { state } = useProgress();
  const log = useDayLog();

  const today = todayKey();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState<string | null>(today);

  const { cells, monthLabel } = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    // JS weeks start on Sunday; shift so Monday is column 0.
    const lead = (first.getDay() + 6) % 7;

    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(keyOf(cursor.year, cursor.month, d));

    return { cells: out, monthLabel: `${MONTHS[cursor.month]} ${cursor.year}` };
  }, [cursor]);

  const shift = (delta: number) =>
    setCursor((c) => {
      const next = new Date(c.year, c.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });

  const detail = selected ? log[selected] : undefined;
  const detailQuests = useMemo(() => {
    if (!detail) return [];
    return Object.entries(detail.values)
      .map(([id, v]) => ({ quest: QUESTS_BY_ID[id], value: v }))
      .filter((x) => x.quest && isComplete(x.quest, x.value));
  }, [detail]);

  return (
    <View>
      <View style={styles.header}>
        <NavButton label="‹" hint="Previous month" onPress={() => shift(-1)} />
        <SystemText variant="title" style={styles.monthLabel}>
          {monthLabel}
        </SystemText>
        <NavButton label="›" hint="Next month" onPress={() => shift(1)} />
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={styles.cell}>
            <SystemText variant="label" style={styles.weekday}>
              {d}
            </SystemText>
          </View>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((key, i) => {
          if (!key) return <View key={`pad-${i}`} style={styles.cell} />;

          const rec = log[key];
          const ratio = rec && rec.total > 0 ? rec.cleared / rec.total : 0;
          const isToday = key === today;
          const isSelected = key === selected;
          const day = Number(key.slice(-2));

          // Three states: perfect fills solid, partial tints by how much was
          // cleared, untouched stays a bare outline.
          const fill = rec?.perfect
            ? palette.accent
            : ratio > 0
              ? alpha(palette.accent, 0.16 + ratio * 0.4)
              : 'transparent';

          return (
            <Pressable
              key={key}
              style={styles.cell}
              onPress={() => setSelected(key)}
              accessibilityRole="button"
              accessibilityLabel={`${day} ${MONTHS[cursor.month]}${rec ? `, ${rec.cleared} of ${rec.total} cleared` : ', nothing logged'}`}
              accessibilityState={{ selected: isSelected }}>
              <View
                style={[
                  styles.day,
                  { backgroundColor: fill },
                  isToday && { borderColor: palette.accent, borderWidth: 1 },
                  isSelected && styles.daySelected,
                ]}>
                <SystemText
                  variant="meta"
                  color={rec?.perfect ? palette.bg : rec ? palette.text : palette.textFaint}
                  style={styles.dayNum}>
                  {day}
                </SystemText>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* selected-day detail */}
      <Animated.View key={selected ?? 'none'} entering={FadeIn.duration(220)} style={styles.detail}>
        {detail && detail.total > 0 ? (
          <>
            <View style={styles.detailHead}>
              <SystemText variant="label" color={palette.textMuted}>
                {selected === today ? 'Today' : formatLong(selected!)}
              </SystemText>
              <SystemText
                variant="label"
                color={detail.perfect ? palette.positive : palette.accent}>
                {detail.cleared} / {detail.total} cleared
                {detail.perfect ? ' · perfect' : ''}
              </SystemText>
            </View>
            <View style={styles.detailList}>
              {detailQuests.length ? (
                detailQuests.map(({ quest }) => (
                  <View key={quest.id} style={styles.detailChip}>
                    <SystemText variant="label" color={categoryMeta[quest.category].color}>
                      {quest.glyph} {quest.title}
                    </SystemText>
                  </View>
                ))
              ) : (
                <SystemText variant="meta" style={styles.empty}>
                  Nothing cleared this day.
                </SystemText>
              )}
            </View>
          </>
        ) : (
          <SystemText variant="meta" style={styles.empty}>
            {selected ? `${formatLong(selected)} — no record.` : 'Pick a day.'}
          </SystemText>
        )}
      </Animated.View>

      <View style={styles.legend}>
        <Legend color={palette.accent} label="Perfect" />
        <Legend color={alpha(palette.accent, 0.4)} label="Partial" />
        <Legend color="transparent" label="Missed" outline />
      </View>

      <SystemText variant="label" style={styles.streakNote}>
        {state.streak > 0
          ? `${state.streak} day streak · best ${state.bestStreak}`
          : `No active streak · best ${state.bestStreak}`}
      </SystemText>
    </View>
  );
}

function NavButton({ label, hint, onPress }: { label: string; hint: string; onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={hint}>
      <Animated.View
        style={[
          styles.nav,
          {
            backgroundColor: pressed ? alpha(palette.accent, 0.2) : alpha(palette.text, 0.06),
            transitionProperty: 'backgroundColor',
            transitionDuration: '120ms',
          },
        ]}>
        <SystemText variant="title" color={palette.text} style={styles.navGlyph}>
          {label}
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

function Legend({ color, label, outline }: { color: string; label: string; outline?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: color },
          outline && { borderWidth: 1, borderColor: palette.borderStrong },
        ]}
      />
      <SystemText variant="label" style={styles.legendLabel}>
        {label}
      </SystemText>
    </View>
  );
}

function formatLong(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  monthLabel: { fontSize: 17 },
  nav: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navGlyph: { fontSize: 18, lineHeight: 22 },
  weekRow: { flexDirection: 'row' },
  weekday: { fontSize: 9, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Seven per row, sized by percentage so it fits any card width.
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  day: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  daySelected: { borderColor: palette.text, borderWidth: 1.5 },
  dayNum: { fontSize: 11 },
  detail: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    minHeight: 64,
  },
  detailHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  detailList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
  detailChip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  empty: { color: palette.textFaint },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { fontSize: 9 },
  streakNote: { marginTop: space.sm, color: palette.textMuted },
});
