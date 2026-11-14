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

/**
 * Everything the profile and the documents say, for the prompt of a given day.
 *
 * `db` must be the caller's own client (see `caller()` in agent.ts): the row
 * rules hand back their profile row and their documents, and nobody else's.
 */
export async function loadProfile(db: SupabaseClient, date: string): Promise<ProfileKnowledge> {
  const [profileRes, docsRes] = await Promise.all([
    db.from('life_profile').select('data').maybeSingle(),
    db
      .from('profile_documents')
      .select('name, kind, summary, weekly, dates, notes')
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
    notesBlock(docs),
  ]
    .filter(Boolean)
    .join('\n');

  return { data, text, timetable, empty };
}

/* ------------------------------------------------------- the file library */

/**
 * What the Player can teach Beerus with, by the type the browser reports:
 * documents and photos, plain text, and voice memos. These are the inputs
 * Gemini 4 Hydrogen reads (text, image, audio, PDF). A Word or Pages file
 * is not among them: save it as a PDF first.
 */
export const LIBRARY_TYPES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/heic': 'image/heic',
  'image/heif': 'image/heif',
  'text/plain': 'text/plain',
  'text/markdown': 'text/md',
  'text/x-markdown': 'text/md',
  'text/csv': 'text/csv',
  'text/html': 'text/html',
  'application/json': 'text/plain',
  'audio/mpeg': 'audio/mp3',
  'audio/mp3': 'audio/mp3',
  'audio/mp4': 'audio/mp4',
  'audio/m4a': 'audio/m4a',
  'audio/x-m4a': 'audio/m4a',
  'audio/aac': 'audio/aac',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/webm': 'audio/webm',
  'audio/ogg': 'audio/ogg',
};

/** The type to hand Gemini for a file, or null when it cannot read it. */
export function libraryType(reported: string): string | null {
  return LIBRARY_TYPES[reported.split(';')[0].trim().toLowerCase()] ?? null;
}

/** The largest file the library takes (the storage bucket's limit too). */
export const MAX_LIBRARY_BYTES = 20 * 1024 * 1024;

/** Bytes to base64 without blowing the call stack on a big file. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * The Player's original files, newest first, inline for one model call,
 * until `maxBytes` is reached: a request to Gemini must stay under 20 MB
 * with the prompt. Read through the caller's own client, so the storage
 * rules hand back only their files.
 */
export async function loadLibrary(
  db: SupabaseClient,
  maxBytes: number,
): Promise<{ files: { mimeType: string; data: string }[]; names: string[] }> {
  const { data: docs } = await db
    .from('profile_documents')
    .select('name, storage_path, mime_type, size_bytes')
    .is('archived_at', null)
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);
  const files: { mimeType: string; data: string }[] = [];
  const names: string[] = [];
  let used = 0;
  for (const d of docs ?? []) {
    const type = libraryType(String(d.mime_type ?? ''));
    const size = Number(d.size_bytes ?? 0);
    if (!type || !d.storage_path || used + size > maxBytes) continue;
    const { data: blob, error } = await db.storage.from('knowledge').download(String(d.storage_path));
    if (error || !blob) {
      console.warn('library file unreadable', error?.message);
      continue;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (used + bytes.length > maxBytes) continue;
    used += bytes.length;
    files.push({ mimeType: type, data: bytesToBase64(bytes) });
    names.push(String(d.name ?? 'file').slice(0, 60));
  }
  return { files, names };
}

/**
 * How much of Beerus's notes on the Player's files goes into every prompt,
 * newest file first. Hydrogen's window is far bigger; this keeps each
 * message cheap. Anything past it is still in the files, which recall reads
 * whole when a question needs them.
 */
export const NOTES_IN_PROMPT = 24_000;

/** What the Player's files say about them, in Beerus's words, within NOTES_IN_PROMPT. */
function notesBlock(docs: { name?: unknown; notes?: unknown }[]): string {
  let left = NOTES_IN_PROMPT;
  const parts: string[] = [];
  for (const d of docs) {
    const notes = typeof d.notes === 'string' ? d.notes.trim() : '';
    if (!notes || left <= 200) continue;
    const piece = notes.slice(0, left);
    left -= piece.length;
    parts.push(`From "${String(d.name).slice(0, 60)}":\n${piece}`);
  }
  return parts.length ? `WHAT THEIR FILES SAY (your notes from reading them):\n${parts.join('\n\n')}` : '';
}
