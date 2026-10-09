/**
 * google — the student's Calendar and Tasks, reached through the server.
 *
 * The client never holds a Google token. It names one of the operations below
 * and this function mints a fresh access token from the stored refresh token
 * and makes the call.
 *
 * WHY AN OPERATION LIST AND NOT A GENERIC PROXY
 * A function that forwarded an arbitrary path and method to googleapis.com
 * would be a confused-deputy waiting to happen: the caller picks the URL, the
 * server supplies the credentials. The allow-list below means a compromised or
 * careless client can only ever do the handful of things the app actually
 * needs, with parameters this file shapes.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';

/** Reject anything that is not a plain RFC3339 timestamp or date. */
function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.+-]{2,}Z?)?$/.test(v);
}

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/**
 * Exchange the stored refresh token for an access token.
 *
 * Google access tokens last an hour and Supabase does not refresh provider
 * tokens, so this happens on every call. Cheap, and it means a revoked grant
 * surfaces immediately rather than after a stale token expires.
 */
async function accessTokenFor(refreshToken: string): Promise<string | null> {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    console.error('google token refresh failed', res.status, (await res.text()).slice(0, 300));
    return null;
  }
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function callGoogle(
  token: string,
  url: string,
  init: { method: string; body?: unknown },
): Promise<Response> {
  const res = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    console.error('google api error', res.status, url, text.slice(0, 400));
    if (res.status === 403) {
      return json(
        { error: 'Google refused that. The account may not have granted Calendar or Tasks access — sign in again.' },
        403,
      );
    }
    return json({ error: `Google returned ${res.status}.` }, 502);
  }

  return json(text ? JSON.parse(text) : {});
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceRole) return json({ error: 'Not configured.' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not allowed.' }, 401);

  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not allowed.' }, 401);

  let op = '';
  let args: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { op?: unknown; args?: unknown };
    op = typeof body.op === 'string' ? body.op : '';
    args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
  } catch {
    return json({ error: 'That request was not readable.' }, 400);
  }

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { data: row, error: rowError } = await admin
    .from('google_tokens')
    .select('refresh_token')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (rowError) {
    console.error('google_tokens read failed', rowError.message);
    return json({ error: 'Could not reach the Google connection.' }, 500);
  }
  if (!row?.refresh_token) {
    return json({ error: 'This account has not connected Google yet. Sign in again to grant access.' }, 409);
  }

  const token = await accessTokenFor(row.refresh_token);
  if (!token) {
    return json(
      { error: 'The Google connection has expired. Sign in again to reconnect Calendar and Tasks.' },
      409,
    );
  }

  switch (op) {
    /* ------------------------------------------------------------ calendar */

    case 'calendar.list': {
      if (!isTimestamp(args.timeMin) || !isTimestamp(args.timeMax)) {
        return json({ error: 'A time range is required.' }, 400);
      }
      const q = new URLSearchParams({
        timeMin: args.timeMin,
        timeMax: args.timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '50',
      });
      return callGoogle(token, `${CALENDAR}/calendars/primary/events?${q}`, { method: 'GET' });
    }

    case 'calendar.insert': {
      const summary = str(args.summary, 200);
      if (!summary) return json({ error: 'An event needs a title.' }, 400);
      if (!isTimestamp(args.start) || !isTimestamp(args.end)) {
        return json({ error: 'An event needs a start and an end.' }, 400);
      }
      return callGoogle(token, `${CALENDAR}/calendars/primary/events`, {
        method: 'POST',
        body: {
          summary,
          description: str(args.description, 1000) || undefined,
          start: { dateTime: args.start },
          end: { dateTime: args.end },
          // The app's own events are recognisable on the way back out.
          source: { title: 'The System', url: 'https://thesystem.app' },
        },
      });
    }

    /* --------------------------------------------------------------- tasks */

    case 'tasks.lists':
      return callGoogle(token, `${TASKS}/users/@me/lists?maxResults=50`, { method: 'GET' });

    case 'tasks.list': {
      const list = str(args.tasklist, 200) || '@default';
      const q = new URLSearchParams({ maxResults: '100', showCompleted: 'false' });
      return callGoogle(token, `${TASKS}/lists/${encodeURIComponent(list)}/tasks?${q}`, {
        method: 'GET',
      });
    }

    case 'tasks.insert': {
      const title = str(args.title, 200);
      if (!title) return json({ error: 'A task needs a title.' }, 400);
      const list = str(args.tasklist, 200) || '@default';
      return callGoogle(token, `${TASKS}/lists/${encodeURIComponent(list)}/tasks`, {
        method: 'POST',
        body: {
          title,
          notes: str(args.notes, 1000) || undefined,
          due: isTimestamp(args.due) ? args.due : undefined,
        },
      });
    }

    case 'tasks.complete': {
      const list = str(args.tasklist, 200) || '@default';
      const task = str(args.task, 200);
      if (!task) return json({ error: 'Which task?' }, 400);
      return callGoogle(
        token,
        `${TASKS}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(task)}`,
        {
          method: 'PATCH',
          body: {
            status: args.completed === false ? 'needsAction' : 'completed',
            // Clearing the timestamp is required when re-opening a task.
            completed: args.completed === false ? null : new Date().toISOString(),
          },
        },
      );
    }

    default:
      return json({ error: 'Unknown operation.' }, 400);
  }
});
