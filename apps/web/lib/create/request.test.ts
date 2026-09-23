import {
  generationRequestSchema,
  type CostQuote,
  type ModelDescriptor,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  buildGenerationRequest,
  costParams,
  missingRequirements,
} from "./request"

function descriptor(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    key: "replicate:bytedance/seedance-2.5",
    provider: "replicate",
    slug: "bytedance/seedance-2.5",
    name: "Seedance 2.5",
    description: null,
    kind: "video",
    versionId: "v1",
    coverImageUrl: null,
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", title: "Prompt" },
        duration: { type: "integer", default: 5 },
        resolution: { type: "string", enum: ["480p", "720p"] },
        watermark: { type: "boolean", default: false },
        reference_images: {
          type: "array",
          items: { type: "string", format: "uri" },
        },
        last_frame_image: { type: "string", format: "uri" },
      },
    },
    outputSchema: null,
    referenceSlots: [
      {
        field: "reference_images",
        label: "Reference Images",
        kind: "image",
        multiple: true,
        max: 12,
        role: "reference",
        verified: false,
        required: false,
        shape: null,
      },
      {
        field: "last_frame_image",
        label: "Last Frame Image",
        kind: "image",
        multiple: false,
        max: null,
        role: "last_frame",
        verified: false,
        required: false,
        shape: null,
      },
    ],
    commonControls: {
      prompt: "prompt",
      aspectRatio: null,
      duration: "duration",
      resolution: "resolution",
      seed: null,
      audio: null,
    },
    pricing: {
      basis: "per_second",
      currency: "USD",
      skus: {},
      estimate: null,
      source: "local_table",
      note: null,
    },
    raw: null,
    fetchedAt: 0,
    family: null,
    mappedBy: null,
    ...overrides,
  }
}

const quote: CostQuote = {
  amount: 1.156,
  currency: "USD",
  basis: "per_second",
  confidence: "estimated",
  source: "local_table",
  note: "Per second of output video.",
  sku: "720p",
}

function build(
  overrides: Partial<Parameters<typeof buildGenerationRequest>[0]> = {}
) {
  return buildGenerationRequest({
    descriptor: descriptor(),
    containerId: "c1",
    values: {
      prompt: "a bellhop opens the lift",
      common: { duration: 5, resolution: "720p" },
      advanced: { watermark: false },
      references: {},
    },
    ...overrides,
  })
}

describe("buildGenerationRequest", () => {
  it("names the model and the board the outputs land on", () => {
    const request = build()
    expect(request.modelKey).toBe("replicate:bytedance/seedance-2.5")
    expect(request.containerId).toBe("c1")
  })

  it("merges advanced and common values into one param set", () => {
    expect(build().params).toEqual({
      watermark: false,
      duration: 5,
      resolution: "720p",
      prompt: "a bellhop opens the lift",
    })
  })

  it("carries the prompt both as its own field and at the top level", () => {
    const request = build()
    expect(request.prompt).toBe("a bellhop opens the lift")
    expect(request.params.prompt).toBe("a bellhop opens the lift")
  })

  it("lets a common value override the same advanced key", () => {
    const request = build({
      values: {
        prompt: "",
        common: { duration: 9 },
        advanced: { duration: 5 },
        references: {},
      },
    })
    expect(request.params.duration).toBe(9)
  })

  it("omits an empty prompt rather than sending a blank string", () => {
    const request = build({
      values: { prompt: "   ", common: {}, advanced: {}, references: {} },
    })
    expect(request.prompt).toBeNull()
    expect(request.params).not.toHaveProperty("prompt")
  })

  it("omits values the user never set", () => {
    const request = build({
      values: {
        prompt: "x",
        common: { duration: undefined, resolution: "" },
        advanced: { watermark: null },
        references: {},
      },
    })
    expect(request.params).toEqual({ prompt: "x" })
  })

  /**
   * Reference slots hold asset ids, which no provider understands. They travel
   * in `references` so main can resolve them to files at submit time.
   */
  it("keeps reference slots out of params", () => {
    const request = build({
      values: {
        prompt: "x",
        common: {},
        advanced: { reference_images: ["nope"], last_frame_image: "nope" },
        references: { reference_images: ["a1"] },
      },
    })
    expect(request.params).toEqual({ prompt: "x" })
    expect(request.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
    ])
  })

  it("flattens references in slot order, numbering each slot from zero", () => {
    const request = build({
      values: {
        prompt: "x",
        common: {},
        advanced: {},
        references: {
          last_frame_image: ["z"],
          reference_images: ["a", "b"],
        },
      },
    })
    expect(request.references).toEqual([
      { slotField: "reference_images", assetId: "a", position: 0 },
      { slotField: "reference_images", assetId: "b", position: 1 },
      { slotField: "last_frame_image", assetId: "z", position: 0 },
    ])
  })

  it("ignores a selection for a slot this model does not have", () => {
    const request = build({
      values: {
        prompt: "x",
        common: {},
        advanced: {},
        references: { motion_video: ["m"] },
      },
    })
    expect(request.references).toEqual([])
  })

  it("records the quote it showed the user", () => {
    const request = build({ quote })
    expect(request.estimatedCostUsd).toBe(1.156)
    expect(request.costConfidence).toBe("estimated")
  })

  it("records no amount when the cost is unknown", () => {
    const request = build({
      quote: { ...quote, amount: 0, confidence: "unknown" },
    })
    expect(request.estimatedCostUsd).toBeNull()
    expect(request.costConfidence).toBe("unknown")
  })

  it("carries a parent when the run is a variant", () => {
    expect(build({ parentGenerationId: "g1" }).parentGenerationId).toBe("g1")
    expect(build().parentGenerationId).toBeNull()
  })

  it("carries the containers the prompt mentioned", () => {
    expect(
      build({ mentionedContainerIds: ["mira", "hall"] }).mentionedContainerIds
    ).toEqual(["mira", "hall"])
    // Not told is not the same as nobody: null, not an empty list.
    expect(build().mentionedContainerIds).toBeNull()
  })

  it("produces something the contract accepts", () => {
    expect(() => generationRequestSchema.parse(build({ quote }))).not.toThrow()
  })
})

