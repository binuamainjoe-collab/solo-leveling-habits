import type { ReactNode } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

/**
 * A sheet that slides up over the screen: a grabber, a header row the
 * caller fills, and scrolling content. Tap the dimmed screen above it, or
 * the close button, to put it away. On a wide screen it stays a readable
 * column in the middle instead of stretching edge to edge.
 */
export function Sheet({
  visible,
  onClose,
  header,
  children,
  height = 0.9,
}: {
  visible: boolean;
  onClose: () => void;
  /** The top row, beside the close button. */
  header?: ReactNode;
  children: ReactNode;
  /** Share of the screen height, 0–1. */
  height?: number;
}) {
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal content renders outside the app's root view on Android, so it
          needs its own gesture root or none of its buttons respond. */}
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.backdrop}>
          <Pressable style={styles.flex} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
          <View style={[styles.sheet, { height: screen * height }]}>
            <View style={styles.grabber} />
            <View style={styles.head}>
              <View style={styles.headContent}>{header}</View>
              <Pressable
                onPress={() => {
                  playSound('tap');
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel="Close">
                <View style={styles.close}>
                  <Icon name="close" size={icon.bar} color={palette.textMuted} />
                </View>
              </Pressable>
            </View>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
              showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: alpha('#000000', 0.6), justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    backgroundColor: palette.bg,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: alpha(palette.accent, 0.22),
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
    marginTop: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  headContent: { flex: 1, minWidth: 0 },
  close: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: space.lg, gap: space.lg },
});
