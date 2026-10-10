/**
 * The Steward's reasoning, with no I/O in it.
 *
 * Every step of the daily report is a pure function here: the gate, the
 * anomaly rules, the number check, the fallback template and the email
 * render. The edge function is left holding only the database calls, the
 * model call and the send.
 *
 * Nothing in this file imports anything — not Deno, not Supabase — so the
 * whole pipeline can be exercised against fixtures under plain Node.
 *
 * The division of labour that governs the whole feature: CODE computes every
 * number, the MODEL only writes words. The validator below is what actually
 * enforces that, rather than trusting the prompt to hold.
 */

/* ------------------------------------------------------------------ cost */

/**
 * Introductory Gemini 3.8 Flash rates. Google has these doubling on
 * 2027-01-01, and they are third-party figures rather than scraped from
 * Google's own pricing page — worth re-checking before trusting the cost
 * line in a report.
 *
 * Reasoning tokens bill at the OUTPUT rate even though Gemini reports them
 * separately from `candidatesTokenCount`, which is why `costUsd` adds them.
 */
export const COST_CONFIG = {
  model: 'gemini-3.8-flash',
  usdPer1mInput: 0.75,
  usdPer1mOutput: 3.75,
} as const;

export function costUsd(tokensIn: number, tokensOut: number, tokensThoughts = 0): number {
  const input = (tokensIn / 1_000_000) * COST_CONFIG.usdPer1mInput;
  const output = ((tokensOut + tokensThoughts) / 1_000_000) * COST_CONFIG.usdPer1mOutput;
  // Four decimals: a day of this costs fractions of a cent, and rounding to
  // two would report every single day as $0.00.
  return Math.round((input + output) * 10_000) / 10_000;
}

/* ------------------------------------------------------------------ time */

const ZONE = 'Europe/Vienna';

/**
 * The local hour, 0–23.
 *
 * `hourCycle: 'h23'` rather than `hour12: false` — the latter renders
 * midnight as "24" in several runtimes, which would make the 20:00 gate
 * quietly untestable at exactly one hour of the day.
 */
export function localHour(now: Date, timeZone: string = ZONE): number {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(text);
}

/** The local calendar date as YYYY-MM-DD — not the UTC one. */
export function localDate(now: Date, timeZone: string = ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  // en-CA already formats as YYYY-MM-DD.
  return parts;
}

export interface GateInput {
  now: Date;
  /** True when a 'sent' or 'fallback' row already exists for the local date. */
  settledToday: boolean;
  force: boolean;
  timeZone?: string;
}

export interface GateResult {
  run: boolean;
  reason: string;
  date: string;
  hour: number;
}

/**
 * Decide whether this invocation should produce a report.
 *
 * The cron fires at 18:00 and 19:00 UTC so that exactly one of them is 20:00
 * in Vienna whether or not daylight saving is in effect. The other one has to
 * fall through quietly, which is what the hour check does — it is a filter,
 * not an error.
 */
export function gate(input: GateInput): GateResult {
  const date = localDate(input.now, input.timeZone);
  const hour = localHour(input.now, input.timeZone);

  if (input.force) return { run: true, reason: 'forced', date, hour };
  if (hour !== 20) return { run: false, reason: `local hour is ${hour}, not 20`, date, hour };
  if (input.settledToday) return { run: false, reason: 'a report already went out today', date, hour };
  return { run: true, reason: 'scheduled', date, hour };
}

/* ----------------------------------------------------------------- facts */

export interface AgentFact {
  agent: string;
  runs: number;
  ok: number;
  failed: number;
  last_error: string | null;
  avg_duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  tokens_thoughts: number;
  cost_usd: number;
}

export interface SnapshotFact {
  date: string;
  xp_gained: number;
  level: number;
  streak: number;
  quests_done: number;
  quests_total: number;
  planned_done: number;
  planned_total: number;
  plan_accepted_at: string | null;
  mandatory_missed: string[];
}

export interface FindingFact {
  title: string;
  rank: string | null;
  score: number | null;
  verdict: string | null;
  minutes_to_consume: number | null;
  url: string | null;
}

