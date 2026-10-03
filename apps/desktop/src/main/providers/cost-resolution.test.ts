/**
 * Per-second, per-resolution pricing, read from the recorded OpenRouter video
 * catalog (`test/fixtures/openrouter/videos-models.json`) — never the live API.
 *
 * Wan 3.0 is the case that started this: it publishes one rate per output
 * resolution (`duration_seconds_480p/720p/1080p`) and nothing else, so its
 * estimate is `rate(resolution) × duration`.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  DURATION_FPS_FIELDS,
  DURATION_FRAME_FIELDS,
  DURATION_SECONDS_FIELDS,
  type ModelDescriptor,
} from "@opendirect/contract"

import { estimateCost, estimateForDescriptor, parseOpenRouterSku } from "./cost"
import { CURATED_PRICING, curatedPrice } from "./curated-pricing"

interface FixtureModel {
  id: string
  pricing_skus: Record<string, string>
}

const catalog = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "test/fixtures/openrouter/videos-models.json"),
    "utf8"
  )
) as { data: FixtureModel[] }

function skusOf(id: string): Record<string, string> {
  const model = catalog.data.find((one) => one.id === id)
  if (!model) throw new Error(`${id} is not in the fixture`)
  return model.pricing_skus
}

function quote(id: string, params: Record<string, unknown>) {
  return estimateCost({
    provider: "openrouter",
    kind: "video",
    slug: id,
    pricingSkus: skusOf(id),
    params,
  })
}

describe("parseOpenRouterSku", () => {
  it("reads resolution, audio and input mode from the key", () => {
    expect(parseOpenRouterSku("duration_seconds_1080p", "0.2")).toMatchObject({
      usd: 0.2,
      basis: "per_second",
      resolution: "1080p",
      audio: null,
      input: null,
    })
    expect(
      parseOpenRouterSku("duration_seconds_without_audio_4k", "0.25")
    ).toMatchObject({ resolution: "4k", audio: false })
    expect(
      parseOpenRouterSku("image_to_video_duration_seconds_720p", "0.10")
    ).toMatchObject({ resolution: "720p", input: "image" })
  })

  it("converts cents-per-second SKUs to dollars", () => {
    expect(
      parseOpenRouterSku("cents_per_video_output_second_1080p", "25")
    ).toMatchObject({ usd: 0.25, resolution: "1080p" })
    expect(parseOpenRouterSku("cents_per_second_output", "12")?.usd).toBe(0.12)
    expect(
      parseOpenRouterSku("cents_per_second_video_continuation_720p", "41")
    ).toMatchObject({ usd: 0.41, input: "video" })
  })

  it("ignores SKUs that are not a per-second rate", () => {
    expect(parseOpenRouterSku("video_tokens", "0.0000107")).toBeNull()
    expect(parseOpenRouterSku("cents_per_image_input", "1")).toBeNull()
    expect(
      parseOpenRouterSku("cents_per_megapixel_second_precise", "7.5")
    ).toBeNull()
    expect(parseOpenRouterSku("duration_seconds_720p", "free")).toBeNull()
  })
})

describe("Wan 3.0 (per-second, per-resolution)", () => {
  it.each([
    ["480p", 0.05],
    ["720p", 0.1],
    ["1080p", 0.2],
  ])("prices %s at its own rate", (resolution, rate) => {
    const r = quote("alibaba/wan-3.0", { duration: 5, resolution })
    expect(r.confidence).toBe("estimated")
    expect(r.source).toBe("provider_api")
    expect(r.amount).toBeCloseTo(rate * 5, 6)
    expect(r.sku).toBe(`duration_seconds_${resolution}`)
    expect(r.rate).toEqual({ amount: rate, unit: "second" })
  })

  it("scales with the duration", () => {
    expect(
      quote("alibaba/wan-3.0", { duration: 30, resolution: "1080p" }).amount
    ).toBeCloseTo(6, 6)
  })

  it("quotes the dearest resolution, and says so, when none is set", () => {
    const r = quote("alibaba/wan-3.0", { duration: 5 })
    expect(r.amount).toBeCloseTo(1, 6)
    expect(r.note).toMatch(/worst-case/i)
  })

  it("reads the resolution from the schema default the provider would use", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      slug: "alibaba/wan-3.0",
      pricingSkus: skusOf("alibaba/wan-3.0"),
      params: { duration: 5 },
      inputSchema: { properties: { resolution: { default: "720p" } } },
    })
    expect(r.amount).toBeCloseTo(0.5, 6)
    expect(r.note).not.toMatch(/worst-case/i)
  })

  it("is unknown without a duration, but still carries the rate", () => {
    const r = quote("alibaba/wan-3.0", { resolution: "1080p" })
    expect(r.confidence).toBe("unknown")
    expect(r.amount).toBe(0)
    expect(r.note).toMatch(/duration/i)
    expect(r.rate).toEqual({ amount: 0.2, unit: "second" })
  })

  it("uses the schema's default duration when the run leaves it unset", () => {
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      slug: "alibaba/wan-3.0",
      pricingSkus: skusOf("alibaba/wan-3.0"),
      params: { resolution: "1080p" },
      inputSchema: { properties: { duration: { default: 5 } } },
    })
    expect(r.confidence).toBe("estimated")
    expect(r.amount).toBeCloseTo(1, 6)
    expect(r.note).toMatch(/default of 5 s/)
  })

  it("prices through the descriptor, reading renamed duration/resolution fields", () => {
    const descriptor = {
      provider: "openrouter",
      kind: "video",
      slug: "alibaba/wan-3.0",
      inputSchema: { type: "object", properties: {} },
      commonControls: {
        prompt: "prompt",
        aspectRatio: null,
        duration: "seconds",
        resolution: "quality",
        seed: null,
        audio: null,
      },
      pricing: {
        basis: "per_second",
        currency: "USD",
        skus: skusOf("alibaba/wan-3.0"),
        estimate: null,
        source: "provider_api",
        note: null,
      },
    } as unknown as ModelDescriptor
    const r = estimateForDescriptor(descriptor, {
      seconds: 8,
      quality: "720p",
    })
    expect(r.amount).toBeCloseTo(0.8, 6)
  })
})

describe("duration field shapes (the renderer's duration control writes these)", () => {
  /** A Wan-3.0-priced descriptor whose schema names its length `field`. */
  function descriptorWith(
    properties: Record<string, unknown>,
    duration: string | null = null
  ): ModelDescriptor {
    return {
      provider: "openrouter",
      kind: "video",
      slug: "alibaba/wan-3.0",
      inputSchema: { type: "object", properties },
      commonControls: {
        prompt: "prompt",
        aspectRatio: null,
        duration,
        resolution: null,
        seed: null,
        audio: null,
      },
      pricing: {
        basis: "per_second",
        currency: "USD",
        skus: skusOf("alibaba/wan-3.0"),
        estimate: null,
        source: "provider_api",
        note: null,
      },
    } as unknown as ModelDescriptor
  }

  it.each(DURATION_SECONDS_FIELDS)(
    "reads a length in seconds named %s",
    (field) => {
      const r = estimateForDescriptor(descriptorWith({ [field]: {} }), {
        [field]: 10,
        resolution: "1080p",
      })
      expect(r.confidence).toBe("estimated")
      expect(r.amount).toBeCloseTo(2, 6)
    }
  )

  it.each(["10", "10s", "10 sec", "10 seconds"])(
    "reads the string %j as ten seconds",
    (value) => {
      const r = estimateForDescriptor(descriptorWith({ duration: {} }), {
        duration: value,
        resolution: "1080p",
      })
      expect(r.amount).toBeCloseTo(2, 6)
    }
  )

  it.each(
    DURATION_FRAME_FIELDS.flatMap((frames) =>
      DURATION_FPS_FIELDS.map((fps) => [frames, fps] as const)
    )
  )("divides a frame count %s by a frame rate %s", (frames, fps) => {
    const r = estimateForDescriptor(
      descriptorWith({ [frames]: {}, [fps]: {} }),
      {
        [frames]: 240,
        [fps]: 24,
        resolution: "1080p",
      }
    )
    expect(r.amount).toBeCloseTo(2, 6)
  })

  it("takes the frame rate from the schema default when the run leaves it unset", () => {
    const r = estimateForDescriptor(
      descriptorWith({ video_length: {}, fps: { default: 24 } }),
      { video_length: 240, resolution: "1080p" }
    )
    expect(r.amount).toBeCloseTo(2, 6)
  })

  it("reads a mapped frame-count control as frames, not seconds", () => {
    const r = estimateForDescriptor(
      descriptorWith({ clip_frames: {}, fps: {} }, "clip_frames"),
      { clip_frames: 240, fps: 24, resolution: "1080p" }
    )
    expect(r.amount).toBeCloseTo(2, 6)
  })

  it("never reads a frame count as seconds when no frame rate is known", () => {
    const r = estimateForDescriptor(descriptorWith({ num_frames: {} }), {
      num_frames: 81,
      resolution: "1080p",
    })
    expect(r.confidence).toBe("unknown")
    expect(r.rate).toEqual({ amount: 0.2, unit: "second" })
  })
})

