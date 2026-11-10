import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { capabilities, config, consentVersion, reasoningReady } from './config';
import { store, now, newId, RECORDINGS_DIR, VOICE_DIR, type RunRecord } from './store';
import { runView, jobView } from './views';
import { ensureJob } from './assessment';
import { sniff, sha256, decodedDuration, trimTo, maxVolumeDb } from './audio';
import { taskHelp } from './providers/reasoning';
import { TASK_HELP_INSTRUCTION } from './prompt';
import { answerFromGuide } from './taskGuide';
import { topicById, MAX_SECONDS } from '../shared/content';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
class HttpError extends Error { constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); } }
const deny = (status: number, message: string, extra?: Record<string, unknown>) => { throw new HttpError(status, message, extra); };

/** Owner-only lookup: other learners' runs are indistinguishable from missing ones. */
function ownRun(req: Request): RunRecord {
  const run = store.db.runs[String(req.params.id)];
  if (!run || run.learnerId !== req.learnerId) deny(404, 'Run not found.');
  return run!;
}
const touch = (run: RunRecord) => { run.updatedAt = now(); };

api.get('/session', h((req, res) => {
  const learner = store.db.learners[req.learnerId];
  const active = store.activeRunFor(req.learnerId);
  res.json({ displayName: learner?.displayName || '', capabilities: capabilities(), consentVersion: consentVersion(), activeRun: active ? runView(active) : null });
}));

api.post('/session/name', h(async (req, res) => {
  const name = String(req.body?.displayName ?? '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > 60) deny(422, 'Enter a name between 1 and 60 characters.');
  store.db.learners[req.learnerId].displayName = name;
  await store.save();
  res.json({ displayName: name });
}));

api.get('/runs/active', h((req, res) => {
  const run = store.activeRunFor(req.learnerId);
  res.json({ run: run ? runView(run) : null });
}));

api.post('/runs', h(async (req, res) => {
  const topic = topicById(req.body?.topicId);
  const key = String(req.body?.idempotencyKey ?? '').slice(0, 80);
  if (!topic) deny(422, 'Choose one of the three issues.');
  if (!key) deny(422, 'Missing idempotency key.');
  const learner = store.db.learners[req.learnerId];
  if (!learner.displayName) deny(409, 'Enter your name first.');
  const existing = store.activeRunFor(req.learnerId);
  if (existing) {
    if (existing.idempotencyKey === key) return res.json({ run: runView(existing) }); // double click / retry
    return deny(409, 'You already have an unfinished run. Resume it before choosing another issue.', { run: runView(existing) });
  }
  const run: RunRecord = {
    id: newId('run'), learnerId: req.learnerId, topicId: topic!.id, displayName: learner.displayName, idempotencyKey: key,
    status: 'active', stage: 'briefing', createdAt: now(), updatedAt: now(), consentVersion: null, consentAt: null,
    briefing: 'pending', captureStartedAt: null, captureAttempts: 0, recordingId: null, jobId: null, evaluationId: null, review: null, closedAt: null,
  };
  store.db.runs[run.id] = run;
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'run.created', detail: { topicId: run.topicId } });
  res.status(201).json({ run: runView(run) });
}));

api.post('/runs/:id/briefing', h(async (req, res) => {
  const run = ownRun(req);
  if (run.status !== 'active') deny(409, 'Briefing is already closed for this run.');
  const outcome = req.body?.outcome === 'completed' ? 'completed' : 'skipped';
  if (run.briefing === 'pending') run.briefing = outcome;
  if (run.stage === 'briefing') run.stage = 'mic';
  touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'briefing.' + outcome });
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/consent', h(async (req, res) => {
  const run = ownRun(req);
  if (run.status !== 'active') deny(409, 'Consent can only be given before recording.');
  if (req.body?.policyVersion !== consentVersion()) deny(409, 'The recording policy changed. Review it and agree again.');
  if (req.body?.recording !== true || req.body?.assessment !== true) deny(422, 'Recording and AI assessment consent are both required.');
  run.consentVersion = consentVersion(); run.consentAt = now(); touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'consent.given', detail: { policyVersion: run.consentVersion } });
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/capture-start', h(async (req, res) => {
  const run = ownRun(req);
  if (run.status !== 'active' || run.recordingId) deny(409, 'This run already has its one recording.');
  if (!run.consentVersion) deny(409, 'Consent is required before recording.');
  if (run.captureStartedAt) deny(409, 'A capture is already open for this run. Report it as interrupted before starting a replacement.');
  run.captureStartedAt = now(); run.captureAttempts += 1; run.stage = 'mic'; touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'capture.started', detail: { attempt: run.captureAttempts } });
  res.json({ run: runView(run) });
}));

