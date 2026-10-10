/**
 * goal-api — how the app reads and writes goals and findings.
 *
 * Not an agent: it makes no model calls and spends none of the daily budget.
 * It exists because `goals`, `findings` and `agent_runs` are service-role
 * only. The alternative — opening them to the anon key, which ships in the
 * bundle — would put one student's goals behind nothing at all.
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

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** A goal must be something an agent can actually research. */
function validTitle(raw: string): string | null {
  const title = raw.replace(/\s+/g, ' ').trim();
  return title.length >= 4 && title.length <= 160 ? title : null;
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
     * Everything the Goal screen needs, in one round trip: the active goal,
     * its findings and the recent run history. Three requests would mean
     * three chances to render a half-loaded screen.
     */
    case 'state': {
      const { data: goal, error: goalError } = await db
        .from('goals')
        .select('id, title, active, created_at')
        .eq('active', true)
        .maybeSingle();
      if (goalError) return fail('The System could not read your goal.', 500);

      const [findings, runs] = await Promise.all([
        goal
          ? db
              .from('findings')
              .select(
                'id, goal_id, title, url, summary, score, rank, minutes_to_consume, verdict, reason, created_at, read_at',
              )
              .eq('goal_id', goal.id)
              .order('created_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
        db
          .from('agent_runs')
          .select('id, agent, status, started_at, finished_at, output_summary, error')
          .order('started_at', { ascending: false })
          .limit(20),
      ]);

      return json({
        goal: goal ?? null,
        findings: findings.data ?? [],
        runs: runs.data ?? [],
      });
    }

    case 'goal.list': {
      const { data, error } = await db
        .from('goals')
        .select('id, title, active, created_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return fail('The System could not list your goals.', 500);
      return json({ goals: data ?? [] });
    }

    case 'goal.create': {
      const title = validTitle(str(args.title, 200));
      if (!title) return fail('Give the goal a name of at least four characters.', 400);

      // Stand the new one down first: the one-active index would reject the
      // insert otherwise, and a clear error beats a constraint violation.
      const { error: clearError } = await db
        .from('goals')
        .update({ active: false })
        .eq('active', true);
      if (clearError) return fail('The System could not retire your old goal.', 500);

      const { data, error } = await db
        .from('goals')
        .insert({ title, active: true })
        .select('id, title, active, created_at')
        .single();
      if (error) {
        console.error('goal insert failed', error.message);
        return fail('The System could not set that goal.', 500);
      }
      return json({ goal: data });
    }

    case 'goal.activate': {
      const id = str(args.id, 64);
      if (!id) return fail('Which goal?', 400);
      const { error } = await db.rpc('activate_goal', { p_goal: id });
      if (error) {
        console.error('activate failed', error.message);
        return fail('The System could not switch goals.', 500);
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

    default:
      return fail('Unknown operation.', 400);
  }
});
