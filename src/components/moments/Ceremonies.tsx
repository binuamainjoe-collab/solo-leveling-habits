import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { FadeOut } from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

import { RankSeal } from '@/components/moments/RankSeal';
import { Sparks } from '@/components/moments/Sparks';
import { Rolling } from '@/components/motion/Rolling';
import { Scramble } from '@/components/motion/Scramble';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, rankMeta, space, type Rank } from '@/constants/theme';
import { rankUpSound } from '@/lib/ceremonySound';
import { haptic } from '@/lib/feedback';
import { skyFor, starAt } from '@/lib/moments';

/** Marks a part of a ceremony for its CSS (src/app/+html.tsx); the motion plays as it mounts. */
const cue = (name: string) => ({ dataSet: { cer: name } }) as object;

/**
 * A burst of light: white-hot in the middle, fading out through `tint` to
 * nothing, so a flash reads as light and not as a disc laid over the screen.
 */
function Bloom({ size, tint, peak, tag }: { size: number; tint: string; peak: number; tag?: object }) {
  const id = `bloom${useId().replace(/:/g, '')}`;
  return (
    <View {...(tag ?? {})} pointerEvents="none" style={[styles.bloom, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFF6E2" stopOpacity={peak} />
            <Stop offset="0.35" stopColor={tint} stopOpacity={peak * 0.45} />
            <Stop offset="1" stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** Steps through a ceremony: each entry is when its phase begins, in ms. */
export function usePhases(times: number[]): number {
  const [phase, setPhase] = useState(0);
  const plan = useRef(times);
  useEffect(() => {
    const timers = plan.current.map((t, i) => setTimeout(() => setPhase(i + 1), t));
    return () => timers.forEach(clearTimeout);
  }, []);
  return phase;
}

/**
 * What every big moment stands on: a backdrop over the whole app, a tap
 * anywhere to move on, and an end of its own after `duration`, so a moment
 * never holds you. It leaves with a short fade, quieter than it came.
 */
export function Stage({
  duration,
  onDone,
  label,
  night,
  children,
}: {
  duration: number;
  onDone: () => void;
  label: string;
  night?: boolean;
  children: ReactNode;
}) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const t = setTimeout(() => done.current(), duration);
    return () => clearTimeout(t);
  }, [duration]);
  return (
    <Animated.View exiting={FadeOut.duration(220)} style={StyleSheet.absoluteFill}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => done.current()}
        accessibilityRole="button"
        accessibilityLabel={`${label}. Tap to continue`}>
        <View {...cue('in')} style={[StyleSheet.absoluteFill, night ? styles.night : styles.backdrop]} />
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Words that arrive partway through. They hold their place from the start,
 * unseen, so the seal or ring above doesn't jump when they come in.
 */
export function Later({ on, style, children }: { on: boolean; style?: object; children: ReactNode }) {
  return (
    <View {...(on ? cue('rise') : {})} aria-hidden={!on} style={[style, !on && styles.waiting]}>
      {children}
    </View>
  );
}

export function Hint({ show }: { show: boolean }) {
  return show ? (
    <View {...cue('in')} style={styles.hint}>
      <SystemText variant="meta" color={palette.textFaint}>
        Tap to continue
      </SystemText>
    </View>
  ) : null;
}

/**
 * A rank: the full ceremony. Your old seal stands, then burns away in a strike
 * of sparks; the new one is forged in its place with a flash and a shock that
 * shakes the screen; then it names what you are now and what changed: the
 * world burns brighter at every rank.
 */
export function RankUp({ from, to, level, onDone }: { from: Rank; to: Rank; level: number; onDone: () => void }) {
  const BURN = 700;
  const FORGE = 1080;
  const phase = usePhases([BURN, FORGE, 1220, 1440, 1900]);
  useEffect(() => rankUpSound(BURN, FORGE), []);
  useEffect(() => {
    if (phase === 1) haptic('medium');
    if (phase === 2) haptic('success');
  }, [phase]);
  const colour = rankMeta[to].color;

  return (
    <Stage duration={3000} onDone={onDone} label={`Rank up. ${to}-rank`}>
      <Sparks
        duration={2800}
        bursts={[
          { at: BURN, x: 0.5, y: 0.4, count: 24, power: 0.8 },
          { at: FORGE, x: 0.5, y: 0.4, count: 40, power: 1.3 },
        ]}
      />
      <View style={styles.centre} pointerEvents="none">
        <View {...cue('rise')}>
          <Scramble variant="label" color={palette.accentSoft} style={styles.kicker}>
            RANK UP
          </Scramble>
        </View>
        <View {...(phase >= 2 ? cue('shake') : {})} style={styles.sealBox}>
          {phase >= 2 ? <View {...cue('wave')} style={[styles.wave, { borderColor: alpha(colour, 0.8) }]} /> : null}
          {phase >= 2 ? <Bloom size={300} tint={colour} peak={0.9} tag={cue('flash')} /> : null}
          {phase < 2 ? <RankSeal key="old" rank={from} size={180} tag={cue(phase >= 1 ? 'burn' : 'rise')} /> : null}
          {phase >= 2 ? <RankSeal key="new" rank={to} size={180} tag={cue('forge')} /> : null}
        </View>
        <Later on={phase >= 3} style={styles.after}>
          <SystemText variant="hero" color={colour} style={styles.rankTitle}>
            {rankMeta[to].label}
          </SystemText>
        </Later>
        <Later on={phase >= 4}>
          <SystemText variant="body" color={palette.text} style={styles.centred}>
            Level {level}. The world burns brighter.
          </SystemText>
        </Later>
      </View>
      <Hint show={phase >= 5} />
    </Stage>
  );
}

/**
 * A perfect day: the last spark of the day rises into the night and becomes
 * a star, beside the stars of every perfect day before it. That star stays in
 * the sky behind your screens. No sound: sound is kept for levels and ranks.
 */
export function StarBorn({ count, onDone }: { count: number; onDone: () => void }) {
  const IGNITE = 760;
  const { width, height } = useWindowDimensions();
  const phase = usePhases([IGNITE, 900, 1300]);
  useEffect(() => {
    if (phase === 1) haptic('success');
  }, [phase]);

  // The sky takes the top of the screen; the world's stars sit in the same order.
  const place = (s: { x: number; y: number }) => ({ left: s.x * width, top: ((0.98 - s.y) / 0.1) * height * 0.32 + height * 0.06 });
  const earlier = skyFor(count - 1);
  const shownCount = phase >= 2 ? count : count - 1;
  const born = place(starAt(count - 1));

  const riser = useRef<View | null>(null);
  useEffect(() => {
    const el = riser.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.animate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate(
      [
        { transform: `translate(${width / 2}px, ${height * 0.86}px) scale(0.7)`, opacity: 0 },
        { transform: `translate(${width / 2}px, ${height * 0.7}px) scale(1)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${born.left}px, ${born.top}px) scale(0.6)`, opacity: 1 },
      ],
      { duration: IGNITE, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' },
    );
  }, [born.left, born.top, height, width]);

  return (
    <Stage duration={2600} onDone={onDone} label={`Perfect day. ${count} perfect days`} night>
      {earlier.map((s, i) => {
        const at = place(s);
        return <View key={i} style={[styles.oldStar, { left: at.left - 2, top: at.top - 2, opacity: 0.35 + s.size * 0.4 }]} />;
      })}
      {phase < 1 ? <View ref={riser} style={styles.riser} /> : null}
      {phase >= 1 ? (
        <View {...cue('ignite')} style={[styles.star, { left: born.left - 40, top: born.top - 40 }]}>
          <Bloom size={80} tint={palette.gold} peak={0.55} />
          {/* Two glints that fade to nothing at their tips, like light through an eye. */}
          <LinearGradient
            colors={['rgba(255,241,218,0)', 'rgba(255,241,218,0.9)', 'rgba(255,241,218,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.glintFlat}
          />
          <LinearGradient
            colors={['rgba(255,241,218,0)', 'rgba(255,241,218,0.9)', 'rgba(255,241,218,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.glintTall}
          />
          <View style={styles.starCore} />
        </View>
      ) : null}
      <Sparks duration={2400} tone="gold" drift={false} bursts={[{ at: IGNITE, x: born.left / width, y: born.top / height, count: 30, power: 0.7 }]} />
      <View style={[styles.centre, styles.low]} pointerEvents="none">
        <View {...cue('rise')}>
          <Scramble variant="label" color={palette.gold} style={styles.kicker}>
            PERFECT DAY
          </Scramble>
        </View>
        <Later on={phase >= 2} style={styles.after}>
          <SystemText variant="heading" color={palette.text} style={styles.centred}>
            A new star joins your sky.
          </SystemText>
        </Later>
        <View style={styles.countRow}>
          <Rolling text={shownCount.toLocaleString('en-US')} lineHeight={22} variant="body" color={palette.gold} />
          <SystemText variant="body" color={palette.textMuted}>
            {shownCount === 1 ? ' perfect day' : ' perfect days'}
          </SystemText>
        </View>
      </View>
      <Hint show={phase >= 3} />
    </Stage>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(17,13,10,0.95)' },
  night: { backgroundColor: '#0C0A0E' },
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  low: { justifyContent: 'flex-end', paddingBottom: '22%' },
  kicker: { letterSpacing: 3, fontSize: 13 },
  sealBox: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  after: { alignItems: 'center' },
  waiting: { opacity: 0 },
  centred: { textAlign: 'center' },
  rankTitle: { fontSize: 40, lineHeight: 46, letterSpacing: 1 },
  bloom: { position: 'absolute', opacity: 0, alignItems: 'center', justifyContent: 'center' },
  wave: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 3, opacity: 0 },
  hint: { position: 'absolute', bottom: space.xxl * 2, left: 0, right: 0, alignItems: 'center' },
  countRow: { flexDirection: 'row', alignItems: 'center' },
  oldStar: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: '#F7E2B8' },
  riser: {
    position: 'absolute',
    left: -6,
    top: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFF1DA',
    boxShadow: `0px 0px 18px 6px ${alpha(palette.gold, 0.7)}`,
    opacity: 0,
  },
  star: { position: 'absolute', width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  starCore: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FFF6E2', boxShadow: `0px 0px 14px 4px ${alpha(palette.gold, 0.8)}` },
  glintFlat: { position: 'absolute', width: 64, height: 2 },
  glintTall: { position: 'absolute', width: 2, height: 64 },
});
