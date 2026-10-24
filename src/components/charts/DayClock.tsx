import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { Ring } from '@/components/charts/Ring';
import { QuestIcon } from '@/components/quest/QuestIcon';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette } from '@/constants/theme';
import { fractionOf, partsOf, spanOf, spread, type Part } from '@/data/dayClock';
import type { QuestIconKey } from '@/data/questIcons';
import { dayMinutes, fromMinutes, type BlockKind, type PlanBlock } from '@/data/timeline';
import { playSound } from '@/lib/feedback';

/** Amber morning, ember afternoon, dusk-violet evening: the day warming and cooling. */
export const PART_META: Record<Part, { label: string; color: string }> = {
  morning: { label: 'Morning', color: palette.gold },
  noon: { label: 'Noon', color: palette.accent },
  evening: { label: 'Evening', color: palette.violet },
};

const BLOCK_FILL: Record<BlockKind, string> = {
  fixed: alpha(palette.text, 0.24),
  task: palette.accent,
  habit: palette.positive,
  break: alpha(palette.text, 0.08),
};

/** A quest as the clock draws it. `minutes` null means it has no time and floats inside. */
export interface ClockIcon {
  id: string;
  label: string;
  icon: QuestIconKey;
  color: string;
  ratio: number;
  done: boolean;
  minutes: number | null;
}

/** The small gap at twelve o'clock where the day starts and ends. */
const GAP = (4 * Math.PI) / 180;

/**
 * The waking day as one ring, cut into morning, noon and evening. Plan
 * blocks are slices of the inner band; each quest sits on the band at its
 * time as a line icon whose ring fills with progress, and the quests with
 * no time sit inside, around the clock face. Tap an icon to pick it.
 */
