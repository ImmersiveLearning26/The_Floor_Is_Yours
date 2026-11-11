// The simulation's HTTP API as one fetch-style handler (Request → Response). It runs unchanged as the
// Lovable Cloud edge function `api` (supabase/functions/api/index.ts) and inside the local dev server.
// Same rules as before: owner-only runs, one active run per learner, topic locked on create, consent before
// capture, exactly one immutable recording, no score without validated evidence, audited state changes.
import { capabilities, consentVersion, runView, jobView } from './views.ts';
import { ensureJob, step, applyHumanDelivery, isStalled, sweepRetention } from './pipeline.ts';
import { parseWav, trimWav, peakDb } from './wav.ts';
import { HttpError, deny, newId, now, safeEqual, sha256Hex } from './util.ts';
import { TASK_HELP_INSTRUCTION } from './prompt.ts';
import { answerFromGuide } from './taskGuide.ts';
import { calculateScore } from './scoring.ts';
import { topicById, MAX_SECONDS } from './content.ts';
import type { Ctx, RunRecord } from './ports.ts';
import type { CriterionId, Level, Rating } from './types.ts';

export type Auth = {
  /** Resolve the anonymous learner for this request (signed-in Lovable Cloud user, or dev cookie). */
  learner(req: Request): Promise<{ id: string; setCookie?: string } | null>;
  /** Secret that authorises internal job-step calls (absent: route disabled). */
  internalSecret?: string;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-facilitator-token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...CORS, ...extra } });

type R = { req: Request; url: URL; params: string[]; ctx: Ctx; learnerId: string; body: () => Promise<Record<string, unknown>> };
type Handler = (r: R) => Promise<Response>;
const routes: { method: string; re: RegExp; scope: 'learner' | 'facilitator' | 'internal'; fn: Handler }[] = [];
const on = (method: string, path: string, scope: 'learner' | 'facilitator' | 'internal', fn: Handler) =>
  routes.push({ method, re: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), scope, fn });

const audit = (ctx: Ctx, runId: string | null, learnerId: string | null, actor: string, event: string, detail?: Record<string, unknown>) =>
  ctx.repo.addAudit({ id: newId('aud'), at: now(), runId, learnerId, actor, event, detail });

/** Owner-only lookup: other learners' runs are indistinguishable from missing ones. */
async function ownRun(r: R): Promise<RunRecord> {
  const run = await r.ctx.repo.getRun(decodeURIComponent(r.params[0]));
  if (!run || run.learnerId !== r.learnerId) deny(404, 'Run not found.');
  return run!;
}
const touch = (run: RunRecord) => { run.updatedAt = now(); };
const view = async (r: R, run: RunRecord, status = 200, extra: Record<string, unknown> = {}) => json({ run: await runView(r.ctx, run), ...extra }, status);

// ── Learner ────────────────────────────────────────────────────────────────
let lastSweep = 0;
on('GET', '/session', 'learner', async r => {
  if (Date.now() - lastSweep > 3600_000) { lastSweep = Date.now(); r.ctx.defer(sweepRetention(r.ctx).catch(() => {})); }
  const [learner, active] = await Promise.all([r.ctx.repo.getLearner(r.learnerId), r.ctx.repo.activeRun(r.learnerId)]);
  return json({ displayName: learner?.displayName || '', capabilities: capabilities(r.ctx), consentVersion: consentVersion(r.ctx), activeRun: active ? await runView(r.ctx, active) : null });
});

