import { store, type RunRecord, type JobRecord } from './store';
import type { Assessment, JobView, RunView } from '../shared/types';

export function jobView(job: JobRecord): JobView {
  return {
    id: job.id, runId: job.runId, stage: job.stage, retryable: job.retryable, message: job.message, updatedAt: job.updatedAt,
    steps: { received: true, transcribed: !!job.transcript, assessed: !!job.evaluationId, voiced: job.stage === 'complete' },
  };
}

export function assessmentView(evaluationId: string | null): Assessment | null {
  const ev = evaluationId ? store.db.evaluations[evaluationId] : null;
  if (!ev) return null;
  return {
    evaluationId: ev.evaluationId, runId: ev.runId, status: 'complete', ratings: ev.ratings,
    scoreExact: ev.scoreExact, scoreRounded: ev.scoreRounded, band: ev.band, strength: ev.strength, improvement: ev.improvement,
    turns: ev.turns.map(t => {
      const v = ev.voice[t.judgeId];
      return v && 'file' in v
        ? { ...t, audioUrl: `/api/evaluations/${ev.evaluationId}/voice/${t.judgeId}?k=${v.key}`, captions: v.captions }
        : { ...t, audioUrl: null, captions: [] };
    }),
    model: ev.model, rubricVersion: ev.rubricVersion, deliveryAssessor: ev.deliveryAssessor, completedAt: ev.completedAt,
  };
}

export function runView(run: RunRecord): RunView {
  const rec = run.recordingId ? store.db.recordings[run.recordingId] : null;
  const job = run.jobId ? store.db.jobs[run.jobId] : null;
  const jobDone = job?.stage === 'complete';
  return {
    id: run.id, topicId: run.topicId, status: run.status, stage: run.stage, displayName: run.displayName,
    consentVersion: run.consentVersion, briefing: run.briefing,
    captureStartedAt: run.captureStartedAt,
    // A capture that started but never produced a server recording was interrupted — unless it is
    // recent enough to still be running (possibly in another tab); 60 s capture + upload margin.
    captureInterrupted: !!run.captureStartedAt && !rec && Date.now() - Date.parse(run.captureStartedAt) > 75_000,
    captureInProgress: !!run.captureStartedAt && !rec && Date.now() - Date.parse(run.captureStartedAt) <= 75_000,
    recording: rec ? { id: rec.id, duration: rec.duration, mimeType: rec.mimeType, trimmed: rec.trimmed } : null,
    job: job ? jobView(job) : null,
    // The learner only receives an assessment once every stage (including voicing) has settled.
    assessment: jobDone ? assessmentView(run.evaluationId) : null,
    review: run.review,
  };
}
