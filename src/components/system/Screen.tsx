import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, space, WIDE } from '@/constants/theme';

const MAX_CONTENT = 1120;

/**
 * Shared screen frame: void background, safe-area top padding, and a centered
 * measured column so the layout doesn't sprawl on a desktop browser.
 */
export function Screen({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.column,
          { paddingTop: insets.top + space.lg, paddingHorizontal: wide ? space.xl : space.lg },
        ]}>
        {children}
      </View>
    </View>
  );
}

/** Width available to content inside <Screen>, for grid maths. */
export function useContentWidth(): { width: number; wide: boolean; columns: number } {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const gutter = (wide ? space.xl : space.lg) * 2;
  const inner = Math.min(width, MAX_CONTENT) - gutter;
  const columns = width >= 1180 ? 3 : wide ? 2 : 1;
  return { width: inner, wide, columns };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
});
