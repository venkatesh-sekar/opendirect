import type { ModelDescriptor, ReferenceSlot } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { COMMON_ORDER, schemaDefaults, splitSchema } from "./split-schema"

function slot(overrides: Partial<ReferenceSlot> = {}): ReferenceSlot {
  return {
    field: "reference_images",
    label: "Reference Images",
    kind: "image",
    multiple: true,
    max: 12,
    role: "reference",
    verified: false,
    required: false,
    shape: null,
    ...overrides,
  }
}

/**
 * Shaped after Replicate's `bytedance/seedance-2.5` input schema: the six
 * promotable controls, two reference slots, and three fields that belong
 * nowhere but Advanced.
 */
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
      title: "Input",
      required: ["prompt"],
      properties: {
        prompt: { type: "string", title: "Prompt", default: "" },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16"],
          default: "16:9",
        },
        duration: { type: "integer", minimum: 1, maximum: 30, default: 5 },
        resolution: { type: "string", enum: ["480p", "720p"], default: "720p" },
        seed: { type: "integer", nullable: true, default: null },
        generate_audio: { type: "boolean", default: true },
        reference_images: {
          type: "array",
          items: { type: "string", format: "uri" },
          maxItems: 12,
        },
        last_frame_image: { type: "string", format: "uri" },
        watermark: { type: "boolean", default: false },
        output_format: {
          type: "string",
          enum: ["mp4", "webm"],
          default: "mp4",
        },
        // A field no version of OpenDirect has ever heard of. It must still
        // reach the user.
        neural_dithering_curve: { type: "string" },
      },
    },
    outputSchema: null,
    referenceSlots: [
      slot(),
      slot({
        field: "last_frame_image",
        label: "Last Frame Image",
        multiple: false,
        max: null,
        role: "last_frame",
      }),
    ],
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
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

describe("splitSchema", () => {
  it("promotes only the six known controls, in a fixed order", () => {
    const { common } = splitSchema(descriptor())

    expect(common.map((field) => field.control)).toEqual(COMMON_ORDER)
    expect(common.map((field) => field.field)).toEqual([
      "prompt",
      "aspect_ratio",
      "duration",
      "resolution",
      "seed",
      "generate_audio",
    ])
  })

  it("omits a control the model does not have", () => {
    const model = descriptor()
    const { properties, ...rest } = model.inputSchema as {
      properties: Record<string, unknown>
    }
    const withoutAudio = { ...properties }
    delete withoutAudio.generate_audio

    const { common } = splitSchema(
      descriptor({
        inputSchema: { ...rest, properties: withoutAudio },
        commonControls: { ...model.commonControls, audio: null },
      })
    )

    expect(common.map((field) => field.field)).not.toContain("generate_audio")
    expect(common).toHaveLength(5)
  })

  it("ignores a common control the schema does not actually declare", () => {
    const { common } = splitSchema(
      descriptor({
        commonControls: {
          prompt: "prompt",
          aspectRatio: "no_such_field",
          duration: null,
          resolution: null,
          seed: null,
          audio: null,
        },
      })
    )

    expect(common.map((field) => field.field)).toEqual(["prompt"])
  })

  it("carries the descriptor's reference slots through untouched", () => {
    const model = descriptor()
    expect(splitSchema(model).slots).toEqual(model.referenceSlots)
  })

  it("puts everything else — including fields it has never seen — in advanced", () => {
    const { advanced } = splitSchema(descriptor())

    expect(Object.keys(advanced.properties).sort()).toEqual([
      "neural_dithering_curve",
      "output_format",
      "watermark",
    ])
  })

  /**
   * The guardrail for the product rule "never hide a field": common + slots +
   * advanced must reconstruct the model's property set exactly, with no
   * duplicates and nothing dropped.
   */
  it("partitions the full property set with nothing omitted or duplicated", () => {
    const model = descriptor()
    const split = splitSchema(model)

    const covered = [
      ...split.common.map((field) => field.field),
      ...split.slots.map((reference) => reference.field),
      ...Object.keys(split.advanced.properties),
    ]
    const all = Object.keys(
      (model.inputSchema as { properties: Record<string, unknown> }).properties
    )

    expect(covered).toHaveLength(all.length)
    expect([...covered].sort()).toEqual([...all].sort())
  })

  it("keeps a slot field out of advanced even when it is also a common control", () => {
    const split = splitSchema(
      descriptor({
        commonControls: {
          prompt: "prompt",
          aspectRatio: null,
          duration: null,
          resolution: null,
          seed: null,
          // A model whose "audio" control is itself a reference slot.
          audio: "reference_images",
        },
      })
    )

    expect(split.common.map((field) => field.field)).toEqual(["prompt"])
    expect(Object.keys(split.advanced.properties)).not.toContain(
      "reference_images"
    )
  })

  it("keeps required fields with the half of the schema they landed in", () => {
    const model = descriptor()
    const split = splitSchema(
      descriptor({
        inputSchema: {
          ...(model.inputSchema as object),
          required: ["prompt", "watermark", "reference_images"],
        },
      })
    )

    expect(split.advanced.required).toEqual(["watermark"])
    expect(
      split.common.find((field) => field.field === "prompt")?.required
    ).toBe(true)
  })

  it("survives a model with no properties at all", () => {
    const split = splitSchema(
      descriptor({
        inputSchema: { type: "object" },
        referenceSlots: [],
        commonControls: {
          prompt: null,
          aspectRatio: null,
          duration: null,
          resolution: null,
          seed: null,
          audio: null,
        },
      })
    )

    expect(split.common).toEqual([])
    expect(split.advanced.properties).toEqual({})
  })

  it("titles a field from the schema, falling back to a humanized name", () => {
    const split = splitSchema(descriptor())
    expect(split.common[0]?.label).toBe("Prompt")
    expect(split.common[1]?.label).toBe("Aspect Ratio")
  })
})

describe("schemaDefaults", () => {
  it("returns the model's own defaults and nothing invented", () => {
    expect(schemaDefaults(descriptor())).toEqual({
      prompt: "",
      aspect_ratio: "16:9",
      duration: 5,
      resolution: "720p",
      generate_audio: true,
      watermark: false,
      output_format: "mp4",
    })
  })

  it("skips a null default, which Cog uses to mean 'unset'", () => {
    expect(schemaDefaults(descriptor())).not.toHaveProperty("seed")
  })
})
