import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { alpha, palette, radius, space } from '@/constants/theme';

interface Props {
  children: ReactNode;
  /** Background illustration. Sits under a scrim so text stays readable. */
  art?: ImageSourcePropType;
  /** Tints the border and fill — used for achievement tiers, as Life Reset
   *  tints its whole Gold rank card. */
  tint?: string;
  /** Lighter surface for boxes nested inside another card. */
  raised?: boolean;
  /** 0–1. How hard the scrim bites; raise it when text runs long. */
  scrim?: number;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

function CardBase({
  children,
  art,
  tint,
  raised,
  scrim = 0.86,
  style,
  contentStyle,
}: Props) {
  return (
    <View
      style={[
        styles.root,
        raised && styles.raised,
        tint ? { borderColor: alpha(tint, 0.42), backgroundColor: alpha(tint, 0.07) } : null,
        style,
      ]}>
      {art ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image source={art} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} />
          {/* Two passes: a flat knock-back over the whole image, then a
              left-heavy gradient so the copy column stays legible while the
              art breathes on the right. */}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: alpha(palette.bg, 0.34) }]}
          />
          <LinearGradient
            colors={[
              alpha(palette.bg, scrim),
              alpha(palette.bg, scrim * 0.72),
              alpha(palette.bg, 0.06),
            ]}
            locations={[0, 0.52, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}

      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    // Clips the artwork to the rounded corners.
    overflow: 'hidden',
  },
  raised: { backgroundColor: palette.surfaceRaised, borderRadius: radius.md },
  content: { padding: space.lg },
});

export const Card = memo(CardBase);
