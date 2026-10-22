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
import { Icon } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space } from '@/constants/theme';
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
import { addText, attachChanges, closeTurns, toLog, type LiveTurn } from '@/data/live';
import { assistantConfigured, loadHistory, logLiveCall, openLiveCall, sendToSystem } from '@/lib/assistant';
import { liveSupported, startLiveCall, type LiveCall, type LiveState, type ToolCall } from '@/lib/live';
import { useAssistantRequest, type AssistantMode } from '@/lib/assistantBus';
import { fetchLifeProfile, saveProfileFields } from '@/lib/profile';
import type { LifeProfile } from '@/data/lifeProfile';
import { calendarFor } from '@/lib/calendar';
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
  // Another screen asked for The System in a mode (interview me, suggest
  // quests). A request is pending until the sheet it opened is closed.
  const request = useAssistantRequest();
  const [seenSeq, setSeenSeq] = useState(0);
  const pending = request && request.seq > seenSeq ? request : null;

  const onTabs = segments[0] === '(tabs)';
  if (!ready || !onboarded || (!onTabs && !pending)) return null;

  const screen = SCREEN_NAME[segments[1] ?? 'index'] ?? 'Quests';
  const hour = new Date().getHours();
  // A quiet cue, not an alarm: evening, and tomorrow has nothing planned.
  const cue = (hour >= 20 || hour < 4) && !state.plans[addDays(state.date, 1)];

  const close = () => {
    setOpen(false);
    if (request) setSeenSeq(request.seq);
  };

  return (
    <>
      {onTabs ? (
      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: insets.bottom + 76 }]}>
        <Pressable
          onPress={() => {
            playSound('tap');
            // Start reading today's calendar while the sheet opens; the
            // first message awaits this same cached read.
            void calendarFor(state.date);
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
      ) : null}
      {open || pending ? (
        <AssistantSheet
          key={pending ? `req${pending.seq}` : 'fab'}
          screen={onTabs ? screen : 'Profile'}
          initialMode={pending?.mode ?? 'chat'}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function AssistantSheet({
  screen,
  initialMode,
  onClose,
}: {
  screen: string;
  initialMode: AssistantMode;
  onClose: () => void;
}) {
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
  /** What The System knows about the Player; it can update this with Undo. */
  const [lifeProfile, setLifeProfile] = useState<LifeProfile>({});
  /** 'interview' while The System is getting to know the Player. */
  const [chatMode, setChatMode] = useState<'chat' | 'interview'>(initialMode === 'interview' ? 'interview' : 'chat');
  const started = useRef(false);

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

  // A live voice call (web only): The System listens and talks back in real
  // time, and can change the app mid-call, with the same checks and Undo.
  const canGoLive = configured && liveSupported();
  const [liveState, setLiveState] = useState<LiveState | 'off'>('off');
  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);
  const callRef = useRef<LiveCall | null>(null);
  /** Undo steps for changes made in a call, by the id stored on the turn. */
  const liveUndoers = useRef<Record<string, (() => Promise<void>)[]>>({});
  const undoSeq = useRef(0);
  /** How many call turns are already stored, so a second call does not store the first again. */
  const loggedTurns = useRef(0);
  /**
   * The newest state, goals and apply(), for a tool call that arrives in the
   * middle of a call: the handlers were made when the call started, and must
   * not check a change against the board as it was then.
   */
  const latest = useRef<{ state: typeof state; goals: Goal[]; profile: LifeProfile; apply: typeof apply } | null>(null);
  const liveTurnsRef = useRef<LiveTurn[]>([]);
  useEffect(() => {
    liveTurnsRef.current = liveTurns;
  }, [liveTurns]);

  // The running conversation lives on the server, so it is fetched fresh on
  // every open — whatever was said in the browser is here on the phone. The
  // goals come too: the System can add one or move the focus.
  useEffect(() => {
    if (!configured) return;
    let alive = true;
    (async () => {
      const [res, goalState, life] = await Promise.all([loadHistory(), fetchGoalState(), fetchLifeProfile()]);
      if (!alive) return;
      if (res.ok && res.data) setMessages(res.data);
      if (goalState.ok && goalState.data) setGoals(goalState.data.goals);
      if (life.ok && life.data) setLifeProfile(life.data.profile);
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

  async function ask(text: string, clip?: VoiceClip, mode?: 'chat' | 'interview' | 'board') {
    setBusy(true);
    setError(null);
    // A spoken message shows as a placeholder until the System says what it
    // heard. It is added per attempt, so a failed clip leaves nothing behind.
    if (clip) setMessages((m) => [...m, { role: 'user', text: '…', voice: true }]);
    const now = await nowForPrompt();
    const res = await sendToSystem(text, now, clip, mode ?? chatMode);
    await handleReply(res, text, clip);
  }

  /** A message the Player did not type: shown, then sent in a mode. */
  function askAs(text: string, mode: 'interview' | 'board') {
    if (busy) return;
    stopSpeaking();
    if (mode === 'interview') setChatMode('interview');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSuggestions([]);
    void ask(text, undefined, mode);
  }

  /** What the app knows about right now, for the System's prompt. */
  async function nowForPrompt() {
    // Today's Google Calendar, so "what's next?" counts the lecture at 14:00.
    // Cached (src/lib/calendar.ts): usually already read by the time the
    // first message is sent, and never waited on for more than 6 s. Empty when
    // Google is not connected.
    const calendar = await calendarFor(state.date);
    return buildNow({
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
      calendar,
    });
  }

  async function handleReply(res: Awaited<ReturnType<typeof sendToSystem>>, text: string, clip?: VoiceClip) {
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
      profile: lifeProfile,
    });

    // A suggested quest board waits for the Player's Accept.
    if (res.data.proposal) {
      setBusy(false);
      const reply = res.data;
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: reply.reply,
          action: reply.action,
          proposal: { changes },
          refused: refused.slice(0, 3),
        },
      ]);
      setSuggestions(reply.suggestions);
      return;
    }

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
        case 'set_profile': {
          const before = lifeProfile[change.section]?.[change.field] ?? '';
          const res = await saveProfileFields([{ section: change.section, field: change.field, value: change.value }]);
          if (!res.ok || !res.data) {
            applied.push(`Could not update your profile: ${res.error ?? 'the server refused'}`);
            continue;
          }
          setLifeProfile(res.data);
          undo.push(async () => {
            const back = await saveProfileFields([{ section: change.section, field: change.field, value: before }]);
            if (back.ok && back.data) setLifeProfile(back.data);
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

  /**
   * The Player accepted a suggested quest board. The changes were checked
   * when they arrived; they are checked again now, against the board as it
   * is, in case it changed in between.
   */
  async function acceptProposal(index: number) {
    const msg = messages[index];
    if (!msg?.proposal || msg.proposal.accepted || msg.proposal.dismissed || busy) return;
    playSound('tap');
    setBusy(true);
    const raw = msg.proposal.changes.map(({ change }) => toRaw(change));
    const { changes, refused } = vetChanges(raw, {
      today: state.date,
      catalog: QUESTS_BY_ID,
      overrides: state.questOverrides ?? {},
      activeIds: state.activeQuestIds,
      values: state.values,
      settings: state.settings,
      goals,
      profile: lifeProfile,
    });
    const { applied, undo } = await apply(changes);
    setBusy(false);
    if (applied.length) feedback('complete', 'success');
    undoers.current[index] = undo;
    setMessages((m) =>
      m.map((x, i) =>
        i === index
          ? { ...x, proposal: { ...x.proposal!, accepted: true }, applied, canUndo: undo.length > 0, refused: [...(x.refused ?? []), ...refused].slice(0, 3) }
          : x,
      ),
    );
  }

  function dismissProposal(index: number) {
    playSound('tap');
    setMessages((m) => m.map((x, i) => (i === index && x.proposal ? { ...x, proposal: { ...x.proposal, dismissed: true } } : x)));
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

  /* --------------------------------------------------------- live call */

  useEffect(() => {
    latest.current = { state, goals, profile: lifeProfile, apply };
  });

  // Closing the sheet hangs up.
  useEffect(() => {
    return () => callRef.current?.end();
  }, []);
  /**
   * The System asked to change the app mid-call. Checked exactly like a
   * typed reply's changes, against the board as it is now; what passed is
   * applied with Undo, and the System hears what happened so it can say so.
   */
  async function handleTool(call: ToolCall): Promise<Record<string, unknown>> {
    const now = latest.current;
    if (call.name !== 'apply_changes' || !now) return { error: `unknown tool ${call.name}` };
    const { changes, refused } = vetChanges(call.args.changes, {
      today: now.state.date,
      catalog: QUESTS_BY_ID,
      overrides: now.state.questOverrides ?? {},
      activeIds: now.state.activeQuestIds,
      values: now.state.values,
      settings: now.state.settings,
      goals: now.goals,
      profile: now.profile,
    });
    const { applied, undo } = await now.apply(changes);
    if (applied.length) feedback('complete', 'success');
    const undoId = `u${undoSeq.current++}`;
    if (undo.length) liveUndoers.current[undoId] = undo;
    setLiveTurns((t) => attachChanges(t, applied, refused.slice(0, 3), undo.length > 0, undoId).turns);
    return { applied, refused };
  }

  async function startLive(mode: 'chat' | 'interview' = 'chat') {
    if (liveState !== 'off' || busy) return;
    playSound('tap');
    stopSpeaking();
    setError(null);
    setLiveState('connecting');
    // The music would be heard by the microphone, and talked over.
    suspendMusic();
    const res = await openLiveCall(await nowForPrompt(), mode);
    if (!res.ok || !res.data) {
      setLiveState('off');
      resumeMusic();
      setError(res.error ?? 'The System could not open a live call.');
      return;
    }
    try {
      callRef.current = await startLiveCall(res.data.token, res.data.model, {
        onState: (s) => setLiveState(s === 'ended' ? 'off' : s),
        onUserText: (text) => setLiveTurns((t) => addText(t, 'user', text)),
        onModelText: (text) => setLiveTurns((t) => addText(t, 'model', text)),
        onTurnEnd: () => setLiveTurns(closeTurns),
        onToolCall: handleTool,
        onEnd: (err) => {
          callRef.current = null;
          setLiveState('off');
          setLiveTurns(closeTurns);
          resumeMusic();
          if (err) setError(err);
          // Stored, so the typed assistant and the next call remember it.
          const turns = liveTurnsRef.current;
          void logLiveCall(toLog(turns.slice(loggedTurns.current)));
          loggedTurns.current = turns.length;
        },
      }, mode === 'interview' ? '(The Player opened a live call so you can get to know them for their profile.)' : undefined);
    } catch (err) {
      setLiveState('off');
      resumeMusic();
      setError(`The live call could not start. ${err instanceof Error ? err.message : ''}`.trim());
    }
  }

  function endLive() {
    playSound('tap');
    callRef.current?.end();
  }

  // Opened for a reason (from the Profile screen or right after sign-up):
  // start that conversation as soon as the history is in.
  useEffect(() => {
    if (!loaded || started.current || initialMode === 'chat') return;
    started.current = true;
    void (async () => {
      if (initialMode === 'interview') askAs('Get to know me. Ask me questions for my profile.', 'interview');
      else if (initialMode === 'board') askAs('Suggest quests from my profile.', 'board');
      else if (initialMode === 'live-interview') await startLive('interview');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  async function undoLive(index: number, ids: string[]) {
    playSound('tap');
    // Newest change first, so a later change never undoes onto an earlier one.
    for (const id of [...ids].reverse()) {
      const steps = liveUndoers.current[id] ?? [];
      delete liveUndoers.current[id];
      for (const step of [...steps].reverse()) await step();
    }
    setLiveTurns((t) => t.map((turn, i) => (i === index ? { ...turn, undone: true } : turn)));
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
    if (action === 'suggest_quests') {
      playSound('tap');
      askAs('Suggest quests from my profile.', 'board');
      return;
    }
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
                <SystemText variant="title" color={palette.text}>
                  <SystemText variant="title" color={palette.accent}>◆ </SystemText>
                  The System
                </SystemText>
                <SystemText variant="meta" numberOfLines={1}>
                  {chatMode === 'interview'
                    ? 'Getting to know you. Answer, skip, or stop any time.'
                    : 'Knows your goals, your plan and how your days are going.'}
                </SystemText>
              </View>
              {chatMode === 'interview' ? (
                <Pressable
                  onPress={() => {
                    playSound('tap');
                    setChatMode('chat');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Stop the interview">
                  <View style={styles.interviewPill}>
                    <SystemText variant="meta" color={palette.accent} style={styles.actionLabel}>
                      Interview
                    </SystemText>
                    <Icon name="close" size={icon.small} color={palette.accent} />
                  </View>
                </Pressable>
              ) : null}
              {canGoLive && liveState === 'off' ? (
                <Pressable
                  onPress={() => void startLive()}
                  accessibilityRole="button"
                  accessibilityLabel="Start a live voice call with The System">
                  <View style={styles.livePill}>
                    <Icon name="live" size={icon.small} color={palette.bg} />
                    <SystemText variant="meta" color={palette.bg} style={styles.actionLabel}>
                      Live
                    </SystemText>
                  </View>
                </Pressable>
              ) : null}
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
                <View style={[styles.round, speaking && styles.roundOn]}>
                  <Icon
                    name={speaking ? 'stop' : speakReplies ? 'speaker' : 'muted'}
                    size={icon.bar}
                    color={speaking ? palette.bg : speakReplies ? palette.accent : palette.textMuted}
                  />
                </View>
              </Pressable>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
                <View style={styles.round}>
                  <Icon name="close" size={icon.bar} color={palette.textMuted} />
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
                  {m.role === 'model' ? <ModelLine text={m.text} /> : <UserBubble text={m.text} voice={m.voice} />}
                  {m.role === 'model' && m.proposal && !m.proposal.accepted ? (
                    <ProposalCard
                      lines={m.proposal.changes.map((c) => c.label)}
                      dismissed={Boolean(m.proposal.dismissed)}
                      busy={busy}
                      onAccept={() => void acceptProposal(i)}
                      onDismiss={() => dismissProposal(i)}
                    />
                  ) : null}
                  {m.role === 'model' ? (
                    <ChangesCard
                      applied={m.applied}
                      refused={m.refused}
                      undone={m.undone}
                      canUndo={m.canUndo}
                      onUndo={() => void undoChanges(i)}
                    />
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
                          <SystemText variant="meta" color={palette.accent} style={styles.actionLabel}>
                            {ACTION_LABEL[m.action]}
                          </SystemText>
                          <Icon name="chevron" size={icon.small} color={palette.accent} />
                        </View>
                      </Pressable>
                    </Animated.View>
                  ) : null}
                </Animated.View>
              ))}

              {/* This sheet's live call, as it is spoken. */}
              {liveTurns.map((t, i) =>
                t.role === 'user' ? (
                  t.text ? <UserBubble key={`live${i}`} text={t.text} voice /> : null
                ) : (
                  <View key={`live${i}`}>
                    {t.text ? <ModelLine text={t.text} /> : null}
                    <ChangesCard
                      applied={t.applied}
                      refused={t.refused}
                      undone={t.undone}
                      canUndo={t.canUndo}
                      onUndo={() => void undoLive(i, t.undoIds ?? [])}
                    />
                  </View>
                ),
              )}

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

            {liveState !== 'off' ? (
              <LivePanel state={liveState} onEnd={endLive} bottomInset={insets.bottom} />
            ) : configured ? (
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

/** What the System changed on one reply or call turn, with Undo. */
function ChangesCard({
  applied,
  refused,
  undone,
  canUndo,
  onUndo,
}: {
  applied?: string[];
  refused?: string[];
  undone?: boolean;
  canUndo?: boolean;
  onUndo: () => void;
}) {
  return (
    <>
      {applied && applied.length > 0 ? (
        <View style={[styles.changes, undone && styles.changesUndone]}>
          <View style={styles.changesHead}>
            <Icon name={undone ? 'undo' : 'check'} size={icon.small} color={undone ? palette.textFaint : palette.positive} />
            <SystemText variant="meta" color={undone ? palette.textFaint : palette.positive} style={styles.changesKicker}>
              {undone ? 'Undone' : 'Changed'}
            </SystemText>
          </View>
          {applied.map((line) => (
            <SystemText key={line} variant="body" style={[styles.changeLine, undone && styles.changeLineUndone]}>
              {line}
            </SystemText>
          ))}
          {!undone && canUndo ? (
            <Pressable onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo these changes">
              <View style={styles.undo}>
                <Icon name="undo" size={icon.small} color={palette.text} />
                <SystemText variant="meta" color={palette.text} style={styles.actionLabel}>
                  Undo
                </SystemText>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {refused && refused.length > 0 ? (
        <SystemText variant="meta" style={styles.refused}>
          Not changed: {refused.join(' · ')}
        </SystemText>
      ) : null}
    </>
  );
}

/** A suggested quest board: nothing changes until Accept. */
function ProposalCard({
  lines,
  dismissed,
  busy,
  onAccept,
  onDismiss,
}: {
  lines: string[];
  dismissed: boolean;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  if (lines.length === 0) return null;
  return (
    <View style={[styles.proposal, dismissed && styles.changesUndone]}>
      <SystemText variant="meta" color={dismissed ? palette.textFaint : palette.accent} style={styles.changesKicker}>
        {dismissed ? 'Not applied' : 'Suggested'}
      </SystemText>
      {lines.map((line) => (
        <SystemText key={line} variant="body" style={[styles.changeLine, dismissed && styles.changeLineUndone]}>
          {line}
        </SystemText>
      ))}
      {!dismissed ? (
        <View style={styles.proposalButtons}>
          {/* No `disabled`: on the web it would leave the button dead; acceptProposal ignores taps while busy. */}
          <Pressable onPress={onAccept} accessibilityRole="button" accessibilityLabel="Accept these quest changes">
            <View style={[styles.accept, busy && styles.acceptBusy]}>
              <Icon name="check" size={icon.small} color={palette.bg} />
              <SystemText variant="meta" color={palette.bg} style={styles.actionLabel}>
                Accept
              </SystemText>
            </View>
          </Pressable>
          <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss these quest changes">
            <View style={styles.undo}>
              <SystemText variant="meta" color={palette.text} style={styles.actionLabel}>
                Not now
              </SystemText>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const LIVE_STATUS: Record<Exclude<LiveState, 'ended'>, string> = {
  connecting: 'Connecting…',
  listening: 'Listening. Just talk.',
  speaking: 'The System is speaking. Talk to interrupt.',
};

/**
 * In place of the composer during a call: a breathing orb that quickens
 * while the System speaks, what is happening in words, and one way out.
 */
function LivePanel({ state, onEnd, bottomInset }: { state: LiveState; onEnd: () => void; bottomInset: number }) {
  const key = state === 'ended' ? 'connecting' : state;
  return (
    <View style={[styles.livePanel, { paddingBottom: bottomInset + space.md }]}>
      <Animated.View
        style={[
          styles.orb,
          state === 'speaking' && styles.orbSpeaking,
          {
            animationName: { from: { transform: [{ scale: 0.92 }] }, to: { transform: [{ scale: 1.08 }] } },
            animationDuration: state === 'speaking' ? '450ms' : '1600ms',
            animationIterationCount: 'infinite',
            animationDirection: 'alternate',
            animationTimingFunction: 'ease-in-out',
          },
        ]}>
        <SystemText variant="title" color={palette.bg} style={styles.orbGlyph}>
          ◆
        </SystemText>
      </Animated.View>
      <SystemText variant="body" color={palette.textMuted} style={styles.liveStatus}>
        {LIVE_STATUS[key]}
      </SystemText>
      <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel="End the live call">
        <View style={styles.hangUp}>
          <Icon name="hangUp" size={icon.bar} color={palette.text} />
          <SystemText variant="body" color={palette.text} style={styles.actionLabel}>
            End call
          </SystemText>
        </View>
      </Pressable>
    </View>
  );
}

/** A vetted change back in the shape the model sends, to check it again. */
function toRaw(change: VettedChange['change']): Record<string, unknown> {
  switch (change.op) {
    case 'set_target':
      return { op: change.op, quest_id: change.questId, target: change.target, title: change.title };
    case 'reset_target':
    case 'add_quest':
    case 'remove_quest':
      return { op: change.op, quest_id: change.questId };
    case 'log_progress':
      return { op: change.op, quest_id: change.questId, amount: change.amount };
    case 'set_schedule':
      return { op: change.op, wake: change.wake, sleep: change.sleep, planning_hour: change.planningHour };
    case 'add_goal':
      return { op: change.op, goal_title: change.title, deadline: change.deadline ?? '' };
    case 'focus_goal':
      return { op: change.op, goal_id: change.goalId };
    case 'set_profile':
      return { op: change.op, section: change.section, field: change.field, value: change.value };
  }
}

function lastIndex<T>(list: T[], test: (item: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return i;
  return -1;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  fabWrap: { position: 'absolute', right: space.lg },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 6px 18px ${alpha(palette.accent, 0.35)}`,
  },
  fabGlyph: { fontSize: 22, lineHeight: 28 },
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
  // Round 44pt buttons, like the close and action buttons on an iOS sheet.
  round: {
    width: HIT,
    height: HIT,
    borderRadius: HIT / 2,
    backgroundColor: palette.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { backgroundColor: palette.accent },

  stream: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },
  remembered: { fontSize: 13, color: palette.gold, marginTop: space.xs, marginLeft: space.lg },
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
  changesHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  changesKicker: { fontWeight: '600' },
  changeLine: { fontSize: 15, lineHeight: 20 },
  changeLineUndone: { color: palette.textFaint, textDecorationLine: 'line-through' },
  undo: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.xs,
    backgroundColor: palette.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: HIT,
  },
  refused: { fontSize: 13, color: palette.textMuted, marginTop: space.xs, marginLeft: space.lg },
  action: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    marginLeft: space.lg,
    backgroundColor: alpha(palette.accent, 0.14),
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: HIT,
  },
  actionLabel: { fontWeight: '600' },

  interviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: HIT,
    paddingHorizontal: space.md,
    borderRadius: HIT / 2,
    backgroundColor: alpha(palette.accent, 0.14),
  },
  proposal: {
    marginTop: space.sm,
    marginLeft: space.lg,
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.4),
    backgroundColor: alpha(palette.accent, 0.06),
    borderRadius: radius.md,
    padding: space.md,
    gap: 4,
  },
  proposalButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  acceptBusy: { opacity: 0.5 },
  accept: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: palette.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    minHeight: HIT,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: HIT,
    paddingHorizontal: space.md,
    borderRadius: HIT / 2,
    backgroundColor: palette.accent,
  },
  livePanel: {
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  orb: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 32px ${alpha(palette.accent, 0.45)}`,
  },
  orbSpeaking: { boxShadow: `0 0 48px ${alpha(palette.accent, 0.75)}` },
  orbGlyph: { fontSize: 28, lineHeight: 34 },
  liveStatus: { textAlign: 'center' },
  hangUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: HIT,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: palette.negative,
  },
});
