import { useId, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { alpha, palette } from '@/constants/theme';

/**
 * A progress ring. `ratio` 0–1 is drawn clockwise from twelve o'clock, with
 * whatever is passed as children centred inside it. Give it two colours to
 * draw the arc as a gradient.
 */
export function Ring({
  size,
  stroke,
  ratio,
  color = palette.accent,
  colors,
  track = alpha(palette.text, 0.08),
  children,
}: {
  size: number;
  stroke: number;
  ratio: number;
  color?: string;
  /** Start and end colours of the arc. */
  colors?: readonly [string, string];
  track?: string;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio));
  const centre = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {colors ? (
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="1" stopColor={colors[1]} />
            </LinearGradient>
          </Defs>
        ) : null}
        <Circle cx={centre} cy={centre} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {clamped > 0 ? (
          <Circle
            cx={centre}
            cy={centre}
            r={r}
            stroke={colors ? `url(#${id})` : color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - clamped)}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        ) : null}
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.centre]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
