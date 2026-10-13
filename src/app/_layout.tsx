import { Anton_400Regular } from '@expo-google-fonts/anton';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  useFonts,
} from '@expo-google-fonts/outfit';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UnlockOverlay } from '@/components/achievement/UnlockOverlay';
import { CardRevealOverlay } from '@/components/card/CardRevealOverlay';
import { BreathingExercise } from '@/components/system/BreathingGate';
import { rememberAccount } from '@/lib/auth';
import { bindAuthToAppState, client, supabaseConfigured } from '@/lib/supabase';
import { initFeedback, setHapticsEnabled, setSoundEnabled } from '@/lib/feedback';
import { initMusic, resumeMusic, setMusicEnabled, suspendMusic } from '@/lib/music';
import { palette } from '@/constants/theme';
import { ProgressProvider, useProgress } from '@/store/progress';

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
          </Stack>
          <FeedbackBridge />
          <AuthBridge />
          <OnboardingGate />
          <BreathingGate />
          <GlobalReveals />
        </ProgressProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sends a student without a profile to the intake, and anyone who already has
 * one away from it. Waits for `ready` so a returning student never sees
 * onboarding flash before their saved profile has loaded.
 */
function OnboardingGate() {
  const { ready, onboarded } = useProgress();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const inOnboarding = segments[0] === 'onboarding';
    if (!onboarded && !inOnboarding) router.replace('/onboarding');
    else if (onboarded && inOnboarding) router.replace('/');
  }, [ready, onboarded, segments, router]);

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
    });

    return () => data.subscription.unsubscribe();
  }, []);

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
  const [done, setDone] = useState(false);
  const finish = useCallback(() => setDone(true), []);

  if (!ready || !onboarded || done) return null;
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
