import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, LinearGradient, Rect, Stop } from 'react-native-svg';

import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, palette, radius } from '@/constants/theme';
import type { DayPoint } from '@/data/insights';
import { playSound } from '@/lib/feedback';

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A week as seven bars. The pale bar is how many quests were on the board
 * that day, the ember bar how many were cleared, so a glance shows both how
 * much was done and how much was asked. Tap a day to read its numbers.
 */
export function WeekBars({
  points,
  selected,
  onSelect,
  height = 132,
}: {
  points: DayPoint[];
  selected: string | null;
  onSelect: (date: string) => void;
  height?: number;
}) {
  const id = useId().replace(/:/g, '');
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...points.map((p) => p.total));
  const slot = width / points.length;
  const bar = Math.min(28, slot * 0.56);

  return (
    <View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={gradient.ember[0]} />
                <Stop offset="0.55" stopColor={gradient.ember[1]} />
                <Stop offset="1" stopColor={gradient.ember[2]} />
              </LinearGradient>
            </Defs>
            {points.map((p, i) => {
              const x = i * slot + (slot - bar) / 2;
              const totalH = p.total > 0 ? Math.max(6, (p.total / max) * height) : 6;
              const doneH = p.cleared > 0 ? Math.max(6, (p.cleared / max) * height) : 0;
              const on = p.date === selected;
              return (
                <G key={p.date}>
                  <Rect
                    x={x}
                    y={height - totalH}
                    width={bar}
                    height={totalH}
                    rx={bar / 2.6}
                    fill={p.future ? alpha(palette.text, 0.03) : alpha(palette.text, on ? 0.12 : 0.07)}
                  />
                  {doneH > 0 ? (
                    <Rect
                      x={x}
                      y={height - doneH}
                      width={bar}
                      height={doneH}
                      rx={bar / 2.6}
                      fill={`url(#${id})`}
                      opacity={selected && !on ? 0.55 : 1}
                    />
                  ) : null}
                </G>
              );
            })}
          </Svg>
        ) : null}
        {/* The bars are drawn; the taps land on plain views laid over them. */}
        <View style={[StyleSheet.absoluteFill, styles.hits]}>
          {points.map((p, i) => (
            <Pressable
              key={p.date}
              style={styles.hit}
              disabled={p.future}
              onPress={() => {
                playSound('tap');
                onSelect(p.date);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: p.date === selected, disabled: p.future }}
              accessibilityLabel={`${DAY[i] ?? p.date}: ${p.cleared} of ${p.total} cleared`}
            />
          ))}
        </View>
      </View>
      <View style={styles.labels}>
        {points.map((p, i) => (
          <SystemText
            key={p.date}
            variant="meta"
            color={p.date === selected ? palette.text : palette.textMuted}
            style={[styles.label, p.date === selected && styles.labelOn]}>
            {points.length === 7 ? DAY[i] : ''}
          </SystemText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hits: { flexDirection: 'row' },
  hit: { flex: 1, borderRadius: radius.md },
  labels: { flexDirection: 'row', marginTop: 6 },
  label: { flex: 1, textAlign: 'center' },
  labelOn: { fontWeight: '600' },
});
