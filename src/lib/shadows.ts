import type { Rank } from '@/constants/theme';
import type { AgentId, AgentRun, Finding, RunStatus, Verdict } from '@/data/agents';
import type { Goal } from '@/data/goals';

/**
 * Talking to the shadow army.
 *
 * Every call carries the app secret, which is compiled into the bundle and so
 * is public in practice. It keeps crawlers off the endpoints; the real
 * protection is the thirty-calls-a-day cap the server enforces for itself.
 *
 * Unset the two environment variables and `shadowsConfigured()` is false, the
 * Goal screen says so plainly, and nothing here is ever called. That is the
 * state the app ships in until the Supabase project exists.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

export function shadowsConfigured(): boolean {
  return BASE.length > 0 && SECRET.length > 0;
}

export interface ShadowResult<T> {
  ok: boolean;
  data?: T;
  /** Plain language, shown to the student as-is. */
  error?: string;
}

async function call<T>(fn: string, body: unknown): Promise<ShadowResult<T>> {
  if (!shadowsConfigured()) {
    return { ok: false, error: 'The System has no server to reach yet.' };
  }

  try {
    const res = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': SECRET },
      body: JSON.stringify(body ?? {}),
    });

    const text = await res.text();
    if (!res.ok) {
      let message = `The System could not reach ${fn} (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // A non-JSON body means something upstream broke; keep the generic line.
      }
      return { ok: false, error: message };
    }

    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch (err) {
    return {
      ok: false,
      error: `The System could not reach the server. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  }
}

/* ------------------------------------------------------------- the shapes */

/** Snake_case as Postgres returns it, before it is turned into app types. */
interface RawFinding {
  id: string;
  goal_id: string;
  title: string;
  url: string | null;
  summary: string | null;
  score: number | null;
  rank: string | null;
  minutes_to_consume: number | null;
  verdict: string | null;
  reason: string | null;
  created_at: string;
  read_at: string | null;
}

interface RawGoal {
  id: string;
  title: string;
  active: boolean;
  created_at: string;
}

interface RawRun {
  id: string;
  agent: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  output_summary: string | null;
  error: string | null;
}

const RANKS_SET = new Set<Rank>(['E', 'D', 'C', 'B', 'A', 'S']);
const VERDICT_SET = new Set<Verdict>(['skip', 'skim', 'read', 'must-read']);

function toFinding(r: RawFinding): Finding {
  return {
    id: r.id,
    goalId: r.goal_id,
    title: r.title,
    url: r.url,
    summary: r.summary ?? '',
    score: typeof r.score === 'number' ? r.score : null,
    // The column is constrained, but a value that somehow fell outside the
    // set would otherwise be rendered as a badge reading "null".
    rank: r.rank && RANKS_SET.has(r.rank as Rank) ? (r.rank as Rank) : null,
    minutesToConsume: typeof r.minutes_to_consume === 'number' ? r.minutes_to_consume : null,
    verdict: r.verdict && VERDICT_SET.has(r.verdict as Verdict) ? (r.verdict as Verdict) : null,
    reason: r.reason,
    createdAt: r.created_at,
    readAt: r.read_at,
  };
}

function toGoal(r: RawGoal): Goal {
  return { id: r.id, title: r.title, active: r.active, createdAt: r.created_at };
}

function toRun(r: RawRun): AgentRun {
  return {
    id: r.id,
    agent: r.agent as AgentId,
    status: (['running', 'ok', 'error'].includes(r.status) ? r.status : 'error') as RunStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    outputSummary: r.output_summary,
    error: r.error,
  };
}

/* ------------------------------------------------------------ operations */

export interface GoalState {
  goal: Goal | null;
  findings: Finding[];
  runs: AgentRun[];
}

/** Everything the Goal screen needs, in one round trip. */
export async function fetchGoalState(): Promise<ShadowResult<GoalState>> {
  const res = await call<{ goal: RawGoal | null; findings: RawFinding[]; runs: RawRun[] }>(
    'goal-api',
    { op: 'state' },
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  return {
    ok: true,
    data: {
      goal: res.data.goal ? toGoal(res.data.goal) : null,
      findings: (res.data.findings ?? []).map(toFinding),
      runs: (res.data.runs ?? []).map(toRun),
    },
  };
}

export async function setGoal(title: string): Promise<ShadowResult<Goal>> {
  const res = await call<{ goal: RawGoal }>('goal-api', { op: 'goal.create', args: { title } });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return { ok: true, data: toGoal(res.data.goal) };
}

export async function markFindingRead(id: string, read: boolean): Promise<ShadowResult<null>> {
  const res = await call<unknown>('goal-api', { op: 'finding.read', args: { id, read } });
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

export interface ScoutOutcome {
  added: number;
  skipped: number;
  judged?: boolean;
  note?: string;
}

/** Send Beru out. It raises Igris itself when it comes back with anything. */
export async function runScout(): Promise<ShadowResult<ScoutOutcome>> {
  return call<ScoutOutcome>('beru-scout', {});
}

/** Re-rule on anything a failed run left unjudged. */
export async function runJudge(): Promise<ShadowResult<{ judged: number; mustRead: number }>> {
  return call<{ judged: number; mustRead: number }>('igris-judge', {});
}
