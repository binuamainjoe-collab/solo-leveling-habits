import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, RadialGradient, Rect, Stop, Text } from 'react-native-svg';

import { display, palette, rankMeta, type Rank } from '@/constants/theme';

/** A pointy-topped hexagon of radius r around the middle of a 100 × 100 box. */
const hexagon = (r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

/**
 * Your rank as a seal: the letter burning in its rank's colour inside an
 * ember hexagon, the System's shape for a rank. It stands still; what it
 * means is enough. `tag` lets a ceremony address its parts.
 */
export function RankSeal({ rank, size, tag }: { rank: Rank; size: number; tag?: object }) {
  const id = useId().replace(/:/g, '');
  const colour = rankMeta[rank].color;
  return (
    <View style={{ width: size, height: size }} {...(tag ?? {})} accessibilityLabel={`${rank}-rank`}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`${id}e`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFB061" />
            <Stop offset="0.55" stopColor={palette.accent} />
            <Stop offset="1" stopColor={palette.accentDeep} />
          </LinearGradient>
          <RadialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colour} stopOpacity={0.42} />
            <Stop offset="0.6" stopColor={colour} stopOpacity={0.08} />
            <Stop offset="1" stopColor={colour} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id}g)`} />
        <Polygon points={hexagon(44)} fill="rgba(17,13,10,0.86)" stroke={`url(#${id}e)`} strokeWidth={3.2} strokeLinejoin="round" />
        <Polygon points={hexagon(37)} fill="none" stroke={`url(#${id}e)`} strokeOpacity={0.45} strokeWidth={1.2} strokeLinejoin="round" />
        <Text
          x="50"
          y="50"
          dy="17"
          textAnchor="middle"
          fontFamily={display.bold}
          fontSize={48}
          fill={colour}
          stroke="#FFF1DA"
          strokeOpacity={0.35}
          strokeWidth={0.8}>
          {rank}
        </Text>
      </Svg>
    </View>
  );
}
