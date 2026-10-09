import { toWire } from '@/data/sync';
import { client } from '@/lib/supabase';
import type { ProgressState } from '@/store/progress';
import type { Envelope, PersistedState } from '@/data/cloudRules';

/**
 * Pushing and pulling one account's progress.
 *
 * The device copy stays authoritative while offline — nothing here ever blocks
 * the UI or gates a tap on a network call. A failed sync is a no-op that will
 * be retried on the next change; a student on a train must not notice.
 *
 * The merge rules themselves live in '@/data/cloudRules', which imports no
 * react-native and so can be exercised under plain Node.
 */

export * from '@/data/cloudRules';

/* ---------------------------------------------------------------- network */

export async function pullProgress(userId: string): Promise<Envelope | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('progress')
      .select('state, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return {
      v: 3,
      updatedAt: typeof data.updated_at === 'string' ? data.updated_at : new Date(0).toISOString(),
      state: data.state as PersistedState,
    };
  } catch {
    return null;
  }
}

export async function pushProgress(
  userId: string,
  state: PersistedState,
  updatedAt: string,
): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await client.from('progress').upsert(
      {
        user_id: userId,
        // The reveal queues never travel — they are instructions to play an
        // animation on the device that earned it.
        state: toWire(state as ProgressState),
        updated_at: updatedAt,
      },
      { onConflict: 'user_id' },
    );
    return !error;
  } catch {
    return false;
  }
}
