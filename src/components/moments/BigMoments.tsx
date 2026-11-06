import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LevelUp, RankUp, StarBorn } from '@/components/moments/Ceremonies';
import { setCeremony, useFocusOpen, useLaunchSettled } from '@/components/moments/stage';
import { hurryDock, useAirborne, useHeldWhileFlying } from '@/components/motion/flight';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, RANKS, space, type Rank } from '@/constants/theme';
import { highest, momentsBetween, sameMarks, type Marks, type Moment } from '@/lib/moments';
import { useDayStats, useProgress } from '@/store/progress';
import { storage } from '@/store/storage';

type Queued = Moment & { id: number; fromRatio: number };

/** Test copies only: a button that previews each ceremony, since a fresh profile can't reach a rank. */
const DEMO = process.env.EXPO_PUBLIC_BEERUS_DEMO === '1';
const DEMO_KINDS = ['level', 'rank', 'star'] as const;

function readMarks(raw: string | null): Marks | null {
  try {
    const m = raw ? (JSON.parse(raw) as Marks) : null;
    return m && typeof m.level === 'number' && RANKS.includes(m.rank as Rank) && typeof m.perfect === 'number' ? m : null;
  } catch {
    return null;
  }
}

/**
 * Plays the big moments: a new level, a new rank, a perfect day. Each plays
 * once, the first time it is reached on this device, and in order. They
 * start when a cleared quest lands in the ring, not before; they wait for
 * the breathing screen and the day's opening, and for a boss Gate to close;
 * and the card and trophy reveals wait for them, so nothing stacks.
 *
 * What has been celebrated is remembered per account, so opening the app
 * again, or taking a quest back and redoing it, never replays a ceremony.
 */
export function BigMoments() {
  const { state, ready, onboarded, accountId } = useProgress();
  const { level, rank, into, need } = useDayStats();
  const settled = useLaunchSettled();
  const focus = useFocusOpen();
  const airborne = useAirborne('ring');

  // What the ring shows: these wait for a quest in flight to land.
  const heldLevel = useHeldWhileFlying(level, 'ring');
  const heldRank = useHeldWhileFlying(rank, 'ring');
  const heldPerfect = useHeldWhileFlying(state.perfectDays, 'ring');
  const heldInto = useHeldWhileFlying(into, 'ring');
  const heldNeed = useHeldWhileFlying(need, 'ring');
  const now: Marks = { level: heldLevel, rank: heldRank, perfect: heldPerfect };
  const ratio = heldInto / Math.max(1, heldNeed);

  const key = `system.marks.${accountId ?? 'local'}`;
  const latest = useRef(now);
  useEffect(() => {
    latest.current = now;
  });

  const [seen, setSeen] = useState<{ key: string; marks: Marks } | null>(null);
  useEffect(() => {
    if (!ready || !onboarded) return;
    let alive = true;
    storage.get(key).then(
      (raw) => alive && setSeen({ key, marks: readMarks(raw) ?? latest.current }),
      () => alive && setSeen({ key, marks: latest.current }),
    );
    return () => {
      alive = false;
    };
  }, [key, ready, onboarded]);

  // Where the ring stood before a level was crossed, so the ceremony fills from there.
  const [before, setBefore] = useState({ level: heldLevel, ratio });

  const [queue, setQueue] = useState<Queued[]>([]);
  // How many moments have been queued, so each gets its own id.
  const [made, setMade] = useState(0);
  if (seen && seen.key === key) {
    const next = highest(seen.marks, now);
    if (!sameMarks(next, seen.marks)) {
      const found = momentsBetween(seen.marks, now).map((m, i) => ({
        ...m,
        id: made + i + 1,
        fromRatio: m.kind === 'level' && before.level === m.from ? before.ratio : 0.5,
      }));
      setQueue([...queue, ...found]);
      setMade(made + found.length);
      setSeen({ key, marks: next });
    }
  }
  // Read above before it moves on, so a crossing fills from the old level's place.
  if (before.level !== heldLevel || before.ratio !== ratio) setBefore({ level: heldLevel, ratio });

  useEffect(() => {
    if (seen) void storage.set(seen.key, JSON.stringify(seen.marks)).catch(() => {});
  }, [seen]);

  useEffect(() => {
    setCeremony(queue.length > 0);
    if (queue.length > 0) hurryDock();
  }, [queue.length]);
  useEffect(() => () => setCeremony(false), []);

  const insets = useSafeAreaInsets();
  const [demo, setDemo] = useState(0);
  const preview = () => {
    const kind = DEMO_KINDS[demo % DEMO_KINDS.length];
    setDemo((d) => d + 1);
    const id = made + 1;
    setMade(made + 1);
    const up = RANKS[Math.min(RANKS.length - 1, RANKS.indexOf(heldRank) + 1)];
    const moment: Queued =
      kind === 'level'
        ? { kind, from: heldLevel, to: heldLevel + 1, id, fromRatio: 0.62 }
        : kind === 'rank'
          ? { kind, from: heldRank === 'S' ? 'A' : heldRank, to: up, level: heldLevel, id, fromRatio: 0 }
          : { kind, count: heldPerfect + 1, id, fromRatio: 0 };
    setQueue((q) => [...q, moment]);
  };

  const current = queue[0];
  if (!current || !settled || focus || airborne) {
    return DEMO && settled && !focus ? (
      <Pressable onPress={preview} style={[styles.demo, { bottom: insets.bottom + 124 }]} accessibilityRole="button" accessibilityLabel="Preview a big moment">
        <SystemText variant="meta" color={palette.text}>
          Preview: {DEMO_KINDS[demo % DEMO_KINDS.length] === 'star' ? 'perfect day' : `${DEMO_KINDS[demo % DEMO_KINDS.length]} up`} · tap
        </SystemText>
      </Pressable>
    ) : null;
  }
  const done = () => setQueue((q) => q.slice(1));

  if (current.kind === 'rank') return <RankUp key={current.id} from={current.from} to={current.to} level={current.level} onDone={done} />;
  if (current.kind === 'level')
    return <LevelUp key={current.id} from={current.from} to={current.to} fromRatio={current.fromRatio} into={heldInto} need={heldNeed} onDone={done} />;
  return <StarBorn key={current.id} count={current.count} onDone={done} />;
}

const styles = StyleSheet.create({
  demo: {
    position: 'absolute',
    left: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: alpha(palette.surface, 0.9),
  },
});
