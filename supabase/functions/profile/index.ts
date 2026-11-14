/**
 * profile — the Player's life profile, and the documents they hand over.
 *
 * Ops:
 *   get       — the profile and the documents
 *   set       — save fields: [{section, field, value}] (only catalogue
 *               fields, cleaned; with onlyEmpty, never overwrites)
 *   document  — read a file the Player gave Beerus to learn from: a class
 *               timetable, a syllabus, a CV, notes, a journal page, a photo,
 *               a voice memo. Beerus's model (Gemini 4 Hydrogen unless the
 *               Player picked another) pulls out the weekly blocks, the
 *               dates, profile facts and detailed notes on what the file
 *               says about the Player; the notes go into every prompt from
 *               then on. A file sent by its storage path (the app uploads
 *               it to the private `knowledge` bucket first) is kept there,
 *               so recall can read it whole later; one sent inline is not
 *               kept. Profile facts come back to the app, which applies them
 *               with Undo.
 *   forget    — archive a document, and delete its kept file
 *
 * The model proposes; code decides: every field is checked against the
 * catalogue, every block's day and times are checked before they are stored.
 */

import { caller, claimCalls, fail, finishRun, gemini, json, MODEL, parseJson, preflight, startRun } from '../_shared/agent.ts';
import { modelsForRole } from '../_shared/models.ts';
import {
  bytesToBase64,
  CATALOG,
  cleanValue,
  isField,
  libraryType,
  MAX_LIBRARY_BYTES,
  sanitize,
  type LifeProfile,
  type WeeklyBlock,
} from '../_shared/profile.ts';
import { settingsOf } from '../_shared/system.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

/** About 4 MB of file, base64-encoded: a file sent inline. Bigger files go through storage. */
const MAX_DOCUMENT_B64 = 5_600_000;
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const PROFILE_KEYS = Object.entries(CATALOG)
  .flatMap(([section, def]) => Object.entries(def.fields).map(([f, label]) => `${section}.${f} (${label})`))
  .join(', ');

const READ_SYSTEM = `You read a file the Player gave Beerus, their personal assistant, so he can get to know them: a class timetable, a syllabus, an exam schedule, a work rota, a CV, notes, a journal page, a photo or a voice memo.
Extract only what is actually in the file. Never invent times, dates, courses or facts.
- kind: "timetable", "exam_schedule", "syllabus", "work_rota", "personal" (about the Player themselves: a CV, a journal, notes on their life) or "other".
- title: a short name for it.
- summary: one or two plain sentences on what it is and what matters in it for planning their weeks.
- weekly: every recurring weekly block: day ("mon".."sun"), start and end ("HH:MM", 24-hour), title (the course or shift, short), place (room or location, if given). A block that runs on several days is listed once per day.
- dates: one-off dated items (exams, deadlines, events): date "YYYY-MM-DD" and a short title. If the year is not written, use the next occurrence after today.
- facts: what the document tells you about the student's life, as profile fields: section and field from this list, and a short value in third person. Fields: ${PROFILE_KEYS}. Only facts the document clearly supports (for example studies.program, studies.school, studies.subjects, studies.exams, career.hours). At most 6.
- notes: everything in the file that would help Beerus know the Player and plan their days, written as short plain lines in third person, up to about 4000 characters. Keep specifics exact: names of courses, people (name and role only), places, dates, times, numbers, goals, likes and dislikes. For a timetable, every course and when; for a CV, education, jobs and skills; for a journal or a voice memo, what matters to them. Leave out passwords, codes, long numbers and health or medical details.`;

const READ_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['timetable', 'exam_schedule', 'syllabus', 'work_rota', 'personal', 'other'] },
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
    notes: { type: 'string' },
  },
  required: ['kind', 'title', 'summary', 'weekly', 'dates', 'facts', 'notes'],
  propertyOrdering: ['kind', 'title', 'summary', 'weekly', 'dates', 'facts', 'notes'],
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

