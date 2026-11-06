import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardViewerHost } from '@/components/collection/CardViewer';
import { RingMenuHost } from '@/components/motion/RingMenu';
import { Scramble } from '@/components/motion/Scramble';
import { alpha, palette, radius, space } from '@/constants/theme';
import { haptic } from '@/lib/feedback';
import { isUndoSwipe, type Touch2 } from '@/lib/moves';
import { takeLastChange } from '@/lib/undo';
import { useProgress } from '@/store/progress';

/** How long the System's "undone" note stays. */
const NOTE_MS = 2200;

/**
 * The app-wide moves: a card opened to fill the screen, the ring menu a long
 * press opens, and the two-finger swipe to undo. Two fingers swept left
 * together take back the last change to a quest, if it was made in the last
 * few minutes, and the System says what it undid. A pinch never counts, and
 * nothing here blocks the browser's own zoom: it only watches.
 */
export function MovesHost() {
  const { setProgress } = useProgress();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState<{ text: string; id: number } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let from: Touch2['from'] | null = null;
    let to: Touch2['to'] | null = null;
    const point = (t: Touch) => ({ x: t.clientX, y: t.clientY });
    const down = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        from = [point(e.touches[0]), point(e.touches[1])];
        to = from;
      } else if (e.touches.length > 2) from = null;
    };
    const move = (e: TouchEvent) => {
      if (from && e.touches.length === 2) to = [point(e.touches[0]), point(e.touches[1])];
    };
    const up = () => {
      if (!from || !to) return;
      const swipe = { from, to };
      from = null;
      to = null;
      if (!isUndoSwipe(swipe)) return;
      const change = takeLastChange();
      haptic(change ? 'medium' : 'light');
      if (change) setProgress(change.questId, change.before);
      setNote({ text: change ? `Undone: ${change.title}` : 'Nothing to undo', id: Date.now() });
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    window.addEventListener('touchcancel', up, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, [setProgress]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <>
      <CardViewerHost />
      <RingMenuHost />
      {note ? (
        <Animated.View
          key={note.id}
          pointerEvents="none"
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(140)}
          style={[styles.note, { top: insets.top + space.md }]}>
          <View style={styles.pill}>
            <Scramble variant="label" color={palette.text} style={styles.noteText}>
              {note.text}
            </Scramble>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  note: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.45),
    backgroundColor: alpha(palette.surface, 0.94),
  },
  noteText: { fontSize: 13 },
});