on('POST', '/session/name', 'learner', async r => {
  const name = String((await r.body()).displayName ?? '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > 60) deny(422, 'Enter a name between 1 and 60 characters.');
  const learner = (await r.ctx.repo.getLearner(r.learnerId)) ?? { id: r.learnerId, displayName: '', createdAt: now() };
  learner.displayName = name;
  await r.ctx.repo.saveLearner(learner);
  return json({ displayName: name });
});

on('GET', '/runs/active', 'learner', async r => {
  const run = await r.ctx.repo.activeRun(r.learnerId);
  return json({ run: run ? await runView(r.ctx, run) : null });
});

on('POST', '/runs', 'learner', async r => {
  const b = await r.body();
  const topic = topicById(String(b.topicId ?? ''));
  const key = String(b.idempotencyKey ?? '').slice(0, 80);
  if (!topic) deny(422, 'Choose one of the three issues.');
  if (!key) deny(422, 'Missing idempotency key.');
  const learner = await r.ctx.repo.getLearner(r.learnerId);
  if (!learner?.displayName) deny(409, 'Enter your name first.');
  const resolveExisting = async () => {
    const existing = await r.ctx.repo.activeRun(r.learnerId);
    if (!existing) return null;
    if (existing.idempotencyKey === key) return view(r, existing); // double click / retry
    return json({ error: 'You already have an unfinished run. Resume it before choosing another issue.', run: await runView(r.ctx, existing) }, 409);
  };
  const early = await resolveExisting();
  if (early) return early;
  const run: RunRecord = {
    id: newId('run'), learnerId: r.learnerId, topicId: topic!.id, displayName: learner!.displayName, idempotencyKey: key,
    status: 'active', stage: 'briefing', createdAt: now(), updatedAt: now(), consentVersion: null, consentAt: null,
    briefing: 'pending', captureStartedAt: null, captureAttempts: 0, recordingId: null, jobId: null, evaluationId: null, review: null, closedAt: null,
  };
  if ((await r.ctx.repo.insertRun(run)) === 'conflict') return (await resolveExisting()) ?? deny(409, 'Please try again.');
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'run.created', { topicId: run.topicId });
  return view(r, run, 201);
});

on('POST', '/runs/:id/briefing', 'learner', async r => {
  const run = await ownRun(r);
  if (run.status !== 'active') deny(409, 'Briefing is already closed for this run.');
  const outcome = (await r.body()).outcome === 'completed' ? 'completed' : 'skipped';
  if (run.briefing === 'pending') run.briefing = outcome;
  if (run.stage === 'briefing') run.stage = 'mic';
  touch(run); await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'briefing.' + outcome);
  return view(r, run);
});

on('POST', '/runs/:id/consent', 'learner', async r => {
  const run = await ownRun(r);
  const b = await r.body();
  if (run.status !== 'active') deny(409, 'Consent can only be given before recording.');
  if (b.policyVersion !== consentVersion(r.ctx)) deny(409, 'The recording policy changed. Review it and agree again.');
  if (b.recording !== true || b.assessment !== true) deny(422, 'Recording and AI assessment consent are both required.');
  run.consentVersion = consentVersion(r.ctx); run.consentAt = now(); touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'consent.given', { policyVersion: run.consentVersion });
  return view(r, run);
});

on('POST', '/runs/:id/capture-start', 'learner', async r => {
  const run = await ownRun(r);
  if (run.status !== 'active' || run.recordingId) deny(409, 'This run already has its one recording.');
  if (!run.consentVersion) deny(409, 'Consent is required before recording.');
  if (run.captureStartedAt) deny(409, 'A capture is already open for this run. Report it as interrupted before starting a replacement.');
  run.captureStartedAt = now(); run.captureAttempts += 1; run.stage = 'mic'; touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'capture.started', { attempt: run.captureAttempts });
  return view(r, run);
});

// Only a technical failure with no valid recording on the server re-opens capture. Audited.
on('POST', '/runs/:id/capture-failed', 'learner', async r => {
  const run = await ownRun(r);
  if (run.recordingId) deny(409, 'A valid recording already exists and cannot be replaced.');
  const reason = String((await r.body()).reason ?? 'unknown').slice(0, 200);
  run.captureStartedAt = null; run.stage = 'mic'; touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'capture.technical-failure', { reason });
  return view(r, run);
});

