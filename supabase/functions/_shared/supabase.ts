// Lovable Cloud implementation of the Repo and Blobs ports: Postgres tables + one private Storage bucket.
// Used only with the service-role client inside the `api` edge function; the browser never reads these
// tables directly (Row-Level Security is on with no learner policies — see supabase/migrations).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AuditRecord, Blobs, EvaluationRecord, JobRecord, Learner, RecordingRecord, Repo, ReviewRecord, RunRecord } from './ports.ts';

export const BUCKET = 'fiy-private';
const ACTIVE_EXCLUDED = '("finished","closed-unscored")';

function must<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(`database: ${r.error.message}`);
  return r.data;
}
const docs = <T>(rows: { doc: unknown }[] | null) => (rows ?? []).map(x => x.doc as T);
const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';

export function supabaseRepo(db: SupabaseClient): Repo {
  const one = async <T>(table: string, id: string) => {
    const data = must(await db.from(table).select('doc').eq('id', id).maybeSingle());
    return (data?.doc as T) ?? null;
  };
  return {
    async getLearner(id) {
      const d = must(await db.from('learners').select('id, display_name, created_at').eq('id', id).maybeSingle());
      return d ? { id: d.id, displayName: d.display_name, createdAt: d.created_at } as Learner : null;
    },
    async saveLearner(l) { must(await db.from('learners').upsert({ id: l.id, display_name: l.displayName, created_at: l.createdAt })); },

    getRun: id => one<RunRecord>('runs', id),
    async activeRun(learnerId) {
      const rows = must(await db.from('runs').select('doc').eq('learner_id', learnerId).not('status', 'in', ACTIVE_EXCLUDED).limit(1));
      return docs<RunRecord>(rows)[0] ?? null;
    },
    async insertRun(r) {
      const res = await db.from('runs').insert({ id: r.id, learner_id: r.learnerId, status: r.status, doc: r, created_at: r.createdAt, updated_at: r.updatedAt });
      if (isUniqueViolation(res.error)) return 'conflict';
      must(res); return 'ok';
    },
    async saveRun(r) { must(await db.from('runs').update({ status: r.status, doc: r, updated_at: r.updatedAt }).eq('id', r.id)); },

    getRecording: id => one<RecordingRecord>('recordings', id),
    async insertRecording(r) {
      const res = await db.from('recordings').insert({ id: r.id, run_id: r.runId, learner_id: r.learnerId, doc: r, created_at: r.createdAt });
      if (isUniqueViolation(res.error)) return 'conflict';
      must(res); return 'ok';
    },
    async saveRecording(r) { must(await db.from('recordings').update({ doc: r }).eq('id', r.id)); },
    async recordingsCreatedBefore(iso) {
      return docs<RecordingRecord>(must(await db.from('recordings').select('doc').lt('created_at', iso).is('doc->>deletedAt', null).limit(500)));
    },

    async getJob(id) {
      const d = must(await db.from('jobs').select('doc, lease_until').eq('id', id).maybeSingle());
      return d ? { ...(d.doc as JobRecord), leaseUntil: d.lease_until ?? null } : null;
    },
    async saveJob(j) {
      must(await db.from('jobs').upsert({ id: j.id, run_id: j.runId, learner_id: j.learnerId, stage: j.stage, lease_until: j.leaseUntil, doc: j, updated_at: j.updatedAt }));
    },
    async claimJob(id, untilIso, nowIso) {
      return must(await db.rpc('claim_job', { p_id: id, p_until: untilIso, p_now: nowIso })) === true;
    },
    async unfinishedJobs() {
      return docs<JobRecord>(must(await db.from('jobs').select('doc').in('stage', ['queued', 'transcribing', 'assessing', 'voicing']).limit(200)));
    },

    getEvaluation: id => one<EvaluationRecord>('evaluations', id),
    async saveEvaluation(e) { must(await db.from('evaluations').upsert({ id: e.evaluationId, run_id: e.runId, learner_id: e.learnerId, doc: e })); },

    async openReview(runId) {
      return docs<ReviewRecord>(must(await db.from('reviews').select('doc').eq('run_id', runId).eq('status', 'open').limit(1)))[0] ?? null;
    },
    async saveReview(r) { must(await db.from('reviews').upsert({ id: r.id, run_id: r.runId, learner_id: r.learnerId, status: r.status, doc: r })); },

    async addAudit(a) {
      must(await db.from('audit_log').insert({ id: a.id, at: a.at, run_id: a.runId, learner_id: a.learnerId, actor: a.actor, event: a.event, detail: a.detail ?? null }));
    },
    async recentAudit(limit) {
      const rows = must(await db.from('audit_log').select('id, at, run_id, learner_id, actor, event, detail').order('at', { ascending: false }).limit(limit));
      return (rows ?? []).map(x => ({ id: x.id, at: x.at, runId: x.run_id, learnerId: x.learner_id, actor: x.actor, event: x.event, detail: x.detail ?? undefined }) as AuditRecord);
    },

    async reviewQueue(limit) {
      const runs = docs<RunRecord>(must(await db.from('runs').select('doc').not('doc->>recordingId', 'is', null).order('updated_at', { ascending: false }).limit(limit)));
      const ids = (k: keyof RunRecord) => runs.map(r => r[k]).filter((x): x is string => typeof x === 'string');
      const fetch = async <T>(table: string, list: string[]) => list.length ? docs<T>(must(await db.from(table).select('doc').in('id', list))) : [];
      const [recordings, jobs, evaluations] = await Promise.all([
        fetch<RecordingRecord>('recordings', ids('recordingId')), fetch<JobRecord>('jobs', ids('jobId')), fetch<EvaluationRecord>('evaluations', ids('evaluationId')),
      ]);
      return { runs, recordings, jobs, evaluations };
    },
  };
}

export function supabaseBlobs(db: SupabaseClient): Blobs {
  const bucket = () => db.storage.from(BUCKET);
  return {
    async put(path, bytes, mimeType) {
      const { error } = await bucket().upload(path, new Blob([bytes as unknown as ArrayBuffer], { type: mimeType }), { contentType: mimeType, upsert: true });
      if (error) throw new Error(`storage: ${error.message}`);
    },
    async get(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) { await bucket().remove([path]); },
    async signedUrl(path, ttlSeconds, downloadName) {
      const { data, error } = await bucket().createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
      return error || !data ? null : data.signedUrl;
    },
  };
}
