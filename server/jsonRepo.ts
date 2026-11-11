// Local development store: one JSON file with atomic writes. Same Repo port as Lovable Cloud's Postgres
// (supabase/functions/_shared/supabase.ts), including the one-active-run and one-recording rules.
import fs from 'node:fs';
import path from 'node:path';
import type { AuditRecord, EvaluationRecord, JobRecord, Learner, RecordingRecord, Repo, ReviewRecord, RunRecord } from '../supabase/functions/_shared/ports.ts';

type DB = {
  learners: Record<string, Learner>; runs: Record<string, RunRecord>; recordings: Record<string, RecordingRecord>;
  jobs: Record<string, JobRecord>; evaluations: Record<string, EvaluationRecord>; reviews: Record<string, ReviewRecord>; audit: AuditRecord[];
};
const empty = (): DB => ({ learners: {}, runs: {}, recordings: {}, jobs: {}, evaluations: {}, reviews: {}, audit: [] });
const clone = <T>(x: T): T => (x === undefined || x === null ? x : structuredClone(x));
const unfinished = (r: RunRecord) => r.status !== 'finished' && r.status !== 'closed-unscored';

export function jsonRepo(dataDir: string): Repo {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'db.v2.json');
  let db: DB = empty();
  try { db = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first start */ }
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(db);
    queue = queue.then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot);
      await fs.promises.rename(tmp, file);
    }).catch(err => console.error('[store] write failed', err?.message));
    return queue;
  };
  const put = <K extends keyof Omit<DB, 'audit'>>(k: K, id: string, v: DB[K][string]) => { (db[k] as Record<string, unknown>)[id] = clone(v); return persist(); };

  return {
    async getLearner(id) { return clone(db.learners[id] ?? null); },
    async saveLearner(l) { await put('learners', l.id, l); },
    async getRun(id) { return clone(db.runs[id] ?? null); },
    async activeRun(learnerId) { return clone(Object.values(db.runs).find(r => r.learnerId === learnerId && unfinished(r)) ?? null); },
    async insertRun(r) {
      if (Object.values(db.runs).some(x => x.learnerId === r.learnerId && unfinished(x))) return 'conflict';
      await put('runs', r.id, r); return 'ok';
    },
    async saveRun(r) { await put('runs', r.id, r); },
    async getRecording(id) { return clone(db.recordings[id] ?? null); },
    async insertRecording(r) {
      if (Object.values(db.recordings).some(x => x.runId === r.runId)) return 'conflict';
      await put('recordings', r.id, r); return 'ok';
    },
    async saveRecording(r) { await put('recordings', r.id, r); },
    async recordingsCreatedBefore(iso) { return clone(Object.values(db.recordings).filter(r => r.createdAt < iso && !r.deletedAt)); },
    async getJob(id) { return clone(db.jobs[id] ?? null); },
    async saveJob(j) { await put('jobs', j.id, j); },
    async claimJob(id, untilIso, nowIso) {
      const j = db.jobs[id];
      if (!j || (j.leaseUntil && j.leaseUntil >= nowIso)) return false;
      j.leaseUntil = untilIso; await persist(); return true;
    },
    async unfinishedJobs() { return clone(Object.values(db.jobs).filter(j => ['queued', 'transcribing', 'assessing', 'voicing'].includes(j.stage))); },
    async getEvaluation(id) { return clone(db.evaluations[id] ?? null); },
    async saveEvaluation(e) { await put('evaluations', e.evaluationId, e); },
    async openReview(runId) { return clone(Object.values(db.reviews).find(r => r.runId === runId && r.status === 'open') ?? null); },
    async saveReview(r) { await put('reviews', r.id, r); },
    async addAudit(a) { db.audit.push(clone(a)); await persist(); },
    async recentAudit(limit) { return clone(db.audit.slice(-limit).reverse()); },
    async reviewQueue(limit) {
      const runs = Object.values(db.runs).filter(r => r.recordingId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
      const pick = <T>(m: Record<string, T>, ids: (string | null)[]) => ids.filter((x): x is string => !!x && !!m[x]).map(x => m[x]);
      return clone({ runs, recordings: pick(db.recordings, runs.map(r => r.recordingId)), jobs: pick(db.jobs, runs.map(r => r.jobId)), evaluations: pick(db.evaluations, runs.map(r => r.evaluationId)) });
    },
  };
}
