import { memo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { palette, weight } from '@/constants/theme';
import { resolveType } from '@/data/typeScale';

/**
 * Every piece of text in the app, on Apple's text-style scale.
 *
 * The variants map to iOS text styles. Screens may still ask for a size in
 * `style`, but it is snapped to the nearest step of the scale (never below
 * 11pt) and given that step's line height unless the screen sets its own,
 * and its tracking is kept readable — see src/data/typeScale.ts. No font family is set anywhere, so the text is
 * the platform's own: SF Pro on Apple devices, Roboto on Android.
 */
export type TextVariant =
  | 'hero' // Large Title, heavy — the System's announcements: "DAILY QUEST", "PLAN SEALED"
  | 'heading' // Title 1 — screen titles
  | 'title' // Headline — card titles
  | 'numeral' // Large Title figures — level, XP, counts; tabular so they don't jiggle
  | 'label' // Caption 1, semibold caps — section and status labels
  | 'body' // Body — running text
  | 'meta'; // Footnote — the "Daily · Medium · 5/8" row

interface Props extends TextProps {
  variant?: TextVariant;
  color?: string;
  /** Soft halo. Reserved for the accent — overuse flattens the hierarchy. */
  glow?: boolean;
  style?: StyleProp<TextStyle>;
}

function SystemTextBase({ variant = 'body', color, glow, style, ...rest }: Props) {
  const flat = StyleSheet.flatten([
    styles[variant],
    color ? { color } : null,
    glow ? { textShadowColor: color ?? palette.accent, textShadowRadius: 18 } : null,
    style,
  ]);
  // The variant and the screen's own style are read apart, so a size the
  // screen changes gets the scale's line height, not the variant's.
  const own = StyleSheet.flatten(style) ?? {};
  return <Text maxFontSizeMultiplier={1.6} {...rest} style={[flat, resolveType(styles[variant], own)]} />;
}

const styles = StyleSheet.create({
  hero: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: weight.heavy,
    textTransform: 'uppercase',
    color: palette.text,
  },
  heading: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: weight.bold,
    color: palette.text,
  },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: weight.semibold,
    color: palette.text,
  },
  numeral: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: weight.bold,
    fontVariant: ['tabular-nums'],
    color: palette.text,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: weight.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: palette.textMuted,
  },
  body: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: weight.regular,
    color: palette.textMuted,
  },
  meta: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: weight.regular,
    color: palette.textMuted,
  },
});

export const SystemText = memo(SystemTextBase);
