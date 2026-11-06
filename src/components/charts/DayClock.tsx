import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedReaction,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Ring } from '@/components/charts/Ring';
import { usePageOnScreen } from '@/components/motion/SwipeTabs';
import { ClockPlanet } from '@/components/planner/ClockPlanet';
import { QuestIcon } from '@/components/quest/QuestIcon';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette } from '@/constants/theme';
import { CLOCK_STEP, fractionOf, minutesAt, nextUp, partsOf, spanOf, spread, type Part } from '@/data/dayClock';
import type { QuestIconKey } from '@/data/questIcons';
import { dayMinutes, fromMinutes, toMinutes, type BlockKind, type PlanBlock } from '@/data/timeline';
import { haptic, playSound } from '@/lib/feedback';
import { clamp, SPRING } from '@/lib/motion';
import { useProgress } from '@/store/progress';

/** Amber morning, ember afternoon, dusk-violet evening: the day warming and cooling. */
export const PART_META: Record<Part, { label: string; color: string }> = {
  morning: { label: 'Morning', color: palette.gold },
  noon: { label: 'Noon', color: palette.accent },
  evening: { label: 'Evening', color: palette.violet },
};

export const BLOCK_FILL: Record<BlockKind, string> = {
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

/** How long a finger rests on a quest before it lifts off to be carried. */
const HOLD_MS = 350;
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * The waking day as one ring, cut into morning, noon and evening. Plan
 * blocks are slices of the inner band; each quest sits on the band at its
 * time as a line icon whose ring fills with progress, and the quests with
 * no time sit inside, around the clock face. Tap an icon to pick it, or run a
 * finger round the ring to move through the day: a hand follows, the face
 * reads out what is happening then, and letting go on a quest picks it.
 *
 * Behind it all is a small planet, lit by a sun that sits behind the ring at
 * the time showing, so moving the hand moves the sun. On today, the hours
 * already gone are veiled and the next quest, when it is close, pulses. Hold
 * a quest from the middle and it lifts: carry it onto the ring and let go to
 * give it that time.
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
  onSchedule,
  focusPart,
  centreTop,
  centreSub,
  paused = false,
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
  /** Give a quest a time, in day-minutes. Without it, quests can't be carried. */
  onSchedule?: (id: string, minutes: number) => void;
  focusPart: Part | null;
  centreTop: string;
  centreSub: string;
  /** Out of sight, as when the week is showing: nothing moves. */
  paused?: boolean;
}) {
  const span = spanOf(wake, sleep);
  /** 0–1 round the day while a finger is on the ring, otherwise -1. */
  const scrub = useSharedValue(-1);
  const handAngle = useSharedValue(0);
  const handShown = useSharedValue(0);
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

  const onScreen = usePageOnScreen();
  // When a quest leaves the middle or joins the ring, the others glide to
  // their new places rather than jumping there.
  const reduced = useReducedMotion();
  const glide = Platform.OS === 'web' && !reduced ? styles.glide : null;
  const lowPower = useProgress().state.settings?.lowPower ?? false;
  const still = paused || !onScreen || lowPower;

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

  // The ring takes the finger, so its icons are found by position here. The
  // hole in the middle lets the icons there be pressed, and the page scroll.
  const ringInner = rInner + BUBBLE / 2 + 2;
  const nearestAt = (x: number, y: number) => {
    let best: ClockIcon | null = null;
    let reach = BUBBLE;
    timed.forEach((icon, k) => {
      const p = at(rBand, angle(spots[k]));
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < reach) {
        reach = d;
        best = icon;
      }
    });
    return best as ClockIcon | null;
  };
  const pickAt = (x: number, y: number) => {
    const hit = nearestAt(x, y);
    if (!hit) return;
    playSound('tap');
    onSelect(hit.id);
  };

  const ring = useMemo(() => {
    const turn = 2 * Math.PI - 2 * GAP;
    const follow = (x: number, y: number) => {
      'worklet';
      let a = Math.atan2(y - c, x - c) + Math.PI / 2 - GAP;
      if (a < 0) a += 2 * Math.PI;
      const next = clamp(a / turn, 0, 1);
      const was = scrub.get();
      // Crossing the gap at twelve must not swing the hand the long way round.
      if (was >= 0 && Math.abs(next - was) > 0.5) return;
      scrub.set(next);
      handAngle.set(GAP + next * turn);
    };
    const drag = Gesture.Pan()
      .maxPointers(1)
      .minDistance(4)
      .onStart((e) => {
        scrub.set(-1);
        follow(e.x, e.y);
        handShown.set(withSpring(1, SPRING.settle));
      })
      .onUpdate((e) => follow(e.x, e.y))
      .onEnd((e) => {
        scheduleOnRN(pickAt, e.x, e.y);
      })
      .onFinalize(() => {
        scrub.set(-1);
        handShown.set(withSpring(0, SPRING.settle));
      });
    const tap = Gesture.Tap().onEnd((e, finished) => {
      if (finished) scheduleOnRN(pickAt, e.x, e.y);
    });
    return Gesture.Race(drag, tap);
    // pickAt reads the icons as they are now; they only change between drags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, handAngle, handShown, scrub, icons]);

  const handStyle = useAnimatedStyle(() => ({
    opacity: handShown.get(),
    transform: [{ rotate: `${handAngle.get()}rad` }],
  }));

  const nowM = now ? dayMinutes(now, wake) : null;
  const nowF = nowM !== null ? fractionOf(nowM, span) : null;
  const nowInside = nowM !== null && nowM >= span.start && nowM <= span.end;
  // The next quest pulses only when it is close; otherwise the clock is still.
  const pulseId = nowM !== null ? nextUp(timed, nowM) : null;
  // A ping every few seconds while it is still a way off, more often in its last quarter hour.
  const pulseNear = pulseId !== null && (timed.find((i) => i.id === pulseId)?.minutes ?? 0) - (nowM ?? 0) <= 15;

  /* ------------------------------------------------ carrying a quest */

  /** The quest being carried, drawn under the finger. */
  const [lifted, setLifted] = useState<ClockIcon | null>(null);
  /** Hidden at its new spot until the carried copy has landed there. */
  const [landing, setLanding] = useState<string | null>(null);
  /** A carry has ended and its copy is still flying home: 'drop' onto the ring, 'back' to the middle. */
  const [settling, setSettling] = useState<'drop' | 'back' | null>(null);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const gs = useSharedValue(1);
  const gShown = useSharedValue(0);
  /** Which quest is being carried, and where on the ring it was let go. */
  const carryId = useSharedValue('');
  const carryAt = useSharedValue(-1);
  /** 0 nothing carried, 1 lifted, 2 dropped on the ring, 3 put back. */
  const carryPhase = useSharedValue(0);

  // The gesture only moves shared values; the clock answers here, once per step.
  const onCarry = (phase: number, id: string, at: number) => {
    if (phase === 1) {
      const icon = icons.find((i) => i.id === id);
      if (!icon) return;
      setLanding(null);
      setSettling(null);
      setLifted(icon);
      haptic('light');
    } else if (phase === 2) {
      playSound('tap');
      haptic('medium');
      setLanding(id);
      onSchedule?.(id, minutesAt(at, span));
      setSettling('drop');
    } else if (phase === 3) {
      setSettling('back');
    }
  };
  useAnimatedReaction(
    () => carryPhase.get(),
    (phase, was) => {
      if (phase !== was && phase !== 0) scheduleOnRN(onCarry, phase, carryId.get(), carryAt.get());
    },
  );
  // Once the copy has landed or gone home, the clock is itself again. Until
  // then a tap on the quest is part of the carry, not a pick.
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(
      () => {
        setLanding(null);
        setLifted(null);
        setSettling(null);
        carryPhase.set(0);
      },
      settling === 'drop' ? 240 : 320,
    );
    return () => clearTimeout(t);
  }, [settling, carryPhase]);

  const ghostStyle = useAnimatedStyle(() => ({
    opacity: gShown.get(),
    transform: [{ translateX: gx.get() - BUBBLE / 2 }, { translateY: gy.get() - BUBBLE / 2 }, { scale: gs.get() }],
  }));

  const carry: Carry = {
    c,
    bandFrom: rBand - 20,
    bandTo: rPart + 26,
    rBand,
    stops: Math.max(1, Math.round((span.end - span.start) / CLOCK_STEP)),
    scrub,
    handAngle,
    handShown,
    gx,
    gy,
    gs,
    gShown,
    carryId,
    carryAt,
    carryPhase,
  };

  const veil = nowF !== null && nowF > 0.004;

  /**
   * Where a quest sits on the clock. It is moved by a transform on a wrapper
   * of its own, so moving it costs no layout and the button inside keeps its
   * own press.
   */
  const spot = (x: number, y: number, raised: boolean) => [
    styles.spot,
    glide,
    { width: BUBBLE, height: BUBBLE, transform: [{ translateX: x - BUBBLE / 2 }, { translateY: y - BUBBLE / 2 }] },
    raised && styles.raised,
  ];

  const bubble = (i: ClockIcon) => {
    const on = i.id === selected;
    const away = landing === i.id || lifted?.id === i.id;
    return (
      <Pressable
        onPress={() => {
          if (carryPhase.get() !== 0) return;
          playSound('tap');
          onSelect(i.id);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${i.label}${i.done ? ', done' : `, ${Math.round(i.ratio * 100)}%`}${i.id === pulseId ? ', coming up' : ''}`}
        style={[
          styles.bubble,
          { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2 },
          on && styles.bubbleOn,
          away && (landing === i.id ? styles.gone : styles.lifted),
        ]}>
        {i.id === pulseId ? (
          <View
            {...({ dataSet: still ? { ping: pulseNear ? 'near' : 'far', rest: '1' } : { ping: pulseNear ? 'near' : 'far' } } as object)}
            style={[styles.ping, { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2, borderColor: i.color }]}
          />
        ) : null}
        <Face icon={i} size={BUBBLE} />
      </Pressable>
    );
  };

  const canCarry = Platform.OS === 'web' && onSchedule !== undefined;
  const placedBubble = (i: ClockIcon, x: number, y: number) => (
    <View key={i.id} pointerEvents="box-none" style={spot(x, y, i.id === selected)}>
      {bubble(i)}
    </View>
  );
  const floatingBubble = (i: ClockIcon, x: number, y: number) =>
    canCarry ? (
      <Carriable key={i.id} icon={i} x={x} y={y} size={BUBBLE} carry={carry} spot={spot(x, y, i.id === selected)}>
        {bubble(i)}
      </Carriable>
    ) : (
      placedBubble(i, x, y)
    );

  return (
    <View style={{ width: size, height: size }}>
      <ClockPlanet
        size={size}
        radius={faceRadius}
        band={rBand}
        gap={GAP}
        scrub={scrub}
        restF={nowF ?? 0}
        restHour={now ? toMinutes(now) / 60 : (span.start / 60) % 24}
        span={span}
        paused={paused || !onScreen}
      />
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
        {/* The hours already gone today, veiled from waking up to now. */}
        {veil ? (
          <Path
            d={arc((rBand - 13 + rPart + 4) / 2, 0, nowF)}
            stroke={alpha(palette.bg, 0.62)}
            strokeWidth={rPart + 4 - (rBand - 13)}
            fill="none"
          />
        ) : null}
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
        return placedBubble(i, p.x, p.y);
      })}
      {orbit1.map((i, k) => {
        const p = at(rInner, -Math.PI / 2 + (k * 2 * Math.PI) / orbit1.length);
        return floatingBubble(i, p.x, p.y);
      })}
      {orbit2.map((i, k) => {
        const p = at(rInner2, -Math.PI / 2 + Math.PI / orbit2.length + (k * 2 * Math.PI) / orbit2.length);
        return floatingBubble(i, p.x, p.y);
      })}

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, handStyle]}>
          <View style={[styles.hand, { left: c - 1.5, top: c - rPart - 8, height: rPart + 8 - (rBand - 18) }]} />
          <View style={[styles.handDot, { left: c - 7, top: c - rPart - 15 }]} />
        </Animated.View>
      </View>

      {Platform.OS === 'web' ? (
        <GestureDetector gesture={ring} touchAction="none">
          <View
            collapsable={false}
            accessible={false}
            style={[
              StyleSheet.absoluteFill,
              { clipPath: `path(evenodd, "${donut(c, ringInner)}")`, cursor: 'grab' } as object,
            ]}
          />
        </GestureDetector>
      ) : null}

      <ClockFace
        scrub={scrub}
        span={span}
        blocks={blocks}
        wake={wake}
        icons={timed}
        spots={spots}
        small={orbit2.length > 0}
        top={centreTop}
        sub={centreSub}
        hidden={hidden}
        carrying={lifted && !landing ? lifted.label : null}
        style={{ left: c - faceRadius, top: c - faceRadius, width: faceRadius * 2, height: faceRadius * 2 }}
      />

      {/* The quest being carried, above everything. */}
      {lifted ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, { width: BUBBLE, height: BUBBLE, borderRadius: BUBBLE / 2 }, ghostStyle]}>
          <Face icon={lifted} size={BUBBLE} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A quest's icon in its progress ring: filled once it is done. */
function Face({ icon: i, size }: { icon: ClockIcon; size: number }) {
  return (
    <View style={[styles.bubbleFace, { width: size, height: size, borderRadius: size / 2, backgroundColor: i.done ? i.color : palette.surfaceRaised }]}>
      <Ring size={size} stroke={3} ratio={i.done ? 0 : i.ratio} color={i.color} track={alpha(i.color, 0.18)}>
        <QuestIcon name={i.icon} size={size < 32 ? 13 : 15} color={i.done ? palette.bg : i.color} />
      </Ring>
    </View>
  );
}

interface Carry {
  c: number;
  bandFrom: number;
  bandTo: number;
  rBand: number;
  stops: number;
  scrub: SharedValue<number>;
  handAngle: SharedValue<number>;
  handShown: SharedValue<number>;
  gx: SharedValue<number>;
  gy: SharedValue<number>;
  gs: SharedValue<number>;
  gShown: SharedValue<number>;
  carryId: SharedValue<string>;
  carryAt: SharedValue<number>;
  carryPhase: SharedValue<number>;
}

/**
 * A quest in the middle of the clock that can be carried onto the ring. Hold
 * it still for a moment and it lifts under the finger; from then the page
 * stops scrolling and the tabs stop swiping, and the hand, the face and the
 * sun all follow it round the ring, so you see the time it would get before
 * you let go. Off the ring, it goes back where it was.
 *
 * Web only. The browser decides whether a touch scrolls at the touch's start,
 * so the quest listens for moves from the beginning and only stops the
 * scroll once it has lifted: a quick swipe across it still scrolls the page.
 */
function Carriable({
  icon,
  x,
  y,
  size,
  carry,
  spot,
  children,
}: {
  icon: ClockIcon;
  x: number;
  y: number;
  size: number;
  carry: Carry;
  /** Where it sits, as the clock places every quest. */
  spot: (object | false | null)[];
  children: ReactNode;
}) {
  const node = useRef<View | null>(null);
  /** 1 while the carried quest is over the ring. */
  const over = useSharedValue(0);
  const { carryPhase } = carry;
  const id = icon.id;

  useEffect(() => {
    const el = node.current as unknown as HTMLElement | null;
    if (!el) return;
    const stopScroll = (e: TouchEvent) => {
      if (carryPhase.get() === 1 && e.cancelable) e.preventDefault();
    };
    // A held quest is a button, not text or a picture: no menu, no selection.
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener('touchmove', stopScroll, { passive: false });
    el.addEventListener('contextmenu', noMenu);
    return () => {
      el.removeEventListener('touchmove', stopScroll);
      el.removeEventListener('contextmenu', noMenu);
    };
  }, [carryPhase]);

  const gesture = useMemo(() => {
    const k = carry;
    const turn = 2 * Math.PI - 2 * GAP;
    const left = x - size / 2;
    const top = y - size / 2;
    const tick = () => haptic('tick');
    const fractionAt = (px: number, py: number) => {
      'worklet';
      let a = Math.atan2(py - k.c, px - k.c) + Math.PI / 2 - GAP;
      if (a < 0) a += 2 * Math.PI;
      // In the gap at twelve: whichever end of the day is nearer.
      if (a > turn) return a - turn < (2 * Math.PI - turn) / 2 ? 1 : 0;
      return a / turn;
    };
    return Gesture.Pan()
      .activateAfterLongPress(HOLD_MS)
      .maxPointers(1)
      .onStart(() => {
        k.gx.set(x);
        k.gy.set(y);
        k.gShown.set(1);
        k.gs.set(withSpring(1.22, SPRING.snap));
        over.set(0);
        k.carryAt.set(-1);
        k.carryId.set(id);
        k.carryPhase.set(1);
      })
      .onUpdate((e) => {
        const px = left + e.x;
        const py = top + e.y;
        k.gx.set(px);
        k.gy.set(py);
        const d = Math.hypot(px - k.c, py - k.c);
        const onRing = d >= k.bandFrom && d <= k.bandTo;
        if (onRing) {
          const at = fractionAt(px, py);
          k.scrub.set(at);
          k.handAngle.set(GAP + at * turn);
        }
        if (onRing !== (over.get() === 1)) {
          over.set(onRing ? 1 : 0);
          if (!onRing) k.scrub.set(-1);
          k.handShown.set(withSpring(onRing ? 1 : 0, SPRING.settle));
          if (onRing) scheduleOnRN(tick);
        }
      })
      .onEnd((_e, success) => {
        const at = k.scrub.get();
        if (success && over.get() === 1 && at >= 0) {
          // Land on the five-minute step it will sit at.
          const snapped = Math.round(at * k.stops) / k.stops;
          const a = -Math.PI / 2 + GAP + snapped * turn;
          k.gx.set(withTiming(k.c + Math.cos(a) * k.rBand, { duration: 220, easing: EASE_OUT }));
          k.gy.set(withTiming(k.c + Math.sin(a) * k.rBand, { duration: 220, easing: EASE_OUT }));
          k.gs.set(withTiming(1, { duration: 220, easing: EASE_OUT }));
          k.carryAt.set(snapped);
          k.carryPhase.set(2);
        } else {
          k.gx.set(withSpring(x, SPRING.snap));
          k.gy.set(withSpring(y, SPRING.snap));
          k.gs.set(withSpring(1, SPRING.snap));
          k.gShown.set(withTiming(0, { duration: 300, easing: EASE_OUT }));
          k.carryPhase.set(3);
        }
      })
      .onFinalize(() => {
        if (over.get() === 1) {
          over.set(0);
          k.handShown.set(withSpring(0, SPRING.settle));
        }
        k.scrub.set(-1);
      });
    // Everything it moves is a shared value, which never changes, so the
    // gesture is only rebuilt when the quest itself moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, size, id, over]);

  return (
    <GestureDetector gesture={gesture} touchAction="pan-y">
      <View
        ref={node}
        collapsable={false}
        style={[styles.carriable, ...spot]}>
        {children}
      </View>
    </GestureDetector>
  );
}

/** The whole square, less the middle: everything the finger can spin on. */
function donut(c: number, hole: number): string {
  const size = c * 2;
  return `M0 0H${size}V${size}H0Z M${c - hole} ${c}A${hole} ${hole} 0 1 0 ${c + hole} ${c}A${hole} ${hole} 0 1 0 ${c - hole} ${c}Z`;
}

/**
 * The middle of the clock. It normally shows the time; while a finger is on
 * the ring it shows the time under the finger and what is happening then, or
 * the quest being carried there. It redraws alone, and only every five
 * minutes of travel, so the ring stays free.
 */
function ClockFace({
  scrub,
  span,
  blocks,
  wake,
  icons,
  spots,
  small,
  top,
  sub,
  hidden,
  carrying,
  style,
}: {
  scrub: SharedValue<number>;
  span: { start: number; end: number };
  blocks: PlanBlock[];
  wake: string;
  icons: ClockIcon[];
  spots: number[];
  small: boolean;
  top: string;
  sub: string;
  hidden: number;
  carrying: string | null;
  style: object;
}) {
  const stops = Math.max(1, Math.round((span.end - span.start) / CLOCK_STEP));
  const [stop, setStop] = useState(-1);

  useAnimatedReaction(
    () => (scrub.get() < 0 ? -1 : Math.round(scrub.get() * stops)),
    (next, was) => {
      if (next !== was) scheduleOnRN(setStop, next);
    },
  );

  const minutes = stop < 0 ? null : span.start + stop * CLOCK_STEP;
  const fraction = stop < 0 ? 0 : stop / stops;
  const quest = minutes === null ? null : icons.find((_, k) => Math.abs(spots[k] - fraction) < 0.025);
  const block =
    minutes === null
      ? null
      : blocks.find((b) => dayMinutes(b.start, wake) <= minutes && minutes < dayMinutes(b.end, wake));
  const what = carrying ?? quest?.label ?? block?.title ?? 'Free';
  const line = minutes !== null ? what : carrying ? 'Onto the ring to give it a time' : sub;

  useEffect(() => {
    if (minutes !== null && !carrying) haptic('tick');
    // A tick each time the finger reaches something new, not every five minutes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [what]);

  return (
    <View pointerEvents="none" style={[styles.face, style]}>
      <SystemText variant="numeral" style={[small ? styles.timeSmall : styles.time, styles.lift]}>
        {minutes === null ? top : fromMinutes(minutes)}
      </SystemText>
      {!small || minutes !== null || carrying ? (
        <SystemText variant="meta" numberOfLines={2} color={minutes === null && !carrying ? undefined : palette.accentSoft} style={[styles.sub, styles.lift]}>
          {line}
        </SystemText>
      ) : null}
      {hidden > 0 && minutes === null ? <SystemText variant="meta" style={styles.lift}>+{hidden} more</SystemText> : null}
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
  hand: { position: 'absolute', width: 3, borderRadius: 2, backgroundColor: palette.accentSoft },
  handDot: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: palette.accentSoft },
  spot: { position: 'absolute', left: 0, top: 0 },
  raised: { zIndex: 2 },
  bubble: { position: 'absolute', left: 0, top: 0 },
  bubbleOn: { transform: [{ scale: 1.25 }] },
  lifted: { opacity: 0.28 },
  gone: { opacity: 0 },
  bubbleFace: { alignItems: 'center', justifyContent: 'center' },
  ping: { position: 'absolute', left: 0, top: 0, borderWidth: 2, opacity: 0.5 },
  carriable: { userSelect: 'none', WebkitTouchCallout: 'none' } as object,
  // Moving on screen: ease in and out, under 300ms.
  glide: {
    transitionProperty: 'transform',
    transitionDuration: '280ms',
    transitionTimingFunction: 'cubic-bezier(0.77, 0, 0.175, 1)',
  } as object,
  ghost: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 5,
    boxShadow: '0 8px 18px rgba(0,0,0,0.55)',
  } as object,
  tickTop: { position: 'absolute' },
  tickTopLeft: { alignItems: 'flex-end' },
  tickMid: { position: 'absolute', width: 48, alignItems: 'center' },
  tick: { fontSize: 11, fontVariant: ['tabular-nums'] },
  face: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 2 },
  time: { fontSize: 34, lineHeight: 38 },
  timeSmall: { fontSize: 22, lineHeight: 26 },
  sub: { textAlign: 'center', maxWidth: 130 },
  // The planet is behind these words, so they carry a little night with them.
  lift: { textShadowColor: 'rgba(17,13,10,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
});
