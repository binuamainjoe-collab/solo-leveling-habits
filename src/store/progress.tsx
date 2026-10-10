import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { ACHIEVEMENTS, type AchievementDef } from '@/data/achievements';
import { CARDS_BY_ID, earnedCards, type CardContext, type CardDef } from '@/data/cards';
import { buildPlan, type Profile } from '@/data/profile';
import { isPlannedId, plannedToQuest, type PlannedTask } from '@/data/planner';
import { isCeilingQuest, isComplete, windowState } from '@/data/completion';
import { DEFAULT_ACTIVE, QUESTS_BY_ID, type QuestDef } from '@/data/quests';
import { CATEGORIES, RANKS, type CategoryId, type Rank, type StatKey } from '@/constants/theme';
import { PersistentStore, storage, type SaveState } from '@/store/storage';
import {
  chooseSeed,
  DEVICE_KEY,
  fromStored,
  keyFor,
  mergeAll,
  pullProgress,
  pushProgress,
  wrap,
  ADOPTED_KEY,
  type Envelope,
  type PersistedState,
} from '@/store/cloud';
import { client } from '@/lib/supabase';

/* ------------------------------------------------------------------ shape */

/** What a finished day looked like. Written once, then never mutated. */
export interface DayRecord {
  /** questId -> value reached that day. */
  values: Record<string, number>;
  cleared: number;
  total: number;
  perfect: boolean;
}

/** User-controlled feedback switches. Persisted with everything else. */
export interface Settings {
  sound: boolean;
  haptics: boolean;
  music: boolean;
  /** 24h "HH:MM" after which the nightly briefing offers itself. */
  briefingTime: string;
}

/** An accepted nightly plan, stored against the day it is FOR. */
export interface StoredPlan {
  taskIds: string[];
  note: string;
  acceptedAt: string;
}

export interface ProgressState {
  /** null until the student finishes onboarding. */
  profile: Profile | null;
  settings: Settings;
  /** Quests currently on the board. Everything else lives in the archive. */
  activeQuestIds: string[];
  /** YYYY-MM-DD the `values` below belong to. */
  date: string;
  /** questId -> progress accumulated today. */
  values: Record<string, number>;
  /** The permanent log. This is what makes progress countable over time. */
  days: Record<string, DayRecord>;
  /** Lifetime totals per quest, for `total` achievements. */
  totals: Record<string, number>;
  questCompletions: number;
  xp: number;
  stats: Record<StatKey, number>;
  unlocked: string[];
  /**
   * Every task the briefing has ever produced, keyed by id and never deleted —
   * an archived day references its tasks by id, so dropping them would make
   * that day's history unreadable.
   */
  planned: Record<string, PlannedTask>;
  /** date -> the plan accepted for it. */
  plans: Record<string, StoredPlan>;
  /** Lifetime accepted plans, for the Strategist trophy. */
  plansAccepted: number;
  /**
   * The date a briefing was waved away for. Persisted, not held in memory:
   * "not tonight" has to survive reopening the app, or the gate just reappears.
   */
  briefingDismissed: string | null;
  /** Collectible cards owned, in the order they were earned. */
  cards: string[];
  /** Cards waiting to play their reveal. Never persisted. */
  cardQueue: string[];
  /**
   * Achievements waiting to play their fanfare. Kept in state so unlocks are
   * computed in the same transition that causes them; never persisted, so a
   * reload doesn't replay old fanfares.
   */
  unlockQueue: string[];

  /* Derived and cached below — recomputed from `days` after every mutation
     rather than incremented, so they cannot drift out of sync. */
  streak: number;
  bestStreak: number;
  perfectDays: number;
  categoryDays: Record<CategoryId, number>;
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Shift a YYYY-MM-DD key by whole days, staying in local time. */
function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return todayKey(dt);
}

const emptyCategoryDays = () =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<CategoryId, number>;

const baseStats = (): Record<StatKey, number> => ({
  STR: 10, AGI: 10, VIT: 10, INT: 10, PER: 10, SEN: 10,
});

