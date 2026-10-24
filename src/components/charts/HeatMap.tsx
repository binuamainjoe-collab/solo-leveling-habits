import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, space } from '@/constants/theme';
import { heatLevel, type DayPoint } from '@/data/insights';
import { playSound } from '@/lib/feedback';

const ROWS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

/** Empty, then the ember in three strengths, then a perfect day at full glow. */
export const HEAT = [
  alpha(palette.text, 0.06),
  alpha(palette.accent, 0.28),
  alpha(palette.accent, 0.55),
  alpha(palette.accent, 0.82),
  palette.accentSoft,
];

/**
 * The consistency map: one column per week, Monday at the top, each square
 * as bright as that day was complete. Gaps show up as dark holes, which is
 * the point — a streak is something you can see. Tap a square to read it.
 */
export function HeatMap({
  weeks,
  today,
  selected,
  onSelect,
}: {
  weeks: DayPoint[][];
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const labelW = 30;
  const gap = 5;
  const cell = width > 0 ? Math.min(38, (width - labelW - gap * (weeks.length - 1)) / weeks.length) : 0;

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {cell > 0 ? (
        <View style={styles.grid}>
          <View style={[styles.rowLabels, { width: labelW, gap }]}>
            {ROWS.map((r, i) => (
              <View key={i} style={{ height: cell, justifyContent: 'center' }}>
                <SystemText variant="meta" style={styles.rowLabel}>
                  {r}
                </SystemText>
              </View>
            ))}
          </View>
          {weeks.map((week, w) => (
            <View key={w} style={[styles.col, { gap, marginLeft: w === 0 ? 0 : gap }]}>
              {week.map((p) => {
                const level = heatLevel(p);
                const on = p.date === selected;
                return (
                  <Pressable
                    key={p.date}
                    disabled={p.future}
                    onPress={() => {
                      playSound('tap');
                      onSelect(p.date);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on, disabled: p.future }}
                    accessibilityLabel={`${p.date}: ${p.cleared} of ${p.total} cleared`}>
                    <View
                      style={[
                        styles.cell,
                        {
                          width: cell,
                          height: cell,
                          borderRadius: cell * 0.3,
                          backgroundColor: p.future ? 'transparent' : HEAT[level],
                          borderColor: on ? palette.text : p.date === today ? alpha(palette.accentSoft, 0.8) : p.future ? alpha(palette.text, 0.06) : 'transparent',
                        },
                      ]}
                    />
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.legend}>
        <SystemText variant="meta">Less</SystemText>
        {HEAT.map((c, i) => (
          <View key={i} style={[styles.swatch, { backgroundColor: c }]} />
        ))}
        <SystemText variant="meta">Perfect</SystemText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row' },
  rowLabels: {},
  rowLabel: { fontSize: 11 },
  col: {},
  cell: { borderWidth: 1.5 },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: space.md },
  swatch: { width: 12, height: 12, borderRadius: 4 },
});
