import { Anton_400Regular } from '@expo-google-fonts/anton';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from '@expo-google-fonts/outfit';
import { Stack, useRouter, useSegments, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView, Pressable } from 'react-native-gesture-handler';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UnlockOverlay } from '@/components/achievement/UnlockOverlay';
import { SystemAssistant } from '@/components/assistant/SystemAssistant';
import { CardRevealOverlay } from '@/components/card/CardRevealOverlay';
import { BigMoments } from '@/components/moments/BigMoments';
import { FocusGate } from '@/components/moments/FocusGate';
import { settleLaunch, useCeremonyPlaying, useFocusOpen } from '@/components/moments/stage';
import { useAirborne } from '@/components/motion/flight';
import { MovesHost } from '@/components/motion/MovesHost';
import { Opening } from '@/components/motion/Opening';
import { BreathingExercise } from '@/components/system/BreathingGate';
import { SystemText } from '@/components/system/SystemText';
import { storage } from '@/store/storage';
import { fromOnboarding } from '@/data/lifeProfile';
import { saveProfileFields } from '@/lib/profile';
import { linkGoogleOnce, rememberAccount, setSignInSkipped, useSignInSkipped } from '@/lib/auth';
import { clearCalendar } from '@/lib/calendar';
import { bindAuthToAppState, client, supabaseConfigured } from '@/lib/supabase';
import { initFeedback, setHapticsEnabled, setSoundEnabled } from '@/lib/feedback';
import { initMusic, resumeMusic, setMusicEnabled, suspendMusic } from '@/lib/music';
import { alpha, palette, radius, space } from '@/constants/theme';
import { ACHIEVEMENTS } from '@/data/achievements';
import { CARDS } from '@/data/cards';
import { planReminders } from '@/data/reminders';
import { snapshotFor } from '@/data/snapshot';
import { addDays } from '@/data/timeline';
import { initReminders, Notifications, syncReminders, urlOf } from '@/lib/reminders';
import { pushSnapshot, snapshotsConfigured } from '@/lib/snapshot';
import {
  PLANNED_XP_MULTIPLIER,
  ProgressProvider,
  useActiveQuests,
  useDayLog,
  useDayStats,
  useProgress,
} from '@/store/progress';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    ArchivoBlack_400Regular,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return <View style={styles.boot} />;

  return (
    // GestureHandlerRootView must sit above every gesture handler in the tree.
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ProgressProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: styles.root }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="planner-chat" />
            <Stack.Screen name="signin" options={{ animation: 'fade' }} />
            <Stack.Screen name="profile" />
          </Stack>
          <FeedbackBridge />
          <AuthBridge />
          <ProfileSync />
          <OnboardingGate />
          <SnapshotBridge />
          <ReminderBridge />
          <SystemAssistant />
          <MovesHost />
          <FocusGate />
          <BreathingGate />
          <BigMoments />
          <GlobalReveals />
        </ProgressProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * True while the launch question — sign in with Google, or keep it on this
 * device — is still unanswered. Undefined until both the saved session and
 * the saved answer have been read, so nothing decides on a guess.
 */
function useNeedsSignIn(): boolean | undefined {
  const { ready, accountId } = useProgress();
  const skipped = useSignInSkipped();
  if (!supabaseConfigured()) return false;
  if (!ready || skipped === undefined) return undefined;
  return !accountId && !skipped;
}

/**
 * The order a student meets the app in: sign in first, then the intake, then
 * the board. Waits for `ready` so a returning student never sees sign-in or
 * onboarding flash before their saved session and profile have loaded.
 */
function OnboardingGate() {
  const { ready, onboarded } = useProgress();
  const needsSignIn = useNeedsSignIn();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready || needsSignIn === undefined) return;
    const top = segments[0];
    if (needsSignIn) {
      if (top !== 'signin') router.replace('/signin');
      return;
    }
    const inOnboarding = top === 'onboarding';
    // The sign-in screen is also opened on purpose from the Hunter tab, so
    // only a student with no profile yet is moved off it.
    if (!onboarded && !inOnboarding) router.replace('/onboarding');
    else if (onboarded && inOnboarding) router.replace('/');
  }, [ready, onboarded, needsSignIn, segments, router]);

  return null;
}

/**
 * Builds the audio players once, then keeps the feedback module in step with
 * the saved preference. The module holds plain module-level flags rather than
 * reading the store, so a sound can fire from anywhere without a hook.
 */