function blankState(): ProgressState {
  return {
    profile: null,
    settings: { sound: true, haptics: true, music: true, briefingTime: '21:30' },
    activeQuestIds: [...DEFAULT_ACTIVE],
    date: todayKey(),
    values: {},
    days: {},
    totals: {},
    planned: {},
    plans: {},
    plansAccepted: 0,
    briefingDismissed: null,
    questCompletions: 0,
    xp: 0,
    stats: baseStats(),
    unlocked: [],
    cards: [],
    cardQueue: [],
    unlockQueue: [],
    streak: 0,
    bestStreak: 0,
    perfectDays: 0,
    categoryDays: emptyCategoryDays(),
  };
}

/** Accepting tomorrow's plan before bed. */
export const ACCEPT_PLAN_XP = 200;
/** Clearing a quest you planned the night before. */
export const PLANNED_XP_MULTIPLIER = 1.5;

/* ---------------------------------------------------------------- levels */

/** Cost of the next level grows 18% each time — fast early, slow later. */
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 400;
  let remaining = xp;
  while (remaining >= need) {
    remaining -= need;
    level += 1;
    need = Math.round(need * 1.18);
  }
  return { level, into: remaining, need };
}

export function rankFromLevel(level: number): Rank {
  if (level >= 100) return 'S';
  if (level >= 80) return 'A';
  if (level >= 50) return 'B';
  if (level >= 25) return 'C';
  if (level >= 10) return 'D';
  return 'E';
}

/* ----------------------------------------------------------- completion */

// Completion and clock rules live in a React-free module so they can be
// unit-tested; re-exported here because the whole app imports them from the
// store.
export { isCeilingQuest, isComplete, windowState, type WindowState } from '@/data/completion';

/* ------------------------------------------------------------- deriving */

/**
 * Resolve any quest id, whichever source it came from.
 *
 * Every lookup goes through here. The catalogue used to be read directly, which
 * meant a planned task — absent from it — was quietly dropped by `.filter`,
 * counting toward nothing: not cleared, not the streak, not a perfect day.
 */
function questFor(s: ProgressState, id: string): QuestDef | undefined {
  if (isPlannedId(id)) {
    const task = s.planned[id];
    return task ? plannedToQuest(task) : undefined;
  }
  return QUESTS_BY_ID[id];
}

/** The board for a given day: the standing quests plus that day's plan. */
function boardIdsFor(s: ProgressState, date: string): string[] {
  return [...s.activeQuestIds, ...(s.plans[date]?.taskIds ?? [])];
}

/** One day, in the shape the log stores. */
function summarize(s: ProgressState, date: string, values: Record<string, number>): DayRecord {
  const quests = boardIdsFor(s, date)
    .map((id) => questFor(s, id))
    .filter((q): q is QuestDef => Boolean(q));
  const cleared = quests.filter((q) => isComplete(q, values[q.id] ?? 0)).length;
  return {
    values,
    cleared,
    total: quests.length,
    perfect: quests.length > 0 && cleared === quests.length,
  };
}

/**
 * Rebuild every cumulative figure from the day log.
 *
 * These were counters before, incremented at mutation sites — which is how
 * `perfectDays` ended up never being written at all. Deriving them means a
 * missed increment is impossible.
 */
function recompute(s: ProgressState): ProgressState {
  const log: Record<string, DayRecord> = {
    ...s.days,
    [s.date]: summarize(s, s.date, s.values),
  };

  let perfectDays = 0;
  for (const rec of Object.values(log)) if (rec.perfect) perfectDays += 1;

  // Current streak: walk back from today. Today not yet started doesn't break
  // it — the day isn't over — so begin at yesterday in that case.
  let streak = 0;
  let cursor = (log[s.date]?.cleared ?? 0) > 0 ? s.date : shiftDay(s.date, -1);
  while ((log[cursor]?.cleared ?? 0) > 0) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }

  // Best streak: longest run of consecutive active days anywhere in the log.
  const active = Object.keys(log).filter((d) => (log[d]?.cleared ?? 0) > 0).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of active) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    if (run > best) best = run;
    prev = day;
  }

  // Days on which each discipline saw at least one clear.
  const categoryDays = emptyCategoryDays();
  for (const rec of Object.values(log)) {
    const seen = new Set<CategoryId>();
    for (const [id, value] of Object.entries(rec.values)) {
      const quest = questFor(s, id);
      if (quest && !seen.has(quest.category) && isComplete(quest, value)) {
        seen.add(quest.category);
      }
    }
    for (const c of seen) categoryDays[c] += 1;
  }

  return { ...s, perfectDays, streak, bestStreak: Math.max(best, streak), categoryDays };
}

