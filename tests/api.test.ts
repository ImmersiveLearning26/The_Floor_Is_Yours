// Drives the real API handler + assessment pipeline (the code Lovable Cloud runs) with the local store,
// local file storage and the deterministic test AI. No browser, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handle } from '../supabase/functions/_shared/app.ts';
import { step } from '../supabase/functions/_shared/pipeline.ts';
import { configFromEnv, type Ai, type Ctx } from '../supabase/functions/_shared/ports.ts';
import { lovableAi } from '../supabase/functions/_shared/ai/lovable.ts';
import { encodeWav } from '../supabase/functions/_shared/wav.ts';
import { jsonRepo } from '../server/jsonRepo.ts';
import { fsBlobs } from '../server/fsBlobs.ts';
import { stubAi } from '../scripts/e2e/stub-ai.ts';

function setup(ai: Ai, env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiy-api-'));
  const files = fsBlobs(path.join(dir, 'blobs'), v => `${v}.sig`, s => (s.endsWith('.sig') ? s.slice(0, -4) : null));
  const pending = new Set<Promise<unknown>>();
  const ctx: Ctx = {
    repo: jsonRepo(dir), blobs: files.blobs, ai, config: configFromEnv(k => env[k]),
    defer: p => { const q = p.finally(() => pending.delete(q)); pending.add(q); },
    kick: id => ctx.defer(Promise.resolve().then(() => step(ctx, id))),
  };
  const settle = async () => { while (pending.size) await Promise.all([...pending]); };
  const call = async (who: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { 'x-test-learner': who, ...headers } };
    if (body instanceof Uint8Array) init.body = body as unknown as BodyInit;
    else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['content-type'] = 'application/json'; }
    const res = await handle(new Request(`http://local/api${url}`, init), ctx, { learner: async r => ({ id: r.headers.get('x-test-learner')! }) });
    return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, any> };
  };
  return { ctx, call, settle };
}

const speech = (seconds: number) => {
  const rate = 16000, pcm = new Int16Array(Math.round(rate * seconds));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 9) * 9000);
  return encodeWav(pcm, rate);
};

async function toCapture(call: ReturnType<typeof setup>['call'], who = 'L1') {
  await call(who, 'POST', '/session/name', { displayName: 'Adaeze' });
  const s = await call(who, 'GET', '/session');
  const created = await call(who, 'POST', '/runs', { topicId: 'T02', idempotencyKey: 'k1' });
  assert.equal(created.status, 201);
  const id = created.body.run.id as string;
  await call(who, 'POST', `/runs/${id}/briefing`, { outcome: 'completed' });
  assert.equal((await call(who, 'POST', `/runs/${id}/consent`, { policyVersion: s.body.consentVersion, recording: true, assessment: true })).status, 200);
  assert.equal((await call(who, 'POST', `/runs/${id}/capture-start`)).status, 200);
  return id;
}

