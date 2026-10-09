import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { client, supabaseConfigured } from '@/lib/supabase';
import { storage } from '@/store/storage';

/**
 * Google sign-in, and the registry of accounts signed in on this device.
 *
 * WHY THE BROWSER FLOW AND NOT THE NATIVE SDK
 * `@react-native-google-signin/google-signin` is the usual choice, but Expo's
 * own documentation is explicit that it cannot run in Expo Go — it needs
 * custom native code and therefore a development build. This app is tested on
 * a phone through Expo Go and also ships as a static web build, so it takes
 * the browser route instead: Supabase hands us a Google consent URL, the
 * system browser handles it, and the result comes back on a deep link.
 *
 * The redirect Google itself sees is always Supabase's own HTTPS callback, so
 * Google never has to accept an `exp://` address. That single detail is what
 * makes this work in Expo Go.
 */

/** Needed for the web popup to hand control back. No-op on native. */
WebBrowser.maybeCompleteAuthSession();

/**
 * Identity, plus Calendar events and Tasks.
 *
 * `calendar.events` rather than the full `calendar` scope: the app reads and
 * writes events and has no business touching calendar settings or sharing.
 * Both Calendar and Tasks are *sensitive* scopes, so the consent screen either
 * stays in Testing (and the refresh token expires weekly) or gets published
 * unverified (one warning screen, then stable). Neither needs Google's review.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

const ACCOUNTS_KEY = 'system.accounts.v1';

export interface Account {
  /** The Supabase user id. Also the key progress is stored under. */
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /**
   * The Supabase refresh token, so switching back to this account restores it
   * without another trip through Google. Not a Google credential: the Google
   * refresh token lives server-side, in a table no client can read.
   */
  refreshToken: string;
  lastUsedAt: string;
}

/* ------------------------------------------------------- account registry */

export async function listAccounts(): Promise<Account[]> {
  try {
    const raw = await storage.get(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Account[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a) => typeof a?.id === 'string' && typeof a?.refreshToken === 'string')
      .sort((a, b) => Date.parse(b.lastUsedAt ?? 0) - Date.parse(a.lastUsedAt ?? 0));
  } catch {
    // A corrupt registry must not block signing in again.
    return [];
  }
}

async function writeAccounts(accounts: Account[]): Promise<void> {
  await storage.set(ACCOUNTS_KEY, JSON.stringify(accounts)).catch(() => {});
}

/** Record (or refresh) an account in the local registry. */
export async function rememberAccount(session: Session): Promise<Account | null> {
  const user = session.user;
  if (!user) return null;

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const account: Account = {
    id: user.id,
    email: user.email ?? '',
    name:
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      (user.email ?? 'Hunter'),
    avatarUrl:
      (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
      (typeof meta.picture === 'string' && meta.picture) ||
      null,
    refreshToken: session.refresh_token ?? '',
    lastUsedAt: new Date().toISOString(),
  };

  const rest = (await listAccounts()).filter((a) => a.id !== account.id);
  await writeAccounts([account, ...rest]);
  return account;
}

/** Drop one account from this device. Does not revoke anything at Google. */
export async function forgetAccount(id: string): Promise<void> {
  await writeAccounts((await listAccounts()).filter((a) => a.id !== id));
}

/* ----------------------------------------------------------- the OAuth run */

export interface AuthResult {
  ok: boolean;
  account?: Account;
  /** Plain language, safe to show as-is. */
  error?: string;
  /** True when the student simply backed out, which is not an error. */
  cancelled?: boolean;
}

/**
 * Pull the session out of the URL Supabase redirects back to.
 *
 * Supabase can return either an authorization code (PKCE) or the tokens
 * directly, depending on flow and platform, so both are handled rather than
 * assuming one.
 */
async function sessionFromUrl(url: string): Promise<Session | null> {
  const supabase = client;
  if (!supabase) return null;

  const parsed = Linking.parse(url);
  const params = (parsed.queryParams ?? {}) as Record<string, string | undefined>;

  // The implicit tokens arrive in the fragment, which Linking.parse leaves in
  // the path, so read them off the raw string instead.
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const frag = new URLSearchParams(hash);

  const errorDescription = params.error_description ?? frag.get('error_description');
  if (errorDescription) throw new Error(errorDescription);

  const code = params.code ?? frag.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data.session;
  }

  const access_token = params.access_token ?? frag.get('access_token');
  const refresh_token = params.refresh_token ?? frag.get('refresh_token');
  if (access_token && refresh_token) {
    const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return data.session;
  }

  return null;
}

