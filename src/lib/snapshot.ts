import type { SnapshotPayload } from '@/data/snapshot';
import { sessionHeaders } from '@/lib/serverAuth';

/**
 * Sending a day's summary to `log-snapshot`, under the signed-in account.
 *
 * Fire and forget: a failed send is retried the next time the day changes,
 * and nothing on the device ever waits on it. Signed out, nothing is sent:
 * the day stays on the device.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function snapshotsConfigured(): boolean {
  return BASE.length > 0 && ANON.length > 0;
}

export async function pushSnapshot(payload: SnapshotPayload): Promise<boolean> {
  if (!snapshotsConfigured()) return false;
  const auth = await sessionHeaders();
  if (!auth) return false;
  try {
    const res = await fetch(`${BASE}/functions/v1/log-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
