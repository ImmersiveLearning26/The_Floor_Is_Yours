// Where the API lives. On Lovable Cloud: the `api` edge function, called with the learner's anonymous
// session token. Locally (no VITE_SUPABASE_URL): the dev server at /api, identified by a cookie.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = ((import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined)?.trim();

export const cloud = !!(url && key);
export const apiBase = cloud ? `${url!.replace(/\/$/, '')}/functions/v1/api` : '/api';

let client: SupabaseClient | null = null;
const supabase = () => (client ??= createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fiy-auth' } }));

let signingIn: Promise<string> | null = null;
/** The learner's access token, signing in anonymously on first use (Lovable Cloud only). */
async function accessToken(): Promise<string> {
  const { data } = await supabase().auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  signingIn ??= supabase().auth.signInAnonymously().then(({ data: d, error }) => {
    signingIn = null;
    if (error || !d.session) throw new Error('Could not start a session. Anonymous sign-ins may be disabled for this project.');
    return d.session.access_token;
  }, e => { signingIn = null; throw e; });
  return signingIn;
}

/** Headers for a learner API call. */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!cloud) return {};
  return { Authorization: `Bearer ${await accessToken()}`, apikey: key! };
}

/** Headers for a facilitator API call (token entered on the review page). */
export function facilitatorHeaders(token: string): Record<string, string> {
  return { 'x-facilitator-token': token, ...(cloud ? { apikey: key!, Authorization: `Bearer ${key}` } : {}) };
}