// Body: the recording as a 16-bit PCM WAV (the browser converts its capture before upload).
on('POST', '/runs/:id/recording', 'learner', async r => {
  const run = await ownRun(r);
  if (run.recordingId) return view(r, run, 200, { duplicate: true }); // immutable; idempotent re-send
  if (run.status !== 'active') deny(409, 'This run is not accepting a recording.');
  if (!run.consentVersion) deny(409, 'Consent is required before a recording can be saved.');
  if (!run.captureStartedAt) deny(409, 'No capture was started for this run.');
  const declared = Number(r.req.headers.get('content-length') || 0);
  if (declared > r.ctx.config.maxUploadBytes) deny(413, 'The recording file is too large.');
  const raw = new Uint8Array(await r.req.arrayBuffer());
  if (raw.length > r.ctx.config.maxUploadBytes) deny(413, 'The recording file is too large.');
  if (!raw.length) deny(422, 'The recording was empty.');
  const info = parseWav(raw);
  if (!info) {
    await audit(r.ctx, run.id, r.learnerId, 'system', 'recording.rejected', { reason: 'not a 16-bit PCM WAV' });
    deny(415, 'The recording could not be read. This is a technical capture problem, not your performance.', { technical: true });
  }
  let bytes: Uint8Array = raw, duration = info!.duration, trimmed = false;
  if (duration > MAX_SECONDS) { bytes = trimWav(raw, info!, MAX_SECONDS); trimmed = true; duration = Math.min(MAX_SECONDS, parseWav(bytes)!.duration); }
  if (duration < 0.5) deny(422, 'The recording was too short to contain a capture. Record again.', { technical: true });
  const finalInfo = parseWav(bytes)!;
  const vol = peakDb(bytes, finalInfo);
  const id = newId('rec');
  const path = `recordings/${r.learnerId}/${id}.wav`;
  await r.ctx.blobs.put(path, bytes, 'audio/wav');
  const rec = {
    id, runId: run.id, learnerId: r.learnerId, path, mimeType: 'audio/wav', bytes: bytes.length, sha256: await sha256Hex(bytes),
    duration: Number(duration.toFixed(3)), trimmed, silent: vol < -50, maxVolumeDb: vol, createdAt: now(), deletedAt: null,
  };
  if ((await r.ctx.repo.insertRecording(rec)) === 'conflict') {
    await r.ctx.blobs.remove(path);
    return view(r, (await r.ctx.repo.getRun(run.id))!, 200, { duplicate: true });
  }
  run.recordingId = id; run.status = 'submitted'; run.stage = 'processing'; touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'system', 'recording.saved', { recordingId: id, duration, trimmed, bytes: bytes.length });
  return view(r, run, 201);
});

on('POST', '/runs/:id/evaluate', 'learner', async r => {
  const run = await ownRun(r);
  if (!run.recordingId) deny(409, 'There is no saved recording to assess yet.');
  if (run.status === 'closed-unscored' || run.status === 'finished') deny(409, 'This run is closed.');
  await ensureJob(r.ctx, run);
  return view(r, (await r.ctx.repo.getRun(run.id))!);
});

on('GET', '/jobs/:id', 'learner', async r => {
  const job = await r.ctx.repo.getJob(decodeURIComponent(r.params[0]));
  if (!job || job.learnerId !== r.learnerId) deny(404, 'Job not found.');
  if (isStalled(job!)) r.ctx.kick(job!.id); // self-healing if a step invocation was cut off
  const run = await r.ctx.repo.getRun(job!.runId);
  return json({ job: jobView(job!), run: await runView(r.ctx, run!) });
});

on('POST', '/runs/:id/review', 'learner', async r => {
  const run = await ownRun(r);
  if (!capabilities(r.ctx).reviewQueue) deny(501, 'No review route is configured for this deployment.');
  if (run.review) return view(r, run);
  const job = run.jobId ? await r.ctx.repo.getJob(run.jobId) : null;
  if (!job || !['failed', 'needs-review'].includes(job.stage)) deny(409, 'A review can be requested when assessment cannot complete.');
  const review = { id: newId('rev'), runId: run.id, learnerId: r.learnerId, createdAt: now(), status: 'open' as const, resolvedAt: null, resolvedBy: null };
  await r.ctx.repo.saveReview(review);
  run.review = { receiptId: review.id, createdAt: review.createdAt }; run.status = 'review-requested'; touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'review.requested', { receiptId: review.id });
  return view(r, run);
});

