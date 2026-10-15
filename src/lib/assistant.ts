import type { AssistantAction, AssistantMessage, AssistantNow, AssistantReply } from '@/data/assistant';

/**
 * Talking to The System's assistant function.
 *
 * Same gate as the shadows: the app secret, which ships in the bundle, plus a
 * hard daily cap the server enforces for itself. The conversation and the
 * memory both live on the server, so the phone and the browser share one
 * running conversation.
 */

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SECRET = process.env.EXPO_PUBLIC_APP_SECRET ?? '';

/** A reply takes a few seconds; anything this long is a dead connection. */
const TIMEOUT_MS = 45_000;

const ACTIONS: AssistantAction[] = ['none', 'plan_today', 'plan_tomorrow', 'open_planner', 'open_goals', 'open_quests'];

export function assistantConfigured(): boolean {
  return BASE.length > 0 && SECRET.length > 0;
}

export interface AssistantResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function call<T>(body: unknown): Promise<AssistantResult<T>> {
  if (!assistantConfigured()) return { ok: false, error: 'The System has no server to reach yet.' };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/functions/v1/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-app-secret': SECRET },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `The System could not answer (${res.status}).`;
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
    if (abort.signal.aborted) return { ok: false, error: 'The System took too long to answer. Try again.' };
    return {
      ok: false,
      error: `The System could not be reached. ${err instanceof Error ? err.message : ''}`.trim(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The recent conversation, oldest first. */
export async function loadHistory(): Promise<AssistantResult<AssistantMessage[]>> {
  const res = await call<{ messages?: { role?: unknown; text?: unknown }[] }>({ op: 'history' });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  const messages = (res.data.messages ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'model') && typeof m.text === 'string')
    .map((m) => ({ role: m.role as 'user' | 'model', text: m.text as string }));
  return { ok: true, data: messages };
}

/** One message in, one reply out — re-read and capped, never trusted whole. */
export async function sendToSystem(text: string, now: AssistantNow): Promise<AssistantResult<AssistantReply>> {
  const res = await call<Record<string, unknown>>({ op: 'send', text, now });
  if (!res.ok || !res.data) return { ok: false, error: res.error };

  const d = res.data;
  const reply = typeof d.reply === 'string' ? d.reply.trim() : '';
  if (!reply) return { ok: false, error: 'The System went quiet. Try again.' };

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
    },
  };
}