describe("missingRequirements", () => {
  it("is empty when every required field has a value", () => {
    expect(missingRequirements(descriptor(), build())).toEqual([])
  })

  it("names a required field the user left blank", () => {
    const request = build({
      values: { prompt: "", common: {}, advanced: {}, references: {} },
    })
    expect(missingRequirements(descriptor(), request)).toEqual(["Prompt"])
  })

  it("counts a filled reference slot as satisfying its requirement", () => {
    const model = descriptor({
      inputSchema: {
        type: "object",
        required: ["reference_images"],
        properties: {
          prompt: { type: "string" },
          reference_images: { type: "array" },
        },
      },
    })
    const withReference = build({
      descriptor: model,
      values: {
        prompt: "x",
        common: {},
        advanced: {},
        references: { reference_images: ["a1"] },
      },
    })
    expect(missingRequirements(model, withReference)).toEqual([])
  })

  it("names an empty required reference slot by its slot label", () => {
    const model = descriptor({
      inputSchema: {
        type: "object",
        required: ["reference_images"],
        properties: { reference_images: { type: "array" } },
      },
    })
    expect(
      missingRequirements(
        model,
        build({
          descriptor: model,
          values: { prompt: "", common: {}, advanced: {}, references: {} },
        })
      )
    ).toEqual(["Reference Images"])
  })

  it("treats a field with a schema default as satisfied", () => {
    const model = descriptor({
      inputSchema: {
        type: "object",
        required: ["duration"],
        properties: { duration: { type: "integer", default: 5 } },
      },
    })
    expect(
      missingRequirements(
        model,
        build({
          descriptor: model,
          values: { prompt: "", common: {}, advanced: {}, references: {} },
        })
      )
    ).toEqual([])
  })
})

describe("costParams", () => {
  it("shows the estimator which reference slots are populated", () => {
    const model = descriptor()
    const request = build({
      values: {
        prompt: "x",
        common: { duration: 5 },
        advanced: {},
        references: {
          reference_images: ["a", "b"],
          last_frame_image: ["z"],
        },
      },
    })

    expect(costParams(model, request)).toEqual({
      duration: 5,
      reference_images: ["a", "b"],
      last_frame_image: "z",
    })
  })

  it("leaves an empty slot out, so an unset tier stays unset", () => {
    const model = descriptor()
    expect(costParams(model, build())).toEqual({
      watermark: false,
      duration: 5,
      resolution: "720p",
    })
  })

  it("strips the prompt, which no provider prices by", () => {
    const model = descriptor()
    const typed = costParams(model, build())
    const typedMore = costParams(
      model,
      build({
        values: {
          prompt: "a bellhop opens the lift slowly",
          common: { duration: 5, resolution: "720p" },
          advanced: { watermark: false },
          references: {},
        },
      })
    )

    expect(typed).not.toHaveProperty("prompt")
    // The params are the `cost:estimate` query key, so an identical quote must
    // be an identical object — otherwise every keystroke re-queries the price.
    expect(typedMore).toEqual(typed)
  })
})
