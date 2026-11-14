import { router, useSegments } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  ScrollView as RNScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureDetector, GestureHandlerRootView, Pressable, ScrollView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerusActor, beerusSlot } from '@/components/assistant/BeerusActor';
import { BeerusComposer, MODE_LABEL, type ChatMode } from '@/components/assistant/BeerusComposer';
import { BeerusOrb } from '@/components/assistant/BeerusOrb';
import { FloatingOrb } from '@/components/assistant/FloatingOrb';
import { summon } from '@/components/assistant/summon';
import { onLanding } from '@/components/motion/flight';
import { useDragSheet } from '@/components/motion/useDragSheet';
import { ChatError, ModelLine, Typing, UserBubble } from '@/components/chat/ChatParts';
import { Icon, type IconName } from '@/components/system/Icon';
import { SystemText } from '@/components/system/SystemText';
import { alpha, HIT, icon, palette, radius, space, WIDE } from '@/constants/theme';
import { salutation } from '@/data/insights';
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
import {
  assistantConfigured,
  learnFromConversation,
  loadHistory,
  logLiveCall,
  openLiveCall,
  recallAbout,
  sendToSystem,
} from '@/lib/assistant';
import {
  liveSupported,
  screenShareSupported,
  startLiveCall,
  type LiveCall,
  type LiveState,
  type ToolCall,
  type VideoKind,
} from '@/lib/live';
import { useAssistantRequest, type AssistantMode } from '@/lib/assistantBus';
import { fetchLifeProfile, pickAndImportDocument, saveProfileFields } from '@/lib/profile';
import type { LifeProfile } from '@/data/lifeProfile';
import { calendarFor } from '@/lib/calendar';
import { feedback, playSound } from '@/lib/feedback';
import { resumeMusic, suspendMusic } from '@/lib/music';
import { readClip, speak, stopSpeaking, type VoiceClip } from '@/lib/voice';
import { archiveGoal, fetchGoalState, focusGoal, setGoal } from '@/lib/shadows';
import { moodFor, PROUD_MS, type Mood } from '@/lib/beerus';
import { isComplete, useActiveQuests, useDayStats, useProgress } from '@/store/progress';

/** Test copies only: a button that runs Beerus through his states, since a copy without keys can't. */
const DEMO = process.env.EXPO_PUBLIC_BEERUS_DEMO === '1';
const DEMO_STATES = ['as he is', 'thinking', 'voice', 'proud', 'angry'] as const;
const demoVoice = () => {
  const t = performance.now() / 1000;
  return Math.max(0, Math.sin(t * 9) * 0.5 + Math.sin(t * 3.7) * 0.45);
};

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
  // Tapped: a chat. Held until the ring fills: straight into a live call.
  const [fabMode, setFabMode] = useState<AssistantMode>('chat');
  // Another screen asked for The System in a mode (interview me, suggest
  // quests). A request is pending until the sheet it opened is closed.
  const request = useAssistantRequest();
  const [seenSeq, setSeenSeq] = useState(0);
  const pending = request && request.seq > seenSeq ? request : null;
  const dayMood = useBeerusMood();
  const lift = useCallback(() => Math.min(1, summon.get()), []);
  const [demo, setDemo] = useState(0);
  const lowPower = state.settings?.lowPower ?? false;
  // True from the moment the window's Beerus sets off until he is home again.
  const [flying, setFlying] = useState(false);
  // A live call is on: Beerus stays, whatever screen the Player opens.
  const [inCall, setInCall] = useState(false);
  const shown = DEMO_STATES[demo];
  const mood = shown === 'proud' || shown === 'angry' ? shown : dayMood;

  const onTabs = segments[0] === '(tabs)';
  if (!ready || !onboarded || (!onTabs && !pending && !inCall)) return null;

  const screen = SCREEN_NAME[segments[1] ?? 'index'] ?? 'Quests';
  // Only where a live call can run: a browser with a microphone and sound.
  const canHoldForLive = assistantConfigured() && liveSupported();
  const hour = new Date().getHours();
  // A quiet cue, not an alarm: evening, and tomorrow has nothing planned.
  const cue = (hour >= 20 || hour < 4) && !state.plans[addDays(state.date, 1)];

  const close = () => {
    setOpen(false);
    setFlying(false);
    setInCall(false);
    setFabMode('chat');
    if (request) setSeenSeq(request.seq);
  };

  return (
    <>
      {onTabs ? (
        <FloatingOrb
          bottom={insets.bottom + 76}
          top={insets.top + space.sm}
          hidden={flying}
          label={`${cue ? 'Talk to Beerus. Tomorrow has no plan yet' : 'Talk to Beerus'}${canHoldForLive ? '. Hold for five seconds to start a live call' : ''}`}
          onPress={() => {
            playSound('tap');
            // Start reading today's calendar while the sheet opens; the
            // first message awaits this same cached read.
            void calendarFor(state.date);
            setFabMode('chat');
            setOpen(true);
          }}
          onHold={
            canHoldForLive
              ? () => {
                  void calendarFor(state.date);
                  setFabMode('live');
                  setOpen(true);
                }
              : undefined
          }>
          <View style={styles.fab}>
            <BeerusOrb
              size={60}
              mood={mood}
              busy={shown === 'thinking'}
              voice={shown === 'voice' ? demoVoice : undefined}
              canSleep
              slow={lowPower}
              paused={flying}
              lift={lift}
            />
            {cue ? <View style={styles.cue} /> : null}
          </View>
        </FloatingOrb>
      ) : null}
      {DEMO && onTabs ? (
        <Pressable
          onPress={() => setDemo((d) => (d + 1) % DEMO_STATES.length)}
          style={[styles.demo, { bottom: insets.bottom + 84 }]}
          accessibilityRole="button"
          accessibilityLabel="Show Beerus in another state">
          <SystemText variant="meta" color={palette.text}>
            Beerus: {shown} · tap
          </SystemText>
        </Pressable>
      ) : null}
      {open || pending ? (
        <AssistantSheet
          key={pending ? `req${pending.seq}` : `fab-${fabMode}`}
          screen={onTabs ? screen : 'Profile'}
          initialMode={pending?.mode ?? fabMode}
          initialPrompt={pending?.prompt}
          mood={mood}
          onLaunch={() => setFlying(true)}
          onClosed={close}
          onCall={setInCall}
        />
      ) : null}
    </>
  );
}