function FeedbackBridge() {
  const { state, ready } = useProgress();
  const sound = state.settings?.sound ?? true;
  const haptics = state.settings?.haptics ?? true;
  const music = state.settings?.music ?? true;

  useEffect(() => {
    initFeedback();
    initMusic();
  }, []);

  useEffect(() => {
    setSoundEnabled(sound);
    setHapticsEnabled(haptics);
  }, [sound, haptics]);

  // Music waits for the saved setting. Before the store has loaded, `music`
  // is only the default, and acting on it played the bed at every launch for
  // a student who had switched it off.
  useEffect(() => {
    if (ready) setMusicEnabled(music);
  }, [ready, music]);

  // The bed must never play over whatever the student switched away to.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') resumeMusic();
      else suspendMusic();
    });
    return () => sub.remove();
  }, []);

  return null;
}

/**
 * Keeps the auth session alive and the local account registry current.
 *
 * Does nothing at all when Supabase is unconfigured, which is the state the
 * app ships in until the project exists — so this must stay a no-op rather
 * than an error.
 */
function AuthBridge() {
  useEffect(() => {
    if (!supabaseConfigured() || !client) return;

    bindAuthToAppState();

    // A session restored from storage, or refreshed in the background, still
    // needs its registry entry touched so the account switcher can order by
    // most recently used.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION')) {
        void rememberAccount(session);
      }
      // Signing in answers the launch question for good; signing out later
      // should ask it again rather than inherit an old "not now".
      if (session && event === 'SIGNED_IN') void setSignInSkipped(false);
      // Back from Google on the web: the first session carries Google's
      // refresh token, so Calendar and Tasks get connected now or never.
      if (session?.provider_refresh_token) {
        void linkGoogleOnce(session).then((ok) => {
          if (ok) clearCalendar();
        });
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}

/**
 * Players who finished onboarding before the life profile existed still have
 * their answers on the device. Once per launch they are offered to the
 * server profile, filling only fields that are still empty, so nothing the
 * Player or The System wrote since is overwritten.
 */
function ProfileSync() {
  const { state, ready } = useProgress();
  const profile = state.profile;
  const sent = useRef(false);
  useEffect(() => {
    if (!ready || !profile || sent.current) return;
    sent.current = true;
    void saveProfileFields(fromOnboarding(profile), true);
  }, [ready, profile]);
  return null;
}

/**
 * Tells the server how the day is going, so the assistant, the planner and
 * the Steward know what was done and not only what was said.
 *
 * Today is sent twenty seconds after the last change (a burst of taps costs
 * one request) and again whenever the app leaves the screen; yesterday is
 * sent once, so a finished day always reaches the server. Each payload is
 * sent only if it differs from the last one that got through.
 */
function SnapshotBridge() {
  const { ready, onboarded, state } = useProgress();
  const board = useActiveQuests();
  const { level } = useDayStats();
  const log = useDayLog();
  const sent = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!ready || !onboarded || !snapshotsConfigured()) return;

    const make = (date: string) =>
      snapshotFor({
        date,
        record: log[date],
        board,
        plan: state.plans[date],
        planned: state.planned,
        level,
        streak: state.streak,
        plannedMultiplier: PLANNED_XP_MULTIPLIER,
      });
    const send = (payload: ReturnType<typeof make>) => {
      const key = JSON.stringify(payload);
      if (sent.current[payload.date] === key) return;
      void pushSnapshot(payload).then((ok) => {
        if (ok) sent.current[payload.date] = key;
      });
    };

    const yesterday = addDays(state.date, -1);
    if (log[yesterday]) send(make(yesterday));

    const timer = setTimeout(() => send(make(state.date)), 20_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') send(make(state.date));
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [ready, onboarded, state.date, state.plans, state.planned, state.streak, log, board, level]);

  return null;
}

/**
 * Keeps the phone's reminders in step with the plan, and opens the right
 * screen when one is tapped.
 *
 * Every change to the plan, today's progress or the reminder settings
 * recomputes the whole set — so ticking a task cancels its check-in — and so
 * does coming back to the app, which is when a new day's morning briefing
 * gets queued. Does nothing on the web.
 */
function ReminderBridge() {
  const { ready, onboarded, state } = useProgress();
  const router = useRouter();
  const [foregrounds, setForegrounds] = useState(0);

  useEffect(() => {
    initReminders();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setForegrounds((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ready || !onboarded || Platform.OS === 'web') return;
    const timer = setTimeout(() => {
      void syncReminders(
        planReminders({
          now: new Date(),
          today: state.date,
          settings: state.settings,
          plans: state.plans,
          values: state.values,
        }),
      );
    }, 1500);
    return () => clearTimeout(timer);
  }, [ready, onboarded, state.date, state.settings, state.plans, state.values, foregrounds]);

  // A tapped reminder opens where it points — including one that launched
  // the app from closed, which is waiting as the "last response".
  useEffect(() => {
    if (!ready || !onboarded || Platform.OS === 'web') return;
    const go = (url: string | null) => {
      if (!url) return;
      Notifications.clearLastNotificationResponse();
      router.push(url as Href);
    };
    go(urlOf(Notifications.getLastNotificationResponse()));
    const sub = Notifications.addNotificationResponseReceivedListener((r) => go(urlOf(r)));
    return () => sub.remove();
  }, [ready, onboarded, router]);

  return null;
}

const OPENED_KEY = 'system.openedOn';

/**
 * A breathing exercise between opening the app and seeing the board, then,
 * on the first open of the day, half a second of the board opening like a gate.
 *
 * The breathing is held in component state rather than persisted, so it runs
 * once per app launch — remount the app, breathe again. Skipped entirely
 * during onboarding: a student who hasn't set anything up yet should not be
 * made to sit through a minute of box breathing before they can begin.
 *
 * Whether today has opened yet is read at launch and decided the moment the
 * breathing ends, so the opening can never turn up late over a board you are
 * already using.
 */
function BreathingGate() {
  const { ready, onboarded, state } = useProgress();
  const needsSignIn = useNeedsSignIn();
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);
  const [openedOn, setOpenedOn] = useState<string | null | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  const today = state.date;

  useEffect(() => {
    let alive = true;
    storage.get(OPENED_KEY).then(
      (v) => alive && setOpenedOn(v),
      () => alive && setOpenedOn(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  const finish = useCallback(() => {
    setDone(true);
    if (Platform.OS === 'web' && !reduced && openedOn !== undefined && openedOn !== today) setOpening(true);
  }, [openedOn, reduced, today]);

  const opened = useCallback(() => {
    setOpening(false);
    setOpenedOn(today);
    void storage.set(OPENED_KEY, today).catch(() => {});
  }, [today]);

  // The board is on screen and the launch is over: big moments may play now.
  const shown = ready && onboarded && needsSignIn === false;
  useEffect(() => {
    if (shown && done && !opening) settleLaunch();
  }, [shown, done, opening]);

  if (!ready || !onboarded || needsSignIn !== false) return null;
  if (!done) return <BreathingExercise onFinish={finish} />;
  return opening ? <Opening late onDone={opened} /> : null;
}

/**
 * Plays whatever is at the head of the reward queues. Cards go first: a rank-up
 * grants both a card and an achievement, and the card is the bigger moment.
 * They wait their turn: for a cleared quest to land in the ring, for a level,
 * rank or perfect day to finish its ceremony, and for a boss Gate to close.
 */
function GlobalReveals() {
  const { pendingCard, dismissCard, pendingUnlock, dismissUnlock } = useProgress();
  const ceremony = useCeremonyPlaying();
  const airborne = useAirborne('ring');
  const focus = useFocusOpen();
  const [preview, setPreview] = useState<number | null>(null);
  const [previews, setPreviews] = useState(0);
  if (ceremony || airborne || focus) return null;
  if (pendingCard) return <CardRevealOverlay card={pendingCard} onDismiss={dismissCard} />;
  if (pendingUnlock) return <UnlockOverlay achievement={pendingUnlock} onDismiss={dismissUnlock} />;
  if (!PREVIEWS) return null;
  // Test copies only: a fresh profile has no rare card or gold trophy to show.
  const shown = preview === null ? null : PREVIEWS[preview % PREVIEWS.length];
  if (shown?.card) return <CardRevealOverlay card={shown.card} onDismiss={() => setPreview(null)} />;
  if (shown?.trophy) return <UnlockOverlay achievement={shown.trophy} onDismiss={() => setPreview(null)} />;
  const next = PREVIEWS[previews % PREVIEWS.length];
  return (
    <Pressable
      onPress={() => {
        setPreview(previews);
        setPreviews(previews + 1);
      }}
      style={styles.preview}
      accessibilityRole="button"
      accessibilityLabel="Preview a reveal">
      <SystemText variant="meta" color={palette.text}>
        Preview: {next.label}
      </SystemText>
    </Pressable>
  );
}

/** Test copies show a pill that plays these, in turn. */
const PREVIEWS =
  process.env.EXPO_PUBLIC_BEERUS_DEMO === '1'
    ? [
        { label: 'mythic card', card: CARDS.find((c) => c.rarity === 'mythic') },
        { label: 'gold trophy', trophy: ACHIEVEMENTS.find((x) => x.tier === 'gold') },
        { label: 'epic card', card: CARDS.find((c) => c.rarity === 'epic') },
      ]
    : null;

const styles = StyleSheet.create({
  preview: {
    position: 'absolute',
    left: space.lg,
    bottom: 204,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    backgroundColor: alpha(palette.surface, 0.9),
  },
  root: { flex: 1, backgroundColor: palette.bg },
  boot: { flex: 1, backgroundColor: palette.bg },
});