// Only a verified technical failure (no valid recording on the server) re-opens capture. Audited.
api.post('/runs/:id/capture-failed', h(async (req, res) => {
  const run = ownRun(req);
  if (run.recordingId) deny(409, 'A valid recording already exists and cannot be replaced.');
  const reason = String(req.body?.reason ?? 'unknown').slice(0, 200);
  run.captureStartedAt = null; run.stage = 'mic'; touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'capture.technical-failure', detail: { reason } });
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/recording', upload.single('audio'), h(async (req, res) => {
  const run = ownRun(req);
  if (run.recordingId) return res.status(200).json({ run: runView(run), duplicate: true }); // immutable; idempotent re-send
  if (run.status !== 'active') deny(409, 'This run is not accepting a recording.');
  if (!run.consentVersion) deny(409, 'Consent is required before a recording can be saved.');
  if (!run.captureStartedAt) deny(409, 'No capture was started for this run.');
  const file = req.file;
  if (!file?.buffer?.length) deny(422, 'The recording was empty.');
  const kind = sniff(file!.buffer);
  if (!kind) deny(415, 'The recording format is not supported.');
  const id = newId('rec');
  const raw = path.join(RECORDINGS_DIR, `${id}.upload.${kind!.ext}`);
  await fs.promises.writeFile(raw, file!.buffer, { mode: 0o600 });
  let duration: number;
  try { duration = await decodedDuration(raw); } catch (e) {
    await fs.promises.unlink(raw).catch(() => {});
    await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'system', event: 'recording.rejected', detail: { reason: (e as Error).message } });
    return deny(422, 'The recording could not be decoded. This is a technical capture problem, not your performance.', { technical: true });
  }
  let finalFile = raw, trimmed = false;
  if (duration > MAX_SECONDS) {
    const out = path.join(RECORDINGS_DIR, `${id}.${kind!.ext}`);
    await trimTo(raw, out, MAX_SECONDS, kind!.ext);
    await fs.promises.unlink(raw).catch(() => {});
    finalFile = out; trimmed = true;
    duration = Math.min(MAX_SECONDS, await decodedDuration(out));
  } else {
    const out = path.join(RECORDINGS_DIR, `${id}.${kind!.ext}`);
    await fs.promises.rename(raw, out); finalFile = out;
  }
  if (duration < 0.5) {
    await fs.promises.unlink(finalFile).catch(() => {});
    return deny(422, 'The recording was too short to contain a capture. Record again.', { technical: true });
  }
  const buf = await fs.promises.readFile(finalFile);
  const vol = await maxVolumeDb(finalFile);
  store.db.recordings[id] = {
    id, runId: run.id, learnerId: req.learnerId, file: path.basename(finalFile), mimeType: kind!.mimeType, bytes: buf.length,
    sha256: sha256(buf), duration: Number(duration.toFixed(3)), trimmed, silent: vol !== null && vol < -50, maxVolumeDb: vol, createdAt: now(),
  };
  run.recordingId = id; run.status = 'submitted'; run.stage = 'processing'; touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'system', event: 'recording.saved', detail: { recordingId: id, duration, trimmed, bytes: buf.length } });
  res.status(201).json({ run: runView(run) });
}));

api.post('/runs/:id/evaluate', h(async (req, res) => {
  const run = ownRun(req);
  if (!run.recordingId) deny(409, 'There is no saved recording to assess yet.');
  if (run.status === 'closed-unscored' || run.status === 'finished') deny(409, 'This run is closed.');
  await ensureJob(run.id);
  res.json({ run: runView(run) });
}));

api.get('/jobs/:id', h((req, res) => {
  const job = store.db.jobs[String(req.params.id)];
  if (!job || job.learnerId !== req.learnerId) deny(404, 'Job not found.');
  const run = store.db.runs[job!.runId];
  res.json({ job: jobView(job!), run: runView(run) });
}));

