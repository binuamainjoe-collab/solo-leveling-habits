import { useEffect, useRef, type ComponentProps } from 'react';
import { Platform, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { scrambled } from '@/lib/moves';

/** Long enough to read as the System decoding, short enough to never be waited on. */
const SCRAMBLE_MS = 520;
/** Letters flicker at about 30 a second; any faster reads as noise. */
const TICK_MS = 33;

/**
 * A System message that decodes itself: its letters flicker through glyphs
 * and settle left to right, once, as the pop-up it heads appears. Only the
 * System's own pop-ups use it, so it stays a signature, not a habit. The
 * text is written straight into the element each tick, so React does not
 * re-render for it, and screen readers hear the message as written.
 * Reduced motion shows it settled from the start.
 */
export function Scramble({ children, delay = 0, ...props }: ComponentProps<typeof SystemText> & { children: string; delay?: number }) {
  const ref = useRef<Text | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || reduced || !el) return;
    const text = children;
    let frame = 0;
    let start = 0;
    let lastTick = -1;
    const step = (now: number) => {
      if (!start) start = now + delay;
      const t = now - start;
      const p = t <= 0 ? 0 : t / SCRAMBLE_MS;
      const tick = Math.floor(Math.max(0, now) / TICK_MS);
      if (tick !== lastTick || p >= 1) {
        lastTick = tick;
        el.textContent = p >= 1 ? text : scrambled(text, p, tick);
      }
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.textContent = text;
    };
  }, [children, delay, reduced]);

  return (
    <SystemText accessibilityLabel={children} {...props}>
      {/* The inner span carries the letters, so writing to it leaves the styled text alone. */}
      <Text ref={ref} aria-hidden>
        {children}
      </Text>
    </SystemText>
  );
}