describe("other per-second SKU shapes in the catalog", () => {
  it("picks the image-to-video rate when a first frame is attached", () => {
    const t2v = quote("alibaba/wan-2.6", { duration: 5, resolution: "1080p" })
    const i2v = quote("alibaba/wan-2.6", {
      duration: 5,
      resolution: "1080p",
      first_frame: "asset-1",
    })
    expect(t2v.amount).toBeCloseTo(0.12 * 5, 6)
    expect(i2v.amount).toBeCloseTo(0.15 * 5, 6)
  })

  it("quotes the dearest rate when no published rate fits the run", () => {
    // Wan 2.6 publishes no image-to-video rate at 480p.
    const r = quote("alibaba/wan-2.6", {
      duration: 5,
      resolution: "480p",
      first_frame: "asset-1",
    })
    expect(r.amount).toBeCloseTo(0.15 * 5, 6)
    expect(r.note).toMatch(/worst-case|dearest/i)
  })

  it("matches a resolution-specific rate over the default one", () => {
    const r = quote("google/veo-3.1-fast", {
      duration: 4,
      resolution: "720p",
      generate_audio: false,
    })
    expect(r.amount).toBeCloseTo(0.08 * 4, 6)
    const hd = quote("google/veo-3.1-fast", {
      duration: 4,
      resolution: "1080p",
      generate_audio: false,
    })
    expect(hd.amount).toBeCloseTo(0.1 * 4, 6)
  })

  it("prices cents-per-second SKUs and adds a per-input-image charge", () => {
    const r = quote("x-ai/grok-imagine-video-1.5", {
      duration: 6,
      resolution: "720p",
      image: "asset-1",
    })
    expect(r.amount).toBeCloseTo(0.14 * 6 + 0.01, 6)
    expect(r.note).toMatch(/input image/)
  })

  it("applies a provider's minimum charge per generation", () => {
    const r = quote("runway/aleph-2", { duration: 1 })
    expect(r.amount).toBeCloseTo(0.56, 6)
    expect(r.note).toMatch(/minimum/i)
  })

  it("charges a reference-mode rate only when references are attached", () => {
    // Recorded from the live catalog on 2026-10-03 (newer than the fixture).
    const heygen = {
      duration_seconds_480p: "0.02",
      duration_seconds_768p: "0.03",
      reference_duration_seconds_480p: "0.04",
      reference_duration_seconds_768p: "0.06",
    }
    const run = (params: Record<string, unknown>) =>
      estimateCost({
        provider: "openrouter",
        kind: "video",
        pricingSkus: heygen,
        params: { duration: 10, resolution: "768p", ...params },
      }).amount
    expect(run({})).toBeCloseTo(0.3, 6)
    expect(run({ reference_images: ["asset-1"] })).toBeCloseTo(0.6, 6)
  })

  it("says why a model priced in units it cannot estimate has no number", () => {
    const r = quote("black-forest-labs/flux-video-upscale", { duration: 5 })
    expect(r.confidence).toBe("unknown")
    expect(r.note).toMatch(/megapixel/)
  })
})

