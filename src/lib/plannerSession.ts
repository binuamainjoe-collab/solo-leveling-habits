import type { PlannerSession } from '@/data/planner';
import { storage } from '@/store/storage';

/**
 * Where an unfinished planning conversation is kept.
 *
 * Local only and never synced: a half-finished chat is a scratchpad, not a
 * record, and pushing every keystroke to the server would cost more than it
 * could ever be worth.
 */
const KEY = 'system.planner.session';

export async function loadSession(): Promise<PlannerSession | null> {
  try {
    const raw = await storage.get(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlannerSession;
    // A malformed save must not crash the chat; treat it as no session.
    if (typeof parsed?.date !== 'string' || !Array.isArray(parsed?.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveSession(session: PlannerSession): Promise<void> {
  await storage.set(KEY, JSON.stringify(session)).catch(() => {});
}

export async function clearSession(): Promise<void> {
  await storage.remove(KEY).catch(() => {});
}
