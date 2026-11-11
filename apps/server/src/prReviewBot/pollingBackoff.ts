const BASE_POLL_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

export interface PollOutcome {
  /** Consecutive failed polls, counting this one. */
  readonly failures: number;
  /** When GitHub said the quota resets or to retry, in epoch ms. */
  readonly retryAtMs?: number | undefined;
}

/**
 * Milliseconds until the next poll. Steady state is one minute. Failures double it up to 15
 * minutes; a rate limit waits for the reset GitHub named, whichever is later.
 */
export function nextPollDelayMs(outcome: PollOutcome, nowMs: number): number {
  const backoff =
    outcome.failures <= 0
      ? BASE_POLL_INTERVAL_MS
      : Math.min(MAX_BACKOFF_MS, BASE_POLL_INTERVAL_MS * 2 ** Math.min(outcome.failures, 10));
  const untilReset = outcome.retryAtMs === undefined ? 0 : outcome.retryAtMs - nowMs + 1_000;
  return Math.max(backoff, untilReset);
}

/**
 * When GitHub asks a client to wait: `retry-after` seconds, or the reset of an exhausted quota.
 * Undefined for an ordinary failure.
 */
export function rateLimitRetryAtMs(input: {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly nowMs: number;
}): number | undefined {
  if (input.status !== 403 && input.status !== 429) return undefined;
  const retryAfter = Number(input.headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return input.nowMs + retryAfter * 1_000;
  if (input.headers["x-ratelimit-remaining"] === "0") {
    const reset = Number(input.headers["x-ratelimit-reset"]);
    if (Number.isFinite(reset)) return reset * 1_000;
  }
  return input.status === 429 ? input.nowMs + BASE_POLL_INTERVAL_MS : undefined;
}
