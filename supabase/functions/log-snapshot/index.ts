/**
 * log-snapshot — the device telling the server how the day is going.
 *
 * The quest board, the day log and the accepted plan all live in local
 * storage, so the phone is the only thing that knows them. The Steward needs
 * those numbers at 20:00 whether or not the app happens to be open then,
 * which is why they are pushed here as they change rather than pulled later.
 *
 * Upsert, not insert: the app calls this several times a day (on accepting a
 * plan, on coming to the foreground, at the midnight rollover) and the last
 * write before the report wins.
 */

import { admin, checkSecret, fail, json, preflight } from '../_shared/agent.ts';

function int(v: unknown, min = 0, max = 100_000): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** YYYY-MM-DD, or null. The device reports its own local date. */
function dateOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.', 500);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('That request was not readable.', 400);
  }

  // The device's own local date, because its midnight is the one that
  // matters for a day's quests — not the server's UTC date.
  const date = dateOrNull(body.date);
  if (!date) return fail('A date in YYYY-MM-DD form is required.', 400);

  const missed = Array.isArray(body.mandatory_missed)
    ? (body.mandatory_missed as unknown[])
        .filter((m): m is string => typeof m === 'string')
        .slice(0, 20)
        .map((m) => m.slice(0, 120))
    : [];

  const row = {
    date,
    xp_gained: int(body.xp_gained, 0, 1_000_000),
    level: int(body.level, 1, 999),
    streak: int(body.streak, 0, 10_000),
    quests_done: int(body.quests_done, 0, 500),
    quests_total: int(body.quests_total, 0, 500),
    planned_done: int(body.planned_done, 0, 100),
    planned_total: int(body.planned_total, 0, 100),
    plan_accepted_at:
      typeof body.plan_accepted_at === 'string' ? body.plan_accepted_at : null,
    mandatory_missed: missed,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from('daily_snapshots').upsert(row, { onConflict: 'date' });
  if (error) {
    console.error('snapshot upsert failed', error.message);
    return fail('The System could not record today.', 500);
  }

  return json({ ok: true, date });
});
