import { describe, expect, it } from "vitest"

import {
  backoffDelay,
  httpStatusOf,
  isRetryable,
  nextPollDelay,
  MAX_ATTEMPTS,
  ProviderReportedFailure,
} from "./poll"

describe("httpStatusOf", () => {
  it("reads the status off a Replicate SDK ApiError", () => {
    expect(httpStatusOf({ response: { status: 503 } })).toBe(503)
  })

  it("reads a plain status/statusCode property", () => {
    expect(httpStatusOf({ status: 429 })).toBe(429)
    expect(httpStatusOf({ statusCode: 404 })).toBe(404)
  })

  it("reads the status out of our own provider error messages", () => {
    expect(
      httpStatusOf(new Error("OpenRouter request failed with HTTP 500."))
    ).toBe(500)
  })

  it("has no status for a network failure", () => {
    expect(httpStatusOf(new Error("fetch failed"))).toBeNull()
  })
})

describe("isRetryable", () => {
  it("retries a 5xx", () => {
    expect(isRetryable(new Error("failed with HTTP 502."))).toBe(true)
  })

  it("retries a rate limit", () => {
    expect(isRetryable({ status: 429 })).toBe(true)
  })

  it("retries a transport failure that carries no status at all", () => {
    expect(isRetryable(new Error("fetch failed"))).toBe(true)
  })

  it("does not retry a 4xx — the request itself is wrong", () => {
    expect(isRetryable({ status: 400 })).toBe(false)
    expect(isRetryable({ status: 401 })).toBe(false)
    expect(isRetryable({ status: 422 })).toBe(false)
  })

  it("never retries a job the provider itself reported as failed", () => {
    // A provider-reported failure is an answer, not a transport problem:
    // re-submitting it would pay for the same failure twice.
    expect(
      isRetryable(new ProviderReportedFailure("NSFW content detected"))
    ).toBe(false)
  })
})

describe("backoffDelay", () => {
  it("grows exponentially from the base delay", () => {
    expect(backoffDelay(1, { random: () => 0 })).toBe(1000)
    expect(backoffDelay(2, { random: () => 0 })).toBe(2000)
    expect(backoffDelay(3, { random: () => 0 })).toBe(4000)
  })

  it("adds jitter so two jobs failing together do not retry in lockstep", () => {
    expect(backoffDelay(1, { random: () => 1 })).toBeGreaterThan(
      backoffDelay(1, { random: () => 0 })
    )
  })

  it("is capped so a long outage does not park a job for an hour", () => {
    expect(backoffDelay(20, { random: () => 1 })).toBeLessThanOrEqual(60_000)
  })

  it("gives up after three attempts", () => {
    expect(MAX_ATTEMPTS).toBe(3)
  })
})

describe("nextPollDelay", () => {
  it("uses the configured interval as its floor", () => {
    expect(nextPollDelay(3000, () => 0)).toBe(3000)
  })

  it("jitters upward by at most a quarter of the interval", () => {
    expect(nextPollDelay(3000, () => 1)).toBe(3750)
  })

  it("never polls faster than the floor, whatever settings say", () => {
    expect(nextPollDelay(0, () => 0)).toBeGreaterThanOrEqual(500)
  })
})