export interface Facts {
  date: string;
  goal: string | null;
  agents: AgentFact[];
  usage: { calls_today: number; cap: number; pct_of_cap: number };
  findings: { created_today: number; top: FindingFact[] };
  today: SnapshotFact | null;
  previous: SnapshotFact[];
  /**
   * Values the model would otherwise have to work out for itself.
   *
   * This exists because of the validator: every number in the narration must
   * already appear in the facts, so any figure worth saying out loud has to
   * be computed here first. Without this the model could not write "you
   * finished half your plan" without failing validation.
   */
  derived: {
    planned_completion_pct: number | null;
    quest_completion_pct: number | null;
    total_runs: number;
    total_failed: number;
    total_cost_usd: number;
    calls_remaining: number;
  };
}

export function deriveFacts(
  partial: Omit<Facts, 'derived'>,
): Facts {
  const t = partial.today;
  const pct = (done: number, total: number): number | null =>
    total > 0 ? Math.round((done / total) * 100) : null;

  return {
    ...partial,
    derived: {
      planned_completion_pct: t ? pct(t.planned_done, t.planned_total) : null,
      quest_completion_pct: t ? pct(t.quests_done, t.quests_total) : null,
      total_runs: partial.agents.reduce((n, a) => n + a.runs, 0),
      total_failed: partial.agents.reduce((n, a) => n + a.failed, 0),
      total_cost_usd:
        Math.round(partial.agents.reduce((n, a) => n + a.cost_usd, 0) * 10_000) / 10_000,
      calls_remaining: Math.max(0, partial.usage.cap - partial.usage.calls_today),
    },
  };
}

/* ------------------------------------------------------------- anomalies */

export type Severity = 'info' | 'warn' | 'critical';

export interface Anomaly {
  code: string;
  severity: Severity;
  evidence: string;
}

/**
 * The seven rules. Pure, ordered most severe first, and entirely free of the
 * model — an alert that depended on a language model's mood would not be
 * worth having.
 */
export function detectAnomalies(facts: Facts): Anomaly[] {
  const out: Anomaly[] = [];
  const t = facts.today;

  for (const a of facts.agents) {
    if (a.failed > 0) {
      out.push({
        code: 'agent_failed',
        severity: 'critical',
        evidence: `${a.agent}: ${a.failed} of ${a.runs} runs failed${a.last_error ? ` — ${a.last_error}` : ''}`,
      });
    }
  }

  const scout = facts.agents.find((a) => a.agent === 'beru-scout');
  if (!scout || scout.runs === 0) {
    out.push({
      code: 'scout_missing_today',
      severity: 'warn',
      evidence: 'beru-scout did not run in the last 24h',
    });
  }

  if (facts.usage.pct_of_cap >= 80) {
    out.push({
      code: 'usage_over_80pct',
      severity: 'warn',
      evidence: `${facts.usage.calls_today} of ${facts.usage.cap} daily calls used`,
    });
  }

  if (!t) {
    out.push({
      code: 'no_snapshot_today',
      severity: 'info',
      evidence: 'the app did not report a snapshot today',
    });
  }

  if (t && t.planned_total > 0) {
    const pct = facts.derived.planned_completion_pct ?? 0;
    if (pct < 50) {
      out.push({
        code: 'planned_completion_under_50pct',
        severity: 'warn',
        evidence: `${t.planned_done} of ${t.planned_total} planned tasks done (${pct}%)`,
      });
    }
  }

  // Yesterday's row is where last night's acceptance would have been recorded.
  const yesterday = facts.previous[0];
  if (yesterday && !yesterday.plan_accepted_at) {
    out.push({
      code: 'plan_not_accepted_last_night',
      severity: 'info',
      evidence: `no plan was accepted on ${yesterday.date}`,
    });
  }

  // Three consecutive falls means four days of data, newest first.
  const series = [t, ...facts.previous].filter((s): s is SnapshotFact => s !== null);
  if (series.length >= 4) {
    const [d0, d1, d2, d3] = series;
    if (d0.quests_done < d1.quests_done && d1.quests_done < d2.quests_done && d2.quests_done < d3.quests_done) {
      out.push({
        code: 'quests_done_falling_3_days',
        severity: 'warn',
        evidence: `quests cleared fell ${d3.quests_done} → ${d2.quests_done} → ${d1.quests_done} → ${d0.quests_done}`,
      });
    }
  }

  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function hasCritical(anomalies: Anomaly[]): boolean {
  return anomalies.some((a) => a.severity === 'critical');
}

/* ------------------------------------------------------------- narration */

export interface Problem {
  text: string;
  fix: string;
  fix_minutes: number;
}

export interface Narration {
  headline: string;
  wins: string[];
  problems: Problem[];
  top_finding_comment: string;
  tomorrow_focus: string[];
}

export const NARRATION_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    wins: { type: 'array', items: { type: 'string' } },
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          fix: { type: 'string' },
          fix_minutes: { type: 'integer' },
        },
        required: ['text', 'fix', 'fix_minutes'],
        propertyOrdering: ['text', 'fix', 'fix_minutes'],
      },
    },
    top_finding_comment: { type: 'string' },
    tomorrow_focus: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'wins', 'problems', 'top_finding_comment', 'tomorrow_focus'],
  propertyOrdering: ['headline', 'wins', 'problems', 'top_finding_comment', 'tomorrow_focus'],
};