/**
 * What Beerus feels about the day, for his colour and eyes: proud for a moment
 * after a quest lands in the ring or all day once the board is clear, angry
 * late in the evening while mandatory quests are still open. Checked again
 * every half minute, so the evening turn needs no tap to show.
 */
function useBeerusMood(): Mood {
  const { state } = useProgress();
  const board = useActiveQuests();
  const [proud, setProud] = useState(false);
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    let wear: ReturnType<typeof setTimeout> | undefined;
    const stop = onLanding(() => {
      setProud(true);
      clearTimeout(wear);
      wear = setTimeout(() => setProud(false), PROUD_MS);
    });
    const clock = setInterval(() => setHour(new Date().getHours()), 30_000);
    return () => {
      stop();
      clearTimeout(wear);
      clearInterval(clock);
    };
  }, []);
  const open = board.filter((q) => !isComplete(q, state.values[q.id] ?? 0));
  return moodFor({
    hour,
    mandatoryLeft: open.filter((q) => q.penalty).length,
    boardLeft: open.length,
    boardTotal: board.length,
    sinceLanding: proud ? 0 : null,
  });
}

function AssistantSheet({
  screen,
  initialMode,
  initialPrompt,
  mood,
  onLaunch,
  onClosed,
  onCall,
}: {
  screen: string;
  initialMode: AssistantMode;
  /** Asked as soon as the history is in, when a screen opened Beerus with a question. */
  initialPrompt?: string;
  mood: Mood;
  /** Beerus has left the floating button to fly up to the window. */
  onLaunch: () => void;
  onClosed: () => void;
  /** Whether a live call is on, so the window is kept while it is. */
  onCall: (on: boolean) => void;
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

  /**
   * Each open starts as a new chat, like any chat app: the earlier
   * conversation is one tap away, and Beerus still has it in mind. This is
   * the index of the first message of this session.
   */
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { width, height: screenHeight } = useWindowDimensions();
  // The whole window is a sheet: pull the header down or flick it away, and
  // the app is there underneath. It opens by unrolling under Beerus as he flies
  // up (the CSS in src/app/+html.tsx), so it starts in place; once it has gone,
  // he flies home, and only then is the window let go.
  const [leaving, setLeaving] = useState(false);
  // During a live call the window can shrink to a bar over the app (like
  // Gemini Live), so the Player keeps using everything while they talk.
  // Held for five seconds on the floating Beerus, the call starts there.
  const [docked, setDocked] = useState(initialMode === 'live');
  const dockedRef = useRef(docked);
  const liveOnRef = useRef(false);
  // Closing the window mid-call docks it; the call only ends from End.
  const { close: onClose, open: reopenSheet, pan: dragClosed, sheetStyle } = useDragSheet(
    screenHeight,
    () => (liveOnRef.current ? setDocked(true) : setLeaving(true)),
    true,
  );
  const wide = width >= WIDE;

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
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState<{ kind: VideoKind; stream: MediaStream } | null>(null);
  // The back camera first, like pointing a phone at something to ask about it.
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  /** A short line on the bar: a camera that was refused, a memory being checked. */
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      setSessionStart(res.ok && res.data ? res.data.length : 0);
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
      setError(res.error ?? 'Beerus did not answer.');
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
    liveOnRef.current = liveState !== 'off';
    dockedRef.current = docked;
  });

  const callOn = liveState !== 'off';
  useEffect(() => onCall(callOn), [callOn, onCall]);

  // Back from the bar: the window slides up again where it left.
  const wasDocked = useRef(docked);
  useEffect(() => {
    if (wasDocked.current && !docked) reopenSheet();
    wasDocked.current = docked;
  }, [docked, reopenSheet]);

  // Messages since the window opened, so closing it can have Beerus go
  // over the conversation and keep what lasts (the learning pass).
  const counts = useRef({ loaded: -1, now: 0, date: state.date });
  useEffect(() => {
    if (loaded && counts.current.loaded < 0) counts.current.loaded = messages.length;
    counts.current.now = messages.length;
    counts.current.date = state.date;
  });
  useEffect(
    () => () => {
      const c = counts.current;
      if (c.loaded >= 0 && c.now > c.loaded) void learnFromConversation(c.date);
    },
    [],
  );

  function flashNote(text: string) {
    setLiveNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setLiveNote(null), 4000);
  }

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
    // Beerus looks something up in his long-term memory: his own model
    // reads everything he knows about the Player, the files included.
    if (call.name === 'recall' && now) {
      flashNote('Checking his memory…');
      const answer = await recallAbout(String(call.args.question ?? '').slice(0, 400), now.state.date);
      // Found: the bar goes back to what is being said.
      clearTimeout(noteTimer.current);
      setLiveNote(null);
      return { answer };
    }
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
      setError(res.error ?? 'Beerus could not open a live call.');
      // The reason is shown in the window, not on a bar that is about to go.
      setDocked(false);
      return;
    }
    setMuted(false);
    setVideo(null);
    try {
      callRef.current = await startLiveCall(res.data, {
        onState: (s) => setLiveState(s === 'ended' ? 'off' : s),
        onUserText: (text) => setLiveTurns((t) => addText(t, 'user', text)),
        onModelText: (text) => setLiveTurns((t) => addText(t, 'model', text)),
        onTurnEnd: () => setLiveTurns(closeTurns),
        onToolCall: handleTool,
        onVideo: (kind) => {
          if (!kind) setVideo(null);
        },
        onEnd: (err) => {
          callRef.current = null;
          setLiveState('off');
          setLiveTurns(closeTurns);
          setVideo(null);
          setMuted(false);
          resumeMusic();
          if (err) setError(err);
          // Stored, so the typed assistant and the next call remember it;
          // then Beerus goes over it and keeps what lasts, since the voice
          // model saves things only when it remembers to.
          const turns = liveTurnsRef.current;
          const date = latest.current?.state.date ?? state.date;
          void logLiveCall(toLog(turns.slice(loggedTurns.current))).then(() => learnFromConversation(date));
          loggedTurns.current = turns.length;
          // Ended from the bar: the window is not open, so Beerus goes home.
          // A call that failed shows why in the window instead.
          if (dockedRef.current) {
            if (err) setDocked(false);
            else setLeaving(true);
          }
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

  function toggleMute() {
    playSound('tap');
    const next = !muted;
    callRef.current?.setMuted(next);
    setMuted(next);
  }

  async function showVideo(kind: VideoKind, side: 'user' | 'environment' = facing) {
    const call = callRef.current;
    if (!call) return;
    try {
      const stream = await call.startVideo(kind, side);
      setVideo({ kind, stream });
    } catch (err) {
      flashNote(err instanceof Error ? err.message : 'That could not start.');
    }
  }

  function toggleCamera() {
    playSound('tap');
    if (video?.kind === 'camera') callRef.current?.stopVideo();
    else void showVideo('camera');
  }

  function flipCamera() {
    playSound('tap');
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    void showVideo('camera', next);
  }

  function toggleScreen() {
    playSound('tap');
    if (video?.kind === 'screen') callRef.current?.stopVideo();
    else void showVideo('screen');
  }

  function minimize() {
    playSound('tap');
    onClose();
  }

  function expand() {
    playSound('tap');
    setDocked(false);
  }

  /** How loud the call is, read by Beerus every frame so his body moves with the voice. */
  const liveLevel = useCallback(() => callRef.current?.level() ?? 0, []);


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
        setError('Beerus needs the microphone to hear you. Allow it in your phone settings, then try again.');
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

  // Opened for a reason (from the Profile screen or right after sign-up):
  // start that conversation as soon as the history is in.
  useEffect(() => {
    if (!loaded || started.current) return;
    started.current = true;
    void (async () => {
      // A screen opened Beerus with a question: ask it.
      if (initialMode === 'chat' && initialPrompt) send(initialPrompt);
      else if (initialMode === 'interview') askAs('Get to know me. Ask me questions for my profile.', 'interview');
      else if (initialMode === 'board') askAs('Suggest quests from my profile.', 'board');
      else if (initialMode === 'live-interview') await startLive('interview');
      else if (initialMode === 'live') await startLive('chat');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  /** Read an attached PDF or photo into the profile, and say what came of it, with Undo. */
  async function attach() {
    if (attaching || busy) return;
    playSound('tap');
    setMenuOpen(false);
    setError(null);
    setAttaching(true);
    const res = await pickAndImportDocument(lifeProfile, state.date);
    setAttaching(false);
    if (!res) return;
    if (!res.ok || !res.data) {
      setError(res.error ?? 'That file could not be read. Try a clearer photo or the PDF.');
      return;
    }
    const { document, changed, undo, profile: next } = res.data;
    setLifeProfile(next);
    feedback('complete', 'success');
    const found = [
      document.weekly.length ? `${document.weekly.length} weekly ${document.weekly.length === 1 ? 'block' : 'blocks'}` : '',
      document.dates.length ? `${document.dates.length} ${document.dates.length === 1 ? 'date' : 'dates'}` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    setMessages((prev) => {
      const at = prev.length + 1;
      if (undo.length) {
        undoers.current[at] = [
          async () => {
            const back = await saveProfileFields(undo);
            if (back.ok && back.data) setLifeProfile(back.data);
          },
        ];
      }
      return [
        ...prev,
        { role: 'user', text: `Attached: ${document.name}` },
        {
          role: 'model',
          text: `I read it. ${document.summary}${found ? ` I keep the ${found} for planning your days.` : ''}`.trim(),
          applied: changed.map((c) => `Profile · ${c}`),
          canUndo: undo.length > 0,
        },
      ];
    });
  }

  /** A clean screen. Beerus still remembers everything; only the view starts over. */
  function newChat() {
    playSound('tap');
    stopSpeaking();
    setSessionStart(messages.length);
    setShowEarlier(false);
    setChatMode('chat');
    setMenuOpen(false);
    setError(null);
    setSuggestions(opening.suggestions);
  }

  function chooseMode(mode: ChatMode) {
    setMenuOpen(false);
    if (mode === 'interview') askAs('Get to know me. Ask me questions for my profile.', 'interview');
    else if (mode === 'board') askAs('Suggest quests from my profile.', 'board');
    else {
      playSound('tap');
      setChatMode('chat');
    }
  }

  const lastModel = lastIndex(messages, (m) => m.role === 'model');
  /** Where this view starts: this session's messages, or everything when "earlier" is open. */
  const firstShown = showEarlier ? 0 : (sessionStart ?? messages.length);
  const hasEarlier = (sessionStart ?? 0) > 0 && !showEarlier;
  const fresh = configured && loaded && firstShown >= messages.length && liveTurns.length === 0 && liveState === 'off' && !busy && !error;
  const name = state.profile?.name?.trim();
  const hello = `${salutation(new Date().getHours())}${name ? `, ${name}` : ''}`;
  const mark = (
    <View style={styles.mark}>
      <BeerusOrb size={26} glow={false} />
    </View>
  );

  const voice = {
    state: voiceState,
    seconds,
    limit: LIMIT,
    onStart: () => void startRecording(),
    onStop: () => void sendRecording(),
    onCancel: () => void cancelRecording(),
  };

  const composer = (large: boolean) => (
    <BeerusComposer
      value={input}
      onChange={setInput}
      onSend={send}
      busy={busy || !loaded}
      voice={voice}
      onAttach={() => void attach()}
      attaching={attaching}
      mode={chatMode}
      onModePress={() => {
        playSound('tap');
        setMenuOpen((o) => !o);
      }}
      large={large}
    />
  );

  const menu = menuOpen ? (
    <Animated.View entering={FadeIn.duration(160)} style={styles.menu}>
      {(['chat', 'interview', 'board'] as const).map((m) => (
        <Pressable key={m} onPress={() => chooseMode(m)} accessibilityRole="button" accessibilityLabel={MODE_LABEL[m]}>
          <View style={[styles.menuItem, chatMode === m && styles.menuItemOn]}>
            <SystemText variant="title" style={styles.menuTitle}>
              {MODE_LABEL[m]}
            </SystemText>
            <SystemText variant="meta">{MODE_HINT[m]}</SystemText>
          </View>
        </Pressable>
      ))}
    </Animated.View>
  ) : null;

  const earlierLink = hasEarlier ? (
    <Pressable
      onPress={() => {
        playSound('tap');
        setShowEarlier(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Show the earlier conversation, ${sessionStart} messages`}>
      <View style={styles.earlier}>
        <Icon name="history" size={icon.small} color={palette.textMuted} />
        <SystemText variant="meta" color={palette.text} style={styles.actionLabel}>
          Show earlier conversation ({sessionStart})
        </SystemText>
      </View>
    </Pressable>
  ) : null;

  const starters: { label: string; icon: IconName; run: () => void }[] = [
    ...suggestions.slice(0, 2).map((s) => ({ label: s, icon: 'bolt' as const, run: () => send(s) })),
    { label: 'Interview me for my profile', icon: 'person', run: () => chooseMode('interview') },
    { label: 'Suggest quests that fit my life', icon: 'quests', run: () => chooseMode('board') },
  ];

  if (docked) {
    const said = [...liveTurns].reverse().find((t) => t.text.trim());
    return (
      <View style={styles.dockLayer} pointerEvents="box-none">
        <LiveDock
          state={liveState}
          caption={error ? { role: 'model', text: error } : said ? { role: said.role, text: said.text } : null}
          note={liveNote}
          muted={muted}
          video={video}
          facing={facing}
          canScreen={screenShareSupported()}
          bottom={insets.bottom + 70}
          onCamera={toggleCamera}
          onFlip={flipCamera}
          onScreen={toggleScreen}
          onMute={toggleMute}
          onEnd={endLive}
          onExpand={expand}
        />
        <BeerusActor leaving={leaving} onHome={onClosed} onLaunch={onLaunch} busy={liveState === 'connecting'} mood={mood} voice={liveLevel} />
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal content renders outside the app's root view on Android, so it
          needs its own gesture root or none of its buttons respond. */}
      <GestureHandlerRootView style={styles.flex}>
        <Animated.View {...({ dataSet: { unroll: '1' } } as object)} style={[styles.window, { paddingTop: insets.top }, sheetStyle]}>
          {wide ? (
            <View style={[styles.rail, { paddingBottom: insets.bottom + space.lg }]}>
              <View {...beerusSlot('header')} style={styles.railSlot} />
              <View style={styles.railGap} />
              <RailButton name="compose" label="New chat" onPress={newChat} />
              <RailButton name="history" label="Earlier conversation" onPress={() => setShowEarlier(true)} disabled={!hasEarlier} />
              <RailButton
                name="person"
                label="Your profile"
                onPress={() => {
                  onClose();
                  router.push('/profile');
                }}
              />
              <RailButton
                name="planner"
                label="Planner"
                onPress={() => {
                  onClose();
                  router.push('/planner');
                }}
              />
              <View style={styles.flex} />
              <RailButton name="close" label="Close Beerus" onPress={onClose} />
            </View>
          ) : null}

          <KeyboardAvoidingView behavior="padding" style={styles.flex}>
            <GestureDetector gesture={dragClosed} touchAction="none">
            <View style={styles.header} collapsable={false}>
              {!wide ? <View {...beerusSlot('header')} style={styles.headerSlot} /> : null}
              <View style={styles.headerText}>
                <SystemText variant="title">Beerus</SystemText>
                <SystemText variant="meta" numberOfLines={1}>
                  {chatMode === 'interview'
                    ? 'Getting to know you. Answer, skip, or stop any time.'
                    : 'Knows your goals, your plan and how your days are going.'}
                </SystemText>
              </View>
              {chatMode === 'interview' ? (
                <Pressable onPress={() => chooseMode('chat')} accessibilityRole="button" accessibilityLabel="Stop the interview">
                  <View style={styles.interviewPill}>
                    <SystemText variant="meta" color={palette.accentSoft} style={styles.actionLabel}>
                      Interview
                    </SystemText>
                    <Icon name="close" size={icon.small} color={palette.accentSoft} />
                  </View>
                </Pressable>
              ) : null}
              {!wide && !fresh ? (
                <Pressable onPress={newChat} accessibilityRole="button" accessibilityLabel="New chat">
                  <View style={styles.round}>
                    <Icon name="compose" size={icon.bar} color={palette.text} />
                  </View>
                </Pressable>
              ) : null}
              {canGoLive && liveState === 'off' ? (
                <Pressable onPress={() => void startLive()} accessibilityRole="button" accessibilityLabel="Start a live voice call with Beerus">
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
                    color={speaking ? palette.bg : speakReplies ? palette.accentSoft : palette.textMuted}
                  />
                </View>
              </Pressable>
              {!wide ? (
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel={liveState !== 'off' ? 'Keep talking while you use the app' : 'Close Beerus'}>
                  <View style={styles.round}>
                    <Icon name={liveState !== 'off' ? 'down' : 'close'} size={icon.bar} color={palette.textMuted} />
                  </View>
                </Pressable>
              ) : null}
            </View>
            </GestureDetector>

            {fresh ? (
              <ScrollView style={styles.flex} contentContainerStyle={styles.freshScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                <View style={styles.column}>
                  <View style={styles.freshHead}>
                    <View {...beerusSlot('hero')} style={wide ? styles.heroSlotWide : styles.heroSlot} />
                    <View>
                      <SystemText variant="heading" style={styles.hello}>
                        {hello}
                      </SystemText>
                      <SystemText variant="heading" color={palette.textMuted} style={styles.hello}>
                        What’s on your mind?
                      </SystemText>
                    </View>
                  </View>
                  {composer(true)}
                  {menu}
                  <View style={styles.starters}>
                    {starters.map((s) => (
                      <Pressable
                        key={s.label}
                        style={styles.starterWrap}
                        onPress={() => {
                          playSound('tap');
                          s.run();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={s.label}>
                        <View style={styles.starter}>
                          <Icon name={s.icon} size={icon.body} color={palette.accentSoft} />
                          <SystemText variant="body" color={palette.text} style={styles.starterText} numberOfLines={2}>
                            {s.label}
                          </SystemText>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                  {earlierLink}
                </View>
              </ScrollView>
            ) : (
              <>
                <ScrollView
                  ref={(r: unknown) => {
                    scrollRef.current = r as RNScrollView | null;
                  }}
                  style={styles.flex}
                  contentContainerStyle={styles.streamScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
                  <View style={[styles.column, styles.stream]}>
                    {earlierLink}
                    {!configured ? (
                      <ModelLine mark={mark} text="Beerus has no server configured, so he cannot talk yet. Everything else still works." />
                    ) : !loaded ? (
                      <Typing mark={mark} />
                    ) : null}

                    {messages.map((m, i) =>
                      i < firstShown ? null : (
                        <Animated.View key={i} entering={FadeInDown.duration(200)}>
                          {m.role === 'model' ? <ModelLine mark={mark} text={m.text} /> : <UserBubble text={m.text} voice={m.voice} />}
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
                              pointKey={i === lastModel ? `msg${i}` : undefined}
                            />
                          ) : null}
                          {m.role === 'model' && m.remembered && m.remembered.length > 0 ? (
                            <SystemText variant="meta" style={styles.remembered}>
                              Remembered: {m.remembered.join('; ')}
                            </SystemText>
                          ) : null}
                          {i === lastModel && m.action && m.action !== 'none' && !busy ? (
                            <Animated.View entering={FadeIn.duration(220)}>
                              <Pressable onPress={() => follow(m.action!)} accessibilityRole="button" accessibilityLabel={ACTION_LABEL[m.action]}>
                                <View style={styles.action}>
                                  <SystemText variant="meta" color={palette.accentSoft} style={styles.actionLabel}>
                                    {ACTION_LABEL[m.action]}
                                  </SystemText>
                                  <Icon name="chevron" size={icon.small} color={palette.accentSoft} />
                                </View>
                              </Pressable>
                            </Animated.View>
                          ) : null}
                        </Animated.View>
                      ),
                    )}

                    {/* This window's live call, as it is spoken. */}
                    {liveTurns.map((t, i) =>
                      t.role === 'user' ? (
                        t.text ? <UserBubble key={`live${i}`} text={t.text} voice /> : null
                      ) : (
                        <View key={`live${i}`}>
                          {t.text ? <ModelLine mark={mark} text={t.text} /> : null}
                          <ChangesCard
                            applied={t.applied}
                            refused={t.refused}
                            undone={t.undone}
                            canUndo={t.canUndo}
                            onUndo={() => void undoLive(i, t.undoIds ?? [])}
                            pointKey={`live${i}`}
                          />
                        </View>
                      ),
                    )}

                    {busy ? <Typing mark={mark} /> : null}
                    {error ? (
                      <ChatError
                        message={error}
                        onRetry={() => {
                          if (pending) void ask(pending.text, pending.clip);
                          else setError(null);
                        }}
                      />
                    ) : null}
                  </View>
                </ScrollView>

                {liveState !== 'off' ? (
                  <LivePanel
                    state={liveState}
                    onEnd={endLive}
                    bottomInset={insets.bottom}
                    muted={muted}
                    camera={video?.kind === 'camera'}
                    onMute={toggleMute}
                    onCamera={toggleCamera}
                    onMinimize={minimize}
                  />
                ) : configured ? (
                  <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
                    <View style={styles.column}>
                      {suggestions.length > 0 && !busy ? (
                        <Animated.View entering={FadeIn.duration(200)} style={styles.chips}>
                          {suggestions.map((s) => (
                            <Pressable key={s} onPress={() => send(s)} accessibilityRole="button" accessibilityLabel={s}>
                              <View style={[styles.chip, /plan/i.test(s) && styles.chipLit]}>
                                <SystemText variant="meta" color={/plan/i.test(s) ? palette.accentSoft : palette.text} style={styles.actionLabel}>
                                  {s}
                                </SystemText>
                              </View>
                            </Pressable>
                          ))}
                        </Animated.View>
                      ) : null}
                      {menu}
                      {composer(false)}
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </KeyboardAvoidingView>
        </Animated.View>
        <BeerusActor
          leaving={leaving}
          onHome={onClosed}
          onLaunch={onLaunch}
          busy={busy || voiceState === 'sending'}
          mood={mood}
          voice={liveState !== 'off' ? liveLevel : undefined}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

const MODE_HINT: Record<ChatMode, string> = {
  chat: 'Ask anything. Beerus changes things when you ask, with Undo.',
  interview: 'One question at a time, to fill in your profile.',
  board: 'A quest board for your life. Nothing changes until you accept.',
};

/** One button on the side rail: an icon, with its name for screen readers. */
function RailButton({ name, label, onPress, disabled }: { name: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}>
      <View style={[styles.railButton, disabled && styles.railOff]}>
        <Icon name={name} size={icon.bar} color={palette.textMuted} />
      </View>
    </Pressable>
  );
}

/**
 * What the System changed on one reply or call turn, with Undo. The newest
 * carries a spot by its corner, and Beerus flies to it for a moment: he
 * points at what he just did.
 */
function ChangesCard({
  applied,
  refused,
  undone,
  canUndo,
  onUndo,
  pointKey,
}: {
  applied?: string[];
  refused?: string[];
  undone?: boolean;
  canUndo?: boolean;
  onUndo: () => void;
  pointKey?: string;
}) {
  return (
    <>
      {applied && applied.length > 0 ? (
        <View style={[styles.changes, undone && styles.changesUndone]}>
          {pointKey && !undone ? <View {...beerusSlot('point', pointKey)} style={styles.pointSlot} pointerEvents="none" /> : null}
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
  speaking: 'Beerus is speaking. Talk to interrupt.',
};

/**
 * In place of the composer during a call: Beerus himself, flown down from the
 * header, his body rippling with whoever is talking; what is happening in
 * words; and one way out.
 */
function LivePanel({
  state,
  onEnd,
  bottomInset,
  muted,
  camera,
  onMute,
  onCamera,
  onMinimize,
}: {
  state: LiveState;
  onEnd: () => void;
  bottomInset: number;
  muted: boolean;
  camera: boolean;
  onMute: () => void;
  onCamera: () => void;
  /** Shrink to the bar over the app, still talking. */
  onMinimize: () => void;
}) {
  const key = state === 'ended' ? 'connecting' : state;
  return (
    <View style={[styles.livePanel, { paddingBottom: bottomInset + space.md }]}>
      <View {...beerusSlot('live')} style={styles.liveSlot} />
      <SystemText variant="body" color={palette.textMuted} style={styles.liveStatus}>
        {LIVE_STATUS[key]}
      </SystemText>
      <View style={styles.liveControls}>
        <DockButton name={camera ? 'cameraOff' : 'camera'} on={camera} label={camera ? 'Turn the camera off' : 'Show Beerus your camera'} onPress={onCamera} />
        <DockButton name={muted ? 'micOff' : 'mic'} on={muted} label={muted ? 'Unmute the microphone' : 'Mute the microphone'} onPress={onMute} />
        <DockButton name="down" label="Keep talking while you use the app" onPress={onMinimize} />
      </View>
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

/**
 * A live call kept open while the Player uses the app, the way Gemini Live
 * sits over the phone: a bar near the bottom with Beerus in the middle, the
 * camera, the screen, the microphone and a way out, and above it what was
 * last said. Everything else on screen stays usable. Tapping Beerus or the
 * words opens the full transcript.
 */
function LiveDock({
  state,
  caption,
  note,
  muted,
  video,
  facing,
  canScreen,
  bottom,
  onCamera,
  onFlip,
  onScreen,
  onMute,
  onEnd,
  onExpand,
}: {
  state: LiveState | 'off';
  caption: { role: 'user' | 'model'; text: string } | null;
  note: string | null;
  muted: boolean;
  video: { kind: VideoKind; stream: MediaStream } | null;
  facing: 'user' | 'environment';
  canScreen: boolean;
  bottom: number;
  onCamera: () => void;
  onFlip: () => void;
  onScreen: () => void;
  onMute: () => void;
  onEnd: () => void;
  onExpand: () => void;
}) {
  const status = state === 'off' || state === 'ended' ? 'Connecting…' : LIVE_STATUS[state];
  const camera = video?.kind === 'camera';
  const screen = video?.kind === 'screen';
  return (
    <View style={[styles.liveDock, { bottom }]} pointerEvents="box-none">
      {video ? <VideoPreview stream={video.stream} mirrored={camera && facing === 'user'} /> : null}
      <Pressable onPress={onExpand} accessibilityRole="button" accessibilityLabel="Open the call transcript">
        <Animated.View
          key={note ?? caption?.text.slice(0, 12) ?? status}
          entering={FadeIn.duration(160)}
          style={[styles.dockCaption, caption?.role === 'user' && !note ? styles.dockCaptionUser : null]}>
          <SystemText
            variant="body"
            color={note ? palette.accentSoft : caption ? palette.text : palette.textMuted}
            numberOfLines={3}
            style={styles.dockCaptionText}>
            {note ?? caption?.text ?? status}
          </SystemText>
        </Animated.View>
      </Pressable>
      <View style={styles.dockBar}>
        <DockButton
          name={camera ? 'cameraOff' : 'camera'}
          on={camera}
          label={camera ? 'Turn the camera off' : 'Show Beerus your camera'}
          onPress={onCamera}
        />
        {camera ? (
          <DockButton name="flipCamera" label="Switch camera" onPress={onFlip} />
        ) : canScreen ? (
          <DockButton name="screen" on={screen} label={screen ? 'Stop sharing your screen' : 'Share your screen with Beerus'} onPress={onScreen} />
        ) : null}
        <Pressable onPress={onExpand} accessibilityRole="button" accessibilityLabel="Open the call transcript">
          <View style={styles.dockOrb}>
            <View {...beerusSlot('live')} style={styles.dockSlot} />
          </View>
        </Pressable>
        <DockButton name={muted ? 'micOff' : 'mic'} on={muted} label={muted ? 'Unmute the microphone' : 'Mute the microphone'} onPress={onMute} />
        <DockButton name="close" danger label="End the live call" onPress={onEnd} />
      </View>
    </View>
  );
}

/** One round button on the live bar, at least 48 px to hit. */
function DockButton({
  name,
  label,
  onPress,
  on,
  danger,
}: {
  name: IconName;
  label: string;
  onPress: () => void;
  on?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: Boolean(on) }}>
      <View style={[styles.dockButton, on && styles.dockButtonOn, danger && styles.dockButtonDanger]}>
        <Icon name={name} size={icon.bar} color={on ? palette.bg : danger ? palette.negative : palette.text} />
      </View>
    </Pressable>
  );
}

/** What the camera or screen is sending, small, so the Player sees what Beerus sees. */
function VideoPreview({ stream, mirrored }: { stream: MediaStream; mirrored: boolean }) {
  const host = useRef<View | null>(null);
  useEffect(() => {
    const el = host.current as unknown as HTMLElement | null;
    if (!el || typeof document === 'undefined') return;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = stream;
    Object.assign(video.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      transform: mirrored ? 'scaleX(-1)' : 'none',
    });
    el.appendChild(video);
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
      video.remove();
    };
  }, [stream, mirrored]);
  return <View ref={host} style={styles.dockPreview} aria-hidden />;
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

/** Lines under a reply start where its text does: past Beerus's 26pt face and the gap. */
const INDENT = 38;

const styles = StyleSheet.create({
  flex: { flex: 1 },

  fab: { width: 60, height: 60 },
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

  window: { flex: 1, flexDirection: 'row', backgroundColor: palette.bg, willChange: 'transform' } as object,
  rail: {
    width: 72,
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.lg,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    backgroundColor: palette.surface,
  },
  railGap: { height: space.md },
  railButton: { width: HIT, height: HIT, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  railOff: { opacity: 0.35 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  mark: { marginTop: -1 },

  // The column every part of the chat sits in, so lines stay readable on a wide screen.
  column: { width: '100%', maxWidth: 760, alignSelf: 'center' },
  freshScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: space.lg, paddingVertical: space.xl },
  freshHead: { alignItems: 'center', gap: space.lg, marginBottom: space.xl },
  hello: { textAlign: 'center' },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.lg },
  // Two to a row in the 760 column; one to a row on a phone.
  starterWrap: { flexGrow: 1, flexBasis: 300 },
  starter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: alpha(palette.surface, 0.7),
  },
  starterText: { flex: 1, fontSize: 15, lineHeight: 20 },
  earlier: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: HIT,
    paddingHorizontal: space.lg,
    marginTop: space.md,
  },
  menu: {
    marginTop: space.sm,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: palette.surface,
    padding: space.xs,
  },
  menuItem: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: HIT, justifyContent: 'center' },
  menuItemOn: { backgroundColor: palette.surfaceRaised },
  menuTitle: { fontSize: 15 },
  streamScroll: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xl },
  dock: { paddingHorizontal: space.lg, paddingTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  chipLit: { borderColor: alpha(palette.accent, 0.5), backgroundColor: alpha(palette.accent, 0.1) },
  headerText: { flex: 1, minWidth: 0, gap: 2 },
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
  // Where Beerus sits, so the header keeps a place for him.
  headerSlot: { width: 36, height: 36 },
  railSlot: { width: 36, height: 36 },
  heroSlot: { width: 88, height: 88 },
  heroSlotWide: { width: 108, height: 108 },
  liveSlot: { width: 104, height: 104 },
  liveControls: { flexDirection: 'row', justifyContent: 'center', gap: space.md },
  dockLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 60 },
  liveDock: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center', gap: space.sm },
  dockCaption: {
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: alpha(palette.surfaceRaised, 0.94),
    borderWidth: 1,
    borderColor: palette.border,
  },
  dockCaptionUser: { backgroundColor: alpha(palette.text, 0.12), borderColor: alpha(palette.text, 0.14) },
  dockCaptionText: { fontSize: 16, lineHeight: 22 },
  dockBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: alpha(palette.surface, 0.96),
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.35),
    boxShadow: `0 10px 30px ${alpha(palette.bg, 0.6)}, 0 0 24px ${alpha(palette.accent, 0.18)}`,
  } as object,
  dockOrb: { width: 76, height: 56, alignItems: 'center', justifyContent: 'center' },
  dockSlot: { width: 64, height: 64 },
  dockButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceRaised,
  },
  dockButtonOn: { backgroundColor: palette.accent },
  dockButtonDanger: { backgroundColor: alpha(palette.negative, 0.16) },
  dockPreview: {
    width: 112,
    height: 150,
    alignSelf: 'flex-end',
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: alpha(palette.accent, 0.4),
    backgroundColor: palette.bg,
  },
  // Beside the corner of the newest change, where he points.
  pointSlot: { position: 'absolute', top: -16, right: -10, width: 34, height: 34 },
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

  stream: { gap: space.xl },
  remembered: { fontSize: 13, color: palette.gold, marginTop: space.xs, marginLeft: INDENT },
  changes: {
    marginTop: space.sm,
    marginLeft: INDENT,
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
  refused: { fontSize: 13, color: palette.textMuted, marginTop: space.xs, marginLeft: INDENT },
  action: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
    marginLeft: INDENT,
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
    marginLeft: INDENT,
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
