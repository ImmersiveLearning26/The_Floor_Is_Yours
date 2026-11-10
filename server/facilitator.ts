import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { store, now, RECORDINGS_DIR } from './store';
import { applyHumanDelivery, ensureJob } from './assessment';
import { setCookie, verifiedCookie } from './session';
import { calculateScore } from '../shared/scoring';
import { topicById } from '../shared/content';
import type { CriterionId, Level, Rating } from '../shared/types';

// Role-protected facilitator route: playback, transcript, human delivery rating, reasoned override,
// append-only revision audit. Disabled unless FACILITATOR_TOKEN is set. Never linked from learner UI.
export const facilitator = express.Router();

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function guard(req: Request, res: Response, next: NextFunction) {
  if (!config.facilitatorToken) return res.status(404).json({ error: 'Facilitator review is not enabled.' });
  if (verifiedCookie(req, 'fiy_fac') === 'facilitator') return next();
  res.status(401).json({ error: 'Sign in with the facilitator token.' });
}

facilitator.post('/login', (req, res) => {
  if (!config.facilitatorToken || !safeEq(String(req.body?.token ?? ''), config.facilitatorToken)) return res.status(401).json({ error: 'Invalid token.' });
  setCookie(res, 'fiy_fac', 'facilitator', 1);
  res.json({ ok: true });
});

facilitator.get('/queue', guard, (_req, res) => {
  const items = Object.values(store.db.runs).filter(r => r.recordingId).map(run => {
    const job = run.jobId ? store.db.jobs[run.jobId] : null;
    const ev = run.evaluationId ? store.db.evaluations[run.evaluationId] : null;
    const rec = store.db.recordings[run.recordingId!];
    return {
      runId: run.id, displayName: run.displayName, topic: topicById(run.topicId)?.label, status: run.status, updatedAt: run.updatedAt,
      jobId: job?.id ?? null, jobStage: job?.stage ?? null, jobMessage: job?.message ?? null,
      reviewRequested: !!run.review, duration: rec?.duration ?? null,
      transcript: job?.transcript?.text ?? null,
      evaluation: ev ? { id: ev.evaluationId, scoreRounded: ev.scoreRounded, scoreExact: ev.scoreExact, band: ev.band, ratings: ev.ratings, revisions: ev.revisions, deliveryAssessor: ev.deliveryAssessor } : null,
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ items });
});

facilitator.get('/runs/:id/audio', guard, (req, res) => {
  const run = store.db.runs[String(req.params.id)];
  const rec = run?.recordingId ? store.db.recordings[run.recordingId] : null;
  const file = rec ? path.join(RECORDINGS_DIR, rec.file) : '';
  if (!rec || !fs.existsSync(file)) return res.status(404).end();
  res.setHeader('Content-Type', rec.mimeType); res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(file);
});

facilitator.post('/jobs/:id/delivery', guard, async (req, res) => {
  const reviewer = String(req.body?.reviewer ?? '').trim().slice(0, 80);
  if (!reviewer) return res.status(422).json({ error: 'Reviewer name is required.' });
  const rating: Rating = {
    id: 'delivery', level: Number(req.body?.level) as Level, justification: String(req.body?.justification ?? '').trim().slice(0, 600),
    evidence: (Array.isArray(req.body?.evidence) ? req.body.evidence : []).slice(0, 4).map((e: { start: number; end: number; observation: string }) => ({
      start: Number(e.start), end: Number(e.end), quote: null, observation: String(e.observation ?? '').slice(0, 400), source: 'audio' as const,
    })),
  };
  if (!rating.justification) return res.status(422).json({ error: 'Justification is required.' });
  try {
    await applyHumanDelivery(String(req.params.id), reviewer, rating);
    const job = store.db.jobs[String(req.params.id)];
    await store.audit({ runId: job.runId, learnerId: null, actor: `facilitator:${reviewer}`, event: 'delivery.human-rated', detail: { level: rating.level } });
    res.json({ ok: true });
  } catch (e) { res.status(422).json({ error: (e as Error).message }); }
});

facilitator.post('/runs/:id/retry', guard, async (req, res) => {
  try { await ensureJob(String(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(409).json({ error: (e as Error).message }); }
});

facilitator.post('/evaluations/:id/override', guard, async (req, res) => {
  const ev = store.db.evaluations[String(req.params.id)];
  const reviewer = String(req.body?.reviewer ?? '').trim().slice(0, 80);
  const reason = String(req.body?.reason ?? '').trim().slice(0, 600);
  const changes = (Array.isArray(req.body?.changes) ? req.body.changes : []) as { id: CriterionId; level: number }[];
  if (!ev) return res.status(404).json({ error: 'Evaluation not found.' });
  if (!reviewer || !reason || !changes.length) return res.status(422).json({ error: 'Reviewer, reason and at least one change are required.' });
  const next = ev.ratings.map(r => ({ ...r }));
  const applied: { id: CriterionId; from: Level; to: Level }[] = [];
  for (const c of changes) {
    const r = next.find(x => x.id === c.id);
    if (!r || !Number.isInteger(c.level) || c.level < 0 || c.level > 4) return res.status(422).json({ error: `Invalid change for ${c.id}.` });
    if (r.level !== c.level) { applied.push({ id: r.id, from: r.level, to: c.level as Level }); r.level = c.level as Level; r.justification = `${r.justification} [Facilitator override by ${reviewer}: ${reason}]`.slice(0, 600); }
  }
  const score = calculateScore(next);
  ev.ratings = next; ev.scoreExact = score.exact; ev.scoreRounded = score.rounded; ev.band = score.band;
  ev.revisions.push({ at: now(), by: reviewer, reason, changes: applied }); // append-only
  await store.audit({ runId: ev.runId, learnerId: null, actor: `facilitator:${reviewer}`, event: 'evaluation.override', detail: { evaluationId: ev.evaluationId, reason, changes: applied, scoreRounded: score.rounded } });
  res.json({ ok: true, scoreRounded: score.rounded });
});

facilitator.post('/reviews/:runId/resolve', guard, async (req, res) => {
  const review = Object.values(store.db.reviews).find(r => r.runId === String(req.params.runId) && r.status === 'open');
  if (!review) return res.status(404).json({ error: 'No open review.' });
  review.status = 'resolved'; review.resolvedAt = now(); review.resolvedBy = String(req.body?.reviewer ?? 'facilitator').slice(0, 80);
  await store.audit({ runId: review.runId, learnerId: null, actor: `facilitator:${review.resolvedBy}`, event: 'review.resolved' });
  res.json({ ok: true });
});

facilitator.get('/audit', guard, (_req, res) => res.json({ audit: store.db.audit.slice(-300).reverse() }));
