/**
 * The runner's timing and retry arithmetic, as pure functions.
 *
 * It lives apart from `runner.ts` because these are the decisions worth
 * asserting on directly — how long to wait, and whether an error is worth
 * paying for a second attempt — and because a function with no clock and no
 * network is the only kind that can be tested without either.
 *
 * ⛔ Nothing here calls a provider.
 */

/** Poll no faster than this, whatever the settings say. */
export const MIN_POLL_INTERVAL_MS = 500

/** Jitter added to each poll, as a fraction of the interval. */
const POLL_JITTER = 0.25

/** First retry waits this long; each further one doubles it. */
export const RETRY_BASE_MS = 1000

/** However long the outage, a retry is never parked longer than this. */
export const RETRY_MAX_MS = 60_000

/** Submit attempts per job, including the first. */
export const MAX_ATTEMPTS = 3

/**
 * A failure that a second attempt cannot fix, and would be charged for.
 *
 * `isRetryable` says no to every one of these, because by the time one is
 * thrown the provider has already accepted (and billed for) the request.
 */
export class TerminalJobError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TerminalJobError"
  }
}

/**
 * A job the provider itself finished as failed.
 *
 * Distinct from a transport error on purpose: the request was accepted, ran
 * and produced a verdict, so re-sending it would pay for the same failure
 * again.
 */
export class ProviderReportedFailure extends TerminalJobError {
  constructor(message: string) {
    super(message)
    this.name = "ProviderReportedFailure"
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/**
 * The HTTP status behind an error, however the thrower chose to express it.
 *
 * Three shapes reach the runner: the Replicate SDK's `ApiError` (which carries
 * the whole `Response`), a plain object with `status`/`statusCode`, and our own
 * OpenRouter adapter's message, which states the status in words. A transport
 * failure has no status at all, which is a meaningful answer rather than a
 * missing one — see `isRetryable`.
 */
export function httpStatusOf(error: unknown): number | null {
  if (isObject(error)) {
    const response = error.response
    if (isObject(response) && typeof response.status === "number") {
      return response.status
    }
    if (typeof error.status === "number") return error.status
    if (typeof error.statusCode === "number") return error.statusCode
  }

  const message = error instanceof Error ? error.message : String(error ?? "")
  const match = /\bHTTP (\d{3})\b/.exec(message)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

/**
 * Whether a failed attempt is worth repeating.
 *
 * A 4xx is the request being wrong — a bad parameter, a rejected key, a model
 * that does not exist — and repeating it would spend money on the same
 * refusal. A 5xx, a 429 and a bare transport failure are the provider or the
 * network having a moment, which is exactly what a retry is for.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TerminalJobError) return false
  const status = httpStatusOf(error)
  if (status === null) return true
  if (status === 429) return true
  return status >= 500
}

export interface JitterOptions {
  random?: () => number
}

/** Exponential backoff with jitter, capped, for attempt 1, 2, 3, … */
export function backoffDelay(
  attempt: number,
  options: JitterOptions = {}
): number {
  const random = options.random ?? Math.random
  const base = Math.min(
    RETRY_MAX_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
  )
  return Math.min(
    RETRY_MAX_MS,
    Math.round(base + base * POLL_JITTER * random())
  )
}

/**
 * How long to wait before the next poll.
 *
 * Jittered upward so two jobs submitted together do not settle into polling
 * the same provider on the same millisecond for the rest of their lives.
 */
export function nextPollDelay(
  intervalMs: number,
  random: () => number = Math.random
): number {
  const interval = Math.max(MIN_POLL_INTERVAL_MS, Math.round(intervalMs))
  return Math.round(interval + interval * POLL_JITTER * random())
}
