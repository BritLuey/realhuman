/**
 * A provider call that failed. `retryable` decides whether the next `failover` provider is tried:
 * true for "unavailable right now" (HTTP 402, 429, 5xx, network errors), false for anything that
 * would fail again elsewhere (bad request, refusal, missing key, malformed response).
 */
export class JevProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; retryable: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'JevProviderError';
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable;
  }
}

/** 402 (billing), 429 (rate limit) and 5xx mean the provider is unavailable, not that the request is wrong. */
export function isRetryableStatus(status: number): boolean {
  return status === 402 || status === 429 || status >= 500;
}

/** True for errors raised by an aborted fetch or `AbortSignal.timeout()`. */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}
