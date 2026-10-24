import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Ring } from '@/components/charts/Ring';
import { Icon } from '@/components/system/Icon';
import { Pressable } from '@/components/system/Pressable';
import { SystemText } from '@/components/system/SystemText';
import { alpha, gradient, HIT, icon, palette, radius, space } from '@/constants/theme';
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

/**
 * The top of the day. Three questions, answered without reading a list:
 * how far through today am I (the ring), what do I do now (one step, with
 * the button that does it), and am I keeping it going (the week of flames).
 */
export function TodayHero({
  greeting,
  done,
  total,
  level,
  into,
  need,
  streak,
  week,
  today,
  selected,
  onSelectDay,
  step,
  onStep,
  onAsk,
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
  compact: boolean;
}) {
  const ratio = total > 0 ? done / total : 0;
  const ringSize = compact ? 108 : 148;

  return (
    <View style={styles.hero}>
      {/* The ember glow behind the ring: the warmth comes from the corner the eye goes to. */}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="88%" cy="18%" rx="62%" ry="78%">
            <Stop offset="0" stopColor={gradient.ember[1]} stopOpacity={0.42} />
            <Stop offset="0.45" stopColor={gradient.ember[2]} stopOpacity={0.16} />
            <Stop offset="1" stopColor={palette.surface} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)" />
      </Svg>

      <View style={styles.top}>
        <View style={styles.headline}>
          <SystemText variant="hero" style={[styles.greeting, compact && styles.greetingCompact]}>
            {greeting}
          </SystemText>
          <SystemText variant="body" color={palette.text} style={styles.status}>
            {total === 0
              ? 'Nothing on the board yet.'
              : done === total
                ? `All ${total} quests cleared today.`
                : `${done} of ${total} quests cleared today.`}
          </SystemText>
          <View style={styles.level} accessibilityLabel={`Level ${level}, ${need - into} XP to level ${level + 1}`}>
            <SystemText variant="title" color={palette.accentSoft} style={styles.levelText}>
              Level {level}
            </SystemText>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: `${Math.max(3, (into / Math.max(1, need)) * 100)}%` }]} />
            </View>
            <SystemText variant="meta">{(need - into).toLocaleString('en-US')} XP to go</SystemText>
          </View>
        </View>
        <Ring size={ringSize} stroke={compact ? 11 : 14} ratio={ratio} colors={[gradient.ember[0], gradient.ember[2]]}>
          <SystemText variant="numeral" style={compact ? styles.ringNumCompact : styles.ringNum}>
            {Math.round(ratio * 100)}%
          </SystemText>
          <SystemText variant="meta">today</SystemText>
        </Ring>
      </View>

      <NextCard step={step} onStep={onStep} onAsk={onAsk} />

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

function NextCard({ step, onStep, onAsk }: { step: NextStep; onStep: () => void; onAsk: () => void }) {
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
    <View style={styles.next}>
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
    backgroundColor: palette.surface,
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
  levelText: { fontSize: 15 },
  xpTrack: { height: 6, borderRadius: 3, backgroundColor: alpha(palette.text, 0.08), overflow: 'hidden', maxWidth: 240 },
  xpFill: { height: 6, borderRadius: 3, backgroundColor: palette.accentSoft },
  ringNum: { fontSize: 34, lineHeight: 38 },
  ringNumCompact: { fontSize: 28, lineHeight: 32 },

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
