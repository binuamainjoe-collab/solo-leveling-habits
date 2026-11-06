import { useEffect, useRef, type ReactNode } from 'react';
import { Platform, type ScrollViewProps } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue, withSpring } from 'react-native-reanimated';

import { summon } from '@/components/assistant/summon';
import { useTabsMotion } from '@/components/motion/SwipeTabs';
import { haptic } from '@/lib/feedback';
import { rubberband, SPRING } from '@/lib/motion';

export interface ScrollNode {
  getScrollableNode?: () => HTMLElement;
}

/**
 * A mouse wheel moves in hard notches, so on its own it jumps. This turns each
 * notch into a target and glides there, slowing as it arrives. A phone or a
 * trackpad already coasts by itself and is left completely alone.
 */
function useCoastingWheel(ref: React.RefObject<ScrollNode | null>) {
  useEffect(() => {
    if (Platform.OS !== 'web' || !window.matchMedia('(pointer: fine)').matches) return;
    const node = ref.current?.getScrollableNode?.();
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let target = 0;
    let frame = 0;
    let then = 0;

    const glide = (time: number) => {
      const dt = Math.min(40, time - then);
      then = time;
      const left = target - node.scrollTop;
      if (Math.abs(left) < 0.6) {
        node.scrollTop = target;
        frame = 0;
        return;
      }
      node.scrollTop += left * (1 - Math.exp(-dt / 90));
      frame = requestAnimationFrame(glide);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey) return;
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 90;
      if (!notch && !frame) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      const from = frame ? target : node.scrollTop;
      target = Math.max(0, Math.min(node.scrollHeight - node.clientHeight, from + delta));
      if (!frame) {
        then = performance.now();
        frame = requestAnimationFrame(glide);
      }
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/** How far a pull at the top has to go before letting go calls Beerus. */
const PULL = 110;

/**
 * Pulling down at the very top calls Beerus: he rises toward the finger as it
 * goes, a tick says the pull is far enough, and letting go there opens him.
 * Short of it, he settles back. Only a pull that starts at the top and goes
 * mostly downward counts, so scrolling and sideways swipes are left alone.
 */
function usePullToCall(ref: React.RefObject<ScrollNode | null>, onPull: (() => void) | undefined) {
  const call = useRef(onPull);
  useEffect(() => {
    call.current = onPull;
  });
  const wanted = Boolean(onPull);
  useEffect(() => {
    if (Platform.OS !== 'web' || !wanted) return;
    const node = ref.current?.getScrollableNode?.();
    if (!node) return;

    let fromX = 0;
    let fromY = 0;
    let pulling = false;
    let armed = false;
    const down = (e: TouchEvent) => {
      fromX = e.touches[0].clientX;
      fromY = e.touches[0].clientY;
      pulling = false;
      armed = false;
    };
    const move = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!pulling) {
        const dy = t.clientY - fromY;
        if (node.scrollTop > 0 || dy < 8 || Math.abs(t.clientX - fromX) * 1.2 > dy || e.touches.length > 1 || !e.cancelable) return;
        pulling = true;
        fromY = t.clientY;
      }
      e.preventDefault();
      const d = Math.max(0, t.clientY - fromY) / PULL;
      // Past the line it keeps coming, but grudgingly.
      const p = d <= 1 ? d : 1 + rubberband(d - 1, 1, 0.4);
      summon.set(p);
      if (!armed && p >= 1) {
        armed = true;
        haptic('tick');
      } else if (armed && p < 1) armed = false;
    };
    const up = () => {
      if (!pulling) return;
      pulling = false;
      if (armed) call.current?.();
      summon.set(withSpring(0, SPRING.settle));
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
  }, [ref, wanted]);
}

/**
 * The scroller every screen uses. It coasts under a mouse wheel, keeps scroll
 * from chaining to the page behind it, and tucks the tab bar away while you
 * read downward, bringing it back the moment you scroll up. Given `onPull`,
 * pulling down at the top calls Beerus. `onScroller` hands the scroller over
 * too, for a page that reads or moves its own scroll.
 */
export function MotionScroll({
  children,
  style,
  onPull,
  onScroller,
  ...props
}: ScrollViewProps & {
  children: ReactNode;
  onPull?: () => void;
  onScroller?: (node: ScrollNode | null) => void;
}) {
  const motion = useTabsMotion();
  const chrome = motion?.chrome;
  const pageScroll = motion?.scroll;
  const lastY = useSharedValue(0);
  const tucked = useSharedValue(0);
  const ref = useRef<ScrollNode | null>(null);
  useCoastingWheel(ref);
  usePullToCall(ref, onPull);

  const onScroll = useAnimatedScrollHandler((e) => {
    if (!chrome) return;
    const y = e.contentOffset.y;
    pageScroll?.set(y);
    const moved = y - lastY.get();
    lastY.set(y);
    const next = y < 40 ? 0 : moved > 3 ? 1 : moved < -3 ? 0 : tucked.get();
    if (next !== tucked.get()) {
      tucked.set(next);
      chrome.set(withSpring(next, SPRING.settle));
    }
  });

  return (
    <Animated.ScrollView
      ref={((node: ScrollNode | null) => {
        ref.current = node;
        onScroller?.(node);
      }) as never}
      onScroll={onScroll}
      scrollEventThrottle={16}
      style={[{ overscrollBehavior: 'contain' } as object, style]}
      {...props}>
      {children}
    </Animated.ScrollView>
  );
}
