/**
 * What Beru is told before it searches.
 *
 * Without this, Beru knew only the goal's title: it searched at no level, in
 * no country, and kept bringing back the same pages because it could not see
 * what was already on file. The brief gives it the deadline, the parts of the
 * life profile that decide which material fits, what the System remembers
 * about the goal, and what Igris and the student already made of earlier
 * finds.
 *
 * Pure: `npx tsx scratch/beru-check.ts` tests it.
 */

import { CATALOG, type LifeProfile } from '../_shared/profile.ts';
import { isGroundingRedirect } from './sources.ts';

/**
 * Profile fields that change which material is right: level, country,
 * language, kit, what the student studies or works at. Nothing about who
 * they live with, money, health or what derails them goes to a search.
 */
const SCOUT_FIELDS: [section: string, field: string][] = [
  ['basics', 'location'],
  ['basics', 'languages'],
  ['studies', 'program'],
  ['studies', 'school'],
  ['studies', 'year'],
  ['studies', 'subjects'],
  ['studies', 'exams'],
  ['studies', 'methods'],
  ['career', 'job'],
  ['career', 'goal'],
  ['career', 'skills'],
  ['fitness', 'training'],
  ['fitness', 'level'],
  ['fitness', 'activities'],
  ['fitness', 'access'],
  ['food', 'diet'],
  ['food', 'cooking'],
  ['drive', 'interests'],
];

/** How many earlier finds Beru is shown. The newest matter most. */
const MAX_ON_FILE = 30;
const MAX_MEMORIES = 8;

export interface BriefGoal {
  title: string;
  deadline: string | null;
}

export interface BriefMemory {
  kind: string;
  content: string;
}

export interface BriefFinding {
  title: string;
  url: string | null;
  verdict: string | null;
  rank: string | null;
  read_at: string | null;
}

function oneLine(v: string, max: number): string {
  return v.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "reddit.com" from a page's address; nothing for a redirect, which names Google. */
export function domainOf(url: string | null): string {
  if (!url || isGroundingRedirect(url)) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Whole days from `today` to `deadline`, both "YYYY-MM-DD". Null if either is unreadable. */
export function daysUntil(deadline: string | null, today: string): number | null {
  if (!deadline) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${deadline}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function profileLines(profile: LifeProfile): string[] {
  const lines: string[] = [];
  for (const [section, field] of SCOUT_FIELDS) {
    const value = profile[section]?.[field];
    const label = CATALOG[section]?.fields[field];
    if (value && label) lines.push(`- ${label}: ${oneLine(value, 200)}`);
  }
  return lines;
}

/** The search call's prompt. */
export function buildBrief(input: {
  goal: BriefGoal;
  today: string;
  profile: LifeProfile;
  memories: BriefMemory[];
  findings: BriefFinding[];
}): string {
  const { goal, today, profile } = input;
  const parts: string[] = [`The goal is: ${oneLine(goal.title, 160)}`];

  const days = daysUntil(goal.deadline, today);
  if (goal.deadline && days !== null) {
    parts.push(
      days >= 0
        ? `Deadline: ${goal.deadline} (${days} day${days === 1 ? '' : 's'} away). Favour what can be used in that time.`
        : `Deadline: ${goal.deadline}, already passed. The student is still on it; favour what helps them finish fast.`,
    );
  }

  const about = profileLines(profile);
  if (about.length) {
    parts.push(
      `About the student. Use this to aim at the right level, country, language and kit. Never search for the student themselves.\n${about.join('\n')}`,
    );
  }

  const memories = input.memories
    .map((m) => ({ kind: oneLine(m.kind, 20), content: oneLine(m.content, 280) }))
    .filter((m) => m.content)
    .slice(0, MAX_MEMORIES);
  if (memories.length) {
    parts.push(`What the System knows that bears on this:\n${memories.map((m) => `- (${m.kind}) ${m.content}`).join('\n')}`);
  }

  const onFile = input.findings.filter((f) => f.title).slice(0, MAX_ON_FILE);
  if (onFile.length) {
    const line = (f: BriefFinding) => {
      const domain = domainOf(f.url);
      const ruling = f.verdict ? ` (Igris: ${f.verdict}${f.rank ? `, rank ${f.rank}` : ''})` : '';
      return `- ${oneLine(f.title, 160)}${domain ? ` — ${domain}` : ''}${ruling}`;
    };
    parts.push(`Already on file. Do not bring any of these back; find different things:\n${onFile.map(line).join('\n')}`);

    const finished = onFile.filter((f) => f.read_at);
    if (finished.length) {
      parts.push(
        `The student has finished: ${finished.map((f) => oneLine(f.title, 80)).join('; ')}. Look for the next step beyond these, not more of the same level.`,
      );
    }
    const skipped = onFile.filter((f) => f.verdict === 'skip');
    if (skipped.length) {
      parts.push(`Igris ruled these not worth the time: ${skipped.map((f) => oneLine(f.title, 80)).join('; ')}. Avoid more like them.`);
    }
  }

  parts.push('Search, open the best pages and read them, then report what you find.');
  return parts.join('\n\n');
}
