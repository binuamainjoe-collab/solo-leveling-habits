import { useEffect, useRef, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Ring } from '@/components/charts/Ring';
import { RingFlame } from '@/components/dashboard/RingFlame';
import { XpTube } from '@/components/dashboard/XpTube';
import { onLanding, setFlightTarget, useHeldWhileFlying } from '@/components/motion/flight';
import { Rolling } from '@/components/motion/Rolling';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { WordReveal } from '@/components/motion/WordReveal';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, HIT, icon, palette, radius, space, SURFACE_ALPHA } from '@/constants/theme';
import { inMinutes, type DayPoint, type NextBlock } from '@/data/insights';
import type { QuestDef } from '@/data/quests';
import { playSound } from '@/lib/feedback';

/** The one thing the hero puts forward. */
export type NextStep =
  | { kind: 'block'; next: NextBlock }
  | { kind: 'quest'; quest: QuestDef; value: number }
  | { kind: 'plan'; label: string }
  | { kind: 'clear' };

const DAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CATCH_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * The top of the day. Three questions, answered without reading a list:
 * how far through today am I (the ring), what do I do now (one step, with
 * the button that does it), and am I keeping it going (the week of flames).
 *
 * The ring is the forge of the day. Cleared quests fly into it, and it only
 * fills when one lands, so the cause is plain to see; the corner glows hotter
 * as the day fills, and the streak burns in its bowl.
 */
