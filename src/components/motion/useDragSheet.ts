import { useCallback, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { haptic } from '@/lib/feedback';
import { project, rubberband, SPRING } from '@/lib/motion';

interface ScrollNode {
  getScrollableNode?: () => HTMLElement;
}

/**
 * The physics of anything that slides up and can be thrown away: a quest
 * sheet, the Beerus window. It follows the finger one to one, resists being
 * pulled past the top, and a flick is enough to send it off. Whether it goes
 * is judged by where the flick was heading, not by how far it travelled, and
 * the finger's speed carries straight into the spring.
 *
 * `startOpen` puts it in place from the first frame, for a sheet that has its
 * own way of appearing.
 */
export function useDragSheet(distance: number, onDismiss: () => void, startOpen = false) {
  const y = useSharedValue(startOpen ? 0 : distance);
  const start = useSharedValue(0);

  const open = useCallback(() => {
    y.set(withSpring(0, SPRING.sheet));
  }, [y]);

  const throwAway = useCallback(
    (velocity: number) => {
      'worklet';
      y.set(
        withSpring(distance, { ...SPRING.dismiss, velocity }, (finished) => {
          if (finished) scheduleOnRN(onDismiss);
        }),
      );
    },
    [distance, onDismiss, y],
  );

  const release = useCallback(
    (velocity: number) => {
      'worklet';
      const now = y.get();
      // A busy phone can under-report a flick's speed, so a quarter of the way
      // down also counts, unless the finger was already heading back up.
      if (now + project(velocity) > distance * 0.4 || (now > distance * 0.25 && velocity >= 0)) {
        throwAway(velocity);
      } else {
        y.set(withSpring(0, { ...SPRING.sheet, velocity }));
        scheduleOnRN(haptic, 'light');
      }
    },
    [distance, throwAway, y],
  );

  /** For a close button or a tap outside: leaves the way a drag would. */
  const close = useCallback(() => throwAway(0), [throwAway]);

  /** Leaves without asking anyone, for when the owner already said to close. */
  const leave = useCallback(
    (done: () => void) => {
      y.set(
        withSpring(distance, SPRING.dismiss, (finished) => {
          if (finished) scheduleOnRN(done);
        }),
      );
    },
    [distance, y],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetY([-6, 6])
        .onStart(() => {
          // Grabbing it mid-flight carries on from where the eye last saw it.
          cancelAnimation(y);
          start.set(y.get());
        })
        .onUpdate((e) => {
          const next = start.get() + e.translationY;
          y.set(next >= 0 ? next : rubberband(next, distance));
        })
        .onEnd((e) => release(e.velocityY)),
    [distance, release, start, y],
  );

  /**
   * On a phone a sheet's content is a scroller, and the browser owns a finger
   * on it. At the top, a pull down means "away", so that one case is taken
   * back from the browser; everywhere else the list scrolls as normal.
   */
  const contentRef = useCallback(
    (scroller: ScrollNode | null) => {
      if (Platform.OS !== 'web' || !scroller) return;
      const node = scroller.getScrollableNode?.();
      if (!node) return;

      let from = 0;
      let dragging = false;
      let lastY = 0;
      let lastT = 0;
      let speed = 0;

      const down = (e: TouchEvent) => {
        from = e.touches[0].clientY;
        lastY = from;
        lastT = e.timeStamp;
        speed = 0;
        dragging = false;
      };
      const move = (e: TouchEvent) => {
        const finger = e.touches[0].clientY;
        if (!dragging) {
          if (node.scrollTop > 0 || finger - from < 6 || !e.cancelable) return;
          dragging = true;
          from = finger;
          cancelAnimation(y);
        }
        e.preventDefault();
        y.set(Math.max(0, finger - from));
        const dt = e.timeStamp - lastT;
        if (dt > 0) speed = ((finger - lastY) / dt) * 1000;
        lastY = finger;
        lastT = e.timeStamp;
      };
      const up = () => {
        if (dragging) release(speed);
        dragging = false;
      };

      node.addEventListener('touchstart', down, { passive: true });
      node.addEventListener('touchmove', move, { passive: false });
      node.addEventListener('touchend', up);
      node.addEventListener('touchcancel', up);
      return () => {
        node.removeEventListener('touchstart', down);
        node.removeEventListener('touchmove', move);
        node.removeEventListener('touchend', up);
        node.removeEventListener('touchcancel', up);
      };
    },
    [release, y],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, distance], [1, 0], Extrapolation.CLAMP),
  }));

  useEffect(() => () => cancelAnimation(y), [y]);

  return { open, close, leave, pan, contentRef, sheetStyle, backdropStyle };
}
