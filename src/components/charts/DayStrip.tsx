import { useRef } from 'react';
import { ScrollView as RNScrollView, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import { dayMinutes, fromMinutes, type BlockKind, type PlanBlock } from '@/data/timeline';
import { playSound } from '@/lib/feedback';

/** Pixels per hour: wide enough that an hour-long block can carry its name. */
const HOUR = 84;
const LANE = 58;

export const KIND: Record<BlockKind, { fill: string; text: string; border: string }> = {
  fixed: { fill: palette.surfaceHover, text: palette.text, border: palette.borderStrong },
  task: { fill: alpha(palette.accent, 0.9), text: palette.bg, border: 'transparent' },
  habit: { fill: alpha(palette.positive, 0.82), text: palette.bg, border: 'transparent' },
  break: { fill: alpha(palette.text, 0.05), text: palette.textMuted, border: palette.border },
};

/**
 * Today's plan as a strip of time you can scroll through, with a line at
 * now — the shape of the day, not a list to read. It opens scrolled to the
 * present. Tap any block to open the Planner.
 */
export function DayStrip({
  blocks,
  wake,
  sleep,
  now,
  onOpen,
  hour = HOUR,
}: {
  blocks: PlanBlock[];
  wake: string;
  sleep: string;
  now: string;
  onOpen: () => void;
  /** Pixels per hour. */
  hour?: number;
}) {
  const HOUR = hour;
  const scroll = useRef<RNScrollView | null>(null);
  const start = Math.floor(dayMinutes(wake, wake) / 60) * 60;
  let end = Math.ceil(dayMinutes(sleep, wake) / 60) * 60;
  if (end <= start) end = start + 16 * 60;
  const width = ((end - start) / 60) * HOUR;
  const x = (hhmm: string) => ((dayMinutes(hhmm, wake) - start) / 60) * HOUR;
  const nowX = x(now);
  const nowInside = nowX >= 0 && nowX <= width;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);

  return (
    <ScrollView
      horizontal
      style={styles.scroller}
      showsHorizontalScrollIndicator={false}
      ref={(r: unknown) => {
        scroll.current = r as RNScrollView | null;
      }}
      onLayout={(e) => {
        // Open with "now" a little in from the left edge.
        if (nowInside) scroll.current?.scrollTo({ x: Math.max(0, nowX - e.nativeEvent.layout.width * 0.25), animated: false });
      }}>
      <View style={{ width: width + space.lg, height: LANE + 30 }}>
        {hours.map((m) => (
          <View key={m} style={[styles.tick, { left: ((m - start) / 60) * HOUR }]}>
            <SystemText variant="meta" style={styles.tickLabel}>
              {fromMinutes(m)}
            </SystemText>
          </View>
        ))}
        {blocks.map((b) => {
          const left = x(b.start);
          let w = x(b.end) - left;
          if (w <= 0) w += 24 * HOUR;
          const k = KIND[b.kind];
          return (
            <Pressable
              key={b.id}
              onPress={() => {
                playSound('tap');
                onOpen();
              }}
              accessibilityRole="button"
              accessibilityLabel={`${b.start} to ${b.end}, ${b.title}. Open the planner`}
              style={[styles.block, { left, width: Math.max(10, w - 3), backgroundColor: k.fill, borderColor: k.border }]}>
              {w > 44 ? (
                <>
                  <SystemText variant="meta" color={k.text} numberOfLines={1} style={styles.blockTitle}>
                    {b.title}
                  </SystemText>
                  <SystemText variant="meta" color={alpha(k.text, 0.75)} numberOfLines={1} style={styles.blockTime}>
                    {b.start}–{b.end}
                  </SystemText>
                </>
              ) : null}
            </Pressable>
          );
        })}
        {nowInside ? (
          <View pointerEvents="none" style={[styles.now, { left: nowX - 1 }]}>
            <View style={styles.nowDot} />
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // A horizontal scroller grows to fill a column by default; this one keeps its height.
  scroller: { flexGrow: 0 },
  tick: { position: 'absolute', top: 0, bottom: 0, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: palette.border },
  tickLabel: { fontSize: 11, marginLeft: 4 },
  block: {
    position: 'absolute',
    top: 26,
    height: LANE,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.sm,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  blockTitle: { fontSize: 13, fontWeight: '600' },
  blockTime: { fontSize: 11 },
  now: { position: 'absolute', top: 18, bottom: 0, width: 2, backgroundColor: palette.accentSoft, borderRadius: 1 },
  nowDot: { position: 'absolute', top: -4, left: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: palette.accentSoft },
});