on('POST', '/runs/:id/close-unscored', 'learner', async r => {
  const run = await ownRun(r);
  if (run.status === 'closed-unscored') return view(r, run);
  if (run.status === 'complete' || run.status === 'finished') deny(409, 'This run has a completed assessment. Use Finish instead.');
  const job = run.jobId ? await r.ctx.repo.getJob(run.jobId) : null;
  const recoverable = !run.recordingId ? run.stage === 'mic' : (!!job && ['failed', 'needs-review'].includes(job.stage)) || run.status === 'review-requested';
  if (!recoverable) deny(409, 'Assessment is still in progress.');
  run.status = 'closed-unscored'; run.closedAt = now(); touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'run.closed-unscored', { reason: String((await r.body()).reason ?? '').slice(0, 200), hadRecording: !!run.recordingId });
  return view(r, run);
});

on('POST', '/runs/:id/stage', 'learner', async r => {
  const run = await ownRun(r);
  if ((await r.body()).stage !== 'results' || run.status !== 'complete') deny(409, 'Results are available after a complete assessment.');
  run.stage = 'results'; touch(run); await r.ctx.repo.saveRun(run);
  return view(r, run);
});

on('POST', '/runs/:id/finish', 'learner', async r => {
  const run = await ownRun(r);
  if (run.status === 'finished') return view(r, run);
  if (run.status !== 'complete' || !run.evaluationId) deny(409, 'Finish requires a completed assessment.');
  run.status = 'finished'; run.closedAt = now(); touch(run);
  await r.ctx.repo.saveRun(run);
  await audit(r.ctx, run.id, r.learnerId, 'learner', 'run.finished', { evaluationId: run.evaluationId });
  return view(r, run);
});

/** Short-lived playback / download link for the learner's own recording. */
on('GET', '/runs/:id/recording/url', 'learner', async r => {
  const run = await ownRun(r);
  const rec = run.recordingId ? await r.ctx.repo.getRecording(run.recordingId) : null;
  if (!rec || rec.deletedAt) deny(404, 'Recording not available.');
  const download = r.url.searchParams.get('download') === '1';
  if (download && !r.ctx.config.recordingDownload) deny(403, 'Recording download is not permitted.');
  const url = await r.ctx.blobs.signedUrl(rec!.path, 900, download ? `the-floor-is-yours-${run.id}.wav` : undefined);
  if (!url) deny(404, 'Recording not available.');
  return json({ url });
});

