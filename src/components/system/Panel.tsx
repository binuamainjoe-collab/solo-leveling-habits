import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { revealProps } from '@/components/motion/Reveal';
import { Icon, type IconName } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space, SURFACE_ALPHA } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

/**
 * A dashboard panel: a symbol, a title that says what the chart is, one
 * line on how to read it, and at most one control on the right (a range
 * switch, a link). The chart goes underneath.
 */
export function Panel({
  iconName,
  title,
  sub,
  right,
  children,
  style,
}: {
  iconName: IconName;
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View {...revealProps()} style={[styles.panel, style]}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Icon name={iconName} size={icon.body} color={palette.accentSoft} />
        </View>
        <View style={styles.headText}>
          <SystemText variant="title" numberOfLines={1}>
            {title}
          </SystemText>
          {sub ? (
            <SystemText variant="meta" numberOfLines={1}>
              {sub}
            </SystemText>
          ) : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Two or three choices in a small capsule — "2 weeks | 30 days". */
export function RangeSwitch<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.switch}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (on) return;
              playSound('tap');
              onChange(o.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}>
            <View style={[styles.switchItem, on && styles.switchOn]}>
              <SystemText variant="meta" color={on ? palette.text : palette.textMuted} style={styles.switchLabel}>
                {o.label}
              </SystemText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A quiet text link with a chevron, for "Open planner" in a panel's corner. */
export function PanelLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <View style={styles.link}>
        <SystemText variant="meta" color={palette.accentSoft} style={styles.switchLabel}>
          {label}
        </SystemText>
        <Icon name="chevron" size={icon.small} color={palette.accentSoft} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: alpha(palette.surface, SURFACE_ALPHA),
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space.lg,
    gap: space.md,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: alpha(palette.accent, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1, minWidth: 0 },
  switch: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.pill,
    padding: 3,
  },
  // 32 tall inside a 38 capsule; the capsule's padding brings the target up.
  switchItem: { minHeight: 32, paddingHorizontal: space.md, borderRadius: radius.pill, justifyContent: 'center' },
  switchOn: { backgroundColor: palette.surfaceHover },
  switchLabel: { fontWeight: '600' },
  link: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: 2 },
});
