import { useId, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop } from 'react-native-svg';

import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, palette } from '@/constants/theme';
import type { DayPoint } from '@/data/insights';
import { playSound } from '@/lib/feedback';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22 Oct" from a day key. */
export function shortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/**
 * A smooth line through the points (Catmull–Rom, drawn as cubic Béziers),
 * kept inside the chart so a spike cannot overshoot below zero.
 */
function smooth(xy: { x: number; y: number }[], floor: number): string {
  if (xy.length === 0) return '';
  let d = `M ${xy[0].x} ${xy[0].y}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i];
    const p1 = xy[i];
    const p2 = xy[i + 1];
    const p3 = xy[i + 2] ?? p2;
    const c1y = Math.min(floor, p1.y + (p2.y - p0.y) / 6);
    const c2y = Math.min(floor, p2.y - (p3.y - p1.y) / 6);
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${c1y}, ${p2.x - (p3.x - p1.x) / 6} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Quests cleared per day as a glowing area: the shape of the last couple
 * of weeks at a glance. Tap anywhere along it to read that day.
 */
export function AreaTrend({
  points,
  selected,
  onSelect,
  height = 120,
}: {
  points: DayPoint[];
  selected: string | null;
  onSelect: (date: string) => void;
  height?: number;
}) {
  const id = useId().replace(/:/g, '');
  const [width, setWidth] = useState(0);
  const max = Math.max(1, ...points.map((p) => p.cleared));
  const top = 10;
  const floor = height - 2;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const xy = points.map((p, i) => ({ x: i * step, y: floor - (p.cleared / max) * (floor - top) }));
  const line = smooth(xy, floor);
  const area = xy.length ? `${line} L ${xy[xy.length - 1].x} ${height} L 0 ${height} Z` : '';
  const at = points.findIndex((p) => p.date === selected);
  const mark = at >= 0 ? xy[at] : null;

  return (
    <View>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={gradient.ember[1]} stopOpacity={0.5} />
                <Stop offset="1" stopColor={gradient.ember[2]} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill={`url(#${id})`} />
            <Path d={line} stroke={palette.accent} strokeWidth={2.5} fill="none" strokeLinecap="round" />
            {mark ? (
              <>
                <Line x1={mark.x} y1={top - 6} x2={mark.x} y2={height} stroke={alpha(palette.text, 0.18)} strokeWidth={1} />
                <Circle cx={mark.x} cy={mark.y} r={6} fill={palette.bg} stroke={palette.accentSoft} strokeWidth={3} />
              </>
            ) : null}
          </Svg>
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.hits]}>
          {points.map((p) => (
            <Pressable
              key={p.date}
              style={styles.hit}
              onPress={() => {
                playSound('tap');
                onSelect(p.date);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: p.date === selected }}
              accessibilityLabel={`${shortDate(p.date)}: ${p.cleared} cleared`}
            />
          ))}
        </View>
      </View>
      <View style={styles.axis}>
        <SystemText variant="meta">{points[0] ? shortDate(points[0].date) : ''}</SystemText>
        <SystemText variant="meta">Today</SystemText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hits: { flexDirection: 'row' },
  hit: { flex: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
});
