import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { setFocusOpen } from '@/components/moments/stage';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, palette, radius, space } from '@/constants/theme';
import { feedback, playSound } from '@/lib/feedback';
import { registerGate } from '@/lib/gateBus';
import { isComplete, useProgress, useQuestLookup } from '@/store/progress';

interface Gate {
  questId: string;
  x: number;
  y: number;
}

type Doc = Document & { startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> } };

/** How long the cleared Gate stays before it closes on its own. */
const CLEARED_MS = 1100;

/**
 * Passes between the board and a Gate with the browser's own view transition:
 * the board is snapshot, and the new view is revealed through a ring opening
 * from the Gate button while the board dives in after it (going in), or the
 * Gate closes back down to the button (coming out). The CSS is in
 * src/app/+html.tsx. Where the browser has no view transitions, or motion is
 * turned down, the switch is immediate.
 */
function through(way: 'in' | 'out', at: { x: number; y: number }, change: (done: () => void) => void) {
  const doc = document as Doc;
  if (Platform.OS !== 'web' || !doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change(() => {});
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--gate-x', `${Math.round(at.x)}px`);
  root.style.setProperty('--gate-y', `${Math.round(at.y)}px`);
  root.dataset.gate = way;
  const t = doc.startViewTransition(() => new Promise<void>((resolve) => change(resolve)));
  t.finished.finally(() => {
    delete root.dataset.gate;
  });
}

/**
 * A boss quest's Gate: step through and the rest of the app falls away, so
 * the one hard thing is all there is. It counts how long you have been inside,
 * takes progress the same way the card does, and when the quest is cleared it
 * says so and closes behind you. Big moments wait until you are out.
 */
export function FocusGate() {
  const { state, setProgress } = useProgress();
  const lookup = useQuestLookup();
  const insets = useSafeAreaInsets();
  const [gate, setGate] = useState<Gate | null>(null);
  const [entered, setEntered] = useState(0);
  const [now, setNow] = useState(0);
  const painted = useRef<(() => void) | null>(null);
  const leaving = useRef(false);

  // The new view is on screen: the transition can take its picture now.
  useLayoutEffect(() => {
    painted.current?.();
    painted.current = null;
  }, [gate]);

  useEffect(() => {
    registerGate((questId, x, y) => {
      playSound('tap');
      leaving.current = false;
      through('in', { x, y }, (done) => {
        painted.current = done;
        setGate({ questId, x, y });
        setEntered(Date.now());
        setNow(Date.now());
      });
    });
    return () => registerGate(null);
  }, []);

  useEffect(() => {
    setFocusOpen(gate !== null);
    if (!gate) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [gate]);
  useEffect(() => () => setFocusOpen(false), []);

  const quest = gate ? lookup(gate.questId) : undefined;
  const value = quest ? (state.values[quest.id] ?? 0) : 0;
  const cleared = quest ? isComplete(quest, value) : false;

  const leave = () => {
    if (!gate || leaving.current) return;
    leaving.current = true;
    playSound('tap');
    through('out', gate, (done) => {
      painted.current = done;
      setGate(null);
    });
  };

  // Cleared inside: it says so, then closes behind you.
  const leaveRef = useRef(leave);
  useEffect(() => {
    leaveRef.current = leave;
  });
  useEffect(() => {
    if (!cleared || !gate) return;
    const t = setTimeout(() => leaveRef.current(), CLEARED_MS);
    return () => clearTimeout(t);
  }, [cleared, gate]);

  if (!gate || !quest) return null;

  const binary = quest.kind === 'binary' || quest.kind === 'window';
  const step = quest.step ?? 1;
  const seconds = Math.max(0, Math.floor((now - entered) / 1000));
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const act = () => {
    const next = binary ? quest.target : value + step;
    if (!isComplete(quest, value) && isComplete(quest, next)) feedback('complete', 'success');
    else playSound('tap');
    setProgress(quest.id, next);
  };

  return (
    <View style={styles.root} accessibilityViewIsModal>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <RadialGradient id="gateCore" cx="50%" cy="58%" rx="70%" ry="55%">
            <Stop offset="0" stopColor={palette.accentDeep} stopOpacity={0.55} />
            <Stop offset="0.45" stopColor="#3A140A" stopOpacity={0.6} />
            <Stop offset="1" stopColor={palette.bg} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#gateCore)" />
        {/* The Gate's rim, ring inside ring, all around you. */}
        {[0.28, 0.42, 0.58, 0.76].map((r, i) => (
          <Circle key={r} cx="50%" cy="58%" r={`${r * 100}%`} fill="none" stroke={palette.accent} strokeOpacity={0.16 - i * 0.03} strokeWidth={1.5} />
        ))}
      </Svg>

      <View style={[styles.content, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl }]}>
        <SystemText variant="label" color={palette.accentSoft} style={styles.kicker}>
          BOSS GATE
        </SystemText>
        <SystemText variant="hero" numberOfLines={3} style={styles.title}>
          {quest.title}
        </SystemText>
        <SystemText variant="body" style={styles.centred} numberOfLines={3}>
          {quest.objective}
        </SystemText>

        <View style={styles.clock} accessibilityLabel={`${Math.floor(seconds / 60)} minutes in the Gate`}>
          <SystemText variant="numeral" style={styles.clockText}>
            {clock}
          </SystemText>
          <SystemText variant="meta">in the Gate</SystemText>
        </View>

        {cleared ? (
          <SystemText variant="title" color={palette.positive} style={styles.centred}>
            Boss quest cleared.
          </SystemText>
        ) : (
          <>
            {!binary ? (
              <SystemText variant="title" color={palette.text}>
                {value} / {quest.target} {quest.unit}
              </SystemText>
            ) : null}
            <Pressable onPress={act} accessibilityRole="button" accessibilityLabel={binary ? 'Mark done' : `Add ${step} ${quest.unit}`}>
              <View style={styles.primary}>
                <SystemText variant="button" color={palette.bg}>
                  {binary ? 'Mark done' : `+${step} ${quest.unit}`}
                </SystemText>
              </View>
            </Pressable>
          </>
        )}

        <View style={styles.spacer} />
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Leave the Gate">
          <View style={styles.ghost}>
            <SystemText variant="button" color={palette.text}>
              Leave the Gate
            </SystemText>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: palette.bg },
  content: { flex: 1, alignItems: 'center', gap: space.lg, paddingHorizontal: space.xl },
  kicker: { letterSpacing: 3, fontSize: 13 },
  title: { textAlign: 'center', fontSize: 32, lineHeight: 38 },
  centred: { textAlign: 'center', maxWidth: 420 },
  clock: { alignItems: 'center', marginTop: space.xl },
  clockText: { fontSize: 56, lineHeight: 64 },
  spacer: { flex: 1 },
  primary: {
    minHeight: HIT,
    minWidth: 200,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: {
    minHeight: HIT,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: alpha(palette.text, 0.18),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