/** The caller's profile row; `db` is their own client, so it is the only one it can see. */
async function readProfile(db: SupabaseClient): Promise<LifeProfile> {
  const { data } = await db.from('life_profile').select('data').maybeSingle();
  return sanitize(data?.data);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const early = preflight(req);
  if (early) return early;

  // The signed-in account. `db` reaches only their rows; `sys` is for the
  // shared daily budget alone.
  const who = await caller(req);
  if (who instanceof Response) return who;
  const { db, sys, userId } = who;

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
        .select('id, name, kind, summary, weekly, dates, notes, mime_type, storage_path, created_at')
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    return json({
      profile,
      documents: (docs.data ?? []).map(({ storage_path, mime_type, ...d }) => ({
        ...d,
        notes: d.notes ?? '',
        mimeType: mime_type ?? null,
        kept: Boolean(storage_path),
        createdAt: d.created_at,
      })),
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
        .upsert({ user_id: userId, data: profile, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
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
    const { data: doc } = await db.from('profile_documents').select('storage_path').eq('id', id).maybeSingle();
    const { error } = await db.from('profile_documents').update({ archived_at: new Date().toISOString() }).eq('id', id);
    if (error) return fail('The System could not remove that document.', 500);
    // Forgetting a file deletes the kept copy too: Beerus cannot look in it again.
    if (doc?.storage_path) {
      const { error: removeError } = await db.storage.from('knowledge').remove([String(doc.storage_path)]);
      if (removeError) console.error('kept file not deleted', removeError.message);
      await db.from('profile_documents').update({ storage_path: null }).eq('id', id);
    }
    return json({ ok: true });
  }

  /* ----------------------------------------------------------- document */
  if (body.op === 'document') {
    const reported = str(body.mimeType, 60).toLowerCase();
    const mimeType = libraryType(reported);
    const name = str(body.name, 80) || 'Document';
    const today = /^\d{4}-\d{2}-\d{2}$/.test(str(body.today, 10)) ? str(body.today, 10) : new Date().toISOString().slice(0, 10);
    if (!mimeType) {
      return fail('Beerus reads PDFs, photos, text files and voice memos. Save a Word or Pages file as a PDF first.', 400);
    }

    // Either kept in the Player's own folder of the private bucket (the app
    // uploaded it there) or sent inline (older apps, small files).
    const path = str(body.path, 300);
    let data = '';
    let size = 0;
    if (path) {
      if (!path.startsWith(`${userId}/`) || path.includes('..')) return fail('That file is not yours to read.', 403);
      const { data: blob, error: downloadError } = await db.storage.from('knowledge').download(path);
      if (downloadError || !blob) return fail('Beerus could not open the uploaded file. Try again.', 404);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      size = bytes.length;
      if (size < 20) return fail('That file was empty.', 400);
      if (size > MAX_LIBRARY_BYTES) return fail('That file is too big. Keep it under 20 MB.', 413);
      data = bytesToBase64(bytes);
    } else {
      data = typeof body.data === 'string' ? body.data : '';
      if (data.length < 100) return fail('That file was empty.', 400);
      if (data.length > MAX_DOCUMENT_B64) return fail('That file is too big. Keep it under 4 MB.', 413);
      if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 2000))) return fail('That file was not readable.', 400);
      size = Math.floor((data.length * 3) / 4);
    }

    // Reading a document is a model call: it draws on the shadows' budget.
    const claim = await claimCalls(sys, 1);
    if (!claim.ok) return claim.response;

    const settings = await settingsOf(db);
    const runId = await startRun(db, 'profile-document');
    const result = await gemini({
      system: READ_SYSTEM,
      prompt: `Today is ${today}. The file is called "${name}". Read it.`,
      file: { mimeType, data },
      schema: READ_SCHEMA,
      // Beerus reads his own files: the Player's pick (Hydrogen by default).
      models: modelsForRole('beerus', settings.models, (n) => Deno.env.get(n)),
      budgetMs: 90_000,
    });
    const spend = { usage: result.usage, durationMs: result.durationMs, model: result.modelVersion ?? MODEL };
    if (!result.ok || !result.text) {
      await finishRun(db, runId, 'error', null, result.error ?? 'reading failed', spend);
      return fail('Beerus could not read that file. Try a clearer photo, or the PDF.', 502);
    }

    const out = parseJson<Record<string, unknown>>(result.text) ?? {};
    const weekly = cleanWeekly(out.weekly);
    const dates = cleanDates(out.dates);
    const facts = (Array.isArray(out.facts) ? out.facts : [])
      .slice(0, 6)
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ section: str(x.section, 30), field: str(x.field, 30), value: cleanValue(x.value) ?? '' }))
      .filter((x) => isField(x.section, x.field) && x.value);
    const kinds = ['timetable', 'exam_schedule', 'syllabus', 'work_rota', 'personal'];
    const kind = kinds.includes(str(out.kind, 20)) ? str(out.kind, 20) : 'other';
    const summary = str(out.summary, 400);
    const title = str(out.title, 80) || name;
    // Line breaks kept: the notes read as a list in the prompt.
    const notes = typeof out.notes === 'string' ? out.notes.replace(/\r/g, '').trim().slice(0, 8000) : '';

    const { data: saved, error } = await db
      .from('profile_documents')
      .insert({
        name: title,
        kind,
        summary,
        weekly,
        dates,
        notes,
        storage_path: path || null,
        mime_type: reported.split(';')[0],
        size_bytes: size,
      })
      .select('id, name, kind, summary, weekly, dates, notes, created_at')
      .single();
    if (error || !saved) {
      await finishRun(db, runId, 'error', null, error?.message ?? 'store failed', spend);
      return fail('Beerus read it but could not store it.', 500);
    }
    await finishRun(db, runId, 'ok', `${kind}: ${weekly.length} weekly blocks, ${dates.length} dates, ${notes.length} chars of notes`, null, spend);

    // The facts go back to the app, which applies them with Undo.
    return json({ document: { ...saved, kept: Boolean(path), createdAt: saved.created_at }, facts });
  }

  return fail('Unknown operation.', 400);
});
