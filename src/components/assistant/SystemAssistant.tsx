import { router, useSegments } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
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
import type { Goal } from '@/data/goals';
import { vetChanges, type VettedChange } from '@/data/questEdits';
import { QUESTS, QUESTS_BY_ID } from '@/data/quests';
import { addDays } from '@/data/timeline';
import { assistantConfigured, loadHistory, sendToSystem } from '@/lib/assistant';
import { feedback, playSound } from '@/lib/feedback';
import { resumeMusic, suspendMusic } from '@/lib/music';
import { readClip, speak, stopSpeaking, type VoiceClip } from '@/lib/voice';
import { archiveGoal, fetchGoalState, focusGoal, setGoal } from '@/lib/shadows';
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
  const { state, setQuestOverride, toggleActive, setProgress, setSetting } = useProgress();
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
  const [pending, setPending] = useState<{ text: string; clip?: VoiceClip } | null>(null);
  const [loaded, setLoaded] = useState(!configured);

  const [goals, setGoals] = useState<Goal[]>([]);

  // Push-to-talk: tap the mic, speak, tap send. Replies to spoken messages
  // are read aloud unless the Player has muted them.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'sending'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const speakReplies = state.settings.speakReplies ?? true;
  const seconds = voiceState === 'recording' ? Math.floor(recorderState.durationMillis / 1000) : 0;

  const scrollRef = useRef<RNScrollView | null>(null);
  /** How to take back the changes on a reply, by message index. */
  const undoers = useRef<Record<number, (() => Promise<void>)[]>>({});

  // The running conversation lives on the server, so it is fetched fresh on
  // every open — whatever was said in the browser is here on the phone. The
  // goals come too: the System can add one or move the focus.
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    (async () => {
      const [res, goalState] = await Promise.all([loadHistory(), fetchGoalState()]);
      if (!alive) return;
      if (res.ok && res.data) setMessages(res.data);
      if (goalState.ok && goalState.data) setGoals(goalState.data.goals);
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

  async function ask(text: string, clip?: VoiceClip) {
    setBusy(true);
    setError(null);
    // A spoken message shows as a placeholder until the System says what it
    // heard. It is added per attempt, so a failed clip leaves nothing behind.
    if (clip) setMessages((m) => [...m, { role: 'user', text: '…', voice: true }]);
    const now = buildNow({
      date: state.date,
      xp: state.xp,
      streak: state.streak,
      values: state.values,
      settings: state.settings,
      plans: state.plans,
      planned: state.planned,
      board,
      catalog: QUESTS,
      level,
      rank,
      screen,
    });
    const res = await sendToSystem(text, now, clip);

    if (!res.ok || !res.data) {
      setBusy(false);
      setPending({ text, clip });
      if (clip) {
        setMessages((prev) => prev.filter((_, i) => i !== lastIndex(prev, (x) => Boolean(x.voice) && x.text === '…')));
        resumeMusic();
      }
      setError(res.error ?? 'The System did not answer.');
      return;
    }
    setPending(null);

    // The model proposed; this decides. Only what passes is applied, and
    // anything refused is shown with its reason rather than silently dropped.
    const { changes, refused } = vetChanges(res.data.changes, {
      today: state.date,
      catalog: QUESTS_BY_ID,
      overrides: state.questOverrides ?? {},
      activeIds: state.activeQuestIds,
      values: state.values,
      settings: state.settings,
      goals,
    });
    const { applied, undo } = await apply(changes);
    setBusy(false);
    if (applied.length) feedback('complete', 'success');

    const heard = res.data.heard;
    setMessages((prev) => {
      // The placeholder becomes the words the System heard.
      const m = clip && heard ? prev.map((msg, i) => (i === lastIndex(prev, (x) => Boolean(x.voice) && x.text === '…') ? { ...msg, text: heard } : msg)) : prev;
      undoers.current[m.length] = undo;
      return [
        ...m,
        {
          role: 'model',
          text: res.data!.reply,
          action: res.data!.action,
          remembered: res.data!.remembered.map((r) => r.content),
          applied,
          canUndo: undo.length > 0,
          refused: refused.slice(0, 3),
        },
      ];
    });
    setSuggestions(res.data.suggestions);

    // Answer in kind: a spoken question gets a spoken reply.
    if (clip && speakReplies) {
      setSpeaking(true);
      speak(res.data.reply, () => {
        setSpeaking(false);
        resumeMusic();
      });
    } else if (clip) {
      resumeMusic();
    }
  }

  /**
   * Apply vetted changes one by one, keeping how to reverse each. A change
   * that fails (a goal the server would not save) is reported, not hidden.
   */
  async function apply(changes: VettedChange[]): Promise<{ applied: string[]; undo: (() => Promise<void>)[] }> {
    const applied: string[] = [];
    const undo: (() => Promise<void>)[] = [];
    const values = { ...state.values };

    for (const { change, label } of changes) {
      switch (change.op) {
        case 'set_target':
        case 'reset_target': {
          const prev = state.questOverrides?.[change.questId] ?? null;
          setQuestOverride(
            change.questId,
            change.op === 'set_target'
              ? { target: change.target, ...(change.title ? { title: change.title } : {}) }
              : null,
          );
          undo.push(async () => setQuestOverride(change.questId, prev));
          break;
        }
        case 'add_quest':
        case 'remove_quest':
          toggleActive(change.questId);
          undo.push(async () => toggleActive(change.questId));
          break;
        case 'log_progress': {
          const prev = values[change.questId] ?? 0;
          values[change.questId] = prev + change.amount;
          setProgress(change.questId, prev + change.amount);
          undo.push(async () => setProgress(change.questId, prev));
          break;
        }
        case 'set_schedule': {
          const before = { ...state.settings };
          if (change.wake) setSetting('wake', change.wake);
          if (change.sleep) setSetting('sleep', change.sleep);
          if (change.planningHour) setSetting('briefingTime', change.planningHour);
          undo.push(async () => {
            if (change.wake) setSetting('wake', before.wake);
            if (change.sleep) setSetting('sleep', before.sleep);
            if (change.planningHour) setSetting('briefingTime', before.briefingTime);
          });
          break;
        }
        case 'add_goal': {
          const res = await setGoal(change.title, change.deadline);
          if (!res.ok || !res.data) {
            applied.push(`Could not add the goal: ${res.error ?? 'the server refused'}`);
            continue;
          }
          const id = res.data.id;
          setGoals((g) => [...g, res.data!]);
          undo.push(async () => {
            await archiveGoal(id);
            setGoals((g) => g.filter((x) => x.id !== id));
          });
          break;
        }
        case 'focus_goal': {
          const previous = goals.find((g) => g.focus);
          const res = await focusGoal(change.goalId);
          if (!res.ok) {
            applied.push(`Could not move the focus: ${res.error ?? 'the server refused'}`);
            continue;
          }
          setGoals((g) => g.map((x) => ({ ...x, focus: x.id === change.goalId })));
          if (previous) {
            undo.push(async () => {
              await focusGoal(previous.id);
              setGoals((g) => g.map((x) => ({ ...x, focus: x.id === previous.id })));
            });
          }
          break;
        }
      }
      applied.push(label);
    }
    return { applied, undo };
  }

  async function undoChanges(index: number) {
    const steps = undoers.current[index];
    if (!steps?.length) return;
    playSound('tap');
    delete undoers.current[index];
    // Last change first, so a later change never undoes onto an earlier one.
    for (const step of [...steps].reverse()) await step();
    setMessages((m) => m.map((msg, i) => (i === index ? { ...msg, undone: true } : msg)));
  }

  /* ------------------------------------------------------------- voice */

  const LIMIT = 60;

  async function startRecording() {
    if (busy || voiceState !== 'idle') return;
    stopSpeaking();
    setError(null);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('The System needs the microphone to hear you. Allow it in your phone settings, then try again.');
        return;
      }
      // The music would end up in the recording.
      suspendMusic();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      playSound('tap');
      setVoiceState('recording');
    } catch (err) {
      resumeMusic();
      setVoiceState('idle');
      setError(`The microphone could not start. ${err instanceof Error ? err.message : ''}`.trim());
    }
  }

  /** Stop the recorder and hand back where the clip is, or null. */
  async function finishRecording(): Promise<string | null> {
    try {
      await recorder.stop();
    } catch {
      // Already stopped; the uri below is still the answer.
    }
    // Recording mode routes iOS playback to the earpiece; replies should
    // come out of the speaker.
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    return recorder.uri;
  }

  async function cancelRecording() {
    playSound('tap');
    setVoiceState('idle');
    await finishRecording();
    resumeMusic();
  }

  async function sendRecording() {
    if (voiceState !== 'recording') return;
    const length = Math.floor(recorderState.durationMillis / 1000);
    setVoiceState('sending');
    const uri = await finishRecording();
    if (!uri || length < 1) {
      setVoiceState('idle');
      resumeMusic();
      setError('That was too short to hear. Tap the mic, say it, then tap send.');
      return;
    }
    playSound('tap');
    let clip: VoiceClip;
    try {
      clip = await readClip(uri);
    } catch {
      setVoiceState('idle');
      resumeMusic();
      setError('The recording could not be read. Try again.');
      return;
    }
    setSuggestions([]);
    setVoiceState('idle');
    await ask('', clip);
  }

  // A minute is plenty for one message; at the limit it sends itself.
  useEffect(() => {
    if (voiceState !== 'recording' || seconds < LIMIT) return;
    void (async () => {
      await sendRecording();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, voiceState]);

  // Closing the sheet silences it.
  useEffect(() => () => stopSpeaking(), []);

  function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    playSound('tap');
    stopSpeaking();
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
              {/* While it talks: stop. Otherwise: whether spoken replies are read aloud. */}
              <Pressable
                onPress={() => {
                  playSound('tap');
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                  } else {
                    setSetting('speakReplies', !speakReplies);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={speaking ? 'Stop speaking' : speakReplies ? 'Mute spoken replies' : 'Read replies aloud'}>
                <View style={[styles.speaker, speaking && styles.speakerOn]}>
                  <SystemText variant="label" color={speaking ? palette.bg : speakReplies ? palette.accent : palette.textFaint} style={styles.speakerLabel}>
                    {speaking ? '■ STOP' : speakReplies ? 'VOICE ON' : 'VOICE OFF'}
                  </SystemText>
                </View>
              </Pressable>
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
                  {m.role === 'model' ? <ModelLine text={m.text} /> : <UserBubble text={m.voice ? `🎙 ${m.text}` : m.text} />}
                  {m.role === 'model' && m.applied && m.applied.length > 0 ? (
                    <View style={[styles.changes, m.undone && styles.changesUndone]}>
                      <SystemText variant="label" color={m.undone ? palette.textFaint : palette.positive} style={styles.changesKicker}>
                        {m.undone ? '↺ UNDONE' : '✓ CHANGED'}
                      </SystemText>
                      {m.applied.map((line) => (
                        <SystemText key={line} variant="body" style={[styles.changeLine, m.undone && styles.changeLineUndone]}>
                          {line}
                        </SystemText>
                      ))}
                      {!m.undone && m.canUndo ? (
                        <Pressable onPress={() => void undoChanges(i)} accessibilityRole="button" accessibilityLabel="Undo these changes">
                          <View style={styles.undo}>
                            <SystemText variant="label" color={palette.textMuted} style={styles.actionLabel}>
                              UNDO
                            </SystemText>
                          </View>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                  {m.role === 'model' && m.refused && m.refused.length > 0 ? (
                    <SystemText variant="meta" style={styles.refused}>
                      Not changed: {m.refused.join(' · ')}
                    </SystemText>
                  ) : null}
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
                    if (pending) void ask(pending.text, pending.clip);
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
                voice={{
                  state: voiceState,
                  seconds,
                  limit: LIMIT,
                  onStart: () => void startRecording(),
                  onStop: () => void sendRecording(),
                  onCancel: () => void cancelRecording(),
                }}
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
  speaker: {
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 5,
  },
  speakerOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  speakerLabel: { fontSize: 9, letterSpacing: 1.4 },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeGlyph: { fontSize: 24, lineHeight: 26 },

  stream: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  remembered: { fontSize: 11, color: palette.gold, marginTop: space.xs, marginLeft: space.lg },
  changes: {
    marginTop: space.sm,
    marginLeft: space.lg,
    borderWidth: 1,
    borderColor: alpha(palette.positive, 0.35),
    backgroundColor: alpha(palette.positive, 0.06),
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  changesUndone: { borderColor: palette.border, backgroundColor: 'transparent' },
  changesKicker: { fontSize: 9, letterSpacing: 1.8 },
  changeLine: { fontSize: 13, lineHeight: 18 },
  changeLineUndone: { color: palette.textFaint, textDecorationLine: 'line-through' },
  undo: {
    alignSelf: 'flex-start',
    marginTop: space.xs,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  refused: { fontSize: 11, color: palette.textMuted, marginTop: space.xs, marginLeft: space.lg },
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
