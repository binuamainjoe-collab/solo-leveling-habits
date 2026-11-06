import { useEffect, useState, type ReactNode } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDragSheet } from '@/components/motion/useDragSheet';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import { playSound } from '@/lib/feedback';

/**
 * A sheet that slides up over the screen: a grabber, a header row the
 * caller fills, and scrolling content. Drag it down or flick it away, or tap
 * the dimmed screen above it or the close button. On a wide screen it stays a
 * readable column in the middle instead of stretching edge to edge.
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
  const tall = screen * height;

  // Stays on screen after `visible` goes false, long enough to slide away.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);

  const { open, leave, pan, contentRef, sheetStyle, backdropStyle } = useDragSheet(tall, onClose);

  useEffect(() => {
    if (visible) open();
    else leave(() => setMounted(false));
  }, [visible, open, leave]);

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal content renders outside the app's root view on Android, so it
          needs its own gesture root or none of its buttons respond. */}
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.frame}>
          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <Pressable style={styles.flex} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View style={[styles.sheet, { height: tall }, sheetStyle]}>
            <GestureDetector gesture={pan} touchAction="none">
              <View collapsable={false}>
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
              </View>
            </GestureDetector>
            <ScrollView
              ref={contentRef as never}
              style={[styles.flex, styles.contained]}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
              showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  contained: { overscrollBehavior: 'contain' } as object,
  frame: { flex: 1, justifyContent: 'flex-end', overflow: 'hidden' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: alpha('#000000', 0.6) },
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
    willChange: 'transform',
  } as object,
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
