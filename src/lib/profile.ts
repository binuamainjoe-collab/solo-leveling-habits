import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import {
  DOCUMENT_TYPES,
  findField,
  MAX_DOCUMENT_BYTES,
  MAX_INLINE_BYTES,
  valueOf,
  type LifeProfile,
  type ProfileDocument,
  type WeeklyBlock,
} from '@/data/lifeProfile';
import { callSystem, type AssistantResult } from '@/lib/assistant';
import { client } from '@/lib/supabase';

/**
 * The life profile on the server (supabase/functions/profile): read it,
 * save fields, hand over a document to be read.
 */

export interface ProfileFieldWrite {
  section: string;
  field: string;
  value: string;
}

export async function fetchLifeProfile(): Promise<AssistantResult<{ profile: LifeProfile; documents: ProfileDocument[] }>> {
  const res = await callSystem<{ profile?: unknown; documents?: unknown }>({ op: 'get' }, 'profile');
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return {
    ok: true,
    data: {
      profile: readProfile(res.data.profile),
      documents: Array.isArray(res.data.documents) ? res.data.documents.map(readDocument).filter((d): d is ProfileDocument => d !== null) : [],
    },
  };
}

/**
 * Save fields. With `onlyEmpty`, a field that already says something is
 * left alone — used to seed the profile from the onboarding answers without
 * ever overwriting what the Player or The System wrote since.
 */
export async function saveProfileFields(
  fields: ProfileFieldWrite[],
  onlyEmpty = false,
): Promise<AssistantResult<LifeProfile>> {
  if (fields.length === 0) return { ok: true };
  const res = await callSystem<{ profile?: unknown }>({ op: 'set', fields, onlyEmpty }, 'profile');
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return { ok: true, data: readProfile(res.data.profile) };
}

/** Archive a document: The System stops using it. */
export async function forgetDocument(id: string): Promise<AssistantResult<unknown>> {
  return callSystem({ op: 'forget', id }, 'profile');
}

/**
 * Hand a PDF or photo to The System to read. Returns what it found, and
 * the profile facts it suggests — which the caller applies with Undo.
 */
export async function readDocumentFile(file: {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
  today: string;
}): Promise<AssistantResult<{ document: ProfileDocument; facts: ProfileFieldWrite[] }>> {
  // Kept first: into the Player's own folder of the private bucket, so
  // Beerus can read it whole again later (recall). If that fails, a small
  // file still goes inline and is read once.
  const path = await keepFile(file);
  let body: Record<string, unknown>;
  if (path) {
    body = { op: 'document', name: file.name, mimeType: file.mimeType, path, today: file.today };
  } else {
    if (file.size && file.size > MAX_INLINE_BYTES) {
      return { ok: false, error: 'That file could not be uploaded, and it is too big to send directly. Try again, or use a file under 4 MB.' };
    }
    let data: string;
    try {
      data = await base64Of(file.uri);
    } catch {
      return { ok: false, error: 'The file could not be read on this device.' };
    }
    body = { op: 'document', name: file.name, mimeType: file.mimeType, data, today: file.today };
  }
  // A long PDF or a voice memo takes Beerus a while to read.
  const res = await callSystem<{ document?: unknown; facts?: unknown }>(body, 'profile', 120_000);
  if (!res.ok || !res.data) {
    // Nothing points at a file that was never read: delete the kept copy.
    if (path && client) void client.storage.from('knowledge').remove([path]);
    return { ok: false, error: res.error };
  }
  const document = readDocument(res.data.document);
  if (!document) return { ok: false, error: 'Beerus read it, but the answer was not usable.' };
  const facts = Array.isArray(res.data.facts)
    ? (res.data.facts as Record<string, unknown>[])
        .filter((f) => typeof f?.section === 'string' && typeof f?.field === 'string' && typeof f?.value === 'string')
        .map((f) => ({ section: f.section as string, field: f.field as string, value: f.value as string }))
    : [];
  return { ok: true, data: { document, facts } };
}

