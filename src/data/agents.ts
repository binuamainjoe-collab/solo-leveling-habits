import type { Rank } from '@/constants/theme';

/**
 * The shadow army — agents that work on the current goal.
 *
 * Each one is a Gemini call with a fixed job, run from inside the Goal
 * section. They are described here as data rather than hard-coded into the
 * screen, because the roster is expected to grow: adding a shadow should be
 * an entry in `AGENTS` and an edge function, not surgery on the UI.
 *
 * React-free on purpose — the scoring and parsing rules below are exercised
 * under plain Node.
 */

export type AgentId = 'beru-scout' | 'igris-judge' | 'steward-report';

export interface AgentDef {
  id: AgentId;
  /** The shadow's name, as the student sees it. */
  name: string;
  /** Two or three words. */
  role: string;
  /** What it actually does, one sentence, in the System's voice. */
  blurb: string;
  rank: Rank;
  glyph: string;
  /**
   * Whether the student summons it directly. Igris is false: it is raised by
   * Beru at the end of a scout run, and a button for it would imply there was
   * something to judge when usually there is not.
   */
  summonable: boolean;
  /** Roughly how many of the daily call budget one run costs. */
  callCost: number;
}

export const AGENTS: AgentDef[] = [
  {
    id: 'beru-scout',
    name: 'Beru',
    role: 'Scout',
    blurb: 'Searches the world for anything that serves the current goal, and brings back what it finds.',
    rank: 'S',
    glyph: '◈',
    summonable: true,
    // One grounded search, then one structuring pass.
    callCost: 2,
  },
  {
    id: 'igris-judge',
    name: 'Igris',
    role: 'Judge',
    blurb: "Weighs everything Beru drags back and rules on what is worth your attention.",
    rank: 'A',
    glyph: '⚔',
    summonable: false,
    // Every unscored finding in a single pass.
    callCost: 1,
  },
  {
    id: 'steward-report',
    name: 'The Steward',
    role: 'Overseer',
    blurb: 'Watches the other shadows and your own record, and reports once a day without flattering you.',
    rank: 'S',
    glyph: '◉',
    // Runs itself at 20:00, but can be asked for a reading at any time.
    summonable: true,
    callCost: 1,
  },
];

/* ----------------------------------------------------------- the report */

export type ReportStatus = 'sent' | 'fallback' | 'failed';

export interface ReportProblem {
  text: string;
  fix: string;
  fix_minutes: number;
}

/** The narration, as the Steward's panel shows it. */
export interface ReportBody {
  headline: string;
  wins: string[];
  problems: ReportProblem[];
  top_finding_comment: string;
  tomorrow_focus: string[];
}

export interface Report {
  id: string;
  date: string;
  status: ReportStatus;
  body: ReportBody | null;
  emailId: string | null;
  error: string | null;
  createdAt: string;
}

/**
 * Whether the reading came from the model or from the deterministic
 * template. Worth showing: a fallback means narration failed, and hiding
 * that would make a degraded report look like a normal one.
 */
export function isFallback(report: Report | null): boolean {
  return report?.status === 'fallback';
}

export function agentById(id: AgentId): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

/* --------------------------------------------------------------- findings */

export type Verdict = 'skip' | 'skim' | 'read' | 'must-read';

export const VERDICTS: Verdict[] = ['skip', 'skim', 'read', 'must-read'];

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VERDICTS as string[]).includes(v);
}

export interface Finding {
  id: string;
  goalId: string;
  title: string;
  /**
   * Grounding hands back a Vertex AI Search redirect rather than the
   * publisher's own address, and those expire. `title` is kept populated so a
   * dead link still says what it was.
   */
  url: string | null;
  summary: string;
  /** Null until Igris has ruled. */
  score: number | null;
  rank: Rank | null;
  minutesToConsume: number | null;
  verdict: Verdict | null;
  reason: string | null;
  createdAt: string;
  /** Set when the student has actually read it and marked it done. */
  readAt: string | null;
}

/**
 * Igris's 1–10 score as a hunter rank.
 *
 * The bands are uneven on purpose: most things are mediocre, so D and C are
 * wide, while 7, 8 and 9+ each earn their own grade. A ladder that gave every
 * rank two points would call half of everything A-rank.
 */
export function rankForScore(score: number): Rank {
  const s = Math.max(1, Math.min(10, Math.round(score)));
  if (s >= 9) return 'S';
  if (s === 8) return 'A';
  if (s === 7) return 'B';
  if (s >= 5) return 'C';
  if (s >= 3) return 'D';
  return 'E';
}

/**
 * What finishing a finding pays.
 *
 * Only `must-read` pays out. Rewarding a skim would make the cheapest verdict
 * the most efficient way to earn, and Igris would quietly become a slot
 * machine rather than a filter.
 */
export const FINDING_XP: Record<Verdict, number> = {
  'must-read': 150,
  read: 0,
  skim: 0,
  skip: 0,
};

export function xpForFinding(finding: Finding): number {
  return finding.verdict ? FINDING_XP[finding.verdict] : 0;
}

/** Findings Igris has not ruled on yet. */
export function unjudged(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.score === null);
}

/**
 * Sort for display: judged first, best rank first, then newest.
 *
 * Unjudged items sink rather than lead — they are not yet a recommendation,
 * and showing them at the top would present unfiltered search results as if
 * the System had endorsed them.
 */
const RANK_ORDER: Rank[] = ['S', 'A', 'B', 'C', 'D', 'E'];

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
    if (a.rank && b.rank && a.rank !== b.rank) {
      return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

/* ------------------------------------------------------------ run history */

export type RunStatus = 'running' | 'ok' | 'error';

export interface AgentRun {
  id: string;
  agent: AgentId;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  outputSummary: string | null;
  error: string | null;
}

/** The most recent run of each agent, for the roster's status line. */
export function latestRuns(runs: AgentRun[]): Partial<Record<AgentId, AgentRun>> {
  const out: Partial<Record<AgentId, AgentRun>> = {};
  for (const run of runs) {
    const seen = out[run.agent];
    if (!seen || Date.parse(run.startedAt) > Date.parse(seen.startedAt)) out[run.agent] = run;
  }
  return out;
}

/* ----------------------------------------------------------- url handling */

/**
 * Normalise a URL for duplicate detection.
 *
 * The database has the final say through a unique constraint, but matching
 * here too means the second run of a scout does not even try to insert five
 * rows it already has. Tracking parameters and a trailing slash are the usual
 * reason the same page arrives looking different.
 */
export function normaliseUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref|source)/i.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

export function isDuplicate(url: string | null, existing: Finding[]): boolean {
  const key = normaliseUrl(url);
  if (!key) return false;
  return existing.some((f) => normaliseUrl(f.url) === key);
}
