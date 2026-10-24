import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Polygon } from 'react-native-svg';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette } from '@/constants/theme';

/**
 * The six ability scores as a hexagon: a lopsided shape says at once which
 * side of life is being trained and which is being left behind — something
 * a column of six numbers never shows.
 */
export function Radar({
  size,
  axes,
}: {
  size: number;
  axes: { key: string; label: string; value: number; color: string }[];
}) {
  const pad = 34;
  const c = size / 2;
  const r = c - pad;
  const max = Math.max(20, ...axes.map((a) => a.value)) * 1.1;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
  const at = (i: number, f: number) => ({ x: c + Math.cos(angle(i)) * r * f, y: c + Math.sin(angle(i)) * r * f });
  const ring = (f: number) => axes.map((_, i) => at(i, f)).map((p) => `${p.x},${p.y}`).join(' ');
  const shape = axes.map((a, i) => at(i, a.value / max));

  return (
    <View style={{ width: size, height: size }} accessibilityLabel={axes.map((a) => `${a.label} ${a.value}`).join(', ')}>
      <Svg width={size} height={size}>
        {[1, 0.66, 0.33].map((f) => (
          <Polygon key={f} points={ring(f)} fill={f === 1 ? alpha(palette.text, 0.03) : 'none'} stroke={palette.border} strokeWidth={1} />
        ))}
        {axes.map((_, i) => {
          const p = at(i, 1);
          return <Line key={i} x1={c} y1={c} x2={p.x} y2={p.y} stroke={palette.border} strokeWidth={1} />;
        })}
        <Polygon
          points={shape.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={alpha(palette.accent, 0.28)}
          stroke={palette.accent}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {shape.map((p, i) => (
          <Circle key={axes[i].key} cx={p.x} cy={p.y} r={4.5} fill={axes[i].color} stroke={palette.surface} strokeWidth={2} />
        ))}
      </Svg>
      {axes.map((a, i) => {
        const p = at(i, 1.22);
        return (
          <View key={a.key} pointerEvents="none" style={[styles.label, { left: p.x - 30, top: p.y - 17 }]}>
            <SystemText variant="meta" color={a.color} style={styles.key}>
              {a.key}
            </SystemText>
            <SystemText variant="meta" color={palette.text} style={styles.value}>
              {a.value}
            </SystemText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute', width: 60, alignItems: 'center' },
  key: { fontSize: 11, fontWeight: '700', lineHeight: 13 },
  value: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
