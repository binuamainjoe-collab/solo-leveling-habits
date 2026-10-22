/**
 * The life profile on the server: the catalogue of what it holds, the check
 * every write goes through, and how it reads to the model.
 *
 * The same catalogue is in the app (src/data/lifeProfile.ts); the check in
 * scratch/profile-check.ts fails if they drift apart.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

/** section -> field -> label. The app holds the interview questions. */
export const CATALOG: Record<string, { label: string; fields: Record<string, string> }> = {
  basics: { label: 'About you', fields: { name: 'Name', age: 'Age', location: 'Where you live', languages: 'Languages' } },
  studies: {
    label: 'Studies',
    fields: {
      program: 'What you study',
      school: 'Where',
      year: 'Year or semester',
      subjects: 'Current subjects',
      exams: 'Exams and deadlines',
      methods: 'How you study',
    },
  },
  career: { label: 'Work and career', fields: { job: 'Job', hours: 'Work hours', goal: 'Career goal', skills: 'Skills you are building' } },
  routine: {
    label: 'Daily routine',
    fields: {
      wake: 'Usual wake time',
      sleep: 'Usual bedtime',
      weekday: 'A normal weekday',
      weekend: 'A normal weekend',
      commute: 'Commute',
      best_hours: 'Best hours',
    },
  },
  fitness: { label: 'Training', fields: { training: 'Goal', level: 'Level', activities: 'What you do', access: 'Gym and equipment' } },
  food: { label: 'Food', fields: { diet: 'How you eat', cooking: 'Cooking', preferences: 'Preferences' } },
  habits: { label: 'Habits', fields: { build: 'Habits to build', break: 'Habits to break' } },
  people: { label: 'People', fields: { living: 'Who you live with', close: 'Important people' } },
  money: { label: 'Money', fields: { situation: 'Situation', goal: 'Money goal' } },
  drive: { label: 'What drives you', fields: { motivation: 'What motivates you', interests: 'Interests', rewards: 'Rewards that work' } },
  struggles: { label: 'What gets in the way', fields: { derailers: 'What derails you', avoid: 'What you put off', notes: 'Anything else' } },
};

export const MAX_VALUE = 400;

const NEVER_STORE =
  /password|passcode|api[ _-]?key|secret|token|\b\d{9,}\b|\b(diagnos\w*|medicat\w*|prescri\w*|therap\w*|disorder|dosage|symptom\w*)\b/i;

export type LifeProfile = Record<string, Record<string, string>>;

export function cleanValue(raw: unknown): string | null {
  const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE) : '';
  return NEVER_STORE.test(value) ? null : value;
}

export function isField(section: string, field: string): boolean {
  return Boolean(CATALOG[section]?.fields[field]);
}

/** Keep only catalogue fields with clean values: whatever is stored is readable. */
export function sanitize(raw: unknown): LifeProfile {
  const out: LifeProfile = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [section, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!CATALOG[section] || !fields || typeof fields !== 'object') continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (!isField(section, field)) continue;
      const v = cleanValue(value);
      if (v) (out[section] ??= {})[field] = v;
    }
  }
  return out;
}

export interface WeeklyBlock {
  day: string;
  start: string;
  end: string;
  title: string;
  place?: string;
}

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** "2026-10-22" → "thu". */
export function dayKey(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : DAYS[d.getUTCDay()];
}

export interface ProfileKnowledge {
  data: LifeProfile;
  /** The profile, the documents and the day's timetable, ready for a prompt. */
  text: string;
  /** Timetable blocks for the given day, as fixed lines ("09:00–10:30 Statistics lecture"). */
  timetable: string[];
  empty: string[];
}

/** Everything the profile and the documents say, for the prompt of a given day. */
export async function loadProfile(db: SupabaseClient, date: string): Promise<ProfileKnowledge> {
  const [profileRes, docsRes] = await Promise.all([
    db.from('life_profile').select('data').eq('id', 'me').maybeSingle(),
    db
      .from('profile_documents')
      .select('name, kind, summary, weekly, dates')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(12),
  ]);
  const data = sanitize(profileRes.data?.data);
  const docs = docsRes.data ?? [];
  const day = dayKey(date);

  const timetable = docs
    .flatMap((d) => (Array.isArray(d.weekly) ? (d.weekly as WeeklyBlock[]) : []))
    .filter((b) => b && b.day === day && /^\d{2}:\d{2}$/.test(b.start) && /^\d{2}:\d{2}$/.test(b.end))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 12)
    .map((b) => `${b.start}–${b.end} ${String(b.title).slice(0, 60)}${b.place ? ` (${String(b.place).slice(0, 30)})` : ''}`);

  const upcoming = docs
    .flatMap((d) => (Array.isArray(d.dates) ? (d.dates as { date: string; title: string }[]) : []))
    .filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((x) => `${x.date} ${String(x.title).slice(0, 80)}`);

  const lines: string[] = [];
  for (const [section, def] of Object.entries(CATALOG)) {
    const filled = Object.entries(def.fields).filter(([f]) => data[section]?.[f]);
    if (!filled.length) continue;
    lines.push(`${def.label}:`);
    for (const [f, label] of filled) lines.push(`  ${section}.${f} — ${label}: ${data[section][f]}`);
  }
  const empty = Object.entries(CATALOG).flatMap(([section, def]) =>
    Object.keys(def.fields)
      .filter((f) => !data[section]?.[f])
      .map((f) => `${section}.${f}`),
  );

  const text = [
    'PROFILE (who the Player is; use it in everything you say and plan):',
    lines.length ? lines.join('\n') : '  nothing yet',
    docs.length
      ? `DOCUMENTS the Player uploaded:\n${docs.map((d) => `  ${String(d.name).slice(0, 60)} (${d.kind}): ${String(d.summary).slice(0, 200)}`).join('\n')}`
      : '',
    timetable.length ? `TIMETABLE for this day (fixed, from their documents):\n${timetable.map((t) => `  ${t}`).join('\n')}` : '',
    upcoming.length ? `Upcoming dates from their documents:\n${upcoming.map((t) => `  ${t}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { data, text, timetable, empty };
}
