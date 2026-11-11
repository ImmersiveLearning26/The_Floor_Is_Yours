// Lovable Cloud edge function: the whole simulation API (see _shared/app.ts for the routes).
// Deployed automatically by Lovable from supabase/functions/api. Secrets it reads:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   — provided by Lovable Cloud
//   LOVABLE_API_KEY                           — provided by Lovable when AI is enabled (used only in _shared/ai/lovable.ts)
//   FACILITATOR_TOKEN                         — you set it: long random string for the /facilitator.html review page
//   REVIEW_QUEUE_ENABLED, RECORDING_POLICY_VERSION, RECORDING_RETENTION_DAYS, SUPPORT_URL, ALLOW_RECORDING_DOWNLOAD — optional
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from '../_shared/app.ts';
import { step } from '../_shared/pipeline.ts';
import { configFromEnv, type Ctx } from '../_shared/ports.ts';
import { supabaseBlobs, supabaseRepo } from '../_shared/supabase.ts';
import { lovableAi } from '../_shared/ai/lovable.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = (k: string) => Deno.env.get(k);
const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const defer = (p: Promise<unknown>) => {
  const safe = p.catch(e => console.error('[deferred]', (e as Error)?.message));
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(safe);
};

const ctx: Ctx = {
  repo: supabaseRepo(admin),
  blobs: supabaseBlobs(admin),
  ai: lovableAi(env),
  config: configFromEnv(env),
  defer,
  // Each assessment step runs in its own invocation so no single call approaches the time limit.
  kick: jobId => defer(fetch(`${SUPABASE_URL}/functions/v1/api/internal/jobs/${encodeURIComponent(jobId)}/step`, {
    method: 'POST', headers: { 'x-fiy-internal': SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
  }).then(r => { if (!r.ok) return step(ctx, jobId); }).catch(() => step(ctx, jobId))),
};

Deno.serve(req => handle(req, ctx, {
  internalSecret: SERVICE_KEY,
  // Learners are anonymous Lovable Cloud users: the browser signs in anonymously and sends its access token.
  async learner(r) {
    const token = (r.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token || token === SERVICE_KEY) return null;
    const { data, error } = await admin.auth.getUser(token);
    return error || !data.user ? null : { id: data.user.id };
  },
}));
