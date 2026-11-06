import { memo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { display, palette, weight } from '@/constants/theme';
import { resolveType } from '@/data/typeScale';

/**
 * Every piece of text in the app, on Apple's text-style scale.
 *
 * The variants map to iOS text styles. Screens may still ask for a size in
 * `style`, but it is snapped to the nearest step of the scale (never below
 * 11pt) and given that step's line height unless the screen sets its own,
 * and its tracking is kept readable — see src/data/typeScale.ts.
 *
 * Two faces, with clear jobs: headings and figures (hero, heading, title,
 * numeral) are set in Outfit, a round geometric sans that suits the warm
 * look; everything you read (body, meta, label) stays in the platform's own
 * face, SF Pro or Roboto, which is the most legible at text sizes.
 */
export type TextVariant =
  | 'hero' // Large Title, heavy — the System's announcements: "DAILY QUEST", "PLAN SEALED"
  | 'heading' // Title 1 — screen titles
  | 'title' // Headline — card titles
  | 'numeral' // Large Title figures — level, XP, counts; tabular so they don't jiggle
  | 'label' // Footnote, semibold — section and status labels
  | 'button' // Subheadline, semibold — the words on a button
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
  // Outfit ships one file per weight. Asking a custom face for a weight
  // makes the browser fake a bold, so the weight picks the file instead.
  const face = DISPLAY.has(variant) && !own.fontFamily ? { fontFamily: faceFor(flat.fontWeight), fontWeight: 'normal' as const } : null;
  // Section headings brighten as they arrive, like the rest of the page.
  const arrive = variant === 'heading' ? { dataSet: { reveal: 'head' } } : null;
  return <Text maxFontSizeMultiplier={1.6} {...arrive} {...rest} style={[flat, face, resolveType(styles[variant], own)]} />;
}

const DISPLAY = new Set<TextVariant>(['hero', 'heading', 'title', 'numeral']);

function faceFor(w: TextStyle['fontWeight']): string {
  const n = typeof w === 'number' ? w : Number(w ?? 400);
  if (n >= 700 || w === 'bold') return display.bold;
  if (n >= 600) return display.semibold;
  if (n >= 500) return display.medium;
  return display.regular;
}

const styles = StyleSheet.create({
  hero: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: weight.bold,
    letterSpacing: -0.4,
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
  // Sentence case: tracked-out capitals are harder to read, and they shout.
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: weight.semibold,
    color: palette.textMuted,
  },
  button: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: weight.semibold,
    color: palette.text,
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
