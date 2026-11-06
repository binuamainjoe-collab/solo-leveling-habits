/**
 * The pure half of a live voice call: turning microphone samples into what
 * Gemini Live accepts, turning its audio back into samples, and keeping the
 * running transcript. No browser APIs here (src/lib/live.ts has those), so
 * `npx tsx scratch/live-check.ts` can test all of it.
 */

/** What Gemini Live hears: 16-bit PCM, mono, 16 kHz. */
export const IN_RATE = 16_000;
/** What it speaks: 16-bit PCM, mono, 24 kHz. */
export const OUT_RATE = 24_000;
/** Microphone audio goes up in 100 ms chunks: small enough to feel live, big enough not to flood the socket. */
export const CHUNK_SAMPLES = IN_RATE / 10;
/** Audio chunks held while the call moves between connections: five seconds. */
export const MAX_BACKLOG = 50;

/** What the live function hands the app to open a call. */
export interface LiveSession {
  token: string;
  model: string;
  /** How long the call may run. The app ends it there, with a message. */
  maxMs: number;
}

export function liveUrl(token: string): string {
  return (
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained' +
    `?access_token=${encodeURIComponent(token)}`
  );
}

/**
 * The first message on every connection. The token supplies the rest of the
 * setup and overrides anything else sent here, so the only thing the app adds
 * is sessionResumption: empty to start the session, or the handle to carry on
 * from.
 */
export function setupMessage(model: string, handle: string | null) {
  return { setup: { model: `models/${model}`, sessionResumption: handle ? { handle } : {} } };
}

/** A protobuf Duration as JSON ("57s", "1.5s") in milliseconds; null if it is not one. */
export function durationMs(value: unknown): number | null {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

/* ------------------------------------------------------------------ audio */

/**
 * Resample by linear interpolation. Used when the browser will not record at
 * 16 kHz directly (Firefox keeps the microphone's own rate).
 */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, input.length - 1);
    const frac = pos - a;
    out[i] = input[a] * (1 - frac) + input[b] * frac;
  }
  return out;
}

/** Float samples (-1..1) to little-endian 16-bit PCM bytes. */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return bytes;
}

/** Little-endian 16-bit PCM bytes to float samples (-1..1). */
export function pcm16ToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: String.fromCharCode with too many arguments overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------- transcript */

export interface LiveTurn {
  role: 'user' | 'model';
  text: string;
  /** Still being spoken: more words may arrive. */
  open: boolean;
  /** What the System changed during this turn. */
  applied?: string[];
  refused?: string[];
  canUndo?: boolean;
  /** Keys of the undo steps for this turn's changes, oldest first. */
  undoIds?: string[];
  undone?: boolean;
}

/**
 * Add words to the transcript. Words for the side that is already speaking
 * extend its turn; words for the other side start a new one.
 */
export function addText(turns: LiveTurn[], role: 'user' | 'model', text: string): LiveTurn[] {
  if (!text) return turns;
  const lastOpen = findLastOpen(turns, role);
  if (lastOpen >= 0) {
    return turns.map((t, i) => (i === lastOpen ? { ...t, text: joinFragments(t.text, text) } : t));
  }
  // The other side has started talking, so its earlier turn is over.
  return [...closeTurns(turns), { role, text: text.trimStart(), open: true }];
}

/** The model finished (or was interrupted): every turn so far is complete. */
export function closeTurns(turns: LiveTurn[]): LiveTurn[] {
  return turns.some((t) => t.open) ? turns.map((t) => (t.open ? { ...t, open: false } : t)) : turns;
}

/**
 * Record what a tool call changed on the System's current turn, creating
 * that turn if the System has not said anything yet. Returns the turn's
 * index, which is what Undo is keyed by.
 */
export function attachChanges(
  turns: LiveTurn[],
  applied: string[],
  refused: string[],
  canUndo: boolean,
  /** Where the caller keeps this call's undo steps; stored on the turn. */
  undoId?: string,
): { turns: LiveTurn[]; index: number } {
  const lastOpen = findLastOpen(turns, 'model');
  const merge = (t: LiveTurn): LiveTurn => ({
    ...t,
    applied: [...(t.applied ?? []), ...applied],
    refused: [...(t.refused ?? []), ...refused],
    canUndo: Boolean(t.canUndo) || canUndo,
    ...(undoId && canUndo ? { undoIds: [...(t.undoIds ?? []), undoId] } : {}),
  });
  if (lastOpen >= 0) {
    return { turns: turns.map((t, i) => (i === lastOpen ? merge(t) : t)), index: lastOpen };
  }
  return { turns: [...turns, merge({ role: 'model', text: '', open: true })], index: turns.length };
}

/** What gets stored after the call: words only, in order, nothing empty. */
export function toLog(turns: LiveTurn[]): { role: 'user' | 'model'; text: string }[] {
  return turns.map((t) => ({ role: t.role, text: t.text.trim() })).filter((t) => t.text.length > 0);
}

function findLastOpen(turns: LiveTurn[], role: 'user' | 'model'): number {
  const last = turns.length - 1;
  return last >= 0 && turns[last].role === role && turns[last].open ? last : -1;
}

/**
 * Gemini's transcription fragments carry their own spacing (" Good",
 * " afternoon,"), and a word can be split across two of them, so they are
 * joined exactly as they come.
 */
function joinFragments(a: string, b: string): string {
  return a ? a + b : b.trimStart();
}