export const STEWARD_SYSTEM = `You are the Steward, the System's overseer. You receive a FACTS JSON. Rules: (1) Use ONLY facts present in the JSON. Never invent, estimate or round numbers. (2) The reader has ADHD: be short, concrete, calm. No shaming, no guilt, no motivational filler. (3) Wins first, then at most 3 problems. Every problem gets exactly one fix that takes a stated number of minutes. (4) Write in a terse System voice (one light Solo Leveling flavor per report at most). (5) If the facts show no problems, say so and return an empty problems array. (6) tomorrow_focus: max 3 items, derived from unfinished mandatory quests, the plan, or the top finding.

Any number you write must appear verbatim in the FACTS JSON. Percentages and totals are already computed for you under "derived" — use those rather than working anything out. The one exception is fix_minutes, which is your own estimate.`;

/* -------------------------------------------------------------- validate */

export interface Validation {
  ok: boolean;
  violations: string[];
}

/** Every number that legitimately appears somewhere in the facts. */
export function factNumbers(facts: Facts): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'number') {
      found.add(String(value));
      // A cost of 0.0123 is also reasonably written as "0.01".
      if (!Number.isInteger(value)) found.add(String(Math.round(value * 100) / 100));
      return;
    }
    if (typeof value === 'string') {
      for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) found.add(m);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(facts);
  return found;
}

/**
 * Check the narration invented no numbers.
 *
 * `fix_minutes` is exempt: the prompt asks the model to estimate how long a
 * fix takes, so by definition that figure cannot already be in the facts.
 * It is schema-constrained to an integer, which is the guard that matters
 * there. Everything written in prose is checked.
 */
export function validateNarration(narration: Narration, facts: Facts): Validation {
  const allowed = factNumbers(facts);
  const violations: string[] = [];

  const check = (field: string, text: string): void => {
    for (const raw of text.match(/\d+(?:\.\d+)?/g) ?? []) {
      // Strip a trailing ordinal/percent artefact before comparing.
      if (allowed.has(raw)) continue;
      violations.push(`${field}: "${raw}" does not appear in the facts`);
    }
  };

  check('headline', narration.headline);
  narration.wins.forEach((w, i) => check(`wins[${i}]`, w));
  narration.problems.forEach((p, i) => {
    check(`problems[${i}].text`, p.text);
    check(`problems[${i}].fix`, p.fix);
    // p.fix_minutes deliberately not checked — see above.
  });
  check('top_finding_comment', narration.top_finding_comment);
  narration.tomorrow_focus.forEach((f, i) => check(`tomorrow_focus[${i}]`, f));

  return { ok: violations.length === 0, violations };
}

