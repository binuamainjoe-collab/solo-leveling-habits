import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView as RNScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { Pressable } from '@/components/system/Pressable';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerusOrb } from '@/components/assistant/BeerusOrb';
import { ChatError, Composer, ModelLine, Typing, UserBubble } from '@/components/chat/ChatParts';
import { Timeline } from '@/components/planner/Timeline';
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
import { fitCalendar } from '@/data/calendar';
import {
  isResumable,
  isStale,
  openLoops,
  openingLine,
  sendPlannerMessage,
  type ChatMessage,
  type PlannerContext,
  type PlannerSession,
} from '@/data/planner';
import {
  clockNow,
  defaultPlanDate,
  normaliseDraft,
  prettyDate,
  validateDraft,
  weekdayOf,
  type DailyQuestRef,
  type DraftPlan,
} from '@/data/timeline';
import { calendarFor } from '@/lib/calendar';
import { feedback, playSound } from '@/lib/feedback';
import { clearSession, loadSession, saveSession } from '@/lib/plannerSession';
import { ACCEPT_PLAN_XP, useProgress, useQuestLookup } from '@/store/progress';

type Busy = 'thinking' | 'sealing' | null;

/**
 * Planning a day by talking it through.
 *
 * The System leads with one question at a time and keeps a draft timeline
 * updated as the conversation goes. Saying "this is it" — or pressing Finalize —
 * validates the draft in code and saves it as that day's plan. The model
 * proposes; src/data/timeline.ts decides what is acceptable.
 *
 * Keyboard: React Native's own KeyboardAvoidingView with `padding` on both
 * platforms. react-native-keyboard-controller is what Expo recommends for
 * chat, but it is not in Expo Go, which is how this app runs on the phone.
 * And Android has been edge-to-edge since SDK 53, so the old "undefined on
 * Android" setting no longer moves the input above the keyboard at all.
 */
/** Beerus plans the day too: his face marks each of his lines. */
const BEERUS = <BeerusOrb size={26} glow={false} />;