/** Archive the finished day and start a fresh one. */
function rollDay(s: ProgressState): ProgressState {
  const key = todayKey();
  if (s.date === key) return s;

  const finished = summarize(s, s.date, s.values);
  const days = finished.total > 0 ? { ...s.days, [s.date]: finished } : s.days;
  return recompute({ ...s, days, date: key, values: {} });
}

/* --------------------------------------------------------- achievements */

export function achievementProgress(
  a: AchievementDef,
  s: ProgressState,
): { current: number; goal: number } {
  switch (a.track.type) {
    case 'streak':
      return { current: s.streak, goal: a.track.days };
    case 'total':
      return { current: s.totals[a.track.questId] ?? 0, goal: a.track.amount };
    case 'perfectDays':
      return { current: s.perfectDays, goal: a.track.count };
    case 'level':
      return { current: levelFromXp(s.xp).level, goal: a.track.level };
    case 'rank':
      return {
        current: RANKS.indexOf(rankFromLevel(levelFromXp(s.xp).level)) + 1,
        goal: RANKS.indexOf(a.track.rank) + 1,
      };
    case 'categoryDays':
      return { current: s.categoryDays[a.track.category] ?? 0, goal: a.track.days };
    case 'questsCompleted':
      return { current: s.questCompletions, goal: a.track.count };
    case 'plansMade':
      return { current: s.plansAccepted, goal: a.track.count };
  }
}

function newlySatisfied(s: ProgressState): string[] {
  return ACHIEVEMENTS.filter((a) => {
    if (a.secret) return false; // secrets unlock through their own triggers
    if (s.unlocked.includes(a.id)) return false;
    const { current, goal } = achievementProgress(a, s);
    return current >= goal;
  }).map((a) => a.id);
}

/** Record satisfied achievements WITHOUT queueing fanfares (load / reset). */
function absorbUnlocks(s: ProgressState): ProgressState {
  const newly = newlySatisfied(s);
  return newly.length ? { ...s, unlocked: [...s.unlocked, ...newly] } : s;
}

/** Record satisfied achievements AND queue their fanfares (live progress). */
function applyUnlocks(s: ProgressState): ProgressState {
  const newly = newlySatisfied(s);
  if (!newly.length) return s;
  return { ...s, unlocked: [...s.unlocked, ...newly], unlockQueue: [...s.unlockQueue, ...newly] };
}

/* ---------------------------------------------------------------- cards */

/** The slice of progress that card triggers are evaluated against. */
function cardContext(s: ProgressState): CardContext {
  return {
    rank: rankFromLevel(levelFromXp(s.xp).level),
    streak: s.streak,
    perfectDays: s.perfectDays,
    questCompletions: s.questCompletions,
    date: s.date,
    // Today is included as a live record so a card can be earned the moment
    // its condition is met, not only after the day rolls over.
    days: { ...s.days, [s.date]: summarize(s, s.date, s.values) },
  };
}

function newCards(s: ProgressState): string[] {
  return earnedCards(cardContext(s)).filter((id) => !s.cards.includes(id));
}

/** Grant cards WITHOUT queueing reveals (load / reset). */
function absorbCards(s: ProgressState): ProgressState {
  const newly = newCards(s);
  return newly.length ? { ...s, cards: [...s.cards, ...newly] } : s;
}

/** Grant cards AND queue their reveal animation (live progress). */
function applyCards(s: ProgressState): ProgressState {
  const newly = newCards(s);
  if (!newly.length) return s;
  return { ...s, cards: [...s.cards, ...newly], cardQueue: [...s.cardQueue, ...newly] };
}

/* ------------------------------------------------------------- provider */


