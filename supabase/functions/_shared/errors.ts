// Provider failures are mapped to learner-safe messages. Raw provider bodies and keys never leave the server.
export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) { super(message); }
  static http(what: string, status: number) {
    if (status === 401 || status === 403) return new ProviderError(`${what} service rejected the server's credentials.`, false, status);
    if (status === 413) return new ProviderError(`${what} service rejected the file size.`, false, status);
    if (status === 429) return new ProviderError(`${what} service is busy (rate limited).`, true, status);
    if (status >= 500) return new ProviderError(`${what} service is temporarily unavailable.`, true, status);
    return new ProviderError(`${what} request failed (${status}).`, status === 408, status);
  }
  static transport(what: string, e: unknown) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return new ProviderError(timeout ? `${what} timed out.` : `${what} service could not be reached.`, true);
  }
}

/** Bounded retry with backoff for transport/5xx/429 failures only. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!(e instanceof ProviderError) || !e.retryable || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, 800 * 2 ** i + Math.random() * 300));
    }
  }
  throw last;
}
