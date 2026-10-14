import type { SnapshotPayload } from '@/data/snapshot';

/**
 * Sending a day's summary to `log-snapshot`.
 *
 * Fire and forget: a failed send is retried the next time the day changes,
 * and nothing on the device ever waits on it.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

export function snapshotsConfigured(): boolean {
  return BASE.length > 0 && SECRET.length > 0;
}

export async function pushSnapshot(payload: SnapshotPayload): Promise<boolean> {
  if (!snapshotsConfigured()) return false;
  try {
    const res = await fetch(`${BASE}/functions/v1/log-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': SECRET },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
