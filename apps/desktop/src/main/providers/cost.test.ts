import { describe, expect, it } from "vitest"

import { estimateCost, REPLICATE_PRICING } from "./cost"

describe("estimateCost", () => {
  it("prices a per-second OpenRouter video model", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: {
        duration_seconds_with_audio: "0.08",
        duration_seconds_without_audio: "0.05",
      },
      params: { duration: 8, generate_audio: true },
    })
    expect(r.amount).toBeCloseTo(0.64, 5)
    expect(r.confidence).toBe("estimated")
  })

  it("picks the no-audio SKU when audio is off", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: {
        duration_seconds_with_audio: "0.08",
        duration_seconds_without_audio: "0.05",
      },
      params: { duration: 8, generate_audio: false },
    })
    expect(r.amount).toBeCloseTo(0.4, 5)
  })

  it("returns unknown confidence for token-based SKUs it cannot resolve", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: { video_tokens: "0.0000107" },
      params: { duration: 10 },
    })
    expect(r.confidence).toBe("unknown")
  })

  it("uses the local table for Replicate, which exposes no pricing API", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5 },
    })
    expect(r.confidence).toBe("estimated")
    expect(r.source).toBe("local_table")
  })

  it("degrades gracefully for an unknown Replicate model", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "image",
      slug: "someone/unknown-model",
      pricingSkus: {},
      params: {},
    })
    expect(r.confidence).toBe("unknown")
    expect(r.amount).toBe(0)
  })

  it("prefers the 720p SKU variant when the request asks for 720p", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: {
        duration_seconds_with_audio: "0.08",
        duration_seconds_without_audio: "0.05",
        duration_seconds_with_audio_720p: "0.05",
        duration_seconds_without_audio_720p: "0.03",
      },
      params: { duration: 4, generate_audio: true, resolution: "720p" },
    })
    expect(r.amount).toBeCloseTo(0.2, 5)
  })

  it("cannot price a per-second model without a duration", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: { duration_seconds_with_audio: "0.08" },
      params: {},
    })
    expect(r.confidence).toBe("unknown")
    expect(r.amount).toBe(0)
    expect(r.source).toBe("none")
  })

  it("multiplies a per-output Replicate image model by the output count", () => {
    const entry = REPLICATE_PRICING["google/nano-banana-pro"]
    expect(entry?.basis).toBe("per_output")
    const r = estimateCost({
      provider: "replicate",
      kind: "image",
      slug: "google/nano-banana-pro",
      pricingSkus: {},
      params: { num_outputs: 3 },
    })
    expect(r.amount).toBeCloseTo(entry!.usd * 3, 6)
    expect(r.source).toBe("local_table")
  })

  it("never invents a price for a Replicate model missing a duration", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.0",
      pricingSkus: {},
      params: {},
    })
    expect(r.confidence).toBe("unknown")
    expect(r.amount).toBe(0)
  })
})