describe("curated pricing table", () => {
  it("parses and is keyed by model key", () => {
    for (const [key, price] of Object.entries(CURATED_PRICING)) {
      expect(key).toMatch(/^(replicate|openrouter):[^/]+\/.+$/)
      expect(Object.keys(price.tiers).length).toBeGreaterThan(0)
    }
    expect(curatedPrice("replicate", "bytedance/seedance-2.5")?.basis).toBe(
      "per_second"
    )
    expect(curatedPrice("openrouter", "bytedance/seedance-2.5")).toBeNull()
  })

  it("prices a model with a resolution-agnostic tier", () => {
    const r = estimateCost({
      provider: "replicate",
      kind: "image",
      slug: "black-forest-labs/flux-schnell",
      pricingSkus: {},
      params: { num_outputs: 4 },
    })
    expect(r.amount).toBeCloseTo(0.012, 6)
    expect(r.source).toBe("local_table")
  })

  it("lets a provider's own SKUs win over the curated table", () => {
    // seedance-2.5 is curated for Replicate only; its OpenRouter endpoint
    // publishes token SKUs, which stay unknown rather than borrowing a rate.
    const r = estimateCost({
      provider: "openrouter",
      kind: "video",
      slug: "bytedance/seedance-2.5",
      pricingSkus: skusOf("bytedance/seedance-2.5"),
      params: { duration: 5 },
    })
    expect(r.confidence).toBe("unknown")
    expect(r.basis).toBe("per_token")
  })
})
