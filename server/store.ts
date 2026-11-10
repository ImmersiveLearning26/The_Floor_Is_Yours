import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config';
import type { Assessment, CriterionId, Cue, JobStage, Level, Rating, RunStatus, ServerStage, TopicId } from '../shared/types';

// Single-process JSON store with atomic writes and a serialised write queue.
// Separate collections keep runs, recordings, transcripts, evaluations, reviews and audit apart.
// For multi-instance hosting swap this module for a database with the same functions.

export type Learner = { id: string; displayName: string; createdAt: string };
export type RunRecord = {
  id: string; learnerId: string; topicId: TopicId; displayName: string; idempotencyKey: string;
  status: RunStatus; stage: ServerStage; createdAt: string; updatedAt: string;
  consentVersion: string | null; consentAt: string | null;
  briefing: 'pending' | 'completed' | 'skipped';
  captureStartedAt: string | null; captureAttempts: number;
  recordingId: string | null; jobId: string | null; evaluationId: string | null;
  review: { receiptId: string; createdAt: string } | null;
  closedAt: string | null;
};
export type RecordingRecord = {
  id: string; runId: string; learnerId: string; file: string; mimeType: string; bytes: number;
  sha256: string; duration: number; trimmed: boolean; silent: boolean; maxVolumeDb: number | null; createdAt: string;
};
export type Transcript = { text: string; words: { text: string; start: number; end: number }[]; languageCode: string | null; provider: string };
export type DeliveryRecord = {
  status: 'complete' | 'needs-review'; recordingHash: string; rating: Rating | null;
  assessor: { provider: string; modelOrReviewer: string; version: string }; reason: string | null; at: string;
};
export type JobRecord = {
  id: string; runId: string; learnerId: string; recordingId: string; audioHash: string; rubricVersion: string;
  stage: JobStage; failedStage: JobStage | null; attempts: number; retryable: boolean; message: string | null;
  transcript: Transcript | null; delivery: DeliveryRecord | null; evaluationId: string | null;
  createdAt: string; updatedAt: string;
};
export type EvaluationRecord = Assessment & {
  learnerId: string; recordingHash: string; transcriptText: string;
  revisions: { at: string; by: string; reason: string; changes: { id: CriterionId; from: Level; to: Level }[] }[];
  voice: Record<string, { file: string; captions: Cue[]; key: string } | { error: string; key: string }>;
};
export type ReviewRecord = { id: string; runId: string; learnerId: string; createdAt: string; status: 'open' | 'resolved'; resolvedAt: string | null; resolvedBy: string | null };
export type AuditRecord = { id: string; at: string; runId: string | null; learnerId: string | null; actor: string; event: string; detail?: Record<string, unknown> };

type DB = {
  learners: Record<string, Learner>; runs: Record<string, RunRecord>; recordings: Record<string, RecordingRecord>;
  jobs: Record<string, JobRecord>; evaluations: Record<string, EvaluationRecord>; reviews: Record<string, ReviewRecord>;
  audit: AuditRecord[];
};

const DB_FILE = path.join(DATA_DIR, 'db.json');
export const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
export const VOICE_DIR = path.join(DATA_DIR, 'voice');
for (const d of [DATA_DIR, RECORDINGS_DIR, VOICE_DIR]) fs.mkdirSync(d, { recursive: true });

const empty = (): DB => ({ learners: {}, runs: {}, recordings: {}, jobs: {}, evaluations: {}, reviews: {}, audit: [] });
let db: DB = empty();
try { db = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* first start */ }

let queue = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(db);
  queue = queue.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, snapshot);
    await fs.promises.rename(tmp, DB_FILE);
  }).catch(err => console.error('[store] write failed', err?.message));
  return queue;
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

export const store = {
  get db() { return db; },
  async save() { await persist(); },
  async audit(e: Omit<AuditRecord, 'id' | 'at'>) {
    db.audit.push({ id: newId('aud'), at: now(), ...e });
    await persist();
  },
  activeRunFor(learnerId: string) {
    return Object.values(db.runs).find(r => r.learnerId === learnerId && r.status !== 'finished' && r.status !== 'closed-unscored') ?? null;
  },
};