interface ProgressApi {
  state: ProgressState;
  ready: boolean;
  /** Whether the latest change has reached disk. */
  saveState: SaveState;
  saveError: string | null;
  /** True once onboarding has produced a profile. */
  onboarded: boolean;
  pendingUnlock: AchievementDef | null;
  dismissUnlock: () => void;
  /** Newest collectible waiting to play its reveal. */
  pendingCard: CardDef | null;
  dismissCard: () => void;
  completeOnboarding: (profile: Profile) => void;
  setSetting: (key: keyof Settings, value: boolean | string) => void;
  /** Turn an accepted briefing into the given day's quests. */
  acceptPlan: (date: string, tasks: PlannedTask[], note: string) => void;
  /** The plan stored for a day, if one was accepted. */
  planFor: (date: string) => StoredPlan | undefined;
  /** Wave tonight's briefing away until tomorrow. */
  dismissBriefing: (date: string) => void;
  /**
   * Award (or claw back) XP that did not come from clearing a quest —
   * finishing a must-read finding, for instance. Negative amounts are
   * allowed so un-marking something takes its reward back, which is what
   * stops a toggle from being farmed.
   */
  addXp: (amount: number) => void;
  setProgress: (questId: string, value: number) => void;
  addProgress: (questId: string, amount: number) => void;
  clearQuest: (questId: string) => void;
  toggleActive: (questId: string) => void;
  resetAll: () => void;
}

const Ctx = createContext<ProgressApi | null>(null);

