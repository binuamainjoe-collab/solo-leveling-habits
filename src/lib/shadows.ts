import type { Rank } from '@/constants/theme';
import type {
  AgentId,
  AgentRun,
  Finding,
  Report,
  ReportBody,
  ReportStatus,
  RunStatus,
  Verdict,
} from '@/data/agents';
import type { Goal, Memory, MemoryKind } from '@/data/goals';
import { sessionHeaders, SIGNED_OUT } from '@/lib/serverAuth';

/**
 * Talking to the shadow army.
 *
 * Every call carries the signed-in account's session (see serverAuth.ts), so
 * the shadows work on that account's goals and nobody else's. Signed out,
 * nothing is sent and the screen says to sign in.
 *
 * Unset the two environment variables and `shadowsConfigured()` is false, the
 * Goal screen says so plainly, and nothing here is ever called.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function shadowsConfigured(): boolean {
  return BASE.length > 0 && ANON.length > 0;
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
  const auth = await sessionHeaders();
  if (!auth) return { ok: false, error: SIGNED_OUT };

  try {
    const res = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
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
  focus?: boolean;
  deadline?: string | null;
  created_at: string;
}

interface RawMemory {
  id: string;
  kind: string;
  content: string;
  goal_id: string | null;
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
  return {
    id: r.id,
    title: r.title,
    active: r.active,
    focus: r.focus === true,
    deadline: typeof r.deadline === 'string' ? r.deadline : null,
    createdAt: r.created_at,
  };
}

const MEMORY_KINDS = new Set<MemoryKind>(['fact', 'preference', 'commitment', 'pattern']);

function toMemory(r: RawMemory): Memory {
  return {
    id: r.id,
    kind: MEMORY_KINDS.has(r.kind as MemoryKind) ? (r.kind as MemoryKind) : 'fact',
    content: r.content,
    goalId: r.goal_id,
    createdAt: r.created_at,
  };
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
  /** The focus goal — the one the shadows and the findings below belong to. */
  goal: Goal | null;
  /** Every active goal, focus first. */
  goals: Goal[];
  findings: Finding[];
  runs: AgentRun[];
  /** What the System remembers, newest first. */
  memories: Memory[];
}

/** Everything the Goal screen needs, in one round trip. */
export async function fetchGoalState(): Promise<ShadowResult<GoalState>> {
  const res = await call<{
    goal: RawGoal | null;
    goals?: RawGoal[];
    findings: RawFinding[];
    runs: RawRun[];
    memories?: RawMemory[];
  }>('goal-api', { op: 'state' });
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const focus = res.data.goal ? toGoal(res.data.goal) : null;
  return {
    ok: true,
    data: {
      goal: focus,
      // An older server sends only the focus; treat that as the whole list.
      goals: res.data.goals ? res.data.goals.map(toGoal) : focus ? [focus] : [],
      findings: (res.data.findings ?? []).map(toFinding),
      runs: (res.data.runs ?? []).map(toRun),
      memories: (res.data.memories ?? []).map(toMemory),
    },
  };
}

/**
 * Add a goal. It becomes the focus only when there is none yet, so adding a
 * second goal never quietly moves the week's attention.
 */
export async function setGoal(title: string, deadline: string | null = null): Promise<ShadowResult<Goal>> {
  const res = await call<{ goal: RawGoal }>('goal-api', { op: 'goal.create', args: { title, deadline } });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return { ok: true, data: toGoal(res.data.goal) };
}

/** Make a goal the focus. The previous focus stays as an ordinary goal. */
export async function focusGoal(id: string): Promise<ShadowResult<null>> {
  const res = await call<unknown>('goal-api', { op: 'goal.focus', args: { id } });
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

/** Put a goal away. If it was the focus, the oldest remaining goal takes over. */
export async function archiveGoal(id: string): Promise<ShadowResult<null>> {
  const res = await call<unknown>('goal-api', { op: 'goal.archive', args: { id } });
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
}

/** Make the System forget one thing it remembered. */
export async function forgetMemory(id: string): Promise<ShadowResult<null>> {
  const res = await call<unknown>('goal-api', { op: 'memory.forget', args: { id } });
  return res.ok ? { ok: true, data: null } : { ok: false, error: res.error };
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

/* ---------------------------------------------------------- the Steward */

interface RawReport {
  id: string;
  date: string;
  status: string;
  report: ReportBody | null;
  email_id: string | null;
  error: string | null;
  created_at: string;
}

function toReport(r: RawReport): Report {
  return {
    id: r.id,
    date: r.date,
    status: (['sent', 'fallback', 'failed'].includes(r.status) ? r.status : 'failed') as ReportStatus,
    body: r.report,
    emailId: r.email_id,
    error: r.error,
    createdAt: r.created_at,
  };
}

/** The most recent reading, for the Steward's panel. */
export async function fetchLatestReport(): Promise<ShadowResult<Report | null>> {
  const res = await call<{ report: RawReport | null }>('goal-api', { op: 'report.latest' });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return { ok: true, data: res.data.report ? toReport(res.data.report) : null };
}

export interface StewardOutcome {
  status: ReportStatus;
  date: string;
  /** 'stored' when no email is configured — which is a success, not a gap. */
  delivery: 'stored' | 'emailed' | 'email-failed';
  alert: boolean;
  anomalies: { code: string; severity: string }[];
  error: string | null;
}

/**
 * Ask for a reading now rather than waiting for 20:00.
 *
 * `force` bypasses both the hour gate and the once-a-day guard, which is
 * exactly what a manual request should do.
 */
export async function runSteward(): Promise<ShadowResult<StewardOutcome>> {
  return call<StewardOutcome>('steward-report', { force: true });
}
