// Local development server for The Floor Is Yours. It runs the SAME API code as the Lovable Cloud edge
// function (supabase/functions/_shared/app.ts) with a JSON file + local folder instead of Postgres +
// Storage. The AI is the same Lovable AI connection point (_shared/ai/lovable.ts), which is not connected
// here — so locally you can walk the whole flow, and assessment shows its honest "not connected" path.
// Set FIY_AI=stub only for automated tests (scripts/e2e) to get deterministic, clearly-labelled fixtures.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { handle } from '../supabase/functions/_shared/app.ts';
import { step } from '../supabase/functions/_shared/pipeline.ts';
import { configFromEnv, type Ai, type Ctx } from '../supabase/functions/_shared/ports.ts';
import { lovableAi } from '../supabase/functions/_shared/ai/lovable.ts';
import { jsonRepo } from './jsonRepo.ts';
import { fsBlobs } from './fsBlobs.ts';
import { cookieIdentity } from './session.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const env = (k: string) => process.env[k];

const identity = cookieIdentity(DATA_DIR, process.env.NODE_ENV === 'production');
const files = fsBlobs(path.join(DATA_DIR, 'blobs'), identity.sign, identity.verify);
const ai: Ai = env('FIY_AI') === 'stub' ? (await import('../scripts/e2e/stub-ai.ts')).stubAi() : lovableAi(env);

const pending = new Set<Promise<unknown>>();
const ctx: Ctx = {
  repo: jsonRepo(DATA_DIR), blobs: files.blobs, ai, config: configFromEnv(env),
  defer: p => { const q = p.catch(e => console.error('[deferred]', e?.message)).finally(() => pending.delete(q)); pending.add(q); },
  kick: jobId => ctx.defer(new Promise(r => setTimeout(r, 0)).then(() => step(ctx, jobId))),
};

async function toRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const body = chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers, body });
}

// SERVE_DIST=1: also serve the built front end (npm run build) — used by the browser tests.
const DIST = path.join(ROOT, 'dist');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };
function serveDist(pathname: string): Response {
  if (env('SERVE_DIST') !== '1') return new Response('Not found', { status: 404 });
  const file = path.resolve(DIST, '.' + decodeURIComponent(pathname));
  const target = file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
  return new Response(fs.readFileSync(target), { headers: { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' } });
}

const server = http.createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const url = new URL(request.url);
    let response: Response;
    const file = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (file) response = (await files.serve(decodeURIComponent(file[1]))) ?? new Response('Not found', { status: 404 });
    else if (url.pathname.startsWith('/api/')) response = await handle(request, ctx, { learner: r => identity.learner(r) });
    else response = serveDist(url.pathname);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error('[dev] request failed', (e as Error).message);
    res.statusCode = 500; res.end();
  }
});

const port = Number(env('PORT') || 8787);
server.listen(port, async () => {
  const s = ai.status();
  console.log(`[api] local dev server on http://localhost:${port} (same API as the Lovable Cloud function)`);
  console.log(`[api] AI: ${s.provider} transcription=${s.transcription} delivery=${s.delivery} reasoning=${s.reasoning} voices=${s.voices} taskHelp=${s.taskHelp}`);
  for (const job of await ctx.repo.unfinishedJobs()) ctx.kick(job.id);
});
