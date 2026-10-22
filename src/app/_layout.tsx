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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UnlockOverlay } from '@/components/achievement/UnlockOverlay';
import { SystemAssistant } from '@/components/assistant/SystemAssistant';
import { CardRevealOverlay } from '@/components/card/CardRevealOverlay';
import { BreathingExercise } from '@/components/system/BreathingGate';
import { fromOnboarding } from '@/data/lifeProfile';
import { saveProfileFields } from '@/lib/profile';
import { rememberAccount, setSignInSkipped, useSignInSkipped } from '@/lib/auth';
import { bindAuthToAppState, client, supabaseConfigured } from '@/lib/supabase';
import { initFeedback, setHapticsEnabled, setSoundEnabled } from '@/lib/feedback';
import { initMusic, resumeMusic, setMusicEnabled, suspendMusic } from '@/lib/music';
import { palette } from '@/constants/theme';
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
          <BreathingGate />
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

/**
 * A breathing exercise between opening the app and seeing the board.
 *
 * Held in component state rather than persisted, so it runs once per app
 * launch — remount the app, breathe again. Skipped entirely during onboarding:
 * a student who hasn't set anything up yet should not be made to sit through a
 * minute of box breathing before they can begin.
 */
function BreathingGate() {
  const { ready, onboarded } = useProgress();
  const needsSignIn = useNeedsSignIn();
  const [done, setDone] = useState(false);
  const finish = useCallback(() => setDone(true), []);

  if (!ready || !onboarded || needsSignIn !== false || done) return null;
  return <BreathingExercise onFinish={finish} />;
}

/**
 * Plays whatever is at the head of the reward queues. Cards go first: a rank-up
 * grants both a card and an achievement, and the card is the bigger moment.
 */
function GlobalReveals() {
  const { pendingCard, dismissCard, pendingUnlock, dismissUnlock } = useProgress();
  if (pendingCard) return <CardRevealOverlay card={pendingCard} onDismiss={dismissCard} />;
  if (pendingUnlock) return <UnlockOverlay achievement={pendingUnlock} onDismiss={dismissUnlock} />;
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  boot: { flex: 1, backgroundColor: palette.bg },
});
