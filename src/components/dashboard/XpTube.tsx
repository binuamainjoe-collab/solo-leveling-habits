import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cubicBezier } from 'react-native-reanimated';

import { onLanding } from '@/components/motion/flight';
import { alpha, palette } from '@/constants/theme';

const POUR = cubicBezier(0.23, 1, 0.32, 1);
const POUR_MS = 600;

/**
 * The XP bar as a glass tube of liquid fire, its leading edge burning hottest.
 * At rest it is still. When a cleared quest lands in the ring its XP pours
 * in: the level rises and the fire rushes along inside and settles (the CSS in
 * src/app/+html.tsx), then it rests again. Any other change only slides the
 * level. A new level starts a fresh tube instead of draining the old one
 * backwards.
 */
export function XpTube({
  ratio,
  level,
  height = 10,
  style,
}: {
  ratio: number;
  level: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const filled = Math.max(0.03, Math.min(1, ratio));
  const round = height / 2;
  // Counts the landings, so each one remounts the fire and plays it once.
  const [pours, setPours] = useState(0);
  useEffect(() => onLanding((t) => t === 'ring' && setPours((n) => n + 1)), []);

  return (
    <View
      style={[styles.tube, { height, borderRadius: round }, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(filled * 100) }}>
      <Animated.View
        key={level}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: round,
            overflow: 'hidden',
            transform: [{ translateX: `${(filled - 1) * 100}%` }],
            transitionProperty: 'transform',
            transitionDuration: POUR_MS,
            transitionTimingFunction: POUR,
          },
        ]}>
        <LinearGradient
          colors={[palette.accentDeep, palette.accent, palette.accentSoft]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        {pours > 0 ? <View key={pours} {...({ dataSet: { flow: 'xp' } } as object)} style={styles.flow} /> : null}
        <LinearGradient
          colors={['rgba(255,241,218,0)', 'rgba(255,241,218,0.9)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.edge, { borderRadius: round }]}
        />
      </Animated.View>
      <View pointerEvents="none" style={[styles.gloss, { borderRadius: round }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tube: {
    maxWidth: 240,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderWidth: 1,
    borderColor: alpha(palette.accentSoft, 0.16),
    boxShadow: 'inset 0px 1px 3px rgba(0,0,0,0.6)',
  },
  // Three 40px bands wider than the tube, which is how far one pour carries the fire.
  flow: { position: 'absolute', top: 0, bottom: 0, left: -120, right: 0 },
  edge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: 10 },
  gloss: { position: 'absolute', left: 3, right: 3, top: 1, height: '36%', backgroundColor: 'rgba(255,240,225,0.14)' },
});