export interface DocumentImport {
  document: ProfileDocument;
  /** What changed in the profile, as people read it: "What you study: BSc Computer Science". */
  changed: string[];
  /** Writing these puts the profile back the way it was. */
  undo: ProfileFieldWrite[];
  /** The profile after the import. */
  profile: LifeProfile;
}

/**
 * Pick a PDF or photo, have it read, and put what it says about the Player
 * into the profile. The same steps whether it starts on the Profile screen
 * or from Beerus's Attach button. Resolves to null when the picker was
 * closed without a file.
 */
export async function pickAndImportDocument(profile: LifeProfile, today: string): Promise<AssistantResult<DocumentImport> | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: DOCUMENT_TYPES, copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const file = picked.assets[0];
  if (file.size && file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: 'That file is too big. Keep it under 20 MB.' };
  }
  const mimeType = file.mimeType || typeFromName(file.name);
  if (!mimeType) {
    return { ok: false, error: 'Beerus reads PDFs, photos, text files and voice memos. Save a Word or Pages file as a PDF first.' };
  }
  const res = await readDocumentFile({ uri: file.uri, name: file.name, mimeType, size: file.size, today });
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? 'That document could not be read.' };
  const { document, facts } = res.data;

  const changes = facts.filter((f) => valueOf(profile, f.section, f.field) !== f.value);
  let next = profile;
  if (changes.length) {
    const saved = await saveProfileFields(changes);
    if (saved.ok && saved.data) next = saved.data;
  }
  return {
    ok: true,
    data: {
      document,
      changed: changes.map((c) => `${findField(c.section, c.field)?.field.label ?? c.field}: ${c.value}`),
      undo: changes.map((c) => ({ section: c.section, field: c.field, value: valueOf(profile, c.section, c.field) })),
      profile: next,
    },
  };
}

/* ---------------------------------------------------------------- reading */

function readProfile(raw: unknown): LifeProfile {
  const out: LifeProfile = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [section, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (!fields || typeof fields !== 'object') continue;
    for (const [field, value] of Object.entries(fields as Record<string, unknown>)) {
      if (typeof value === 'string' && value) (out[section] ??= {})[field] = value;
    }
  }
  return out;
}

function readDocument(raw: unknown): ProfileDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string') return null;
  return {
    id: d.id,
    name: typeof d.name === 'string' ? d.name : 'Document',
    kind: typeof d.kind === 'string' ? d.kind : 'other',
    summary: typeof d.summary === 'string' ? d.summary : '',
    weekly: Array.isArray(d.weekly) ? (d.weekly as WeeklyBlock[]) : [],
    dates: Array.isArray(d.dates) ? (d.dates as { date: string; title: string }[]) : [],
    notes: typeof d.notes === 'string' ? d.notes : '',
    kept: d.kept === true,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
  };
}

/** A browser that reports no type: guess it from the name, or null for one Beerus cannot read. */
function typeFromName(name: string): string | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    mp3: 'audio/mpeg',
    m4a: 'audio/m4a',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
  };
  return known[ext] ?? null;
}

/**
 * Upload a picked file to the Player's own folder of the private
 * `knowledge` bucket (the folder is their user id, which is what the storage
 * rules check). Null when signed out or the upload failed.
 */
async function keepFile(file: { uri: string; name: string; mimeType: string }): Promise<string | null> {
  if (!client) return null;
  const { data: session } = await client.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';
  const path = `${userId}/${Date.now()}-${safe}`;
  try {
    const body = Platform.OS === 'web' ? await (await fetch(file.uri)).blob() : await new File(file.uri).bytes();
    const { error } = await client.storage.from('knowledge').upload(path, body, { contentType: file.mimeType, upsert: false });
    if (error) {
      console.warn('[profile] could not keep the file', error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn('[profile] could not keep the file', err);
    return null;
  }
}

/** A picked file as base64: a blob: URL on the web, a file on a phone. */
async function base64Of(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
      reader.readAsDataURL(blob);
    });
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }
  return new File(uri).base64();
}
