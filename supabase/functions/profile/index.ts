/**
 * profile — the Player's life profile, and the documents they hand over.
 *
 * Ops:
 *   get       — the profile and the documents
 *   set       — save fields: [{section, field, value}] (only catalogue
 *               fields, cleaned; with onlyEmpty, never overwrites)
 *   document  — read an uploaded PDF or photo (a class timetable, a
 *               syllabus, a work rota): Gemini pulls out the weekly blocks,
 *               the dates and what it says about the Player's life. The
 *               file is not kept; what was in it is. Profile facts come back
 *               to the app, which applies them with Undo.
 *   forget    — archive a document
 *
 * The model proposes; code decides: every field is checked against the
 * catalogue, every block's day and times are checked before they are stored.
 */

import { admin, checkSecret, fail, finishRun, gemini, json, MODEL, parseJson, preflight, startRun, claimCalls } from '../_shared/agent.ts';
import { CATALOG, cleanValue, isField, sanitize, type LifeProfile, type WeeklyBlock } from '../_shared/profile.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
/** About 4 MB of file, base64-encoded. */
const MAX_DOCUMENT_B64 = 5_600_000;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const PROFILE_KEYS = Object.entries(CATALOG)
  .flatMap(([section, def]) => Object.entries(def.fields).map(([f, label]) => `${section}.${f} (${label})`))
  .join(', ');

const READ_SYSTEM = `You read a document a student uploaded to their personal assistant: usually a class timetable, sometimes a syllabus, an exam schedule, a work rota or a photo of a planner.
Extract only what is actually in the document. Never invent times, dates or courses.
- kind: "timetable", "exam_schedule", "syllabus", "work_rota" or "other".
- title: a short name for it.
- summary: one or two plain sentences on what it is and what matters in it for planning their weeks.
- weekly: every recurring weekly block: day ("mon".."sun"), start and end ("HH:MM", 24-hour), title (the course or shift, short), place (room or location, if given). A block that runs on several days is listed once per day.
- dates: one-off dated items (exams, deadlines, events): date "YYYY-MM-DD" and a short title. If the year is not written, use the next occurrence after today.
- facts: what the document tells you about the student's life, as profile fields: section and field from this list, and a short value in third person. Fields: ${PROFILE_KEYS}. Only facts the document clearly supports (for example studies.program, studies.school, studies.subjects, studies.exams, career.hours). At most 6.`;

const READ_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['timetable', 'exam_schedule', 'syllabus', 'work_rota', 'other'] },
    title: { type: 'string' },
    summary: { type: 'string' },
    weekly: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          start: { type: 'string' },
          end: { type: 'string' },
          title: { type: 'string' },
          place: { type: 'string' },
        },
        required: ['day', 'start', 'end', 'title'],
        propertyOrdering: ['day', 'start', 'end', 'title', 'place'],
      },
    },
    dates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { date: { type: 'string' }, title: { type: 'string' } },
        required: ['date', 'title'],
        propertyOrdering: ['date', 'title'],
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { section: { type: 'string' }, field: { type: 'string' }, value: { type: 'string' } },
        required: ['section', 'field', 'value'],
        propertyOrdering: ['section', 'field', 'value'],
      },
    },
  },
  required: ['kind', 'title', 'summary', 'weekly', 'dates', 'facts'],
  propertyOrdering: ['kind', 'title', 'summary', 'weekly', 'dates', 'facts'],
};

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Only blocks a planner can trust: a real day, real times, start before end. */
function cleanWeekly(raw: unknown): WeeklyBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: WeeklyBlock[] = [];
  for (const item of raw.slice(0, 60)) {
    const b = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const day = str(b.day, 3).toLowerCase();
    const start = str(b.start, 5).padStart(5, '0');
    const end = str(b.end, 5).padStart(5, '0');
    const title = str(b.title, 60);
    if (!DAYS.includes(day) || !TIME.test(start) || !TIME.test(end) || !title) continue;
    if (toMinutes(end) <= toMinutes(start)) continue;
    const place = str(b.place, 40);
    out.push({ day, start, end, title, ...(place ? { place } : {}) });
  }
  return out;
}

function cleanDates(raw: unknown): { date: string; title: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 40)
    .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ date: str(x.date, 10), title: str(x.title, 80) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && !Number.isNaN(Date.parse(x.date)) && x.title);
}

