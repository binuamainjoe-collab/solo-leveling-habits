import { router, useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  ScrollView as RNScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { GestureHandlerRootView, Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatError, Composer, ModelLine, Typing, UserBubble } from '@/components/chat/ChatParts';
import { SystemText } from '@/components/system/SystemText';
import { alpha, palette, radius, space } from '@/constants/theme';
import {
  ACTION_LABEL,
  actionTarget,
  buildNow,
  greeting,
  type AssistantAction,
  type AssistantMessage,
} from '@/data/assistant';
import { addDays } from '@/data/timeline';
import { assistantConfigured, loadHistory, sendToSystem } from '@/lib/assistant';
import { playSound } from '@/lib/feedback';
import { useActiveQuests, useDayStats, useProgress } from '@/store/progress';

/** Tab route name to the name the System calls that screen. */
const SCREEN_NAME: Record<string, string> = {
  index: 'Quests',
  planner: 'Planner',
  goal: 'Goal',
  collection: 'Collection',
  hunter: 'Status',
  archive: 'Archive',
};

/**
 * The System, one tap away on every screen.
 *
 * A floating button over the tabs opens a conversation that already knows
 * the goals, today's board and plan, and what it remembers — so asking "what
 * now?" never starts with explaining yourself. Hidden during onboarding and
 * over the full-screen planner chat, where it would only be in the way.
 */
export function SystemAssistant() {
  const { ready, onboarded, state } = useProgress();
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!ready || !onboarded || segments[0] !== '(tabs)') return null;

  const screen = SCREEN_NAME[segments[1] ?? 'index'] ?? 'Quests';
  const hour = new Date().getHours();
  // A quiet cue, not an alarm: evening, and tomorrow has nothing planned.
  const cue = (hour >= 20 || hour < 4) && !state.plans[addDays(state.date, 1)];

  return (
    <>
      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: insets.bottom + 76 }]}>
        <Pressable
          onPress={() => {
            playSound('tap');
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Talk to The System">
          <View style={styles.fab}>
            <SystemText variant="title" color={palette.bg} style={styles.fabGlyph}>
              ◆
            </SystemText>
            {cue ? <View style={styles.cue} /> : null}
          </View>
        </Pressable>
      </View>
      {open ? <AssistantSheet screen={screen} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AssistantSheet({ screen, onClose }: { screen: string; onClose: () => void }) {
  const { state } = useProgress();
  const board = useActiveQuests();
  const { level, rank } = useDayStats();
  const insets = useSafeAreaInsets();
  const configured = assistantConfigured();

  const tomorrowPlanned = Boolean(state.plans[addDays(state.date, 1)]);
  const [opening] = useState(() => greeting(new Date(), tomorrowPlanned));

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>(opening.suggestions);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!configured);

  const scrollRef = useRef<RNScrollView | null>(null);

  // The running conversation lives on the server, so it is fetched fresh on
  // every open — whatever was said in the browser is here on the phone.
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    (async () => {
      const res = await loadHistory();
      if (!alive) return;
      if (res.ok && res.data) setMessages(res.data);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [configured]);

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, []);

  async function ask(text: string) {
    setBusy(true);
    setError(null);
    const now = buildNow({
      date: state.date,
      xp: state.xp,
      streak: state.streak,
      values: state.values,
      settings: state.settings,
      plans: state.plans,
      planned: state.planned,
      board,
      level,
      rank,
      screen,
    });
    const res = await sendToSystem(text, now);
    setBusy(false);

    if (!res.ok || !res.data) {
      setPending(text);
      setError(res.error ?? 'The System did not answer.');
      return;
    }
    setPending(null);
    setMessages((m) => [
      ...m,
      {
        role: 'model',
        text: res.data!.reply,
        action: res.data!.action,
        remembered: res.data!.remembered.map((r) => r.content),
      },
    ]);
    setSuggestions(res.data.suggestions);
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    playSound('tap');
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setSuggestions([]);
    void ask(text);
  }

  function follow(action: AssistantAction) {
    const target = actionTarget(action, state.date);
    if (!target) return;
    playSound('tap');
    onClose();
    router.push(target as Parameters<typeof router.push>[0]);
  }

  const lastModel = lastIndex(messages, (m) => m.role === 'model');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal content renders outside the app's root view on Android, so it
          needs its own gesture root or none of its buttons respond. */}
      <GestureHandlerRootView style={styles.flex}>
        <View style={styles.backdrop}>
          <Pressable style={styles.flex} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close The System" />
          <KeyboardAvoidingView behavior="padding" style={[styles.sheet, { paddingTop: space.sm }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <View style={styles.headerText}>
                <SystemText variant="label" color={palette.accent} style={styles.kicker}>
                  ◆ THE SYSTEM
                </SystemText>
                <SystemText variant="meta" style={styles.sub}>
                  Knows your goals, your plan and how your days are going.
                </SystemText>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                <View style={styles.close}>
                  <SystemText variant="title" color={palette.textMuted} style={styles.closeGlyph}>
                    ×
                  </SystemText>
                </View>
              </Pressable>
            </View>

            <ScrollView
              ref={(r: unknown) => {
                scrollRef.current = r as RNScrollView | null;
              }}
              style={styles.flex}
              contentContainerStyle={styles.stream}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
              {!configured ? (
                <ModelLine text="The System has no server configured, so it cannot talk yet. Everything else still works." />
              ) : !loaded ? (
                <Typing />
              ) : messages.length === 0 ? (
                <ModelLine text={opening.text} />
              ) : null}

              {messages.map((m, i) => (
                <Animated.View key={i} entering={FadeInDown.duration(200)}>
                  {m.role === 'model' ? <ModelLine text={m.text} /> : <UserBubble text={m.text} />}
                  {m.role === 'model' && m.remembered && m.remembered.length > 0 ? (
                    <SystemText variant="meta" style={styles.remembered}>
                      ◆ Remembered: {m.remembered.join(' · ')}
                    </SystemText>
                  ) : null}
                  {i === lastModel && m.action && m.action !== 'none' && !busy ? (
                    <Animated.View entering={FadeIn.duration(220)}>
                      <Pressable
                        onPress={() => follow(m.action!)}
                        accessibilityRole="button"
                        accessibilityLabel={ACTION_LABEL[m.action]}>
                        <View style={styles.action}>
                          <SystemText variant="label" color={palette.accent} style={styles.actionLabel}>
                            {ACTION_LABEL[m.action].toUpperCase()}  →
                          </SystemText>
                        </View>
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </Animated.View>
              ))}

              {busy ? <Typing /> : null}
              {error ? (
                <ChatError
                  message={error}
                  onRetry={() => {
                    if (pending) void ask(pending);
                  }}
                />
              ) : null}
            </ScrollView>

            {configured ? (
              <Composer
                value={input}
                onChange={setInput}
                onSend={send}
                busy={busy || !loaded}
                suggestions={suggestions}
                highlight={(s) => /plan/i.test(s)}
                bottomInset={insets.bottom}
                placeholder="Ask The System…"
              />
            ) : null}
          </KeyboardAvoidingView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function lastIndex<T>(list: T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  fabWrap: { position: 'absolute', right: space.lg },
  fab: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 6px 18px ${alpha(palette.accent, 0.35)}`,
  },
  fabGlyph: { fontSize: 20, lineHeight: 24 },
  cue: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.gold,
    borderWidth: 2,
    borderColor: palette.bg,
  },

  backdrop: { flex: 1, backgroundColor: alpha('#000000', 0.55), justifyContent: 'flex-end' },
  sheet: {
    height: '88%',
    backgroundColor: palette.bg,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    borderTopWidth: 1,
    borderColor: alpha(palette.accent, 0.25),
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.borderStrong,
    marginBottom: space.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontSize: 10, letterSpacing: 2.4 },
  sub: { fontSize: 11, color: palette.textMuted },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 24, lineHeight: 26 },

  stream: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  remembered: { fontSize: 11, color: palette.gold, marginTop: space.xs, marginLeft: space.lg },
  action: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    marginLeft: space.lg,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.6),
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  actionLabel: { fontSize: 10, letterSpacing: 1.6 },
});