/** Shape check before the number check — a malformed object fails faster. */
export function parseNarration(raw: unknown): Narration | null {
  const n = raw as Partial<Narration>;
  if (!n || typeof n !== 'object') return null;
  if (typeof n.headline !== 'string' || typeof n.top_finding_comment !== 'string') return null;
  if (!Array.isArray(n.wins) || !Array.isArray(n.problems) || !Array.isArray(n.tomorrow_focus)) {
    return null;
  }
  const problems: Problem[] = [];
  for (const p of n.problems as Partial<Problem>[]) {
    if (typeof p?.text !== 'string' || typeof p?.fix !== 'string') return null;
    problems.push({
      text: p.text,
      fix: p.fix,
      fix_minutes: Math.max(1, Math.min(600, Math.round(Number(p.fix_minutes) || 5))),
    });
  }
  return {
    headline: n.headline.slice(0, 80),
    wins: (n.wins as string[]).filter((w) => typeof w === 'string').slice(0, 3),
    problems: problems.slice(0, 3),
    top_finding_comment: n.top_finding_comment,
    tomorrow_focus: (n.tomorrow_focus as string[]).filter((f) => typeof f === 'string').slice(0, 3),
  };
}

/* -------------------------------------------------------------- fallback */

/**
 * The report the System writes when the model cannot be trusted or reached.
 *
 * Deliberately plain. It states what happened and nothing else — a fallback
 * that tried to sound like the real thing would hide the fact that narration
 * failed, which is itself worth knowing.
 */
export function fallbackNarration(facts: Facts, anomalies: Anomaly[]): Narration {
  const t = facts.today;
  const wins: string[] = [];
  if (t && t.quests_done > 0) wins.push(`${t.quests_done} quests cleared.`);
  if (t && t.xp_gained > 0) wins.push(`${t.xp_gained} XP gained.`);
  if (t && t.streak > 0) wins.push(`Streak holding at ${t.streak}.`);

  const problems: Problem[] = anomalies
    .filter((a) => a.severity !== 'info')
    .slice(0, 3)
    .map((a) => ({
      text: a.evidence,
      fix: FALLBACK_FIX[a.code] ?? 'Open the app and look at it.',
      fix_minutes: 5,
    }));

  return {
    headline: 'Report generated without narration.',
    wins,
    problems,
    top_finding_comment:
      facts.findings.top.length > 0
        ? `Top finding: ${facts.findings.top[0].title}.`
        : 'No findings to comment on.',
    tomorrow_focus: t?.mandatory_missed.slice(0, 3) ?? [],
  };
}

const FALLBACK_FIX: Record<string, string> = {
  agent_failed: 'Check the agent_runs table for the error.',
  scout_missing_today: 'Open the Goal tab and send Beru out.',
  usage_over_80pct: 'Leave the shadows alone until the cap resets.',
  planned_completion_under_50pct: 'Shorten tomorrow’s plan.',
  quests_done_falling_3_days: 'Drop one quest from the board.',
};

/* ---------------------------------------------------------------- render */

