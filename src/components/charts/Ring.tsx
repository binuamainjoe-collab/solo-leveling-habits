import { useId, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Stop } from 'react-native-svg';

import { alpha, palette } from '@/constants/theme';

const WEB = Platform.OS === 'web';
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const FILL_MS = '520ms';

/**
 * A progress ring. `ratio` 0–1 is drawn clockwise from twelve o'clock, with
 * whatever is passed as children centred inside it. Give it two colours to
 * draw the arc as a gradient.
 *
 * With `depth` the ring is cut into the card: the arc runs in a dark groove
 * with a lit lip, catches a highlight along its outer edge and carries a hot
 * point at its head. On the web it also fills to a new value instead of
 * jumping, so you see how far it moved.
 */
export function Ring({
  size,
  stroke,
  ratio,
  color = palette.accent,
  colors,
  track = alpha(palette.text, 0.08),
  depth,
  children,
}: {
  size: number;
  stroke: number;
  ratio: number;
  color?: string;
  /** Start and end colours of the arc. */
  colors?: readonly [string, string];
  track?: string;
  depth?: boolean;
  children?: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  const r = (size - stroke) / 2;
  const clamped = Math.max(0, Math.min(1, ratio));
  const centre = size / 2;
  const ink = colors ? `url(#${id})` : color;
  const shown = clamped > 0 ? 1 : 0;

  // An arc of radius `radius`, filled to the current ratio. At zero it fades
  // out rather than unmounting, so it can fill from nothing.
  const arc = (radius: number, width: number, paint: string) => {
    const length = 2 * Math.PI * radius;
    const offset = length * (1 - clamped);
    return (
      <Circle
        cx={centre}
        cy={centre}
        r={radius}
        stroke={paint}
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${length} ${length}`}
        strokeDashoffset={offset}
        opacity={shown}
        transform={`rotate(-90 ${centre} ${centre})`}
        {...(WEB
          ? {
              style: {
                strokeDashoffset: offset,
                opacity: shown,
                transitionProperty: 'stroke-dashoffset, opacity',
                transitionDuration: `${FILL_MS}, 200ms`,
                transitionTimingFunction: EASE,
              } as object,
            }
          : null)}
      />
    );
  };

  // The hot point at the head of the arc turns with it.
  const turn = clamped * 360;
  const head: object = WEB
    ? {
        style: {
          transform: [{ rotate: `${turn}deg` }],
          transformOrigin: `${centre}px ${centre}px`,
          opacity: shown,
          transitionProperty: 'transform, opacity',
          transitionDuration: `${FILL_MS}, 200ms`,
          transitionTimingFunction: EASE,
        },
      }
    : { transform: `rotate(${turn} ${centre} ${centre})` };

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
        {depth ? (
          <>
            <Circle cx={centre} cy={centre} r={r} stroke="rgba(0,0,0,0.42)" strokeWidth={stroke} fill="none" />
            <Circle cx={centre} cy={centre} r={r} stroke={track} strokeWidth={stroke} fill="none" />
            <Circle cx={centre} cy={centre} r={r - stroke / 2 + 0.6} stroke="rgba(0,0,0,0.55)" strokeWidth={1.2} fill="none" />
            <Circle cx={centre} cy={centre} r={r + stroke / 2 - 0.6} stroke={alpha(palette.text, 0.1)} strokeWidth={1.2} fill="none" />
          </>
        ) : (
          <Circle cx={centre} cy={centre} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        )}
        {arc(r, stroke, ink)}
        {depth ? (
          <>
            {arc(r + stroke * 0.2, stroke * 0.22, 'rgba(255,240,222,0.34)')}
            <G opacity={shown} {...head}>
              <Circle cx={centre} cy={stroke / 2} r={stroke * 0.85} fill={alpha(palette.accentSoft, 0.22)} />
              <Circle cx={centre} cy={stroke / 2} r={stroke * 0.34} fill="#FFF1DA" opacity={0.9} />
            </G>
          </>
        ) : null}
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.centre]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: 'center', justifyContent: 'center' },
});