/**
 * Sign in with Google.
 *
 * `prompt: 'select_account consent'` is doing two jobs. `select_account` is
 * what makes a second Gmail possible at all — without it Google silently
 * reuses whoever is already signed in, so you could never add the other
 * address. `consent` is what makes Google issue a refresh token, which it
 * otherwise only does once per app and never again.
 */
export async function signInWithGoogle(): Promise<AuthResult> {
  if (!supabaseConfigured() || !client) {
    return { ok: false, error: 'Sign-in is not set up yet. The System has no account server to talk to.' };
  }

  const redirectTo = makeRedirectUri();

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes: GOOGLE_SCOPES,
        skipBrowserRedirect: Platform.OS !== 'web',
        queryParams: { access_type: 'offline', prompt: 'select_account consent' },
      },
    });
    if (error) throw error;

    // On web the call above navigates the page; nothing after this runs.
    if (Platform.OS === 'web') return { ok: true };

    if (!data?.url) return { ok: false, error: 'Google did not return a sign-in page.' };

    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (res.type !== 'success') return { ok: false, cancelled: true };

    const session = await sessionFromUrl(res.url);
    if (!session) return { ok: false, error: 'Signed in, but no session came back. Try again.' };

    const account = await rememberAccount(session);
    await linkGoogleTokens(session);
    return account ? { ok: true, account } : { ok: false, error: 'That account had no profile attached.' };
  } catch (err) {
    return {
      ok: false,
      error: `Google sign-in failed. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  }
}

/**
 * Hand the Google refresh token to the server, once, and forget it here.
 *
 * Supabase gives the provider refresh token to the client and does not manage
 * it: Google access tokens last an hour, and refreshing one needs the client
 * secret, which must never ship in a bundle. So the token goes straight to an
 * edge function that stores it in a table no client can read, and from then on
 * the server makes every Calendar and Tasks call on the student's behalf.
 *
 * Failing here is not fatal — sign-in still worked, the student just has no
 * Calendar access until next time.
 */
export async function linkGoogleTokens(session: Session): Promise<void> {
  const refresh = session.provider_refresh_token;
  if (!refresh || !client) return;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  if (!url) return;

  try {
    await fetch(`${url}/functions/v1/google-link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ refresh_token: refresh, scopes: GOOGLE_SCOPES.split(' ') }),
    });
  } catch (err) {
    console.warn('[auth] could not store Google tokens', err);
  }
}

/* --------------------------------------------------------- switching, out */

/**
 * Switch to an account already signed in on this device, without Google.
 *
 * Returns false when the stored refresh token has expired, in which case the
 * caller should run `signInWithGoogle` and let the student pick that address
 * again.
 */
export async function switchAccount(id: string): Promise<boolean> {
  if (!client) return false;

  const account = (await listAccounts()).find((a) => a.id === id);
  if (!account?.refreshToken) return false;

  try {
    // `refreshSession`, not `setSession`: setSession rejects a falsy
    // access_token outright, and only the refresh token was kept here. auth-js
    // names the multi-account switch as exactly this call's purpose, and it
    // bypasses the refresh-failure cooldown for a token it has not seen.
    const { data, error } = await client.auth.refreshSession({
      refresh_token: account.refreshToken,
    });
    if (error || !data.session) return false;

    // The refresh token rotates on use, so the registry must take the new one
    // or the next switch to this account will fail.
    await rememberAccount(data.session);
    return true;
  } catch {
    return false;
  }
}

/** Sign out of the active account. Its progress and registry entry remain. */
export async function signOut(): Promise<void> {
  if (!client) return;
  await client.auth.signOut().catch(() => {});
}

export async function currentSession(): Promise<Session | null> {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data.session ?? null;
}
