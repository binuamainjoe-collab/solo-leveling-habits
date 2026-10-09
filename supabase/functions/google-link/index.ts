/**
 * google-link — take the Google refresh token off the client, for good.
 *
 * Supabase hands `provider_refresh_token` to whoever completed the OAuth flow.
 * Refreshing it into a usable access token requires the Google client secret,
 * which can never ship inside a bundle, so the client posts the token here
 * once and keeps no copy. `public.google_tokens` has RLS on with no policies,
 * so from that moment nothing holding an anon key can read it back — not even
 * the student it belongs to.
 *
 * JWT verification is ON for this function: unlike plan-tomorrow there are
 * real Supabase users now, and the whole point is to know which one is
 * speaking. The user id comes from the verified token, never from the body —
 * taking it from the body would let any signed-in user overwrite another
 * user's Google credentials.
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !serviceRole) return json({ error: 'Not configured.' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not allowed.' }, 401);

  // Resolve the caller against Supabase rather than trusting the body.
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Not allowed.' }, 401);

  let refreshToken: string;
  let scopes: string[];
  try {
    const body = (await req.json()) as { refresh_token?: unknown; scopes?: unknown };
    if (typeof body.refresh_token !== 'string' || body.refresh_token.length === 0) {
      return json({ error: 'No refresh token supplied.' }, 400);
    }
    refreshToken = body.refresh_token;
    scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return json({ error: 'That request was not readable.' }, 400);
  }

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });
  const { error } = await admin
    .from('google_tokens')
    .upsert(
      {
        user_id: userData.user.id,
        refresh_token: refreshToken,
        scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    console.error('google-link upsert failed', error.message);
    return json({ error: 'Could not store the Google connection.' }, 500);
  }

  // Deliberately returns nothing about the token.
  return json({ ok: true, scopes });
});
