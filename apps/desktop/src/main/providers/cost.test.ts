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

  it("prices the Replicate tier the requested resolution selects", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5, resolution: "480p" },
    })
    expect(r.amount).toBeCloseTo(0.1028 * 5, 6)
    expect(r.confidence).toBe("estimated")
    expect(r.source).toBe("local_table")
  })

  it("uses the dearer video-input tier when a video reference is attached", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: {
        duration: 5,
        resolution: "720p",
        reference_videos: ["file:///clip.mp4"],
      },
    })
    expect(r.amount).toBeCloseTo(0.9676 * 5, 6)
  })

  it("uses the model's own schema default when the resolution is unset", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5 },
      inputSchema: {
        type: "object",
        properties: {
          resolution: {
            type: "string",
            enum: ["480p", "720p"],
            default: "480p",
          },
        },
      },
    })
    // The form would have submitted the schema default, so quoting the
    // worst-case tier here would overstate the price.
    expect(r.amount).toBeCloseTo(0.1028 * 5, 6)
    expect(r.sku).toBe("480p")
    expect(r.note).not.toMatch(/worst-case/i)
  })

  it("keeps the video-input variant when the tier comes from a schema default", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5, reference_videos: ["file:///clip.mp4"] },
      inputSchema: {
        properties: { resolution: { default: "480p" } },
      },
    })
    expect(r.sku).toBe("480p:video_in")
    expect(r.amount).toBeCloseTo(0.4304 * 5, 6)
  })

  it("still quotes the worst-case tier when the schema default is unusable", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5 },
      inputSchema: {
        properties: { resolution: { default: null, enum: ["480p", "720p"] } },
      },
    })
    expect(r.amount).toBeCloseTo(0.2312 * 5, 6)
    expect(r.note).toMatch(/worst-case/i)
  })

  it("falls back to the worst-case tier of the matching variant when the resolution is unset", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5 },
    })
    // No video input, so the fallback stays inside the non-video tiers.
    expect(r.amount).toBeCloseTo(0.2312 * 5, 6)
    expect(r.note).toMatch(/worst-case/i)
  })

  it("falls back inside the video-input tiers when a video is attached", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: {},
      params: { duration: 5, reference_videos: ["file:///clip.mp4"] },
    })
    expect(r.amount).toBeCloseTo(0.9676 * 5, 6)
    expect(r.sku).toBe("720p:video_in")
  })

  it("matches Replicate tier keys case-insensitively", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "image",
      slug: "google/nano-banana-2",
      pricingSkus: {},
      params: { resolution: "2K", num_outputs: 2 },
    })
    expect(r.amount).toBeCloseTo(0.101 * 2, 6)
    expect(r.basis).toBe("per_output")
  })

  it("defaults a per-output model to a single output", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "image",
      slug: "google/nano-banana-pro",
      pricingSkus: {},
      params: { resolution: "4K" },
    })
    expect(r.amount).toBeCloseTo(0.3, 6)
  })

  it("does not read num_frames as a duration in seconds", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.0",
      pricingSkus: {},
      params: { num_frames: 121, resolution: "480p" },
    })
    expect(r.confidence).toBe("unknown")
    expect(r.amount).toBe(0)
  })

  it("derives a duration from num_frames and fps when both are given", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "video",
      slug: "bytedance/seedance-2.0",
      pricingSkus: {},
      params: { num_frames: 120, fps: 24, resolution: "480p" },
    })
    expect(r.amount).toBeCloseTo(0.08 * 5, 6)
  })

  it("assumes the dearer audio SKU when the request does not say", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      pricingSkus: {
        duration_seconds_with_audio: "0.08",
        duration_seconds_without_audio: "0.05",
      },
      params: { duration: 8 },
    })
    expect(r.amount).toBeCloseTo(0.64, 5)
    expect(r.note).toMatch(/audio/i)
  })

  it("keeps every published tier for the curated Replicate models", () => {
    expect(Object.keys(REPLICATE_PRICING).sort()).toEqual([
      "bytedance/seedance-2.0",
      "bytedance/seedance-2.5",
      "google/nano-banana-2",
      "google/nano-banana-pro",
    ])
    expect(REPLICATE_PRICING["bytedance/seedance-2.0"]?.tiers).toMatchObject({
      "480p": 0.08,
      "480p:video_in": 0.1,
      "4k": 1,
      "4k:video_in": 1.25,
    })
  })
})
