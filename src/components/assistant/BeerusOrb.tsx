import { useId } from 'react';
import { View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, Path, RadialGradient, Stop } from 'react-native-svg';

import { alpha, gradient, palette } from '@/constants/theme';

/**
 * Beerus: a glowing ember sphere with two narrow cat's eyes — the floating
 * button and the face at the top of the chat. `breathing` lets it swell
 * slowly while it waits for you, the one idle motion in the app; it holds
 * still when the system asks for reduced motion.
 */
export function BeerusOrb({ size, breathing = false, glow = true }: { size: number; breathing?: boolean; glow?: boolean }) {
  const id = useId().replace(/:/g, '');
  const reduced = useReducedMotion();
  const r = size / 2;
  // Almond eyes, tilted up at the outer corners.
  const eye = (cx: number, tilt: number) => {
    const w = size * 0.14;
    const h = size * 0.07;
    const y = size * 0.5;
    return `M ${cx - w} ${y + tilt} Q ${cx} ${y - h * 1.6} ${cx + w} ${y - tilt} Q ${cx} ${y + h * 1.4} ${cx - w} ${y + tilt} Z`;
  };

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: r },
        glow ? { boxShadow: `0 0 ${Math.round(size * 0.45)}px ${alpha(palette.accent, 0.45)}` } : null,
        breathing && !reduced
          ? {
              animationName: { from: { transform: [{ scale: 0.97 }] }, to: { transform: [{ scale: 1.04 }] } },
              animationDuration: '2600ms',
              animationIterationCount: 'infinite',
              animationDirection: 'alternate',
              animationTimingFunction: 'ease-in-out',
            }
          : null,
      ]}>
      <View pointerEvents="none">
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={`${id}b`} cx="38%" cy="32%" r="75%">
              <Stop offset="0" stopColor={gradient.ember[0]} />
              <Stop offset="0.5" stopColor={gradient.ember[1]} />
              <Stop offset="1" stopColor={gradient.ember[2]} />
            </RadialGradient>
            <RadialGradient id={`${id}s`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={r} cy={r} r={r} fill={`url(#${id}b)`} />
          {/* The gloss: a soft highlight up and to the left. */}
          <Ellipse cx={size * 0.36} cy={size * 0.27} rx={size * 0.22} ry={size * 0.13} fill={`url(#${id}s)`} />
          <Path d={eye(size * 0.35, -size * 0.035)} fill={alpha(palette.bg, 0.9)} />
          <Path d={eye(size * 0.65, size * 0.035)} fill={alpha(palette.bg, 0.9)} />
        </Svg>
      </View>
    </Animated.View>
  );
}
