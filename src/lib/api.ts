import type { Capabilities, JobView, RunView, TopicId } from '../../shared/types';
import { apiBase, authHeaders } from './backend';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  let res: Response;
  try {
    const auth = await authHeaders();
    res = await fetch(`${apiBase}${path}`, {
      credentials: 'same-origin', ...init,
      headers: { ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...auth, ...(init.headers as Record<string, string>) },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && /session/i.test(e.message)) throw new ApiError(e.message, 0);
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ApiError(timeout ? 'The server took too long to respond.' : 'You appear to be offline or the server is unreachable.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error || `Request failed (${res.status}).`, res.status, body);
  return body as T;
}
const post = <T>(path: string, data?: unknown, timeoutMs?: number) => call<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }, timeoutMs);

export type SessionInfo = { displayName: string; capabilities: Capabilities; consentVersion: string; activeRun: RunView | null };
type R = { run: RunView };

export const api = {
  session: () => call<SessionInfo>('/session'),
  setName: (displayName: string) => post<{ displayName: string }>('/session/name', { displayName }),
  active: () => call<{ run: RunView | null }>('/runs/active'),
  createRun: (topicId: TopicId, idempotencyKey: string) => post<R>('/runs', { topicId, idempotencyKey }),
  briefing: (id: string, outcome: 'completed' | 'skipped') => post<R>(`/runs/${id}/briefing`, { outcome }),
  consent: (id: string, policyVersion: string) => post<R>(`/runs/${id}/consent`, { policyVersion, recording: true, assessment: true }),
  captureStart: (id: string) => post<R>(`/runs/${id}/capture-start`),
  captureFailed: (id: string, reason: string) => post<R>(`/runs/${id}/capture-failed`, { reason }),
  /** Body: the recording as a 16 kHz mono WAV (see lib/wav.ts). */
  upload: (id: string, wav: Blob) => call<R & { duplicate?: boolean }>(`/runs/${id}/recording`, { method: 'POST', body: wav, headers: { 'content-type': 'audio/wav' } }, 90000),
  evaluate: (id: string) => post<R>(`/runs/${id}/evaluate`),
  job: (id: string) => call<{ job: JobView; run: RunView }>(`/jobs/${id}`),
  review: (id: string) => post<R>(`/runs/${id}/review`),
  closeUnscored: (id: string, reason: string) => post<R>(`/runs/${id}/close-unscored`, { reason }),
  toResults: (id: string) => post<R>(`/runs/${id}/stage`, { stage: 'results' }),
  finish: (id: string) => post<R>(`/runs/${id}/finish`),
  taskHelp: (question: string, stage: string) => post<{ answer: string; source: 'ai' | 'guide' }>('/task-help', { question, stage }, 35000),
  /** Short-lived link to the learner's own recording (playback, or download). */
  recordingUrl: (id: string, download = false) => call<{ url: string }>(`/runs/${id}/recording/url${download ? '?download=1' : ''}`).then(r => r.url),
};