test('full run with the test AI: 3/2/4/3 → 74 Effective, voiced, then finished', async () => {
  const { call, settle } = setup(stubAi());
  const id = await toCapture(call);
  const up = await call('L1', 'POST', `/runs/${id}/recording`, speech(62), { 'content-type': 'audio/wav' });
  assert.equal(up.status, 201);
  assert.equal(up.body.run.recording.trimmed, true);
  assert.equal(up.body.run.recording.duration, 60);
  assert.equal((await call('L1', 'POST', `/runs/${id}/recording`, speech(10))).body.duplicate, true); // immutable
  const ev = await call('L1', 'POST', `/runs/${id}/evaluate`);
  await settle();
  const job = await call('L1', 'GET', `/jobs/${ev.body.run.job.id}`);
  assert.equal(job.body.job.stage, 'complete');
  const a = job.body.run.assessment;
  assert.equal(a.scoreExact, 73.75); assert.equal(a.scoreRounded, 74); assert.equal(a.band, 'Effective');
  assert.match(a.model, /^test-stub:/);
  assert.equal(a.turns.length, 3);
  assert.ok(a.turns.every((t: { audioUrl: string; captions: unknown[] }) => t.audioUrl && t.captions.length));
  const url = await call('L1', 'GET', `/runs/${id}/recording/url?download=1`);
  assert.match(url.body.url, /^\/api\/files\//);
  assert.equal((await call('L1', 'POST', `/runs/${id}/stage`, { stage: 'results' })).status, 200);
  assert.equal((await call('L1', 'POST', `/runs/${id}/finish`)).body.run.status, 'finished');
});

test('ownership, one active run, idempotent create, WAV-only uploads', async () => {
  const { call } = setup(stubAi());
  const id = await toCapture(call);
  assert.equal((await call('L2', 'GET', `/runs/active`)).body.run, null);
  assert.equal((await call('L2', 'POST', `/runs/${id}/evaluate`)).status, 404); // other learner: indistinguishable from missing
  assert.equal((await call('L1', 'POST', '/runs', { topicId: 'T02', idempotencyKey: 'k1' })).body.run.id, id); // double click
  assert.equal((await call('L1', 'POST', '/runs', { topicId: 'T01', idempotencyKey: 'k2' })).status, 409);
  assert.equal((await call('L1', 'POST', `/runs/${id}/recording`, new TextEncoder().encode('x'.repeat(100)))).status, 415);
  assert.equal((await call('L1', 'POST', `/runs/${id}/recording`, speech(0.2))).status, 422);
});

test('AI not connected yet: honest failure, no score, retry and unscored close', async () => {
  const { call, settle } = setup(lovableAi(() => undefined), { REVIEW_QUEUE_ENABLED: 'true', FACILITATOR_TOKEN: 'fac-secret' });
  const caps = (await call('L1', 'GET', '/session')).body.capabilities;
  assert.deepEqual([caps.transcription, caps.reasoning, caps.delivery], [false, false, 'human']);
  const id = await toCapture(call);
  await call('L1', 'POST', `/runs/${id}/recording`, speech(20));
  const ev = await call('L1', 'POST', `/runs/${id}/evaluate`);
  await settle();
  const job = await call('L1', 'GET', `/jobs/${ev.body.run.job.id}`);
  assert.equal(job.body.job.stage, 'failed');
  assert.equal(job.body.job.retryable, true);
  assert.match(job.body.job.message, /not connected yet/);
  assert.equal(job.body.run.assessment, null);
  await call('L1', 'POST', `/runs/${id}/evaluate`); await settle(); // retry, same file
  assert.equal((await call('L1', 'POST', `/runs/${id}/review`)).body.run.status, 'review-requested');
  assert.equal((await call('L1', 'POST', `/runs/${id}/close-unscored`, { reason: 'test' })).body.run.status, 'closed-unscored');
  const help = await call('L1', 'POST', '/task-help', { question: 'How long can I speak?', stage: 'mic' });
  assert.equal(help.body.source, 'guide');
});

test('no audio AI: facilitator rates delivery from the recording, then the score appears', async () => {
  const base = stubAi();
  const ai: Ai = { ...base, status: () => ({ ...base.status(), delivery: false }) };
  const { call, settle } = setup(ai, { FACILITATOR_TOKEN: 'fac-secret' });
  const id = await toCapture(call);
  await call('L1', 'POST', `/runs/${id}/recording`, speech(30));
  const ev = await call('L1', 'POST', `/runs/${id}/evaluate`);
  await settle();
  assert.equal((await call('L1', 'GET', `/jobs/${ev.body.run.job.id}`)).body.job.stage, 'needs-review');
  assert.equal((await call('x', 'GET', '/facilitator/queue', undefined, { 'x-facilitator-token': 'wrong' })).status, 401);
  const fac = { 'x-facilitator-token': 'fac-secret' };
  const q = await call('x', 'GET', '/facilitator/queue', undefined, fac);
  const item = q.body.items[0];
  assert.equal(item.jobStage, 'needs-review');
  assert.match((await call('x', 'GET', `/facilitator/runs/${item.runId}/audio-url`, undefined, fac)).body.url, /^\/api\/files\//);
  const rated = await call('x', 'POST', `/facilitator/jobs/${item.jobId}/delivery`, { reviewer: 'Dr Okafor', level: 3, justification: 'Clear and steady.', evidence: [{ start: 1, end: 8, observation: 'Steady pace.' }] }, fac);
  assert.equal(rated.status, 200);
  await settle();
  const done = await call('L1', 'GET', `/jobs/${item.jobId}`);
  assert.equal(done.body.run.assessment.scoreRounded, 74);
  assert.equal(done.body.run.assessment.deliveryAssessor, 'human:Dr Okafor');
  const ov = await call('x', 'POST', `/facilitator/evaluations/${done.body.run.assessment.evaluationId}/override`, { reviewer: 'Dr Okafor', reason: 'Second listen', changes: [{ id: 'delivery', level: 4 }] }, fac);
  assert.equal(ov.body.scoreRounded, 78); // 22.5 + 15 + 25 + 15 = 77.5 → 78
});

test('internal step route requires the internal secret', async () => {
  const { ctx } = setup(stubAi());
  const res = await handle(new Request('http://local/functions/v1/api/internal/jobs/x/step', { method: 'POST' }), ctx, { learner: async () => null, internalSecret: 's3cret' });
  assert.equal(res.status, 403);
  const ok = await handle(new Request('http://local/functions/v1/api/internal/jobs/x/step', { method: 'POST', headers: { 'x-fiy-internal': 's3cret' } }), ctx, { learner: async () => null, internalSecret: 's3cret' });
  assert.equal(ok.status, 202);
});
