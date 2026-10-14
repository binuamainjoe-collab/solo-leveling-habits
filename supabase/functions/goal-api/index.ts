/**
 * goal-api — how the app reads and writes goals, findings and memories.
 *
 * Not an agent: it makes no model calls and spends none of the daily budget.
 * It exists because these tables are service-role only. The alternative —
 * opening them to the anon key, which ships in the bundle — would put one
 * student's goals behind nothing at all.
 *
 * Several goals can be active at once; exactly one is the focus. The shadows
 * work on the focus, and the planner and the assistant lead with it.
 *
 * Same gate as the shadows: `x-app-secret`, no JWT.
 */

import {
  admin,
  checkSecret,
  fail,
  json,
  preflight,
} from '../_shared/agent.ts';

/** More than this and "focus" stops meaning anything. */
const MAX_ACTIVE_GOALS = 6;

const GOAL_COLUMNS = 'id, title, active, focus, deadline, created_at';
const MEMORY_COLUMNS = 'id, kind, content, goal_id, created_at, last_seen_at';

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** A goal must be something an agent can actually research. */
function validTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, ' ').trim();
  return title.length >= 4 && title.length <= 160 ? title : null;
}

/** YYYY-MM-DD and a real calendar date, or null. */
function validDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : raw;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  let op = '';
  let args: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { op?: unknown; args?: unknown };
    op = typeof body.op === 'string' ? body.op : '';
    args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
  } catch {
    return fail('That request was not readable.', 400);
  }

  switch (op) {
    /**
     * Everything the Goal screen needs, in one round trip: every active goal,
     * the focus goal's findings, the recent run history and what the System
     * remembers. `goal` is the focus, kept under its old name so an older
     * build of the app still reads it.
     */
    case 'state': {
      const { data: goals, error: goalError } = await db
        .from('goals')
        .select(GOAL_COLUMNS)
        .eq('active', true)
        .order('focus', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(MAX_ACTIVE_GOALS * 2);
      if (goalError) return fail('The System could not read your goals.', 500);

      const focus = (goals ?? []).find((g) => g.focus) ?? null;

      const [findings, runs, memories] = await Promise.all([
        focus
          ? db
              .from('findings')
              .select(
                'id, goal_id, title, url, summary, score, rank, minutes_to_consume, verdict, reason, created_at, read_at',
              )
              .eq('goal_id', focus.id)
              .order('created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
        db
          .from('agent_runs')
          .select('id, agent, status, started_at, finished_at, output_summary, error')
          .order('started_at', { ascending: false })
          .limit(20),
        db
          .from('memories')
          .select(MEMORY_COLUMNS)
          .is('archived_at', null)
          .order('last_seen_at', { ascending: false })
          .limit(60),
      ]);

      return json({
        goal: focus,
        goals: goals ?? [],
        findings: findings.data ?? [],
        runs: runs.data ?? [],
        memories: memories.data ?? [],
      });
    }

    /**
     * The newest report, for the Steward's panel.
     *
     * `facts` is deliberately not returned: it is a large audit blob the
     * screen has no use for, and keeping it server-side means the only
     * thing that ever reaches a device is the handful of sentences meant
     * to be read.
     */
    case 'report.latest': {
      const { data, error } = await db
        .from('reports')
        .select('id, date, status, report, email_id, error, created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        console.error('report read failed', error.message);
        return fail('The System could not read the last report.', 500);
      }
      return json({ report: data ?? null });
    }

    case 'goal.list': {
      const { data, error } = await db
        .from('goals')
        .select(GOAL_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return fail('The System could not list your goals.', 500);
      return json({ goals: data ?? [] });
    }

    /**
     * Add a goal. It becomes the focus only when there is no focus yet —
     * adding a second goal must never quietly move the week's attention.
     */
    case 'goal.create': {
      const title = validTitle(str(args.title, 200));
      if (!title) return fail('Give the goal a name of at least four characters.', 400);
      const deadline = args.deadline == null || args.deadline === '' ? null : validDate(args.deadline);
      if (args.deadline && !deadline) return fail('That deadline is not a date.', 400);

      const { data: live, error: countError } = await db
        .from('goals')
        .select('id, focus')
        .eq('active', true);
      if (countError) return fail('The System could not read your goals.', 500);
      if ((live ?? []).length >= MAX_ACTIVE_GOALS) {
        return fail(`You already hold ${MAX_ACTIVE_GOALS} goals. Finish or archive one first.`, 409);
      }
      const hasFocus = (live ?? []).some((g) => g.focus);

      const { data, error } = await db
        .from('goals')
        .insert({ title, deadline, active: true, focus: !hasFocus })
        .select(GOAL_COLUMNS)
        .single();
      if (error) {
        console.error('goal insert failed', error.message);
        return fail('The System could not set that goal.', 500);
      }
      return json({ goal: data });
    }

    /** Make one goal the focus. The previous focus stays active. */
    case 'goal.focus': {
      const id = str(args.id, 64);
      if (!id) return fail('Which goal?', 400);
      const { error } = await db.rpc('set_focus_goal', { p_goal: id });
      if (error) {
        console.error('focus failed', error.message);
        return fail('The System could not change your focus.', 500);
      }
      return json({ ok: true });
    }

    /**
     * Put a goal away — done, or no longer wanted. Its findings stay. If it
     * was the focus, the oldest remaining goal takes over, so there is never
     * a week with goals but no focus.
     */
    case 'goal.archive': {
      const id = str(args.id, 64);
      if (!id) return fail('Which goal?', 400);

      const { data: archived, error } = await db
        .from('goals')
        .update({ active: false, focus: false })
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error || !archived) {
        if (error) console.error('archive failed', error.message);
        return fail('The System could not archive that goal.', 500);
      }

      const { data: rest } = await db
        .from('goals')
        .select('id, focus')
        .eq('active', true)
        .order('created_at', { ascending: true });
      if (rest && rest.length > 0 && !rest.some((g) => g.focus)) {
        await db.rpc('set_focus_goal', { p_goal: rest[0].id });
      }
      return json({ ok: true });
    }

    /** Marking a finding done, or undoing that. */
    case 'finding.read': {
      const id = str(args.id, 64);
      if (!id) return fail('Which finding?', 400);
      const read = args.read !== false;
      const { data, error } = await db
        .from('findings')
        .update({ read_at: read ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id, verdict, read_at')
        .single();
      if (error) {
        console.error('read toggle failed', error.message);
        return fail('The System could not record that.', 500);
      }
      return json({ finding: data });
    }

    /**
     * Forget one memory. Archived rather than deleted, so a mistaken tap is
     * recoverable from the dashboard; the assistant never sees it again.
     */
    case 'memory.forget': {
      const id = str(args.id, 64);
      if (!id) return fail('Which memory?', 400);
      const { error } = await db
        .from('memories')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', id);
      if (error) {
        console.error('forget failed', error.message);
        return fail('The System could not forget that.', 500);
      }
      return json({ ok: true });
    }

    default:
      return fail('Unknown operation.', 400);
  }
});