export function DayClock({
  size,
  wake,
  sleep,
  blocks,
  now,
  icons,
  selected,
  onSelect,
  focusPart,
  centreTop,
  centreSub,
}: {
  size: number;
  wake: string;
  sleep: string;
  blocks: PlanBlock[];
  /** "HH:MM", or null when the day shown is not today. */
  now: string | null;
  icons: ClockIcon[];
  selected: string | null;
  onSelect: (id: string) => void;
  focusPart: Part | null;
  centreTop: string;
  centreSub: string;
}) {
  const span = spanOf(wake, sleep);
  // Icons a touch smaller on a phone, where the ring is too.
  const BUBBLE = size < 400 ? 28 : 32;
  const c = size / 2;
  const rPart = c - 24;
  const rBand = rPart - 20;
  const rInner = rBand - 44;
  const angle = (f: number) => -Math.PI / 2 + GAP + f * (2 * Math.PI - 2 * GAP);
  const at = (r: number, a: number) => ({ x: c + Math.cos(a) * r, y: c + Math.sin(a) * r });
  const arc = (r: number, f0: number, f1: number) => {
    const a0 = angle(f0);
    const a1 = angle(f1);
    const p0 = at(r, a0);
    const p1 = at(r, a1);
    return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p1.x} ${p1.y}`;
  };
  const f = (hhmm: string) => fractionOf(dayMinutes(hhmm, wake), span);

  // Quests with a time, spread along the band so no two icons overlap.
  const timed = icons.filter((i) => i.minutes !== null);
  const usable = 1 - (2 * GAP) / (2 * Math.PI);
  const minGap = (BUBBLE + 4) / (2 * Math.PI * rBand * usable);
  const spots = spread(
    timed.map((i) => fractionOf(i.minutes!, span)),
    minGap,
  );

  // Quests without one, around the face: one orbit, a second inside it when crowded.
  const floating = icons.filter((i) => i.minutes === null);
  const cap1 = Math.max(1, Math.floor((2 * Math.PI * rInner) / (BUBBLE + 6)));
  const rInner2 = rInner - (BUBBLE + 6);
  const cap2 = Math.max(0, Math.floor((2 * Math.PI * rInner2) / (BUBBLE + 6)));
  const orbit1 = floating.slice(0, cap1);
  const orbit2 = floating.slice(cap1, cap1 + cap2);
  const hidden = floating.length - orbit1.length - orbit2.length;
  const faceRadius = (orbit2.length ? rInner2 : rInner) - BUBBLE / 2 - 4;

  const nowF = now ? fractionOf(dayMinutes(now, wake), span) : null;
  const nowInside = now !== null && dayMinutes(now, wake) >= span.start && dayMinutes(now, wake) <= span.end;

  const bubble = (i: ClockIcon, x: number, y: number) => {
    const on = i.id === selected;
    return (
      <Pressable
        key={i.id}
        onPress={() => {
          playSound('tap');
          onSelect(i.id);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${i.label}${i.done ? ', done' : `, ${Math.round(i.ratio * 100)}%`}`}
        style={[styles.bubble, { left: x - BUBBLE / 2, top: y - BUBBLE / 2, width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2 }, on && styles.bubbleOn]}>
        <View style={[styles.bubbleFace, { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2, backgroundColor: i.done ? i.color : palette.surfaceRaised }]}>
          <Ring size={BUBBLE} stroke={3} ratio={i.done ? 0 : i.ratio} color={i.color} track={alpha(i.color, 0.18)}>
            <QuestIcon name={i.icon} size={BUBBLE < 32 ? 13 : 15} color={i.done ? palette.bg : i.color} />
          </Ring>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* The three parts of the day, around the outside. */}
        {partsOf(span).map((p) => (
          <Path
            key={p.part}
            d={arc(rPart, fractionOf(p.from, span) + 0.004, fractionOf(p.to, span) - 0.004)}
            stroke={PART_META[p.part].color}
            strokeWidth={6}
            strokeLinecap="round"
            fill="none"
            opacity={focusPart && focusPart !== p.part ? 0.22 : 1}
          />
        ))}
        {/* The band the plan's blocks sit on. */}
        <Path d={arc(rBand, 0, 1)} stroke={alpha(palette.text, 0.05)} strokeWidth={24} fill="none" />
        {blocks.map((b) => {
          const f0 = f(b.start);
          let f1 = f(b.end);
          if (f1 <= f0) f1 = Math.min(1, f0 + 0.01);
          return (
            <Path
              key={b.id}
              d={arc(rBand, f0 + 0.002, Math.max(f0 + 0.004, f1 - 0.002))}
              stroke={BLOCK_FILL[b.kind]}
              strokeWidth={24}
              fill="none"
              opacity={focusPart && focusPart !== partOfFraction(span, f0) ? 0.3 : 0.9}
            />
          );
        })}
        {/* Now: a hand across the band. */}
        {nowF !== null && nowInside ? (
          <G>
            <Line
              x1={at(rBand - 16, angle(nowF)).x}
              y1={at(rBand - 16, angle(nowF)).y}
              x2={at(rPart + 6, angle(nowF)).x}
              y2={at(rPart + 6, angle(nowF)).y}
              stroke={palette.text}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <Circle cx={at(rPart + 6, angle(nowF)).x} cy={at(rPart + 6, angle(nowF)).y} r={4.5} fill={palette.text} />
          </G>
        ) : null}
      </Svg>

      {/* Times where the parts meet; wake and sleep share twelve o'clock. */}
      <View pointerEvents="none" style={[styles.tickTop, { left: c + 6, top: 0 }]}>
        <SystemText variant="meta" style={styles.tick}>
          {wake}
        </SystemText>
      </View>
      <View pointerEvents="none" style={[styles.tickTop, styles.tickTopLeft, { right: c + 6, top: 0 }]}>
        <SystemText variant="meta" style={styles.tick}>
          {sleep}
        </SystemText>
      </View>
      {partsOf(span)
        .slice(1)
        .map((p) => {
          const pos = at(rPart + 15, angle(fractionOf(p.from, span)));
          return (
            <View key={p.part} pointerEvents="none" style={[styles.tickMid, { left: Math.max(0, Math.min(size - 48, pos.x - 24)), top: pos.y - 9 }]}>
              <SystemText variant="meta" style={styles.tick}>
                {fromMinutes(p.from)}
              </SystemText>
            </View>
          );
        })}

      {timed.map((i, k) => {
        const p = at(rBand, angle(spots[k]));
        return bubble(i, p.x, p.y);
      })}
      {orbit1.map((i, k) => {
        const p = at(rInner, -Math.PI / 2 + (k * 2 * Math.PI) / orbit1.length);
        return bubble(i, p.x, p.y);
      })}
      {orbit2.map((i, k) => {
        const p = at(rInner2, -Math.PI / 2 + Math.PI / orbit2.length + (k * 2 * Math.PI) / orbit2.length);
        return bubble(i, p.x, p.y);
      })}

      <View pointerEvents="none" style={[styles.face, { left: c - faceRadius, top: c - faceRadius, width: faceRadius * 2, height: faceRadius * 2 }]}>
        <SystemText variant="numeral" style={orbit2.length ? styles.timeSmall : styles.time}>
          {centreTop}
        </SystemText>
        {!orbit2.length ? (
          <SystemText variant="meta" numberOfLines={2} style={styles.sub}>
            {centreSub}
          </SystemText>
        ) : null}
        {hidden > 0 ? <SystemText variant="meta">+{hidden} more</SystemText> : null}
      </View>
    </View>
  );
}

function partOfFraction(span: { start: number; end: number }, f: number): Part {
  const m = span.start + f * (span.end - span.start);
  if (m >= 17 * 60) return 'evening';
  if (m >= 12 * 60) return 'noon';
  return 'morning';
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute' },
  bubbleOn: { transform: [{ scale: 1.25 }], zIndex: 2 },
  bubbleFace: { alignItems: 'center', justifyContent: 'center' },
  tickTop: { position: 'absolute' },
  tickTopLeft: { alignItems: 'flex-end' },
  tickMid: { position: 'absolute', width: 48, alignItems: 'center' },
  tick: { fontSize: 11, fontVariant: ['tabular-nums'] },
  face: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 2 },
  time: { fontSize: 34, lineHeight: 38 },
  timeSmall: { fontSize: 22, lineHeight: 26 },
  sub: { textAlign: 'center', maxWidth: 130 },
});
