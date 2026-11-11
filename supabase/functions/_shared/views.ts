import type { Assessment, Capabilities, JobView, RunView } from './types.ts';
import type { Ctx, EvaluationRecord, JobRecord, RunRecord } from './ports.ts';

export const consentVersion = (ctx: Ctx) => ctx.config.policyVersion ?? 'dev-unconfigured';

export function capabilities(ctx: Ctx): Capabilities {
  const s = ctx.ai.status();
  return {
    reasoning: s.reasoning, transcription: s.transcription,
    // Delivery needs an audio-capable assessor; without one a facilitator listens and rates it.
    delivery: s.delivery ? 'automatic' : ctx.config.facilitatorToken ? 'human' : 'none',
    voices: s.voices, reviewQueue: ctx.config.reviewQueue && !!ctx.config.facilitatorToken, supportUrl: ctx.config.supportUrl,
    recordingPolicyVersion: ctx.config.policyVersion, retentionDays: ctx.config.retentionDays,
    recordingDownload: ctx.config.recordingDownload, taskHelpAi: s.taskHelp,
  };
}

export function jobView(job: JobRecord): JobView {
  return {
    id: job.id, runId: job.runId, stage: job.stage, retryable: job.retryable, message: job.message, updatedAt: job.updatedAt,
    steps: { received: true, transcribed: !!job.transcript, assessed: !!job.evaluationId, voiced: job.stage === 'complete' },
  };
}

export async function assessmentView(ctx: Ctx, ev: EvaluationRecord): Promise<Assessment> {
  const turns = await Promise.all(ev.turns.map(async t => {
    const v = ev.voice[t.judgeId];
    const url = v && 'path' in v ? await ctx.blobs.signedUrl(v.path, 2 * 3600) : null;
    return url && v && 'path' in v ? { ...t, audioUrl: url, captions: v.captions } : { ...t, audioUrl: null, captions: [] };
  }));
  return {
    evaluationId: ev.evaluationId, runId: ev.runId, status: 'complete', ratings: ev.ratings,
    scoreExact: ev.scoreExact, scoreRounded: ev.scoreRounded, band: ev.band, strength: ev.strength, improvement: ev.improvement,
    turns, model: ev.model, rubricVersion: ev.rubricVersion, deliveryAssessor: ev.deliveryAssessor, completedAt: ev.completedAt,
  };
}

const CAPTURE_WINDOW_MS = 75_000; // 60 s capture + upload margin

export async function runView(ctx: Ctx, run: RunRecord): Promise<RunView> {
  const [rec, job] = await Promise.all([
    run.recordingId ? ctx.repo.getRecording(run.recordingId) : null,
    run.jobId ? ctx.repo.getJob(run.jobId) : null,
  ]);
  // The learner only receives an assessment once every stage (including voicing) has settled.
  const ev = job?.stage === 'complete' && run.evaluationId ? await ctx.repo.getEvaluation(run.evaluationId) : null;
  const sinceCapture = run.captureStartedAt ? Date.now() - Date.parse(run.captureStartedAt) : 0;
  return {
    id: run.id, topicId: run.topicId, status: run.status, stage: run.stage, displayName: run.displayName,
    consentVersion: run.consentVersion, briefing: run.briefing, captureStartedAt: run.captureStartedAt,
    // A capture that started but never produced a recording was interrupted — unless it is recent
    // enough to still be running (possibly in another tab).
    captureInterrupted: !!run.captureStartedAt && !rec && sinceCapture > CAPTURE_WINDOW_MS,
    captureInProgress: !!run.captureStartedAt && !rec && sinceCapture <= CAPTURE_WINDOW_MS,
    recording: rec ? { id: rec.id, duration: rec.duration, mimeType: rec.mimeType, trimmed: rec.trimmed } : null,
    job: job ? jobView(job) : null,
    assessment: ev ? await assessmentView(ctx, ev) : null,
    review: run.review,
  };
}