async function readProfile(db: SupabaseClient): Promise<LifeProfile> {
  const { data } = await db.from('life_profile').select('data').eq('id', 'me').maybeSingle();
  return sanitize(data?.data);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req) ?? checkSecret(req);
  if (early) return early;

  const db = admin();
  if (!db) return fail('The System is not configured.', 500);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail('That request was not readable.', 400);
  }

  /* ---------------------------------------------------------------- get */
  if (body.op === 'get') {
    const [profile, docs] = await Promise.all([
      readProfile(db),
      db
        .from('profile_documents')
        .select('id, name, kind, summary, weekly, dates, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    return json({
      profile,
      documents: (docs.data ?? []).map((d) => ({ ...d, createdAt: d.created_at })),
    });
  }

  /* ---------------------------------------------------------------- set */
  if (body.op === 'set') {
    const fields = Array.isArray(body.fields) ? body.fields.slice(0, 40) : [];
    const onlyEmpty = body.onlyEmpty === true;
    const profile = await readProfile(db);
    let changed = 0;
    for (const item of fields) {
      const f = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
      const section = str(f.section, 30);
      const field = str(f.field, 30);
      if (!isField(section, field)) continue;
      const value = cleanValue(f.value);
      if (value === null) continue;
      if (onlyEmpty && profile[section]?.[field]) continue;
      if (value) (profile[section] ??= {})[field] = value;
      else if (profile[section]) {
        delete profile[section][field];
        if (Object.keys(profile[section]).length === 0) delete profile[section];
      }
      changed++;
    }
    if (changed > 0) {
      const { error } = await db
        .from('life_profile')
        .upsert({ id: 'me', data: profile, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) {
        console.error('profile save failed', error.message);
        return fail('The System could not save your profile.', 500);
      }
    }
    return json({ profile, changed });
  }

  /* ------------------------------------------------------------- forget */
  if (body.op === 'forget') {
    const id = str(body.id, 64);
    const { error } = await db.from('profile_documents').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (error) return fail('The System could not remove that document.', 500);
    return json({ ok: true });
  }

  /* ----------------------------------------------------------- document */
  if (body.op === 'document') {
    const mimeType = str(body.mimeType, 40).toLowerCase();
    const data = typeof body.data === 'string' ? body.data : '';
    const name = str(body.name, 80) || 'Document';
    const today = /^\d{4}-\d{2}-\d{2}$/.test(str(body.today, 10)) ? str(body.today, 10) : new Date().toISOString().slice(0, 10);
    if (!DOCUMENT_TYPES.includes(mimeType)) return fail('The System reads PDFs and photos (JPEG, PNG, WebP, HEIC).', 400);
    if (data.length < 100) return fail('That file was empty.', 400);
    if (data.length > MAX_DOCUMENT_B64) return fail('That file is too big. Keep it under 4 MB.', 413);
    if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 2000))) return fail('That file was not readable.', 400);

    // Reading a document is a model call: it draws on the shadows' budget.
    const claim = await claimCalls(db, 1);
    if (!claim.ok) return claim.response;

    const runId = await startRun(db, 'profile-document');
    const result = await gemini({
      system: READ_SYSTEM,
      prompt: `Today is ${today}. The file is called "${name}". Read it.`,
      file: { mimeType, data },
      schema: READ_SCHEMA,
      temperature: 0.1,
    });
    const spend = { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL };
    if (!result.ok || !result.text) {
      await finishRun(db, runId, 'error', null, result.error ?? 'reading failed', spend);
      return fail('The System could not read that document. Try a clearer photo or the PDF.', 502);
    }

    const out = parseJson<Record<string, unknown>>(result.text) ?? {};
    const weekly = cleanWeekly(out.weekly);
    const dates = cleanDates(out.dates);
    const facts = (Array.isArray(out.facts) ? out.facts : [])
      .slice(0, 6)
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ section: str(x.section, 30), field: str(x.field, 30), value: cleanValue(x.value) ?? '' }))
      .filter((x) => isField(x.section, x.field) && x.value);
    const kind = ['timetable', 'exam_schedule', 'syllabus', 'work_rota'].includes(str(out.kind, 20)) ? str(out.kind, 20) : 'other';
    const summary = str(out.summary, 400);
    const title = str(out.title, 80) || name;

    const { data: saved, error } = await db
      .from('profile_documents')
      .insert({ name: title, kind, summary, weekly, dates })
      .select('id, name, kind, summary, weekly, dates, created_at')
      .single();
    if (error || !saved) {
      await finishRun(db, runId, 'error', null, error?.message ?? 'store failed', spend);
      return fail('The System read it but could not store it.', 500);
    }
    await finishRun(db, runId, 'ok', `${kind}: ${weekly.length} weekly blocks, ${dates.length} dates`, null, spend);

    // The facts go back to the app, which applies them with Undo.
    return json({ document: { ...saved, createdAt: saved.created_at }, facts });
  }

  return fail('Unknown operation.', 400);
});