api.post('/runs/:id/review', h(async (req, res) => {
  const run = ownRun(req);
  if (!capabilities().reviewQueue) deny(501, 'No review route is configured for this deployment.');
  const job = run.jobId ? store.db.jobs[run.jobId] : null;
  if (run.review) return res.json({ run: runView(run) });
  if (!job || !['failed', 'needs-review'].includes(job.stage)) deny(409, 'A review can be requested when assessment cannot complete.');
  const review = { id: newId('rev'), runId: run.id, learnerId: req.learnerId, createdAt: now(), status: 'open' as const, resolvedAt: null, resolvedBy: null };
  store.db.reviews[review.id] = review;
  run.review = { receiptId: review.id, createdAt: review.createdAt }; run.status = 'review-requested'; touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'review.requested', detail: { receiptId: review.id } });
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/close-unscored', h(async (req, res) => {
  const run = ownRun(req);
  if (run.status === 'closed-unscored') return res.json({ run: runView(run) });
  if (run.status === 'complete' || run.status === 'finished') deny(409, 'This run has a completed assessment. Use Finish instead.');
  const job = run.jobId ? store.db.jobs[run.jobId] : null;
  const recoverable = !run.recordingId ? run.stage === 'mic' : !!job && ['failed', 'needs-review'].includes(job.stage) || run.status === 'review-requested';
  if (!recoverable) deny(409, 'Assessment is still in progress.');
  run.status = 'closed-unscored'; run.closedAt = now(); touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'run.closed-unscored', detail: { reason: String(req.body?.reason ?? '').slice(0, 200), hadRecording: !!run.recordingId } });
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/stage', h(async (req, res) => {
  const run = ownRun(req);
  if (req.body?.stage !== 'results' || run.status !== 'complete') deny(409, 'Results are available after a complete assessment.');
  run.stage = 'results'; touch(run); await store.save();
  res.json({ run: runView(run) });
}));

api.post('/runs/:id/finish', h(async (req, res) => {
  const run = ownRun(req);
  if (run.status === 'finished') return res.json({ run: runView(run) });
  if (run.status !== 'complete' || !run.evaluationId) deny(409, 'Finish requires a completed assessment.');
  run.status = 'finished'; run.closedAt = now(); touch(run);
  await store.audit({ runId: run.id, learnerId: req.learnerId, actor: 'learner', event: 'run.finished', detail: { evaluationId: run.evaluationId } });
  res.json({ run: runView(run) });
}));

function streamFile(res: Response, file: string, type: string) {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(file);
}

api.get('/runs/:id/recording/audio', h((req, res) => {
  const run = ownRun(req);
  const rec = run.recordingId ? store.db.recordings[run.recordingId] : null;
  const file = rec && path.join(RECORDINGS_DIR, rec.file);
  if (!rec || !file || !fs.existsSync(file)) deny(404, 'Recording not available.');
  if (req.query.download === '1') {
    if (!config.recordingDownload) deny(403, 'Recording download is not permitted.');
    res.setHeader('Content-Disposition', `attachment; filename="the-floor-is-yours-${run.id}.${path.extname(rec!.file).slice(1)}"`);
  }
  streamFile(res, file!, rec!.mimeType);
}));

api.get('/evaluations/:id/voice/:judge', h((req, res) => {
  const ev = store.db.evaluations[String(req.params.id)];
  if (!ev || ev.learnerId !== req.learnerId) deny(404, 'Not found.');
  const v = ev!.voice[String(req.params.judge)];
  if (!v || !('file' in v)) deny(404, 'Voice not available.');
  streamFile(res, path.join(VOICE_DIR, (v as { file: string }).file), 'audio/mpeg');
}));

// Task help: setup only. Clarifies the task; never writes the argument or hints at scores.
const helpBudget = new Map<string, { n: number; at: number }>();
api.post('/task-help', h(async (req, res) => {
  const question = String(req.body?.question ?? '').trim().slice(0, 500);
  const stage = String(req.body?.stage ?? '');
  if (!question) deny(422, 'Ask a question about the task.');
  if (stage === 'recording') deny(409, 'Task help is paused while you speak.');
  const b = helpBudget.get(req.learnerId) ?? { n: 0, at: Date.now() };
  if (Date.now() - b.at > 10 * 60_000) { b.n = 0; b.at = Date.now(); }
  if (++b.n > 20) deny(429, 'You have asked a lot of questions recently. Try again in a few minutes.');
  helpBudget.set(req.learnerId, b);
  const run = store.activeRunFor(req.learnerId);
  const topic = topicById(run?.topicId);
  if (reasoningReady()) {
    try {
      const answer = await taskHelp(`${TASK_HELP_INSTRUCTION}${topic ? `\nThe learner's locked issue: ${topic.question} (${topic.boundary})` : ''}`, question);
      if (answer) return res.json({ answer, source: 'ai' });
    } catch { /* fall back to the written guide */ }
  }
  res.json({ answer: answerFromGuide(question, topic?.question ?? null), source: 'guide' });
}));

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'The recording file is too large.' : 'Upload failed.' });
  console.error('[api] error', err instanceof Error ? err.message : err);
  res.status(500).json({ error: 'Something went wrong on the server. Your saved work is kept.' });
});
