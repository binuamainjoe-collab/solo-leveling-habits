import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { RectButton, ScrollView } from 'react-native-gesture-handler';

import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, palette, radius, space } from '@/constants/theme';

/**
 * One row of filter chips that scrolls sideways, for the Cards and Trophies panels.
 * shortcut: the scroller is pinned against growing/shrinking because RN Web squeezes a horizontal scroller in a column until its chips clip; revisit if RN Web fixes it.
 */
export function FilterChips<K extends string>({
  filters,
  value,
  onChange,
  style,
}: {
  filters: readonly { key: K; label: string }[];
  value: K;
  onChange: (next: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.scroll, style]} contentContainerStyle={styles.row}>
      {filters.map((f) => {
        const on = f.key === value;
        return (
          <RectButton
            key={f.key}
            onPress={() => onChange(f.key)}
            rippleColor={alpha(palette.accent, 0.2)}
            accessibilityRole="button"
            accessibilityLabel={f.label}
            accessibilityState={{ selected: on }}
            style={[styles.chip, { backgroundColor: on ? alpha(palette.accent, 0.18) : alpha(palette.text, 0.06) }]}>
            <SystemText variant="label" color={on ? palette.text : palette.textFaint}>
              {f.label}
            </SystemText>
          </RectButton>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { gap: space.sm, paddingRight: space.sm },
  chip: { minHeight: HIT, minWidth: HIT, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, paddingHorizontal: space.md },
});