// Task help: setup only. Clarifies the task; never writes the argument or hints at scores.
const helpBudget = new Map<string, { n: number; at: number }>();
on('POST', '/task-help', 'learner', async r => {
  const b = await r.body();
  const question = String(b.question ?? '').trim().slice(0, 500);
  if (!question) deny(422, 'Ask a question about the task.');
  if (String(b.stage ?? '') === 'recording') deny(409, 'Task help is paused while you speak.');
  const budget = helpBudget.get(r.learnerId) ?? { n: 0, at: Date.now() };
  if (Date.now() - budget.at > 10 * 60_000) { budget.n = 0; budget.at = Date.now(); }
  if (++budget.n > 20) deny(429, 'You have asked a lot of questions recently. Try again in a few minutes.');
  helpBudget.set(r.learnerId, budget);
  const run = await r.ctx.repo.activeRun(r.learnerId);
  const topic = topicById(run?.topicId);
  if (r.ctx.ai.status().taskHelp) {
    try {
      const answer = (await r.ctx.ai.taskHelp({ system: `${TASK_HELP_INSTRUCTION}${topic ? `\nThe learner's locked issue: ${topic.question} (${topic.boundary})` : ''}`, question })).trim();
      if (answer) return json({ answer: answer.slice(0, 800), source: 'ai' });
    } catch { /* fall back to the written guide */ }
  }
  return json({ answer: answerFromGuide(question, topic?.question ?? null), source: 'guide' });
});

// ── Facilitator (header x-facilitator-token = FACILITATOR_TOKEN) ─────────────
on('POST', '/facilitator/login', 'facilitator', async () => json({ ok: true }));

on('GET', '/facilitator/queue', 'facilitator', async r => {
  const q = await r.ctx.repo.reviewQueue(200);
  const recs = new Map(q.recordings.map(x => [x.id, x])), jobs = new Map(q.jobs.map(x => [x.id, x])), evs = new Map(q.evaluations.map(x => [x.evaluationId, x]));
  const items = q.runs.map(run => {
    const job = run.jobId ? jobs.get(run.jobId) : undefined;
    const ev = run.evaluationId ? evs.get(run.evaluationId) : undefined;
    const rec = run.recordingId ? recs.get(run.recordingId) : undefined;
    return {
      runId: run.id, displayName: run.displayName, topic: topicById(run.topicId)?.label, status: run.status, updatedAt: run.updatedAt,
      jobId: job?.id ?? null, jobStage: job?.stage ?? null, jobMessage: job?.message ?? null,
      reviewRequested: !!run.review, duration: rec?.duration ?? null, audioDeleted: !!rec?.deletedAt,
      transcript: job?.transcript?.text ?? null,
      evaluation: ev ? { id: ev.evaluationId, scoreRounded: ev.scoreRounded, scoreExact: ev.scoreExact, band: ev.band, ratings: ev.ratings, revisions: ev.revisions, deliveryAssessor: ev.deliveryAssessor } : null,
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return json({ items, capabilities: capabilities(r.ctx) });
});

on('GET', '/facilitator/runs/:id/audio-url', 'facilitator', async r => {
  const run = await r.ctx.repo.getRun(decodeURIComponent(r.params[0]));
  const rec = run?.recordingId ? await r.ctx.repo.getRecording(run.recordingId) : null;
  const url = rec && !rec.deletedAt ? await r.ctx.blobs.signedUrl(rec.path, 900) : null;
  if (!url) deny(404, 'Recording not available.');
  return json({ url });
});

on('POST', '/facilitator/jobs/:id/delivery', 'facilitator', async r => {
  const b = await r.body();
  const reviewer = String(b.reviewer ?? '').trim().slice(0, 80);
  if (!reviewer) deny(422, 'Reviewer name is required.');
  const rating: Rating = {
    id: 'delivery', level: Number(b.level) as Level, justification: String(b.justification ?? '').trim().slice(0, 600),
    evidence: (Array.isArray(b.evidence) ? b.evidence : []).slice(0, 4).map((e: { start: number; end: number; observation: string }) => ({
      start: Number(e.start), end: Number(e.end), quote: null, observation: String(e.observation ?? '').slice(0, 400), source: 'audio' as const,
    })),
  };
  if (!rating.justification) deny(422, 'Justification is required.');
  const jobId = decodeURIComponent(r.params[0]);
  try { await applyHumanDelivery(r.ctx, jobId, reviewer, rating); } catch (e) { deny(422, (e as Error).message); }
  const job = await r.ctx.repo.getJob(jobId);
  await audit(r.ctx, job!.runId, null, `facilitator:${reviewer}`, 'delivery.human-rated', { level: rating.level });
  return json({ ok: true });
});

on('POST', '/facilitator/runs/:id/retry', 'facilitator', async r => {
  const run = await r.ctx.repo.getRun(decodeURIComponent(r.params[0]));
  if (!run) deny(404, 'Run not found.');
  if (run!.status === 'closed-unscored' || run!.status === 'finished') deny(409, 'This run is closed.');
  try { await ensureJob(r.ctx, run!, 'facilitator'); } catch (e) { deny(409, (e as Error).message); }
  return json({ ok: true });
});

on('POST', '/facilitator/evaluations/:id/override', 'facilitator', async r => {
  const b = await r.body();
  const ev = await r.ctx.repo.getEvaluation(decodeURIComponent(r.params[0]));
  const reviewer = String(b.reviewer ?? '').trim().slice(0, 80);
  const reason = String(b.reason ?? '').trim().slice(0, 600);
  const changes = (Array.isArray(b.changes) ? b.changes : []) as { id: CriterionId; level: number }[];
  if (!ev) deny(404, 'Evaluation not found.');
  if (!reviewer || !reason || !changes.length) deny(422, 'Reviewer, reason and at least one change are required.');
  const next = ev!.ratings.map(x => ({ ...x }));
  const applied: { id: CriterionId; from: Level; to: Level }[] = [];
  for (const c of changes) {
    const x = next.find(y => y.id === c.id);
    if (!x || !Number.isInteger(c.level) || c.level < 0 || c.level > 4) deny(422, `Invalid change for ${c.id}.`);
    if (x!.level !== c.level) { applied.push({ id: x!.id, from: x!.level, to: c.level as Level }); x!.level = c.level as Level; x!.justification = `${x!.justification} [Facilitator override by ${reviewer}: ${reason}]`.slice(0, 600); }
  }
  const score = calculateScore(next);
  Object.assign(ev!, { ratings: next, scoreExact: score.exact, scoreRounded: score.rounded, band: score.band });
  ev!.revisions.push({ at: now(), by: reviewer, reason, changes: applied }); // append-only
  await r.ctx.repo.saveEvaluation(ev!);
  await audit(r.ctx, ev!.runId, null, `facilitator:${reviewer}`, 'evaluation.override', { evaluationId: ev!.evaluationId, reason, changes: applied, scoreRounded: score.rounded });
  return json({ ok: true, scoreRounded: score.rounded });
});

on('POST', '/facilitator/reviews/:runId/resolve', 'facilitator', async r => {
  const review = await r.ctx.repo.openReview(decodeURIComponent(r.params[0]));
  if (!review) deny(404, 'No open review.');
  review!.status = 'resolved'; review!.resolvedAt = now(); review!.resolvedBy = String((await r.body()).reviewer ?? 'facilitator').slice(0, 80);
  await r.ctx.repo.saveReview(review!);
  await audit(r.ctx, review!.runId, null, `facilitator:${review!.resolvedBy}`, 'review.resolved');
  return json({ ok: true });
});

on('GET', '/facilitator/audit', 'facilitator', async r => json({ audit: await r.ctx.repo.recentAudit(300) }));

// ── Internal: next assessment step in a fresh invocation ─────────────────────
on('POST', '/internal/jobs/:id/step', 'internal', async r => {
  r.ctx.defer(step(r.ctx, decodeURIComponent(r.params[0])).catch(e => console.error('[step]', (e as Error)?.message)));
  return json({ ok: true }, 202);
});

// ── Dispatcher ─────────────────────────────────────────────────────────────
export async function handle(req: Request, ctx: Ctx, auth: Auth): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  // Path after the function / API prefix: "/api/runs/1" and "/functions/v1/api/runs/1" → "/runs/1"
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, '') || '/';
  if (path === '/health') return json({ ok: true, capabilities: capabilities(ctx) });
  const route = routes.find(x => x.method === req.method && x.re.test(path));
  if (!route) return json({ error: 'Not found.' }, 404);
  let cookie: string | undefined;
  try {
    let learnerId = '';
    if (route.scope === 'facilitator') {
      if (!ctx.config.facilitatorToken) deny(404, 'Facilitator review is not enabled.');
      if (!(await safeEqual(req.headers.get('x-facilitator-token') ?? '', ctx.config.facilitatorToken))) deny(401, 'Sign in with the facilitator token.');
    } else if (route.scope === 'internal') {
      if (!auth.internalSecret || !(await safeEqual(req.headers.get('x-fiy-internal') ?? '', auth.internalSecret))) deny(403, 'Forbidden.');
    } else {
      const who = await auth.learner(req);
      if (!who) deny(401, 'Your session has expired. Reload the page to continue.');
      learnerId = who!.id; cookie = who!.setCookie;
    }
    let parsed: Record<string, unknown> | null = null;
    const body = async () => {
      if (parsed) return parsed;
      try { parsed = (await req.json()) as Record<string, unknown> ?? {}; } catch { parsed = {}; }
      return parsed!;
    };
    const res = await route.fn({ req, url, params: route.re.exec(path)!.slice(1), ctx, learnerId, body });
    if (cookie) res.headers.append('set-cookie', cookie);
    return res;
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status, cookie ? { 'set-cookie': cookie } : {});
    console.error('[api] error', err instanceof Error ? err.message : err);
    return json({ error: 'Something went wrong on the server. Your saved work is kept.' }, 500);
  }
}
