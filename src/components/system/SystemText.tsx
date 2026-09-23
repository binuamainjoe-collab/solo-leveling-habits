import { memo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { font, palette } from '@/constants/theme';

export type TextVariant =
  | 'hero' // condensed uppercase slab — "DAY 14", the loudest thing on screen
  | 'heading' // screen titles — "Your Rating", "Trophy Hall"
  | 'title' // card titles
  | 'numeral' // giant right-aligned stat figures
  | 'label' // tiny letter-spaced uppercase captions
  | 'body' // running text
  | 'meta'; // the "↺ Daily · Medium · 5/8" row

interface Props extends TextProps {
  variant?: TextVariant;
  color?: string;
  /** Soft halo. Reserved for the accent — overuse flattens the hierarchy. */
  glow?: boolean;
  style?: StyleProp<TextStyle>;
}

function SystemTextBase({ variant = 'body', color, glow, style, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[
        styles[variant],
        color ? { color } : null,
        glow ? { textShadowColor: color ?? palette.accent, textShadowRadius: 18 } : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    fontFamily: font.display,
    fontSize: 34,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: palette.text,
  },
  heading: {
    fontFamily: font.heading,
    fontSize: 26,
    letterSpacing: -0.4,
    color: palette.text,
  },
  title: {
    fontFamily: font.heading,
    fontSize: 17,
    letterSpacing: -0.2,
    color: palette.text,
  },
  numeral: {
    fontFamily: font.numeral,
    fontSize: 40,
    letterSpacing: -1,
    color: palette.text,
  },
  label: {
    fontFamily: font.semi,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textFaint,
  },
  body: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 21,
    color: palette.textMuted,
  },
  meta: {
    fontFamily: font.body,
    fontSize: 12,
    letterSpacing: 0.2,
    color: palette.textMuted,
  },
});

export const SystemText = memo(SystemTextBase);