/** Read one storage key as an envelope, tolerating the pre-sync format. */
async function readEnvelope(key: string): Promise<Envelope | null> {
  try {
    const raw = await storage.get(key);
    return raw ? fromStored(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in account id, or null.
 *
 * Returns null immediately and forever when Supabase is unconfigured, which
 * keeps the whole sync path dormant on a device that has never signed in —
 * including the student's phone today.
 */
function useActiveAccountId(): string | null {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let alive = true;

    void client.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setId(data.session?.user?.id ?? null);
      })
      .catch(() => {});

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setId(session?.user?.id ?? null);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return id;
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>(() => recompute(blankState()));
  /**
   * Which account the loaded state belongs to — `undefined` before the first
   * hydration, then the account id (or null for device-only).
   *
   * Readiness is derived from this rather than kept as its own flag so that
   * switching accounts makes `ready` false on the very same render as the
   * change, instead of needing a setState inside an effect to push it back.
   */
  const [readyFor, setReadyFor] = useState<string | null | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const hydrated = useRef(false);

  // Which Google account is active, or null for a device-only hunter. The key
  // progress is stored under follows this, so switching accounts swaps the
  // whole board rather than mixing two students together.
  const accountId = useActiveAccountId();

  /** False the instant the account changes, true once its state has loaded. */
  const ready = readyFor === accountId;

  // The timestamp of the most recent local change. Saved into the envelope and
  // sent with the push, so the device copy and the server copy agree about
  // when this device last moved — which is what the merge compares.
  const stamp = useRef(new Date().toISOString());

  const store = useMemo(
    () =>
      new PersistentStore<Envelope>(keyFor(accountId), (s, err) => {
        setSaveState(s);
        setSaveError(err ?? null);
      }),
    [accountId],
  );

  // Hydrate, then roll the day over if the log is from an earlier day.
  //
  // Runs again whenever the account changes. Signed out this is exactly what
  // it always was: read one key, absorb, done — no network, no waiting. Signed
  // in it additionally pulls the server copy and merges, and on a first-ever
  // sign-in folds in whatever was recorded before there were accounts.
  useEffect(() => {
    let alive = true;
    hydrated.current = false;

    (async () => {
      const own = fromStored(await store.load());
      let seed: Envelope | null = own;

      if (accountId) {
        const [cloud, device, adoptedBy] = await Promise.all([
          pullProgress(accountId),
          own ? Promise.resolve(null) : readEnvelope(DEVICE_KEY),
          storage.get(ADOPTED_KEY).catch(() => null),
        ]);

        const choice = chooseSeed({ own, cloud, device, adoptedBy, userId: accountId });
        seed = mergeAll(choice.parts);

        // Claim the pre-account progress so the second Gmail starts clean.
        if (choice.adoptsDevice) {
          await storage.set(ADOPTED_KEY, accountId).catch(() => {});
        }
      }

      if (!alive) return;

      if (seed) {
        // absorb, not apply: past achievements must not replay on launch.
        stamp.current = seed.updatedAt;
        setState(
          absorbCards(
            absorbUnlocks(
              rollDay(recompute({ ...blankState(), ...seed.state, unlockQueue: [], cardQueue: [] })),
            ),
          ),
        );
      } else {
        // A brand-new account on this device starts from nothing rather than
        // inheriting whoever used the app last.
        stamp.current = new Date().toISOString();
        setState(recompute(blankState()));
      }

      hydrated.current = true;
      setReadyFor(accountId);
    })();

    return () => {
      alive = false;
    };
  }, [store, accountId]);

  // Persist every change after hydration. The queue is stripped first.
  useEffect(() => {
    if (!hydrated.current) return;
    const { unlockQueue: _q, cardQueue: _c, ...persisted } = state;
    stamp.current = new Date().toISOString();
    store.save(wrap(persisted, stamp.current));
  }, [state, store]);

  // Push to the server well behind the local write.
  //
  // Local storage is the fast path and is never gated on the network; this is
  // a background catch-up on a longer timer, so a burst of taps costs one
  // request rather than twenty. A failure is deliberately silent — the next
  // change retries, and the merge means nothing is lost by arriving late.
  useEffect(() => {
    if (!hydrated.current || !accountId) return;
    const { unlockQueue: _q, cardQueue: _c, ...persisted } = state;
    const at = stamp.current;
    const timer = setTimeout(() => {
      void pushProgress(accountId, persisted as PersistedState, at);
    }, 4000);
    return () => clearTimeout(timer);
  }, [state, accountId]);

  // Flush pending writes when the app leaves the foreground, so a student who
  // swipes the app away mid-session doesn't lose the last few taps — and roll
  // the day on the way back in, since JS timers don't fire while backgrounded.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void store.flush();
      else setState((s) => rollDay(s));
    });
    return () => sub.remove();
  }, [store]);

  // Roll the board over the moment the date changes, rather than waiting for
  // the next tap. Without this the app can sit open past midnight still
  // showing yesterday's progress.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const armForMidnight = () => {
      const now = new Date();
      // A couple of seconds past the hour, so we're safely into the new date.
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
      timer = setTimeout(() => {
        setState((s) => rollDay(s));
        armForMidnight();
      }, Math.max(1000, next.getTime() - now.getTime()));
    };

    armForMidnight();
    return () => clearTimeout(timer);
  }, []);

  const applyValue = useCallback((questId: string, next: number) => {
    setState((s) => {
      const quest = questFor(s, questId);
      if (!quest) return s;

      const base = rollDay(s);
      const prev = base.values[questId] ?? 0;
      const value = Math.max(0, next);
      if (value === prev) return base;

      // Defence in depth: the card already disables itself outside the window,
      // but a stale render must not be able to backdate a time-bound quest.
      // Clearing one is always allowed, so a mistake can be undone.
      if (value > prev && !windowState(quest).open) return base;

      const wasDone = isComplete(quest, prev);
      const nowDone = isComplete(quest, value);
      const totalDelta = isCeilingQuest(quest) ? (nowDone && !wasDone ? 1 : 0) : value - prev;

      const draft: ProgressState = {
        ...base,
        values: { ...base.values, [questId]: value },
        totals: {
          ...base.totals,
          [questId]: Math.max(0, (base.totals[questId] ?? 0) + totalDelta),
        },
      };

      if (nowDone !== wasDone) {
        const sign = nowDone ? 1 : -1;
        // Work you committed to the night before pays more than work you
        // happened to do — that is the whole incentive to plan.
        const award = Math.round(quest.xp * (isPlannedId(questId) ? PLANNED_XP_MULTIPLIER : 1));
        draft.xp = Math.max(0, base.xp + sign * award);
        draft.questCompletions = Math.max(0, base.questCompletions + sign);
        draft.stats = { ...base.stats };
        for (const [k, v] of Object.entries(quest.stats)) {
          const key = k as StatKey;
          draft.stats[key] = Math.max(0, (draft.stats[key] ?? 0) + sign * (v ?? 0));
        }
      }

      // Streaks, perfect days and category coverage all fall out of the log.
      return applyCards(applyUnlocks(recompute(draft)));
    });
  }, []);

  const api = useMemo<ProgressApi>(() => {
    const nextId = state.unlockQueue[0];
    const nextCard = state.cardQueue[0];
    return {
      state,
      ready,
      saveState,
      saveError,
      onboarded: state.profile !== null,
      pendingUnlock: nextId ? (ACHIEVEMENTS.find((a) => a.id === nextId) ?? null) : null,
      dismissUnlock: () => setState((s) => ({ ...s, unlockQueue: s.unlockQueue.slice(1) })),
      pendingCard: nextCard ? (CARDS_BY_ID[nextCard] ?? null) : null,
      dismissCard: () => setState((s) => ({ ...s, cardQueue: s.cardQueue.slice(1) })),
      completeOnboarding: (profile) =>
        setState((s) =>
          applyCards(recompute({ ...s, profile, activeQuestIds: buildPlan(profile) })),
        ),
      setSetting: (key, value) =>
        setState((s) => ({ ...s, settings: { ...s.settings, [key]: value } })),
      planFor: (date) => state.plans[date],
      dismissBriefing: (date) => setState((s) => ({ ...s, briefingDismissed: date })),
      acceptPlan: (date, tasks, note) =>
        setState((s) => {
          const planned = { ...s.planned };
          for (const t of tasks) planned[t.id] = t;
          // Re-planning the same day is fine — changing your mind at 22:00 is
          // not cheating — but it is only paid for once. Otherwise the Status
          // screen's "Plan tomorrow now" is a 200 XP button you can hold down
          // all evening, and the Strategist trophy counts presses.
          const firstPlanForDate = s.plans[date] === undefined;
          return applyCards(
            applyUnlocks(
              recompute({
                ...s,
                planned,
                plans: {
                  ...s.plans,
                  [date]: { taskIds: tasks.map((t) => t.id), note, acceptedAt: new Date().toISOString() },
                },
                plansAccepted: s.plansAccepted + (firstPlanForDate ? 1 : 0),
                // Paid on acceptance, not on completion: the planning itself is
                // the habit being trained.
                xp: s.xp + (firstPlanForDate ? ACCEPT_PLAN_XP : 0),
              }),
            ),
          );
        }),
      addXp: (amount) =>
        setState((s) => (amount === 0 ? s : { ...s, xp: Math.max(0, s.xp + amount) })),
      setProgress: applyValue,
      addProgress: (id, amount) => applyValue(id, (state.values[id] ?? 0) + amount),
      clearQuest: (id) => applyValue(id, 0),
      toggleActive: (id) =>
        setState((s) =>
          recompute({
            ...s,
            activeQuestIds: s.activeQuestIds.includes(id)
              ? s.activeQuestIds.filter((q) => q !== id)
              : [...s.activeQuestIds, id],
          }),
        ),
      resetAll: () => setState(recompute(blankState())),
    };
  }, [state, ready, saveState, saveError, applyValue]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useProgress(): ProgressApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProgress must be used inside <ProgressProvider>');
  return ctx;
}

