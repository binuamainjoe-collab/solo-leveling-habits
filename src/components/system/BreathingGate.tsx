import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';

/**
 * Box breathing — 4 in, 4 hold, 4 out, 4 hold. Symmetric, easy to follow
 * without counting, and the pattern with the strongest evidence for settling
 * acute stress. Tune these four numbers to change the whole exercise.
 */
const PHASES = [
  { key: 'in', label: 'Breathe in', seconds: 4, expanded: true },
  { key: 'hold-in', label: 'Hold', seconds: 4, expanded: true },
  { key: 'out', label: 'Breathe out', seconds: 4, expanded: false },
  { key: 'hold-out', label: 'Hold', seconds: 4, expanded: false },
] as const;

const CYCLES = 3;
const CYCLE_SECONDS = PHASES.reduce((s, p) => s + p.seconds, 0);
const TOTAL_SECONDS = CYCLES * CYCLE_SECONDS;

/** Circle scale at each end of the breath. */
const SMALL = 0.52;
const LARGE = 1;

/**
 * Which phase a given second falls in. A plain function rather than a memo —
 * it walks four entries once a second, and the early return inside the loop is
 * something React Compiler can't preserve a manual memo through anyway.
 */
function phaseAt(tick: number) {
  const into = tick % CYCLE_SECONDS;
  let acc = 0;
  for (const p of PHASES) {
    if (into < acc + p.seconds) {
      return {
        phase: p,
        remaining: p.seconds - (into - acc),
        cycle: Math.floor(tick / CYCLE_SECONDS),
      };
    }
    acc += p.seconds;
  }
  return { phase: PHASES[0], remaining: PHASES[0].seconds, cycle: 0 };
}

export function BreathingExercise({ onFinish }: { onFinish: () => void }) {
  // A single clock. Phase, countdown and cycle are all derived from it, so
  // they can never drift apart the way separate timers would.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (tick >= TOTAL_SECONDS) onFinish();
  }, [tick, onFinish]);

  const { phase, remaining, cycle } = phaseAt(tick);

  const scale = phase.expanded ? LARGE : SMALL;

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      exiting={FadeOut.duration(500)}
      style={styles.root}>
      <View style={styles.head}>
        <SystemText variant="label" color={palette.accent} style={styles.kicker}>
          ◆ Before you begin ◆
        </SystemText>
        <SystemText variant="body" style={styles.sub}>
          Four in, four hold, four out, four hold.
        </SystemText>
      </View>

      <View style={styles.stage}>
        {/* Outer halo — trails the breath slightly, so the glow feels like it
            follows the body rather than driving it. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              transform: [{ scale }],
              opacity: phase.expanded ? 0.5 : 0.18,
              transitionProperty: ['transform', 'opacity'],
              transitionDuration: [`${phase.seconds * 1000 + 400}ms`, `${phase.seconds * 1000}ms`],
              transitionTimingFunction: ['ease-in-out', 'ease-in-out'],
            },
          ]}
        />

        <Animated.View
          style={[
            styles.orb,
            {
              transform: [{ scale }],
              // The transition runs for exactly as long as the phase, so the
              // circle finishes growing precisely as the count hits zero.
              transitionProperty: 'transform',
              transitionDuration: `${phase.seconds * 1000}ms`,
              transitionTimingFunction: 'ease-in-out',
            },
          ]}
        />

        <Animated.View
          style={[
            styles.core,
            {
              transform: [{ scale: phase.expanded ? 1 : 0.7 }],
              transitionProperty: 'transform',
              transitionDuration: `${phase.seconds * 1000}ms`,
              transitionTimingFunction: 'ease-in-out',
            },
          ]}
        />

        <SystemText variant="numeral" color={palette.bg} style={styles.count}>
          {remaining}
        </SystemText>
      </View>

      {/* Rendered plainly, not via an `entering` animation. This is the one
          piece of text telling you what to do — if the animation stalls, it
          must still be on screen. The orb and the countdown carry the motion. */}
      <SystemText variant="hero" style={styles.phase}>
        {phase.label}
      </SystemText>

      <View style={styles.cycles}>
        {Array.from({ length: CYCLES }, (_, i) => (
          <Animated.View
            key={i}
            style={[
              styles.cycleDot,
              {
                backgroundColor: i <= cycle ? palette.accent : alpha(palette.text, 0.16),
                transitionProperty: 'backgroundColor',
                transitionDuration: '400ms',
              },
            ]}
          />
        ))}
      </View>

      <SkipButton onPress={onFinish} />
    </Animated.View>
  );
}

function SkipButton({ onPress }: { onPress: () => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel="Skip the breathing exercise"
      style={styles.skipWrap}>
      <Animated.View
        style={[
          styles.skip,
          {
            opacity: pressed ? 1 : 0.6,
            transitionProperty: 'opacity',
            transitionDuration: '140ms',
          },
        ]}>
        <SystemText variant="label" color={palette.textMuted}>
          Skip
        </SystemText>
      </Animated.View>
    </Pressable>
  );
}

const ORB = 220;

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xl,
  },
  head: { alignItems: 'center', gap: space.xs },
  kicker: { fontSize: 10, letterSpacing: 3 },
  sub: { fontSize: 14, color: palette.textFaint, textAlign: 'center' },
  stage: { width: ORB, height: ORB, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: alpha(palette.accent, 0.18),
  },
  orb: {
    position: 'absolute',
    width: ORB * 0.82,
    height: ORB * 0.82,
    borderRadius: (ORB * 0.82) / 2,
    backgroundColor: alpha(palette.accent, 0.22),
    borderWidth: 1.5,
    borderColor: alpha(palette.accent, 0.7),
    boxShadow: `0px 0px 48px ${alpha(palette.accent, 0.45)}`,
  },
  core: {
    position: 'absolute',
    width: ORB * 0.3,
    height: ORB * 0.3,
    borderRadius: (ORB * 0.3) / 2,
    backgroundColor: palette.accent,
  },
  count: { fontSize: 26, lineHeight: 30 },
  phase: { fontSize: 30, textAlign: 'center' },
  cycles: { flexDirection: 'row', gap: space.sm },
  cycleDot: { width: 22, height: 4, borderRadius: 2 },
  skipWrap: { position: 'absolute', bottom: space.xxl },
  skip: { paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill },
});
