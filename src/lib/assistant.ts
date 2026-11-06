import type { AssistantAction, AssistantMessage, AssistantNow, AssistantReply } from '@/data/assistant';
import type { LiveSession } from '@/data/live';
import { sessionHeaders, SIGNED_OUT } from '@/lib/serverAuth';
import type { VoiceClip } from '@/lib/voice';

/**
 * Talking to The System's assistant function.
 *
 * Every call carries the signed-in account's session (see serverAuth.ts), and
 * the server answers as that account alone. The conversation and the memory
 * live on the server under that account, so the phone and the browser share
 * one running conversation, and nobody else can read it.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** A reply takes a few seconds; anything this long is a dead connection. */
const TIMEOUT_MS = 45_000;

const ACTIONS: AssistantAction[] = ['none', 'plan_today', 'plan_tomorrow', 'open_planner', 'open_goals', 'open_quests', 'suggest_quests', 'open_profile'];

export function assistantConfigured(): boolean {
  return BASE.length > 0 && ANON.length > 0;
}

export interface AssistantResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function callSystem<T>(
  body: unknown,
  fn: 'assistant' | 'live' | 'profile' = 'assistant',
  timeoutMs: number = TIMEOUT_MS,
): Promise<AssistantResult<T>> {
  if (!assistantConfigured()) return { ok: false, error: 'Beerus has no server to reach yet.' };
  const auth = await sessionHeaders();
  if (!auth) return { ok: false, error: SIGNED_OUT };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `Beerus could not answer (${res.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // A non-JSON body means something upstream failed; keep the generic line.
      }
      return { ok: false, error: message };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    if (abort.signal.aborted) return { ok: false, error: 'Beerus took too long to answer. Try again.' };
    return {
      ok: false,
      error: `Beerus could not be reached. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The recent conversation, oldest first. */
export async function loadHistory(): Promise<AssistantResult<AssistantMessage[]>> {
  const res = await callSystem<{ messages?: { role?: unknown; text?: unknown }[] }>({ op: 'history' });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  const messages = (res.data.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role as 'user' | 'model', text: m.text as string }));
  return { ok: true, data: messages };
}

/**
 * One message in, one reply out — re-read and capped, never trusted whole.
 * A spoken message carries the clip instead of text; the reply then says
 * what was heard.
 */
export async function sendToSystem(
  text: string,
  now: AssistantNow,
  audio?: VoiceClip,
  /** chat, or 'interview' (fill the profile) or 'board' (propose quests). */
  mode: 'chat' | 'interview' | 'board' = 'chat',
): Promise<AssistantResult<AssistantReply>> {
  const res = await callSystem<Record<string, unknown>>(audio ? { op: 'send', now, audio, mode } : { op: 'send', text, now, mode });
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const d = res.data;
  const reply = typeof d.reply === 'string' ? d.reply.trim() : '';
  if (!reply) return { ok: false, error: 'Beerus went quiet. Try again.' };

  return {
    ok: true,
    data: {
      reply,
      suggestions: Array.isArray(d.suggestions)
        ? d.suggestions.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3)
        : [],
      action: ACTIONS.includes(d.action as AssistantAction) ? (d.action as AssistantAction) : 'none',
      remembered: Array.isArray(d.remembered)
        ? (d.remembered as { kind?: unknown; content?: unknown }[])
            .filter((m) => typeof m?.content === 'string')
            .map((m) => ({ kind: String(m.kind ?? 'fact'), content: String(m.content) }))
        : [],
      // Passed through as-is: `vetChanges` is the only thing that decides.
      changes: Array.isArray(d.changes) ? d.changes.slice(0, 12) : [],
      heard: typeof d.heard === 'string' ? d.heard.trim() : null,
      proposal: d.proposal === true,
    },
  };
}

/**
 * A live voice call: a single-use token for Gemini Live, with The System's
 * prompt, knowledge and tools locked into it on the server (supabase/
 * functions/live). The key itself never reaches the browser.
 */
export async function openLiveCall(
  now: AssistantNow,
  mode: 'chat' | 'interview' = 'chat',
): Promise<AssistantResult<LiveSession>> {
  const res = await callSystem<{ token?: unknown; model?: unknown; maxMs?: unknown }>({ op: 'token', now, mode }, 'live');
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  const { token, model, maxMs } = res.data;
  if (typeof token !== 'string' || !token || typeof model !== 'string' || !model || typeof maxMs !== 'number' || maxMs <= 0) {
    return { ok: false, error: 'Beerus could not open a live call. Try again, or type instead.' };
  }
  return { ok: true, data: { token, model, maxMs } };
}

/** Store what was said in a live call, so the next conversation remembers it. */
export async function logLiveCall(turns: { role: 'user' | 'model'; text: string }[]): Promise<void> {
  if (turns.length === 0) return;
  await callSystem({ op: 'log', turns }, 'live');
}
