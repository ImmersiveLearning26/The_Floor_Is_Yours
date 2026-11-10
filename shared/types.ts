// Shared contracts between browser and server. Adapted from the handoff kit
// (replication/shared/types.ts) with the server-owned run record added.
export type TopicId = 'T01' | 'T02' | 'T03';
export type JudgeId = 'ada' | 'tunde' | 'zainab';
export type CriterionId = 'position' | 'reasoning' | 'structure' | 'delivery';
export type Level = 0 | 1 | 2 | 3 | 4;

export type Topic = {
  id: TopicId; label: string; question: string; boundary: string;
  narration: string; image: string; audio: string; captions: string;
};
export type Judge = { id: JudgeId; name: string; role: string; focus: string; image: string };

export type Evidence = { start: number; end: number; quote?: string | null; observation: string; source: 'transcript' | 'audio' };
export type Rating = { id: CriterionId; level: Level; evidence: Evidence[]; justification: string };
export type Cue = { start: number; end: number; text: string };
export type FeedbackTurn = { judgeId: JudgeId; text: string; audioUrl?: string | null; captions?: Cue[] };

export type Assessment = {
  evaluationId: string; runId: string; status: 'complete'; ratings: Rating[];
  scoreExact: number; scoreRounded: number; band: string;
  strength: string; improvement: string; turns: FeedbackTurn[];
  model: string; rubricVersion: string; deliveryAssessor: string; completedAt: string;
};

export type Stage = 'welcome' | 'topics' | 'briefing' | 'mic' | 'recording' | 'processing' | 'feedback' | 'results';
export type MicStatus = 'idle' | 'requesting' | 'listening' | 'ready' | 'quiet' | 'denied' | 'missing' | 'busy' | 'unsupported' | 'insecure' | 'lost';
export type ProcessingStatus = 'uploading' | 'transcribing' | 'assessing' | 'voicing' | 'failed' | 'needs-review' | 'review-requested';

export type RunStatus = 'active' | 'submitted' | 'complete' | 'review-requested' | 'closed-unscored' | 'finished';
export type ServerStage = 'briefing' | 'mic' | 'processing' | 'feedback' | 'results';

export type JobStage = 'queued' | 'transcribing' | 'assessing' | 'voicing' | 'complete' | 'failed' | 'needs-review';
export type JobView = {
  id: string; runId: string; stage: JobStage; retryable: boolean;
  message: string | null; updatedAt: string;
  steps: { received: boolean; transcribed: boolean; assessed: boolean; voiced: boolean };
};

export type RunView = {
  id: string; topicId: TopicId; status: RunStatus; stage: ServerStage;
  displayName: string; consentVersion: string | null;
  briefing: 'pending' | 'completed' | 'skipped';
  captureStartedAt: string | null; captureInterrupted: boolean; captureInProgress: boolean;
  recording: { id: string; duration: number; mimeType: string; trimmed: boolean } | null;
  job: JobView | null; assessment: Assessment | null;
  review: { receiptId: string; createdAt: string } | null;
};

export type Capabilities = {
  reasoning: boolean; transcription: boolean; delivery: 'automatic' | 'human' | 'none';
  voices: boolean; reviewQueue: boolean; supportUrl: string | null;
  recordingPolicyVersion: string | null; retentionDays: number | null;
  recordingDownload: boolean; taskHelpAi: boolean;
};
