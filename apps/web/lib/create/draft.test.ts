import type { CostQuote, ModelDescriptor } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { groupReferences, modelDefaults, quoteOf } from "./draft"

const descriptor = {
  key: "replicate:bytedance/seedance-2.5",
  kind: "video",
  name: "Seedance 2.5",
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
      resolution: { type: "string", enum: ["480p", "720p"], default: "720p" },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16"], default: "16:9" },
      duration: { type: "integer", default: 5 },
      watermark: { type: "boolean", default: false },
      reference_images: {
        type: "array",
        items: { type: "string" },
        default: [],
      },
    },
  },
  referenceSlots: [
    {
      field: "reference_images",
      label: "Reference Images",
      kind: "image",
      multiple: true,
      max: 12,
      role: "reference",
    },
  ],
  commonControls: {
    prompt: "prompt",
    aspectRatio: "aspect_ratio",
    duration: "duration",
    resolution: "resolution",
    seed: null,
    audio: null,
  },
} as unknown as ModelDescriptor

describe("a model's starting parameters", () => {
  it("puts promoted controls in common and the rest in advanced", () => {
    const { common, advanced } = modelDefaults(descriptor)
    expect(common).toEqual({
      resolution: "720p",
      aspect_ratio: "16:9",
      duration: 5,
    })
    expect(advanced).toEqual({ watermark: false })
  })

  it("never seeds a reference slot", () => {
    const { common, advanced } = modelDefaults(descriptor)
    expect(common).not.toHaveProperty("reference_images")
    expect(advanced).not.toHaveProperty("reference_images")
  })
})

describe("references for a request", () => {
  it("groups by slot in position order", () => {
    expect(
      groupReferences([
        { slotField: "a", assetId: "x2", position: 1 },
        { slotField: "b", assetId: "y", position: 0 },
        { slotField: "a", assetId: "x1", position: 0 },
      ])
    ).toEqual({ a: ["x1", "x2"], b: ["y"] })
  })
})

describe("the quote a run records", () => {
  it("records no amount when the rate is unknown — never $0.00", () => {
    const unknown = {
      amount: 0,
      confidence: "unknown",
    } as unknown as CostQuote
    expect(quoteOf(unknown)).toEqual({
      estimatedCostUsd: null,
      costConfidence: "unknown",
    })
  })

  it("records the amount the user saw", () => {
    const quote = { amount: 0.42, confidence: "estimated" } as CostQuote
    expect(quoteOf(quote)).toEqual({
      estimatedCostUsd: 0.42,
      costConfidence: "estimated",
    })
  })

  it("records nothing without a quote", () => {
    expect(quoteOf(undefined)).toEqual({
      estimatedCostUsd: null,
      costConfidence: null,
    })
  })
})
