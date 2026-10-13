import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Timeline } from '@/components/planner/Timeline';
import { SystemText } from '@/components/system/SystemText';
import { alpha, font, palette, radius, space } from '@/constants/theme';
import {
  isResumable,
  isStale,
  openingLine,
  sendPlannerMessage,
  type ChatMessage,
  type PlannerContext,
  type PlannerSession,
} from '@/data/planner';
import { QUESTS_BY_ID } from '@/data/quests';
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
import { feedback, playSound } from '@/lib/feedback';
import { clearSession, loadSession, saveSession } from '@/lib/plannerSession';
import { ACCEPT_PLAN_XP, useProgress } from '@/store/progress';

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
export default function PlannerChatScreen() {
  const params = useLocalSearchParams<{ date?: string }>();
  const { state, finalizePlan } = useProgress();
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
    .map((id) => QUESTS_BY_ID[id])
    .filter(Boolean)
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

  // Keep the newest line in view when the keyboard opens.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  /* ------------------------------------------------------------ talking */

  function contextFor(current: DraftPlan | null): PlannerContext {
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
    const res = await sendPlannerMessage(history, contextFor(draft));

    if (!res.ok || !res.data) {
      setBusy(null);
      setError(res.error ?? 'The System did not answer.');
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
      const res = await sendPlannerMessage(history, contextFor(plan), check.violations);
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
    await clearSession();
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
            <SystemText variant="title" color={palette.text} style={styles.backGlyph}>
              ‹
            </SystemText>
          </View>
        </Pressable>
        <View style={styles.headerText}>
          <SystemText variant="label" color={palette.textMuted} style={styles.headerKicker}>
            ◷ PLANNING
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
              {m.role === 'model' ? <ModelLine text={m.text} /> : <UserBubble text={m.text} />}

              {i === lastModel && draft && draft.blocks.length > 0 && !sealed ? (
                <DraftCard draft={draft} weekday={date === today ? 'Today' : weekday} issues={issues?.violations ?? []} />
              ) : null}
            </Animated.View>
          ))}

          {busy ? <Typing label={busy === 'sealing' ? 'Fixing a couple of things' : null} /> : null}

          {error ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.errorWrap}>
              <SystemText variant="body" style={styles.errorText}>
                {error}
              </SystemText>
              <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Try again">
                <View style={styles.retry}>
                  <SystemText variant="label" color={palette.text} style={styles.retryLabel}>
                    TRY AGAIN
                  </SystemText>
                </View>
              </Pressable>
            </Animated.View>
          ) : null}

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
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
            {suggestions.length > 0 && !busy ? (
              <Animated.View entering={FadeInUp.duration(200)} style={styles.chips}>
                {suggestions.map((s) => (
                  <Pressable key={s} onPress={() => void send(s)} accessibilityRole="button" accessibilityLabel={s}>
                    <View style={[styles.chip, /finalize|seal|lock/i.test(s) && styles.chipSeal]}>
                      <SystemText
                        variant="meta"
                        numberOfLines={1}
                        style={[styles.chipText, /finalize|seal|lock/i.test(s) && { color: palette.accent }]}>
                        {s}
                      </SystemText>
                    </View>
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}

            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Message The System…"
                placeholderTextColor={palette.textFaint}
                style={styles.input}
                multiline
                editable={!busy}
                accessibilityLabel="Message The System"
                onKeyPress={(e) => {
                  // On a desktop browser, Enter sends and Shift+Enter is a new
                  // line, as every chat app has taught people to expect.
                  const native = e.nativeEvent as { key: string; shiftKey?: boolean };
                  if (Platform.OS === 'web' && native.key === 'Enter' && !native.shiftKey) {
                    (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                    void send(input);
                  }
                }}
              />
              <Pressable
                onPress={() => void send(input)}
                disabled={!input.trim() || Boolean(busy)}
                accessibilityRole="button"
                accessibilityLabel="Send"
                accessibilityState={{ disabled: !input.trim() || Boolean(busy) }}>
                <View style={[styles.send, (!input.trim() || busy) && styles.sendOff]}>
                  <SystemText variant="title" color={palette.bg} style={styles.sendGlyph}>
                    ↑
                  </SystemText>
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/* ---------------------------------------------------------------- pieces */

function ModelLine({ text }: { text: string }) {
  return (
    <View style={styles.modelRow}>
      <SystemText variant="label" color={palette.accent} style={styles.modelGlyph}>
        ◆
      </SystemText>
      <SystemText variant="body" style={styles.modelText}>
        {text}
      </SystemText>
    </View>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <SystemText variant="body" style={styles.userText}>
          {text}
        </SystemText>
      </View>
    </View>
  );
}

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

/**
 * Three dots, staggered with negative delays so they ripple from the first
 * frame. CSS animations stop themselves on unmount — no cleanup to forget.
 */
const blink = {
  '0%': { opacity: 0.25, transform: [{ translateY: 0 }] },
  '50%': { opacity: 1, transform: [{ translateY: -3 }] },
  '100%': { opacity: 0.25, transform: [{ translateY: 0 }] },
};

function Typing({ label }: { label: string | null }) {
  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.modelRow} accessibilityLabel="The System is thinking">
      <SystemText variant="label" color={palette.accent} style={styles.modelGlyph}>
        ◆
      </SystemText>
      <View style={styles.typing}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              {
                animationName: blink,
                animationDuration: '1050ms',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
                animationDelay: `${-1050 + i * 175}ms`,
              },
            ]}
          />
        ))}
        {label ? (
          <SystemText variant="meta" style={styles.typingLabel}>
            {label}
          </SystemText>
        ) : null}
      </View>
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
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backGlyph: { fontSize: 28, lineHeight: 30 },
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

  modelRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingRight: space.lg },
  modelGlyph: { fontSize: 11, marginTop: 4 },
  modelText: { flex: 1, fontSize: 15, lineHeight: 22, color: palette.text },

  userRow: { alignItems: 'flex-end', paddingLeft: space.xxl },
  userBubble: {
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.lg,
    borderBottomRightRadius: 6,
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm + 2,
  },
  userText: { fontSize: 15, lineHeight: 21, color: palette.text },

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

  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 7 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.textMuted },
  typingLabel: { fontSize: 11, color: palette.textMuted, marginLeft: space.sm },

  errorWrap: {
    marginLeft: space.lg,
    borderWidth: 1,
    borderColor: alpha(palette.negative, 0.4),
    backgroundColor: alpha(palette.negative, 0.08),
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  errorText: { fontSize: 13, lineHeight: 19, color: palette.text },
  retry: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  retryLabel: { fontSize: 9, letterSpacing: 1.6 },

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

  composer: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    gap: space.sm,
    backgroundColor: palette.bg,
  },
  // Wrapping rather than a horizontal ScrollView: RN Web squeezes a
  // horizontal scroller in a flex column until its chips clip.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  chipSeal: { borderColor: alpha(palette.accent, 0.55) },
  chipText: { fontSize: 12, color: palette.text },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: 22,
    backgroundColor: palette.surface,
    color: palette.text,
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: space.md + 2,
    paddingTop: 11,
    paddingBottom: 11,
    textAlignVertical: 'top',
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.35 },
  sendGlyph: { fontSize: 20, lineHeight: 22 },
});
