import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { LifeProfile, ProfileDocument, WeeklyBlock } from '@/data/lifeProfile';
import { callSystem, type AssistantResult } from '@/lib/assistant';

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
  today: string;
}): Promise<AssistantResult<{ document: ProfileDocument; facts: ProfileFieldWrite[] }>> {
  let data: string;
  try {
    data = await base64Of(file.uri);
  } catch {
    return { ok: false, error: 'The file could not be read on this device.' };
  }
  // A document is read by the flagship with Flash behind it; that can take
  // longer than a chat reply.
  const res = await callSystem<{ document?: unknown; facts?: unknown }>(
    { op: 'document', name: file.name, mimeType: file.mimeType, data, today: file.today },
    'profile',
    90_000,
  );
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  const document = readDocument(res.data.document);
  if (!document) return { ok: false, error: 'The System read it, but the answer was not usable.' };
  const facts = Array.isArray(res.data.facts)
    ? (res.data.facts as Record<string, unknown>[])
        .filter((f) => typeof f?.section === 'string' && typeof f?.field === 'string' && typeof f?.value === 'string')
        .map((f) => ({ section: f.section as string, field: f.field as string, value: f.value as string }))
    : [];
  return { ok: true, data: { document, facts } };
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
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
  };
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
