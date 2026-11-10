// Lovable Cloud edge function: judge-reasoning
// Deploy inside your Lovable project (Lovable Cloud → Edge Functions, or supabase/functions/judge-reasoning/index.ts).
// It forwards the judges' reasoning request to the Lovable AI Gateway using the project's own LOVABLE_API_KEY,
// which Lovable provisions as a backend secret. The key never leaves Lovable; The Floor Is Yours server calls this
// function with a shared secret instead. See docs/LOVABLE_AI_SETUP.md.
//
// Secrets to set in the Lovable project:
//   LOVABLE_API_KEY      — provisioned by Lovable when AI is enabled (do not copy it anywhere else)
//   FIY_SHARED_SECRET    — any long random string; the same value goes in the server's LOVABLE_FUNCTION_SECRET
//   FIY_ALLOWED_MODELS   — optional comma-separated allow-list, e.g. "google/gemini-2.5-pro,google/gemini-2.5-flash"

const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('FIY_SHARED_SECRET') ?? '';
  if (!secret || req.headers.get('x-fiy-secret') !== secret) return new Response('Forbidden', { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response('Bad request', { status: 400 }); }

  // Forward only the fields the simulation uses — nothing else from the caller reaches the gateway.
  const allowed = (Deno.env.get('FIY_ALLOWED_MODELS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (typeof body.model !== 'string' || (allowed.length && !allowed.includes(body.model))) return new Response('Model not allowed', { status: 400 });
  const payload = {
    model: body.model,
    messages: body.messages,
    max_tokens: Math.min(Number(body.max_tokens) || 1000, 4000),
    ...(body.tools ? { tools: body.tools, tool_choice: body.tool_choice } : {}),
  };

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('LOVABLE_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Pass status through so the server can tell 401/402/429/5xx apart; never echo the key.
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
});