/* --------------------------------------------------------- selectors */

export function useActiveQuests(): QuestDef[] {
  const { state } = useProgress();
  return useMemo(
    () =>
      boardIdsFor(state, state.date)
        .map((id) => questFor(state, id))
        .filter((q): q is QuestDef => Boolean(q)),
    [state],
  );
}

export function useDayStats() {
  const { state } = useProgress();
  return useMemo(() => {
    const today = summarize(state, state.date, state.values);
    const { level, into, need } = levelFromXp(state.xp);
    return {
      done: today.cleared,
      total: today.total,
      ratio: today.total ? today.cleared / today.total : 0,
      level,
      into,
      need,
      rank: rankFromLevel(level),
    };
  }, [state]);
}

/**
 * The full day log with today folded in. Today lives outside `days` until it
 * is archived, so anything reading history needs it merged back in.
 */
export function useDayLog(): Record<string, DayRecord> {
  const { state } = useProgress();
  return useMemo(
    () => ({ ...state.days, [state.date]: summarize(state, state.date, state.values) }),
    [state],
  );
}

/** The last `count` days, oldest first — for the activity chart. */
export function useRecentDays(count = 30): { date: string; cleared: number; total: number; perfect: boolean }[] {
  const { state } = useProgress();
  return useMemo(() => {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const date = shiftDay(state.date, -i);
      const rec =
        date === state.date ? summarize(state, state.date, state.values) : state.days[date];
      out.push({
        date,
        cleared: rec?.cleared ?? 0,
        total: rec?.total ?? 0,
        perfect: rec?.perfect ?? false,
      });
    }
    return out;
  }, [state, count]);
}
