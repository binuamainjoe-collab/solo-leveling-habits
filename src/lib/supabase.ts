import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

/**
 * The Supabase client, used for Google sign-in and cross-device sync.
 *
 * Both values are `EXPO_PUBLIC_*` and so compiled into the bundle. That is
 * correct for these two: the anon key is designed to be public and is only
 * useful alongside row-level security, which `20261009010000_accounts_and_sync`
 * turns on for every table. The Google refresh token and client secret never
 * come near the client — the edge functions hold those.
 *
 * Leave them unset and `client` stays null. The app then runs exactly as it
 * did before any of this existed: local-only, single profile, no sign-in
 * button. That is the state the student's phone is in until the project is
 * created, so it has to be a supported configuration rather than a crash.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const isWeb = Platform.OS === 'web';

export function supabaseConfigured(): boolean {
  return URL.length > 0 && ANON.length > 0;
}

/**
 * On web the session lives in localStorage, which supabase-js reaches by
 * itself; on native it must be told, because there is no global storage.
 * Wrapped so a storage failure degrades to "signed out" rather than throwing
 * out of a constructor.
 */
const nativeStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key).catch(() => null),
  setItem: (key: string, value: string) =>
    AsyncStorage.setItem(key, value).catch(() => undefined),
  removeItem: (key: string) => AsyncStorage.removeItem(key).catch(() => undefined),
};

export const client: SupabaseClient | null = supabaseConfigured()
  ? createClient(URL, ANON, {
      auth: {
        storage: isWeb ? undefined : nativeStorage,
        autoRefreshToken: true,
        persistSession: true,
        // On native there is no URL to read the session back out of; the OAuth
        // result arrives through a deep link we parse ourselves. On web the
        // redirect lands on the page with the tokens in the fragment, so
        // supabase-js must pick them up.
        detectSessionInUrl: isWeb,
        flowType: 'pkce',
      },
    })
  : null;

/**
 * Token refresh has to stop while the app is backgrounded.
 *
 * supabase-js refreshes on a timer. On a phone that timer keeps firing after
 * the student switches away, which burns requests and can leave a half-written
 * session if the OS suspends the process mid-flight. Supabase's own guidance
 * is to drive it off AppState instead.
 */
let appStateBound = false;

export function bindAuthToAppState(): void {
  if (!client || appStateBound || isWeb) return;
  appStateBound = true;

  if (AppState.currentState === 'active') client.auth.startAutoRefresh();

  AppState.addEventListener('change', (next) => {
    if (next === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}

/** The client, or a thrown error — for paths that genuinely cannot continue. */
export function requireClient(): SupabaseClient {
  if (!client) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return client;
}
