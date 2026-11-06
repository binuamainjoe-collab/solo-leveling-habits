import { useSyncExternalStore } from 'react';

import { client } from '@/lib/supabase';

/**
 * How the app tells The System's server functions who is asking.
 *
 * Every call carries the signed-in account's Supabase session token. The
 * server checks it with the auth server and then reads and writes as that
 * account, so the database's row rules keep each person's Beerus, goals,
 * profile and days apart. There is no shared app secret any more: anything
 * compiled into the bundle is public, so it could never tell two people
 * apart.
 *
 * Signed out ("Keep it on this device"), there is no token, the call is not
 * made at all, and the screen shows SIGNED_OUT instead.
 */

const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Shown wherever a server feature is used while signed out. */
export const SIGNED_OUT = 'Sign in with Google to use this. Your Beerus, goals and profile are kept under your own account.';

/**
 * The headers for one server call, or null when no account is signed in.
 * `getSession` hands back a fresh token when the stored one has expired.
 */
export async function sessionHeaders(): Promise<Record<string, string> | null> {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    return { Authorization: `Bearer ${token}`, apikey: ANON };
  } catch {
    return null;
  }
}

/* ------------------------------------------------ who is signed in, live */

let signedIn: string | null | undefined;
let watching = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!watching && client) {
    watching = true;
    void client.auth
      .getSession()
      .then(({ data }) => {
        if (signedIn === undefined) {
          signedIn = data.session?.user?.id ?? null;
          emit();
        }
      })
      .catch(() => {});
    client.auth.onAuthStateChange((_event, session) => {
      const id = session?.user?.id ?? null;
      if (id !== signedIn) {
        signedIn = id;
        emit();
      }
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The signed-in account id: `null` when signed out, `undefined` while the
 * saved session is still being read. A screen that holds server data keys
 * its loading on this, so switching accounts reloads it and never shows one
 * person's data under another's name.
 */
export function useSignedInId(): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (client ? signedIn : null),
    () => (client ? signedIn : null),
  );
}