export interface Email {
  subject: string;
  html: string;
  text: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The email.
 *
 * Inline CSS only and a 600px table, because mail clients strip stylesheets
 * and ignore most modern layout. Palette per the README: near-black ground,
 * warm cream text, and the orange used on exactly two things — the headline
 * rule and the level — so it stays a highlight rather than decoration.
 */
export function renderEmail(facts: Facts, n: Narration, anomalies: Anomaly[]): Email {
  const t = facts.today;
  const level = t?.level ?? 0;
  const done = t?.quests_done ?? 0;
  const total = t?.quests_total ?? 0;

  const alert = hasCritical(anomalies) ? '[ALERT] ' : '';
  const subject = `${alert}[System] Daily Report | Lv ${level} | ${done}/${total}`;

  const BG = '#0A0A0B';
  const SURFACE = '#17171A';
  const TEXT = '#F3EDE3';
  const MUTED = '#8C8C93';
  const ACCENT = '#FF6A00';

  const section = (title: string, body: string): string =>
    `<tr><td style="padding:20px 24px 0 24px;">
       <div style="font:600 11px/1.4 Arial,sans-serif;letter-spacing:2px;color:${MUTED};text-transform:uppercase;">${esc(title)}</div>
       <div style="margin-top:8px;">${body}</div>
     </td></tr>`;

  const list = (items: string[]): string =>
    items.length === 0
      ? `<div style="font:400 14px/1.5 Arial,sans-serif;color:${MUTED};">None.</div>`
      : items
          .map(
            (i) =>
              `<div style="font:400 14px/1.5 Arial,sans-serif;color:${TEXT};padding:3px 0;">• ${esc(i)}</div>`,
          )
          .join('');

  const problems =
    n.problems.length === 0
      ? `<div style="font:400 14px/1.5 Arial,sans-serif;color:${MUTED};">Nothing to fix.</div>`
      : n.problems
          .map(
            (p) =>
              `<div style="background:${SURFACE};border-radius:12px;padding:12px 14px;margin:8px 0;">
                 <div style="font:400 14px/1.5 Arial,sans-serif;color:${TEXT};">${esc(p.text)}</div>
                 <div style="font:400 13px/1.5 Arial,sans-serif;color:${MUTED};margin-top:6px;">Fix (${p.fix_minutes} min): ${esc(p.fix)}</div>
               </div>`,
          )
          .join('');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${BG};border:1px solid #232327;border-radius:16px;">

  <tr><td style="padding:24px 24px 0 24px;">
    <div style="font:600 10px/1.4 Arial,sans-serif;letter-spacing:3px;color:${ACCENT};text-transform:uppercase;">&#9670; Daily Report &#9670;</div>
    <div style="font:700 24px/1.25 Arial,sans-serif;color:${TEXT};margin-top:10px;">${esc(n.headline)}</div>
    <div style="font:400 12px/1.4 Arial,sans-serif;color:${MUTED};margin-top:8px;">${esc(facts.date)}${facts.goal ? ` &middot; ${esc(facts.goal)}` : ''}</div>
  </td></tr>

  <tr><td style="padding:18px 24px 0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background:${ACCENT};border-radius:12px;padding:12px 16px;" width="33%">
          <div style="font:700 10px/1.2 Arial,sans-serif;letter-spacing:1.5px;color:${BG};">LEVEL</div>
          <div style="font:700 28px/1.1 Arial,sans-serif;color:${BG};">${level}</div>
        </td>
        <td width="8"></td>
        <td style="background:${SURFACE};border-radius:12px;padding:12px 16px;" width="33%">
          <div style="font:700 10px/1.2 Arial,sans-serif;letter-spacing:1.5px;color:${MUTED};">QUESTS</div>
          <div style="font:700 28px/1.1 Arial,sans-serif;color:${TEXT};">${done}/${total}</div>
        </td>
        <td width="8"></td>
        <td style="background:${SURFACE};border-radius:12px;padding:12px 16px;" width="33%">
          <div style="font:700 10px/1.2 Arial,sans-serif;letter-spacing:1.5px;color:${MUTED};">STREAK</div>
          <div style="font:700 28px/1.1 Arial,sans-serif;color:${TEXT};">${t?.streak ?? 0}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  ${section('Wins', list(n.wins))}
  ${section('Problems', problems)}
  ${section('On the top finding', `<div style="font:400 14px/1.5 Arial,sans-serif;color:${TEXT};">${esc(n.top_finding_comment)}</div>`)}
  ${section('Tomorrow', list(n.tomorrow_focus))}

  <tr><td style="padding:20px 24px 24px 24px;">
    <div style="border-top:1px solid #232327;padding-top:12px;font:400 11px/1.6 Arial,sans-serif;color:${MUTED};">
      ${facts.derived.total_runs} agent runs &middot; ${facts.derived.total_failed} failed &middot;
      ${facts.usage.calls_today}/${facts.usage.cap} calls &middot; $${facts.derived.total_cost_usd}
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    `[System] Daily Report — ${facts.date}`,
    n.headline,
    '',
    `Level ${level} · Quests ${done}/${total} · Streak ${t?.streak ?? 0}`,
    '',
    'WINS',
    ...(n.wins.length ? n.wins.map((w) => `  - ${w}`) : ['  None.']),
    '',
    'PROBLEMS',
    ...(n.problems.length
      ? n.problems.map((p) => `  - ${p.text}\n    Fix (${p.fix_minutes} min): ${p.fix}`)
      : ['  Nothing to fix.']),
    '',
    'TOP FINDING',
    `  ${n.top_finding_comment}`,
    '',
    'TOMORROW',
    ...(n.tomorrow_focus.length ? n.tomorrow_focus.map((f) => `  - ${f}`) : ['  Nothing set.']),
    '',
    `${facts.derived.total_runs} agent runs, ${facts.derived.total_failed} failed, ` +
      `${facts.usage.calls_today}/${facts.usage.cap} calls, $${facts.derived.total_cost_usd}`,
  ].join('\n');

  return { subject, html, text };
}
