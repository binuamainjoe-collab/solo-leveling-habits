import { cleanPicks, type ModelPicks } from '@/data/models';
import { client } from '@/lib/supabase';

/**
 * The Player's model picks, kept on their account (user_settings.models) so
 * the phone and the browser use the same models. Read and written as them:
 * the row rules let an account touch only its own row. The server checks
 * every id again before using it.
 */

export async function loadModelPicks(): Promise<ModelPicks | null> {
  if (!client) return null;
  const { data: session } = await client.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await client.from('user_settings').select('models').maybeSingle();
  if (error) {
    console.warn('[models] could not read your picks', error.message);
    return {};
  }
  return cleanPicks(data?.models);
}

export async function saveModelPicks(picks: ModelPicks): Promise<boolean> {
  if (!client) return false;
  const { data: session } = await client.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return false;
  const { error } = await client
    .from('user_settings')
    .upsert({ user_id: userId, models: cleanPicks(picks), updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) console.warn('[models] could not save your picks', error.message);
  return !error;
}
