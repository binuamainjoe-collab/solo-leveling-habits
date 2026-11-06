import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, space } from '@/constants/theme';

export interface Chapter {
  key: string;
  label: string;
}

interface ScrollHandle {
  getScrollableNode?: () => HTMLElement;
}

/**
 * Where each chapter of a long page starts, which one you are in, and a way
 * to go straight to one. Reads the scroller itself, so it never depends on
 * which page last scrolled, and changes state only when the chapter does.
 */
export function useChapters(count: number) {
  const scroller = useRef<ScrollHandle | null>(null);
  const [tops, setTops] = useState<number[]>(() => Array(count).fill(-1));
  const [span, setSpan] = useState(0);
  const [current, setCurrent] = useState(0);
  const reduced = useReducedMotion();
  const attach = useCallback((node: ScrollHandle | null) => {
    scroller.current = node;
  }, []);
  const topsRef = useRef(tops);
  useEffect(() => {
    topsRef.current = tops;
  });

  const measure = useCallback(() => {
    const el = scroller.current?.getScrollableNode?.();
    if (el) setSpan(Math.max(0, el.scrollHeight - el.clientHeight));
  }, []);

  /** Give each chapter's root `onLayout={onChapter(i)}`; it must be a direct child of the scroll content. */
  const onChapter = useCallback(
    (i: number) => (e: LayoutChangeEvent) => {
      const y = e.nativeEvent.layout.y;
      setTops((t) => (t[i] === y ? t : t.map((v, k) => (k === i ? y : v))));
      measure();
    },
    [measure],
  );

  useEffect(() => {
    const el = scroller.current?.getScrollableNode?.();
    if (!el) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      // The chapter whose start has passed the upper third of the screen.
      const line = el.scrollTop + el.clientHeight * 0.34;
      const t = topsRef.current;
      let i = 0;
      for (let k = 0; k < t.length; k++) if (t[k] >= 0 && t[k] <= line) i = k;
      // At the very bottom the last chapter is the one you are in, short or not.
      if (el.scrollTop >= el.scrollHeight - el.clientHeight - 2) i = t.length - 1;
      setCurrent(i);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    read();
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
    };
  }, [measure, tops]);

  const jump = useCallback(
    (i: number) => {
      const el = scroller.current?.getScrollableNode?.();
      const y = topsRef.current[i];
      if (!el || y < 0) return;
      // By, not to: react-native-web puts its own scrollTo({ x, y }) on the
      // scroller's element, which reads { top } as a trip to the very top.
      el.scrollBy({ top: Math.max(0, y - space.md) - el.scrollTop, behavior: reduced ? 'auto' : 'smooth' });
    },
    [reduced],
  );

  const ticks = tops.map((y) => (span > 0 && y >= 0 ? Math.min(1, y / span) : 0));
  return { attach, onChapter, onContentSize: measure, ticks, current, jump, ready: span > 0 && tops.every((y) => y >= 0) };
}

/**
 * The thin line down the right edge of the Status page: how far down the
 * page you are, a mark where each chapter starts, the chapter you are in and
 * its number. The fill follows the scroll on the compositor where the
 * browser can (CSS in src/app/+html.tsx); elsewhere it steps chapter by
 * chapter. Tap a mark to go to that chapter.
 */
export function StatusRail({
  chapters,
  ticks,
  current,
  onJump,
}: {
  chapters: Chapter[];
  ticks: number[];
  current: number;
  onJump: (i: number) => void;
}) {
  const here = chapters[current];
  return (
    <View pointerEvents="box-none" style={styles.rail}>
      <View pointerEvents="none" style={styles.labelBox}>
        <SystemText variant="label" color={palette.textMuted} style={styles.label} numberOfLines={1}>
          {here?.label}
        </SystemText>
      </View>
      <View pointerEvents="box-none" style={styles.track}>
        <View
          pointerEvents="none"
          {...({ dataSet: { railFill: '1' } } as object)}
          style={[
            styles.fill,
            {
              transform: [{ scaleY: ticks[current] ?? 0 }],
              transformOrigin: 'top center',
            } as object,
          ]}
        />
        {ticks.map((t, i) => (
          <Pressable
            key={chapters[i].key}
            onPress={() => onJump(i)}
            accessibilityRole="button"
            accessibilityLabel={`Go to ${chapters[i].label}`}
            hitSlop={8}
            style={[styles.tickHit, { top: `${t * 100}%` }]}>
            <View
              style={[
                styles.tick,
                i === current && styles.tickHere,
                i < current && styles.tickPast,
              ]}
            />
          </Pressable>
        ))}
      </View>
      <View pointerEvents="none" style={styles.countBox}>
        <SystemText variant="label" color={palette.textMuted} style={styles.count}>
          {`${current + 1}/${chapters.length}`}
        </SystemText>
      </View>
    </View>
  );
}

/** The rail sits in the screen's right gutter, clear of the cards. */
const RAIL = 14;

const styles = StyleSheet.create({
  rail: {
    position: 'absolute',
    right: -space.lg,
    top: '30%',
    height: '36%',
    width: RAIL,
    alignItems: 'center',
  },
  labelBox: {
    position: 'absolute',
    width: 120,
    height: 14,
    left: RAIL / 2 - 60,
    top: -76,
    transform: [{ rotate: '-90deg' }],
  },
  label: { fontSize: 10, lineHeight: 14, letterSpacing: 0.4 },
  track: {
    flex: 1,
    width: 1,
    backgroundColor: alpha(palette.text, 0.12),
  },
  fill: {
    position: 'absolute',
    left: -0.5,
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: palette.accent,
  },
  tickHit: {
    position: 'absolute',
    left: -RAIL / 2 + 0.5,
    width: RAIL,
    height: RAIL,
    marginTop: -RAIL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: palette.bg,
    borderWidth: 1,
    borderColor: alpha(palette.text, 0.35),
  },
  tickPast: { backgroundColor: palette.accent, borderColor: palette.accent },
  tickHere: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: palette.text, borderColor: palette.text },
  countBox: {
    position: 'absolute',
    width: 40,
    height: 14,
    left: RAIL / 2 - 20,
    bottom: -34,
    transform: [{ rotate: '-90deg' }],
  },
  count: { fontSize: 10, lineHeight: 14, letterSpacing: 0, textAlign: 'right' },
});
