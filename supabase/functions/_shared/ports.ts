// The core (app.ts, pipeline.ts) talks to the outside world only through these four ports.
// Lovable Cloud supplies them from Postgres + Storage + Lovable AI (supabase.ts, ai/lovable.ts);
// the local dev server supplies them from a JSON file + the file system (server/).
import type { Assessment, CriterionId, Cue, JobStage, JudgeId, Level, Rating, RunStatus, ServerStage, TopicId } from './types.ts';

// ── Records ────────────────────────────────────────────────────────────────
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
  id: string; runId: string; learnerId: string; path: string; mimeType: string; bytes: number;
  sha256: string; duration: number; trimmed: boolean; silent: boolean; maxVolumeDb: number | null;
  createdAt: string; deletedAt: string | null;
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
  leaseUntil: string | null; createdAt: string; updatedAt: string;
};
export type VoiceRecord = { path: string; mimeType: string; captions: Cue[]; key: string } | { error: string; key: string };
export type EvaluationRecord = Omit<Assessment, 'turns'> & {
  turns: { judgeId: JudgeId; text: string }[];
  learnerId: string; recordingHash: string; transcriptText: string;
  revisions: { at: string; by: string; reason: string; changes: { id: CriterionId; from: Level; to: Level }[] }[];
  voice: Partial<Record<JudgeId, VoiceRecord>>;
};
export type ReviewRecord = { id: string; runId: string; learnerId: string; createdAt: string; status: 'open' | 'resolved'; resolvedAt: string | null; resolvedBy: string | null };
export type AuditRecord = { id: string; at: string; runId: string | null; learnerId: string | null; actor: string; event: string; detail?: Record<string, unknown> };

// ── Ports ──────────────────────────────────────────────────────────────────
export interface Repo {
  getLearner(id: string): Promise<Learner | null>;
  saveLearner(l: Learner): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  /** The learner's unfinished run (status not finished / closed-unscored), if any. */
  activeRun(learnerId: string): Promise<RunRecord | null>;
  /** 'conflict' when the learner already has an unfinished run (enforced by the store, not just the caller). */
  insertRun(r: RunRecord): Promise<'ok' | 'conflict'>;
  saveRun(r: RunRecord): Promise<void>;
  getRecording(id: string): Promise<RecordingRecord | null>;
  /** 'conflict' when the run already has its one recording. */
  insertRecording(r: RecordingRecord): Promise<'ok' | 'conflict'>;
  saveRecording(r: RecordingRecord): Promise<void>;
  recordingsCreatedBefore(iso: string): Promise<RecordingRecord[]>;
  getJob(id: string): Promise<JobRecord | null>;
  saveJob(j: JobRecord): Promise<void>;
  /** Atomically take the job's processing lease if it is free or expired. */
  claimJob(id: string, untilIso: string, nowIso: string): Promise<boolean>;
  unfinishedJobs(): Promise<JobRecord[]>;
  getEvaluation(id: string): Promise<EvaluationRecord | null>;
  saveEvaluation(e: EvaluationRecord): Promise<void>;
  openReview(runId: string): Promise<ReviewRecord | null>;
  saveReview(r: ReviewRecord): Promise<void>;
  addAudit(a: AuditRecord): Promise<void>;
  recentAudit(limit: number): Promise<AuditRecord[]>;
  /** Runs that have a recording, newest first, with their related records (facilitator queue). */
  reviewQueue(limit: number): Promise<{ runs: RunRecord[]; recordings: RecordingRecord[]; jobs: JobRecord[]; evaluations: EvaluationRecord[] }>;
}

/** Private file storage (one bucket). Paths: recordings/<learner>/<id>.wav, voices/<evaluation>/<judge>-<key>.<ext> */
export interface Blobs {
  put(path: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
  /** Short-lived URL the browser can play or download without other credentials. */
  signedUrl(path: string, ttlSeconds: number, downloadName?: string): Promise<string | null>;
}

// ── AI ─────────────────────────────────────────────────────────────────────
// Everything the AI does is behind this interface. The core builds the prompts, validates every answer
// against the recording and computes the score in code; an AI implementation only makes the calls.
export type AiStatus = {
  /** Shown in audit records, e.g. "lovable-ai". */
  provider: string;
  transcription: boolean; delivery: boolean; reasoning: boolean; voices: boolean; taskHelp: boolean;
};
export type AudioInput = { audio: Uint8Array; mimeType: 'audio/wav'; durationSeconds: number };
export type DeliveryAnswer = {
  uncertain: boolean; level?: number; justification?: string;
  evidence?: { start: number; end: number; observation: string }[]; model: string;
};
export type JudgeInput = {
  system: string; evidence: unknown; schema: Record<string, unknown>; toolName: 'submit_assessment';
  repair?: { previous: unknown; errors: string[] };
};
export interface Ai {
  status(): AiStatus;
  /** Speech-to-text of the actual recording, with word timestamps in seconds when the engine provides them. */
  transcribe(input: AudioInput): Promise<Transcript>;
  /** Audio-capable model listens to the recording and rates DELIVERY only (instruction supplied by the core). */
  assessDelivery(input: AudioInput & { instruction: string; userText: string }): Promise<DeliveryAnswer>;
  /** Chat model returns position/reasoning/structure ratings + three judge turns via the forced tool call. */
  judge(input: JudgeInput): Promise<{ output: unknown; model: string }>;
  /** Text-to-speech for one judge turn; captions optional (the core falls back to timed text). */
  speak(input: { text: string; judgeId: JudgeId }): Promise<{ audio: Uint8Array; mimeType: string; cues: Cue[] | null }>;
  /** Short plain-text answer about the task rules (never the argument). */
  taskHelp(input: { system: string; question: string }): Promise<string>;
}

// ── Context ────────────────────────────────────────────────────────────────
export type Config = {
  policyVersion: string | null; retentionDays: number | null; supportUrl: string | null;
  reviewQueue: boolean; recordingDownload: boolean; facilitatorToken: string; maxUploadBytes: number;
};
export type Ctx = {
  repo: Repo; blobs: Blobs; ai: Ai; config: Config;
  /** Keep work running after the response is sent (EdgeRuntime.waitUntil on Lovable Cloud). */
  defer(p: Promise<unknown>): void;
  /** Run the next assessment step soon, in a fresh invocation where the platform has time limits. */
  kick(jobId: string): void;
};

export function configFromEnv(get: (k: string) => string | undefined): Config {
  const env = (k: string) => (get(k) ?? '').trim();
  const flag = (k: string, dflt = false) => env(k) ? /^(1|true|yes)$/i.test(env(k)) : dflt;
  return {
    policyVersion: env('RECORDING_POLICY_VERSION') || null,
    retentionDays: env('RECORDING_RETENTION_DAYS') ? Number(env('RECORDING_RETENTION_DAYS')) : null,
    supportUrl: env('SUPPORT_URL') || null,
    reviewQueue: flag('REVIEW_QUEUE_ENABLED'),
    recordingDownload: flag('ALLOW_RECORDING_DOWNLOAD', true),
    facilitatorToken: env('FACILITATOR_TOKEN'),
    maxUploadBytes: 8 * 1024 * 1024,
  };
}
