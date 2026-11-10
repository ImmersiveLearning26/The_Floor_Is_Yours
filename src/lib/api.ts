import type { Capabilities, JobView, RunView, TopicId } from '../../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: Record<string, unknown> = {}) { super(message); }
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin', ...init,
      headers: init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json', ...init.headers } : init.headers,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
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
  upload: (id: string, blob: Blob) => {
    const form = new FormData();
    form.append('audio', blob, 'speech');
    return call<R & { duplicate?: boolean }>(`/runs/${id}/recording`, { method: 'POST', body: form }, 90000);
  },
  evaluate: (id: string) => post<R>(`/runs/${id}/evaluate`),
  job: (id: string) => call<{ job: JobView; run: RunView }>(`/jobs/${id}`),
  review: (id: string) => post<R>(`/runs/${id}/review`),
  closeUnscored: (id: string, reason: string) => post<R>(`/runs/${id}/close-unscored`, { reason }),
  toResults: (id: string) => post<R>(`/runs/${id}/stage`, { stage: 'results' }),
  finish: (id: string) => post<R>(`/runs/${id}/finish`),
  taskHelp: (question: string, stage: string) => post<{ answer: string; source: 'ai' | 'guide' }>('/task-help', { question, stage }, 35000),
  recordingUrl: (id: string, download = false) => `/api/runs/${id}/recording/audio${download ? '?download=1' : ''}`,
};
