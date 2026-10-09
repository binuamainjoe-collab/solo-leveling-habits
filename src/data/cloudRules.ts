import { mergeProgress, type Snapshot } from '@/data/sync';
import type { ProgressState } from '@/store/progress';

/**
 * Rules for combining one account's progress across devices.
 *
 * The device copy stays authoritative while offline — nothing here ever blocks
 * the UI or gates a tap on a network call. A failed sync is a no-op that will
 * be retried on the next change; a student on a train must not notice.
 */

export const DEVICE_KEY = 'system.progress.v2';
/** Which account absorbed the pre-sign-in device progress, if any. */
export const ADOPTED_KEY = 'system.progress.adopted';

/** Per-account storage key. Signed out, the original device key is used. */
export function keyFor(userId: string | null): string {
  return userId ? `${DEVICE_KEY}:${userId}` : DEVICE_KEY;
}

/**
 * What actually sits in local storage.
 *
 * Versioned because the shape changed when sync arrived: before, the bare
 * state was stored with no timestamp, and a merge needs one. `fromStored`
 * below reads both.
 */
export interface Envelope {
  v: 3;
  updatedAt: string;
  state: PersistedState;
}

export type PersistedState = Omit<ProgressState, 'unlockQueue' | 'cardQueue'>;

export function isEnvelope(raw: unknown): raw is Envelope {
  return Boolean(raw) && typeof raw === 'object' && (raw as Envelope).v === 3;
}

/**
 * Read either format.
 *
 * A legacy blob has no timestamp, so it is dated to the moment it is read.
 * That is the honest reading: it is whatever this device last recorded, and
 * nothing newer has happened here since.
 */
export function fromStored(raw: unknown, now = new Date().toISOString()): Envelope | null {
  if (!raw || typeof raw !== 'object') return null;
  if (isEnvelope(raw)) return raw;
  // Anything with a day log or a date is a pre-v3 bare state.
  const maybe = raw as PersistedState;
  if (typeof maybe.date === 'string') return { v: 3, updatedAt: now, state: maybe };
  return null;
}

export function wrap(state: PersistedState, updatedAt = new Date().toISOString()): Envelope {
  return { v: 3, updatedAt, state };
}

/* ------------------------------------------------------------ seed choice */

export interface SeedInputs {
  /** This account's own local copy, if it has been used on this device. */
  own: Envelope | null;
  /** This account's copy on the server. */
  cloud: Envelope | null;
  /** Progress recorded before anyone signed in. */
  device: Envelope | null;
  /** The account that already absorbed `device`, if any. */
  adoptedBy: string | null;
  /** The account signing in now. */
  userId: string;
}

export interface SeedChoice {
  /** The envelopes to merge, newest-wins where they disagree. */
  parts: Envelope[];
  /** True when `device` was folded in and the marker should be written. */
  adoptsDevice: boolean;
}

/**
 * Decide what a signing-in account starts from.
 *
 * The case this exists for: the student has been using the app locally for
 * weeks, then signs in for the first time. That progress is theirs and must
 * follow them into the account. But it must follow them into exactly ONE
 * account — the second Gmail is a different hunter and starts clean, or both
 * accounts would claim the same history and the second would look like it had
 * been played for weeks.
 */
export function chooseSeed(input: SeedInputs): SeedChoice {
  const parts: Envelope[] = [];
  if (input.own) parts.push(input.own);
  if (input.cloud) parts.push(input.cloud);

  // Adopt only when this account is genuinely new everywhere and no other
  // account has taken the device progress already.
  const firstTimeEverywhere = !input.own && !input.cloud;
  const unclaimed = input.adoptedBy === null || input.adoptedBy === input.userId;
  const adoptsDevice = Boolean(input.device) && firstTimeEverywhere && unclaimed;

  if (adoptsDevice && input.device) parts.push(input.device);

  return { parts, adoptsDevice };
}

/** Merge however many copies exist, newest last so it wins ties. */
export function mergeAll(parts: Envelope[]): Envelope | null {
  if (parts.length === 0) return null;
  const sorted = [...parts].sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  let acc = sorted[0];
  for (const next of sorted.slice(1)) {
    const a: Snapshot = { updatedAt: acc.updatedAt, state: acc.state as ProgressState };
    const b: Snapshot = { updatedAt: next.updatedAt, state: next.state as ProgressState };
    acc = {
      v: 3,
      updatedAt: next.updatedAt,
      state: mergeProgress(a, b) as PersistedState,
    };
  }
  return acc;
}
