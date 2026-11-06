import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { usePageOnScreen } from '@/components/motion/SwipeTabs';
import { alpha, palette } from '@/constants/theme';
import { flameFor } from '@/lib/flourish';
import { useProgress } from '@/store/progress';

/** One tongue of flame in a 40 × 52 box, its rounded base on the bottom edge. */
const TONGUE = 'M20 0 C 27 12 36 22 36 35 A 16 16 0 0 1 4 35 C 4 22 13 12 20 0 Z';

const LAYERS = [
  { kind: 'outer', size: 1, top: palette.accentSoft, base: palette.accentDeep, alpha: 0.5 },
  { kind: 'mid', size: 0.7, top: '#FFC27A', base: palette.accent, alpha: 0.62 },
  { kind: 'core', size: 0.42, top: '#FFF1DA', base: '#FFD9A0', alpha: 0.78 },
] as const;

/**
 * The streak, burning in the bowl of the day's ring. Embers before there is a
 * streak, then a flame that grows every day you keep it, full height at a
 * month. Each tongue licks at its own pace (the CSS in src/app/+html.tsx), so
 * it never reads as a loop. It sits behind the figures and keeps low enough
 * that they stay legible. It is the one thing on Today that moves by itself,
 * so it holds still on a page you can't see and when Low power is on.
 */
export function RingFlame({ ring, stroke, streak }: { ring: number; stroke: number; streak: number }) {
  const id = useId().replace(/:/g, '');
  const bowl = ring - stroke * 2;
  const { height, glow } = flameFor(streak);
  const tall = bowl * 0.92 * height;
  const onScreen = usePageOnScreen();
  const lowPower = useProgress().state.settings?.lowPower ?? false;
  const rest = !onScreen || lowPower;

  return (
    <View
      pointerEvents="none"
      style={[styles.bowl, { top: stroke, left: stroke, width: bowl, height: bowl, borderRadius: bowl / 2 }]}>
      <Svg style={StyleSheet.absoluteFill} width={bowl} height={bowl}>
        <Defs>
          <RadialGradient id={`${id}bed`} cx="50%" cy="100%" rx="55%" ry="40%">
            <Stop offset="0" stopColor={palette.accent} stopOpacity={0.55 * glow} />
            <Stop offset="1" stopColor={palette.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={bowl / 2} cy={bowl} rx={bowl * 0.55} ry={bowl * 0.4} fill={`url(#${id}bed)`} />
      </Svg>
      {LAYERS.map((layer) => {
        const h = tall * layer.size;
        const w = (h * 40) / 52;
        return (
          <View
            key={layer.kind}
            {...({ dataSet: rest ? { flame: layer.kind, rest: '1' } : { flame: layer.kind } } as object)}
            style={[styles.tongue, { width: w, height: h, left: (bowl - w) / 2, opacity: layer.alpha * glow }]}>
            <Svg width={w} height={h} viewBox="0 0 40 52">
              <Defs>
                <LinearGradient id={`${id}${layer.kind}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={layer.top} stopOpacity={0} />
                  <Stop offset="0.45" stopColor={layer.top} stopOpacity={0.9} />
                  <Stop offset="1" stopColor={layer.base} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Path d={TONGUE} fill={`url(#${id}${layer.kind})`} />
            </Svg>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bowl: { position: 'absolute', overflow: 'hidden', backgroundColor: alpha(palette.bg, 0.25) },
  tongue: { position: 'absolute', bottom: -2 },
});
