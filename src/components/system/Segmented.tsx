import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

export interface Segment<K extends string> {
  key: K;
  label: string;
  /** Optional count shown in a small badge, as on the Quests board. */
  count?: number;
}

/**
 * A row of pills that switches between views — the same look as the To do |
 * Done switch on the Quests board, so every switch in the app reads alike.
 *
 * One flat pressable per pill, never nested: react-native-web renders a
 * pressable as a <button>, and a button inside a button is invalid markup.
 */
export function Segmented<K extends string>({
  segments,
  value,
  onChange,
  tint = palette.accent,
}: {
  segments: Segment<K>[];
  value: K;
  onChange: (next: K) => void;
  tint?: string;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {segments.map((s) => {
        const selected = s.key === value;
        return (
          <Pressable
            key={s.key}
            style={styles.wrap}
            onPress={() => {
              if (selected) return;
              playSound('tap');
              onChange(s.key);
            }}
            accessibilityRole="tab"
            accessibilityLabel={s.count !== undefined ? `${s.label}, ${s.count}` : s.label}
            accessibilityState={{ selected }}>
            <Animated.View
              style={[
                styles.pill,
                {
                  backgroundColor: selected ? tint : alpha(palette.text, 0.04),
                  borderColor: selected ? tint : palette.border,
                  transitionProperty: ['backgroundColor', 'borderColor'],
                  transitionDuration: ['180ms', '180ms'],
                  transitionTimingFunction: ['ease-out', 'ease-out'],
                },
              ]}>
              <SystemText
                variant="title"
                color={selected ? palette.bg : palette.textMuted}
                style={styles.label}>
                {s.label}
              </SystemText>
              {s.count !== undefined ? (
                <View
                  style={[
                    styles.count,
                    { backgroundColor: selected ? alpha(palette.bg, 0.22) : alpha(tint, 0.16) },
                  ]}>
                  <SystemText variant="label" color={selected ? palette.bg : tint} style={styles.countText}>
                    {s.count}
                  </SystemText>
                </View>
              ) : null}
            </Animated.View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  wrap: { flex: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 11,
  },
  label: { fontSize: 15 },
  count: {
    minWidth: 22,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 1,
    alignItems: 'center',
  },
  countText: { fontSize: 10, letterSpacing: 0 },
});