export function TodayHero({
  greeting,
  done: doneNow,
  total,
  level: levelNow,
  into: intoNow,
  need: needNow,
  streak: streakNow,
  week,
  today,
  selected,
  onSelectDay,
  step,
  onStep,
  onAsk,
  nextRef,
  compact,
}: {
  greeting: string;
  done: number;
  total: number;
  level: number;
  into: number;
  need: number;
  streak: number;
  week: DayPoint[];
  today: string;
  selected: string | null;
  onSelectDay: (date: string) => void;
  step: NextStep;
  onStep: () => void;
  onAsk: () => void;
  /** The next-step card, so a quest cleared from it can fly into the ring. */
  nextRef?: RefObject<View | null>;
  compact: boolean;
}) {
  // Everything a cleared quest changes waits for it to reach the ring.
  const done = useHeldWhileFlying(doneNow, 'ring');
  const level = useHeldWhileFlying(levelNow, 'ring');
  const into = useHeldWhileFlying(intoNow, 'ring');
  const need = useHeldWhileFlying(needNow, 'ring');
  const streak = useHeldWhileFlying(streakNow, 'ring');

  const ratio = total > 0 ? done / total : 0;
  const ringSize = compact ? 108 : 148;
  const ringStroke = compact ? 11 : 14;

  const target = useRef<View>(null);
  const caught = useSharedValue(0);
  useEffect(() => {
    setFlightTarget('ring', target.current as unknown as HTMLElement | null);
    const stop = onLanding((t) => {
      if (t !== 'ring') return;
      caught.set(
        withSequence(
          withTiming(1, { duration: 90, easing: CATCH_OUT }),
          withTiming(0, { duration: 460, easing: CATCH_OUT }),
        ),
      );
    });
    return () => {
      stop();
      setFlightTarget('ring', null);
    };
  }, [caught]);
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.07 * caught.get() }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: caught.get() }));

  return (
    <View style={styles.hero}>
      {/* The ember glow behind the ring: the warmth comes from the corner the
          eye goes to, and it burns hotter as the day fills. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="88%" cy="18%" rx="62%" ry="78%">
            <Stop offset="0" stopColor={gradient.ember[1]} stopOpacity={0.3 + 0.28 * ratio} />
            <Stop offset="0.45" stopColor={gradient.ember[2]} stopOpacity={0.12 + 0.1 * ratio} />
            <Stop offset="1" stopColor={palette.surface} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)" />
      </Svg>

      <View style={styles.top}>
        <View style={styles.headline}>
          <WordReveal screen="today" variant="hero" style={[styles.greeting, compact && styles.greetingCompact]}>
            {greeting}
          </WordReveal>
          <SystemText variant="body" color={palette.text} style={styles.status}>
            {total === 0
              ? 'Nothing on the board yet.'
              : done === total
                ? `All ${total} quests cleared today.`
                : `${done} of ${total} quests cleared today.`}
          </SystemText>
          <View style={styles.level} accessibilityLabel={`Level ${level}, ${need - into} XP to level ${level + 1}`}>
            <View style={styles.inline}>
              <SystemText variant="title" color={palette.accentSoft} style={styles.levelText}>
                {'Level '}
              </SystemText>
              <Rolling text={String(level)} lineHeight={20} variant="title" color={palette.accentSoft} style={styles.levelText} />
            </View>
            <XpTube ratio={into / Math.max(1, need)} level={level} />
            <View style={styles.inline}>
              <Rolling text={(need - into).toLocaleString('en-US')} lineHeight={18} variant="meta" />
              <SystemText variant="meta">{' XP to go'}</SystemText>
            </View>
          </View>
        </View>
        <Animated.View style={ringStyle}>
          <Animated.View
            pointerEvents="none"
            style={[styles.flash, { borderRadius: ringSize / 2 }, flashStyle]}
          />
          <View ref={target} collapsable={false}>
            <Ring size={ringSize} stroke={ringStroke} ratio={ratio} colors={[gradient.ember[0], gradient.ember[2]]} depth>
              <RingFlame ring={ringSize} stroke={ringStroke} streak={streak} />
              <Rolling
                text={`${Math.round(ratio * 100)}%`}
                lineHeight={compact ? 32 : 38}
                style={[compact ? styles.ringNumCompact : styles.ringNum, styles.overFlame]}
              />
              <SystemText variant="meta" style={styles.overFlame}>
                today
              </SystemText>
            </Ring>
          </View>
        </Animated.View>
      </View>

      <NextCard step={step} onStep={onStep} onAsk={onAsk} nextRef={nextRef} />

      <View style={styles.week}>
        <View style={styles.flames}>
          {week.map((p, i) => {
            const lit = p.cleared > 0;
            const on = p.date === selected;
            return (
              <Pressable
                key={p.date}
                disabled={p.future}
                onPress={() => {
                  playSound('tap');
                  onSelectDay(p.date);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: p.future }}
                accessibilityLabel={`${p.date}: ${p.perfect ? 'perfect day' : lit ? `${p.cleared} cleared` : 'nothing cleared'}`}>
                <View style={styles.flameCol}>
                  <View
                    style={[
                      styles.flame,
                      lit && styles.flameLit,
                      p.perfect && styles.flamePerfect,
                      p.date === today && styles.flameToday,
                      on && styles.flameOn,
                    ]}>
                    <Icon name="flame" size={icon.small} color={lit ? palette.bg : alpha(palette.text, p.future ? 0.15 : 0.3)} />
                  </View>
                  <SystemText variant="meta" color={p.date === today ? palette.text : palette.textMuted} style={styles.flameDay}>
                    {DAY[i]}
                  </SystemText>
                </View>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.streak}>
          <SystemText variant="title" color={streak > 0 ? palette.accentSoft : palette.textMuted}>
            {streak > 0 ? `${streak}-day streak` : 'No streak yet'}
          </SystemText>
          <SystemText variant="meta">{streak > 0 ? 'Clear one quest a day to keep it.' : 'Clear one quest today to start one.'}</SystemText>
        </View>
      </View>
    </View>
  );
}

function NextCard({
  step,
  onStep,
  onAsk,
  nextRef,
}: {
  step: NextStep;
  onStep: () => void;
  onAsk: () => void;
  nextRef?: RefObject<View | null>;
}) {
  let kicker = 'Next';
  let title = '';
  let detail = '';
  let action = '';
  if (step.kind === 'block') {
    const b = step.next.block;
    kicker = step.next.status === 'now' ? 'Happening now' : `Next, in ${inMinutes(step.next.minutes)}`;
    title = b.focus ? `${b.title}: ${b.focus}` : b.title;
    detail = `${b.start}–${b.end}`;
    action = 'Open planner';
  } else if (step.kind === 'quest') {
    const q = step.quest;
    kicker = q.penalty ? 'Next mandatory quest' : 'Next quest';
    title = q.title;
    const binary = q.kind === 'binary' || q.kind === 'window';
    detail = binary ? q.objective : `${step.value} of ${q.target} ${q.unit}`;
    // "+10 reps"; a step of one needs no unit ("+1"), and saying "1 glasses" is worse.
    const by = q.step ?? 1;
    action = binary ? 'Mark done' : by > 1 ? `+${by} ${q.unit}` : '+1';
  } else if (step.kind === 'plan') {
    kicker = 'Board cleared';
    title = step.label;
    detail = 'A few questions, then the day laid out.';
    action = 'Plan it';
  } else {
    kicker = 'Board cleared';
    title = 'Everything on today’s board is done.';
    detail = 'Rest is part of the plan.';
  }

  return (
    <View ref={nextRef} collapsable={false} style={styles.next}>
      <View style={styles.nextText}>
        <View style={styles.nextKicker}>
          <Icon name="bolt" size={icon.small} color={palette.accentSoft} />
          <SystemText variant="meta" color={palette.accentSoft} style={styles.bold}>
            {kicker}
          </SystemText>
        </View>
        <SystemText variant="title" numberOfLines={2}>
          {title}
        </SystemText>
        <SystemText variant="meta" numberOfLines={1}>
          {detail}
        </SystemText>
      </View>
      <View style={styles.nextButtons}>
        {action ? (
          <Pressable
            onPress={() => {
              playSound('tap');
              onStep();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${action}: ${title}`}>
            <View style={styles.primary}>
              <SystemText variant="body" color={palette.bg} style={styles.bold}>
                {action}
              </SystemText>
            </View>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            playSound('tap');
            onAsk();
          }}
          accessibilityRole="button"
          accessibilityLabel="Ask Beerus what to do next">
          <View style={styles.secondary}>
            <SystemText variant="body" color={palette.text} style={styles.bold}>
              Ask Beerus
            </SystemText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: alpha(palette.surface, SURFACE_ALPHA),
    borderRadius: radius.xl + 4,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.18),
    padding: space.xl,
    gap: space.lg,
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  headline: { flex: 1, minWidth: 0, gap: space.xs },
  greeting: { fontSize: 34, lineHeight: 41 },
  greetingCompact: { fontSize: 28, lineHeight: 34 },
  status: { fontSize: 17 },
  level: { marginTop: space.sm, gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  levelText: { fontSize: 15 },
  ringNum: { fontSize: 34, lineHeight: 38 },
  ringNumCompact: { fontSize: 28, lineHeight: 32 },
  // The figures sit over the flame, so they carry a shadow of the dark behind them.
  overFlame: { textShadowColor: alpha(palette.bg, 0.9), textShadowRadius: 10 },
  // The ring flashes as a quest lands in it.
  flash: { ...StyleSheet.absoluteFill, boxShadow: `0px 0px 28px 6px ${alpha(palette.accent, 0.55)}` },

  next: {
    backgroundColor: alpha(palette.bg, 0.55),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    padding: space.lg,
    gap: space.md,
  },
  nextText: { gap: 2 },
  nextKicker: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  nextButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  primary: {
    minHeight: HIT,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    justifyContent: 'center',
  },
  secondary: {
    minHeight: HIT,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: alpha(palette.text, 0.08),
    justifyContent: 'center',
  },
  bold: { fontWeight: '600' },

  week: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.lg },
  flames: { flexDirection: 'row', gap: 6 },
  flameCol: { alignItems: 'center', gap: 4 },
  flame: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: alpha(palette.text, 0.05),
    borderWidth: 2,
    borderColor: 'transparent',
  },
  flameLit: { backgroundColor: palette.accent },
  flamePerfect: { backgroundColor: palette.accentSoft },
  flameToday: { borderColor: alpha(palette.accentSoft, 0.7) },
  flameOn: { borderColor: palette.text },
  flameDay: { fontSize: 11 },
  streak: { flex: 1, minWidth: 160 },
});