export default function PlannerChatScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { state, finalizePlan } = useProgress();
  const lookup = useQuestLookup();
  const insets = useSafeAreaInsets();

  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? params.date
    : defaultPlanDate();
  const today = state.date;
  const weekday = weekdayOf(date);
  const existing = state.plans[date]?.timeline;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState<DraftPlan | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<{ xp: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const scrollRef = useRef<RNScrollView | null>(null);

  const dailyQuests: DailyQuestRef[] = state.activeQuestIds
    .flatMap((id) => {
      const q = lookup(id);
      return q ? [q] : [];
    })
    .map((q) => ({ id: q.id, title: q.title, kind: q.kind, target: q.target, unit: q.unit }));

  /* ------------------------------------------------------ open / resume */

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await loadSession();
      if (!alive) return;

      if (isResumable(saved, date) && saved) {
        setMessages(saved.messages);
        setSuggestions(saved.suggestions);
        setDraft(saved.draft);
      } else {
        if (isStale(saved, today)) await clearSession();
        const opening = openingLine(date, today, weekday, Boolean(existing));
        setMessages([{ role: 'model', text: opening.text }]);
        setSuggestions(opening.suggestions);
        // Re-planning starts from the plan that is already there, so "move
        // the gym" has something to move.
        setDraft(existing ? { ...existing, note: state.plans[date]?.note ?? '' } : null);
      }
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // Opening is decided once per date; later store changes must not reset
    // a conversation that is under way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Save after every change, so leaving mid-sentence loses nothing.
  useEffect(() => {
    if (!loaded || sealed) return;
    const session: PlannerSession = {
      date,
      messages,
      suggestions,
      draft,
      updatedAt: new Date().toISOString(),
    };
    void saveSession(session);
  }, [loaded, sealed, date, messages, suggestions, draft]);

  // Cleared once sealed, from an effect: clearing inside seal() could be
  // overtaken by the save above from the render before, which brought the
  // finished conversation back on the phone.
  useEffect(() => {
    if (sealed) void clearSession();
  }, [sealed]);

  // Start reading the planned day's calendar as soon as the chat opens.
  // Every turn then awaits the same cached read (src/lib/calendar.ts), so
  // even the first message carries it. Empty when Google is not connected,
  // and the System simply asks what is fixed.
  useEffect(() => {
    void calendarFor(date);
  }, [date]);

  // Keep the newest line in view when the keyboard opens.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  /* ------------------------------------------------------------ talking */

  function contextFor(current: DraftPlan | null, calendar: string[]): PlannerContext {
    return {
      date,
      weekday,
      today,
      nowTime: clockNow(),
      wake: state.settings.wake ?? null,
      sleep: state.settings.sleep ?? null,
      goals: state.profile?.goals ?? [],
      studyMethods: state.profile?.studyMethods ?? [],
      dailyQuests,
      openLoops: date === today ? [] : openLoops(state.plans[today]?.timeline?.blocks, state.values),
      // Cut to the waking hours the draft (or the settings) uses, so every
      // timed line the System places as a fixed block passes validateDraft.
      // 07:30 / 23:00 are the planner prompt's own defaults.
      calendar: fitCalendar(
        calendar,
        current?.wake ?? state.settings.wake ?? '07:30',
        current?.sleep ?? state.settings.sleep ?? '23:00',
      ),
      draft: current,
    };
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy || sealed) return;

    playSound('tap');
    const next: ChatMessage[] = [...messages, { role: 'user', text }];
    setMessages(next);
    setInput('');
    setSuggestions([]);
    setError(null);
    await ask(next);
  }

  /** Ask for the next turn. Separate from send() so a failed turn can be retried. */
  async function ask(history: ChatMessage[]) {
    setBusy('thinking');
    const res = await sendPlannerMessage(history, contextFor(draft, await calendarFor(date)));

    if (!res.ok || !res.data) {
      setBusy(null);
      setError(res.error ?? 'Beerus did not answer.');
      return;
    }

    const { reply, suggestions: chips, wantsFinalize, draft: rawDraft } = res.data;
    const after: ChatMessage[] = [...history, { role: 'model', text: reply }];
    setMessages(after);
    setSuggestions(chips);

    const { draft: next } = normaliseDraft(rawDraft, dailyQuests);
    const current = next.blocks.length > 0 ? next : draft;
    if (next.blocks.length > 0) setDraft(next);

    setBusy(null);
    if (wantsFinalize) await seal(current, after);
  }

  /**
   * Validate and save. Free when the draft is already sound — finalising is
   * just keeping what is on screen. Only a broken draft costs a model call,
   * to repair exactly what failed.
   */
  async function seal(current: DraftPlan | null, history: ChatMessage[]) {
    if (!current || current.blocks.length === 0) {
      setMessages([
        ...history,
        { role: 'model', text: 'There is nothing to finalize yet. Tell me what the day holds first.' },
      ]);
      return;
    }

    let plan = current;
    let check = validateDraft(plan);

    if (!check.ok) {
      setBusy('sealing');
      const res = await sendPlannerMessage(history, contextFor(plan, await calendarFor(date)), check.violations);
      if (res.ok && res.data) {
        const repaired = normaliseDraft(res.data.draft, dailyQuests).draft;
        if (repaired.blocks.length > 0) {
          plan = repaired;
          check = validateDraft(plan);
          setDraft(plan);
        }
        history = [...history, { role: 'model', text: res.data.reply }];
        setMessages(history);
      }
      setBusy(null);

      if (!check.ok) {
        setMessages([
          ...history,
          {
            role: 'model',
            text: `I could not finalize it yet. Still to fix: ${check.violations.slice(0, 3).join('; ')}.`,
          },
        ]);
        setSuggestions(['Fix it for me', 'Make it lighter']);
        return;
      }
    }

    const first = state.plans[date] === undefined;
    finalizePlan(date, plan);
    feedback('complete', 'success');
    setSuggestions([]);
    setSealed({ xp: first ? ACCEPT_PLAN_XP : 0 });
  }

  function sealNow() {
    if (busy || sealed) return;
    playSound('tap');
    const history: ChatMessage[] = [...messages, { role: 'user', text: 'Finalize.' }];
    setMessages(history);
    void seal(draft, history);
  }

  function retry() {
    setError(null);
    void ask(messages);
  }

  function leave() {
    playSound('tap');
    if (router.canGoBack()) router.back();
    else router.replace('/planner');
  }

  const lastModel = lastIndexOf(messages, (m) => m.role === 'model');
  const canSeal = Boolean(draft && draft.blocks.length > 0) && !busy && !sealed;
  const issues = draft ? validateDraft(draft) : null;

  /* -------------------------------------------------------------- render */

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Back to the planner">
          <View style={styles.back}>
            <Icon name="back" size={icon.bar} color={palette.text} />
          </View>
        </Pressable>
        <View style={styles.headerText}>
          <SystemText variant="label" color={palette.textMuted} style={styles.headerKicker}>
            Planning
          </SystemText>
          <SystemText variant="title" numberOfLines={1} style={styles.headerTitle}>
            {date === today ? 'Today' : weekday}
            <SystemText variant="meta" style={styles.headerDate}>
              {'  '}
              {prettyDate(date).replace(`${weekday} `, '')}
            </SystemText>
          </SystemText>
        </View>
        <Pressable
          onPress={sealNow}
          disabled={!canSeal}
          accessibilityRole="button"
          accessibilityLabel="Finalize the plan"
          accessibilityState={{ disabled: !canSeal }}>
          <View style={[styles.sealButton, !canSeal && styles.sealButtonOff]}>
            <SystemText variant="label" color={canSeal ? palette.bg : palette.textFaint} style={styles.sealLabel}>
              FINALIZE
            </SystemText>
          </View>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView
          ref={(r: unknown) => {
            scrollRef.current = r as RNScrollView | null;
          }}
          style={styles.flex}
          contentContainerStyle={styles.stream}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
          {messages.map((m, i) => (
            <Animated.View key={i} entering={FadeInDown.duration(220)}>
              {m.role === 'model' ? <ModelLine mark={BEERUS} text={m.text} /> : <UserBubble text={m.text} />}

              {i === lastModel && draft && draft.blocks.length > 0 && !sealed ? (
                <DraftCard draft={draft} weekday={date === today ? 'Today' : weekday} issues={issues?.violations ?? []} />
              ) : null}
            </Animated.View>
          ))}

          {busy ? <Typing mark={BEERUS} label={busy === 'sealing' ? 'Fixing a couple of things' : null} /> : null}

          {error ? <ChatError message={error} onRetry={retry} /> : null}

          {sealed && draft ? (
            <SealedCard
              draft={draft}
              xp={sealed.xp}
              day={date === today ? 'Today' : weekday}
              onView={() => {
                playSound('tap');
                router.replace('/planner');
              }}
            />
          ) : null}
        </ScrollView>

        {!sealed ? (
          <Composer
            value={input}
            onChange={setInput}
            onSend={(t) => void send(t)}
            busy={Boolean(busy)}
            suggestions={suggestions}
            highlight={(s) => /finalize|seal|lock/i.test(s)}
            bottomInset={insets.bottom}
          />
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/* ---------------------------------------------------------------- pieces */

function DraftCard({ draft, weekday, issues }: { draft: DraftPlan; weekday: string; issues: string[] }) {
  return (
    <Animated.View entering={FadeIn.duration(260)} style={styles.draft}>
      <View style={styles.draftHead}>
        <SystemText variant="label" color={palette.textMuted} style={styles.draftLabel}>
          DRAFT · {weekday.toUpperCase()}
        </SystemText>
        <SystemText variant="label" color={palette.textFaint} style={styles.draftLabel}>
          {draft.wake}–{draft.sleep}
        </SystemText>
      </View>
      <Timeline plan={draft} compact />
      {issues.length > 0 ? (
        <SystemText variant="meta" style={styles.draftIssues}>
          {issues.length === 1 ? '1 thing' : `${issues.length} things`} to fix — I will sort them when you finalize.
        </SystemText>
      ) : null}
    </Animated.View>
  );
}

function SealedCard({
  draft,
  xp,
  day,
  onView,
}: {
  draft: DraftPlan;
  xp: number;
  day: string;
  onView: () => void;
}) {
  const tasks = draft.blocks.filter((b) => b.kind === 'task').length;
  return (
    <Animated.View entering={FadeInDown.duration(320)} style={styles.sealed}>
      <SystemText variant="label" color={palette.positive} style={styles.sealedKicker}>
        ◆ PLAN SEALED
      </SystemText>
      <SystemText variant="hero" style={styles.sealedTitle}>
        {day.toUpperCase()} IS SET
      </SystemText>
      <SystemText variant="body" style={styles.sealedBody}>
        {draft.blocks.length} blocks · {tasks} {tasks === 1 ? 'task' : 'tasks'} added to your quests
        {xp > 0 ? '' : ' · re-planned, no extra XP'}
      </SystemText>
      {xp > 0 ? (
        <SystemText variant="numeral" color={palette.gold} style={styles.sealedXp}>
          +{xp} XP
        </SystemText>
      ) : null}
      <Pressable onPress={onView} accessibilityRole="button" accessibilityLabel="View in Planner">
        <View style={styles.viewButton}>
          <SystemText variant="label" color={palette.bg} style={styles.viewLabel}>
            VIEW IN PLANNER
          </SystemText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function lastIndexOf<T>(list: T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}

/* ---------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  back: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, minWidth: 0 },
  headerKicker: { fontSize: 9, letterSpacing: 2 },
  headerTitle: { fontSize: 17, lineHeight: 21 },
  headerDate: { fontSize: 12, color: palette.textMuted },
  sealButton: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  sealButtonOff: { backgroundColor: 'transparent', borderWidth: 1, borderColor: palette.border },
  sealLabel: { fontSize: 10, letterSpacing: 2 },

  stream: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },

  draft: {
    marginTop: space.md,
    marginLeft: space.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  draftHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  draftLabel: { fontSize: 9, letterSpacing: 1.6 },
  draftIssues: { fontSize: 11, color: palette.gold, marginTop: 2 },

  sealed: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: alpha(palette.positive, 0.35),
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
  },
  sealedKicker: { fontSize: 10, letterSpacing: 2.4 },
  sealedTitle: { fontSize: 30, lineHeight: 34 },
  sealedBody: { fontSize: 13, lineHeight: 19, color: palette.textMuted },
  sealedXp: { fontSize: 26, lineHeight: 32, marginTop: space.xs },
  viewButton: {
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingVertical: space.md,
    marginTop: space.md,
  },
  viewLabel: { fontSize: 10, letterSpacing: 2 },
});
