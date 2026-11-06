import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';

import { usePageOnScreen } from '@/components/motion/SwipeTabs';
import { SystemText, type TextVariant } from '@/components/system/SystemText';
import { rollingParts } from '@/lib/flourish';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ROLL = cubicBezier(0.23, 1, 0.32, 1);

/**
 * Text whose digits roll to a new value like a counter, the ones place first.
 * Only a change rolls: it shows its first value at once. On a page that is
 * off screen it keeps what you last saw, so the roll plays when you get there
 * instead of somewhere you can't see it.
 *
 * `lineHeight` must match the text's, since each digit is a window that tall.
 */
export function Rolling({
  text,
  lineHeight,
  variant = 'numeral',
  color,
  style,
}: {
  text: string;
  lineHeight: number;
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const onScreen = usePageOnScreen();
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(text);
  if (onScreen && seen !== text) setSeen(text);
  const shown = onScreen ? text : seen;
  const parts = rollingParts(shown);
  const line = [style, { lineHeight }];

  return (
    <View style={styles.row}>
      {/* What a screen reader hears: the whole figure once, not ten digits a column. */}
      <SystemText variant={variant} style={styles.reader}>
        {shown}
      </SystemText>
      {parts.map((p, i) =>
        p.digit === null ? (
          <SystemText key={p.key} aria-hidden variant={variant} color={color} style={line}>
            {p.char}
          </SystemText>
        ) : (
          <View key={p.key} aria-hidden style={[styles.window, { height: lineHeight }]}>
            <Animated.View
              style={{
                transform: [{ translateY: -p.digit * lineHeight }],
                transitionProperty: 'transform',
                transitionDuration: reduced ? 0 : 480,
                transitionDelay: reduced ? 0 : (parts.length - 1 - i) * 40,
                transitionTimingFunction: ROLL,
              }}>
              {DIGITS.map((d) => (
                <SystemText key={d} variant={variant} color={color} style={[line, styles.digit, { height: lineHeight }]}>
                  {d}
                </SystemText>
              ))}
            </Animated.View>
          </View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  window: { overflow: 'hidden' },
  reader: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  digit: { fontVariant: ['tabular-nums'], textAlign: 'center' },
});
