import { describe, expect, it } from "vitest"

import { modelFamilySchema, type ModelFamily } from "./schema"
import {
  RegistryTranslationError,
  translateFamilyParams,
  translateFamilyRequest,
  type TranslateInput,
} from "./translate"

const family: ModelFamily = modelFamilySchema.parse({
  id: "seedance-2-5",
  name: "Seedance 2.5",
  kind: "video",
  endpoints: [
    {
      provider: "replicate",
      model: "bytedance/seedance-2.5",
      inputs: {
        first_frame: { field: "image", kind: "image" },
        last_frame: { field: "last_frame_image", kind: "image" },
        reference: { field: "reference_images", kind: "image", max: 3 },
        "reference:2": {
          field: "reference_videos",
          kind: "video",
          label: "Reference videos",
        },
      },
      controls: {
        prompt: { field: "prompt" },
        aspect_ratio: { field: "ratio" },
        duration: { field: "duration", values: { "5": 5, "10": 10 } },
        seed: { field: "seed" },
        generate_audio: { field: "generate_audio" },
        count: { field: "num_outputs" },
      },
    },
    {
      provider: "openrouter",
      model: "bytedance/seedance-2.5",
      inputs: {
        first_frame: { field: "first_frame", kind: "image", required: true },
        character: { field: "subjects", kind: "image" },
      },
      controls: { prompt: { field: "prompt" } },
    },
  ],
})

const replicate = family.endpoints[0]!
const openrouter = family.endpoints[1]!

/** Seedance 2.5's Replicate schema, trimmed, with a `ratio` rename. */
const replicateSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    image: { type: "string", format: "uri" },
    last_frame_image: { type: "string", format: "uri" },
    reference_images: {
      type: "array",
      items: { type: "string", format: "uri" },
    },
    reference_videos: {
      type: "array",
      items: { type: "string", format: "uri" },
    },
    ratio: { type: "string", enum: ["16:9", "9:16"] },
    duration: { type: "integer" },
    seed: { type: "integer" },
    generate_audio: { type: "boolean" },
    num_outputs: { type: "integer", minimum: 1, maximum: 4 },
    watermark: { type: "boolean" },
    aspect_ratio: { type: "string" },
  },
}

const openrouterSchema = {
  type: "object",
  properties: {
    prompt: { type: "string" },
    first_frame: { type: "string", format: "uri" },
    subjects: { type: "array", items: { type: "string", format: "uri" } },
    seed: { type: "integer" },
  },
  required: ["first_frame"],
}

function onReplicate(patch: Partial<TranslateInput> = {}): TranslateInput {
  return {
    family,
    endpoint: replicate,
    endpointSchema: replicateSchema,
    params: {},
    references: [],
    ...patch,
  }
}

function asset(slotField: string, position = 0, assetId = `a-${position}`) {
  return { slotField, assetId, position }
}

describe("translateFamilyRequest — controls", () => {
  it("renames a canonical control to the provider field", () => {
    const out = translateFamilyRequest(
      onReplicate({ params: { prompt: "a fox", aspect_ratio: "9:16" } })
    )
    expect(out.params).toEqual({ prompt: "a fox", ratio: "9:16" })
  })

  it("maps a value through `values`", () => {
    const out = translateFamilyRequest(
      onReplicate({ params: { duration: "10" } })
    )
    expect(out.params).toEqual({ duration: 10 })
  })

  it("rejects a value `values` does not list", () => {
    expect(() =>
      translateFamilyRequest(onReplicate({ params: { duration: "7" } }))
    ).toThrow(
      new RegistryTranslationError(
        "Seedance 2.5 on Replicate: 7 is not a duration this endpoint takes (5, 10)"
      )
    )
  })

  it("coerces a value to the schema's type", () => {
    const out = translateFamilyRequest(
      onReplicate({
        params: { seed: "42", generate_audio: "false", count: "2" },
      })
    )
    expect(out.params).toEqual({
      seed: 42,
      generate_audio: false,
      num_outputs: 2,
    })
  })

  it("leaves a value it cannot coerce untouched", () => {
    const out = translateFamilyRequest(onReplicate({ params: { seed: "abc" } }))
    expect(out.params).toEqual({ seed: "abc" })
  })

  it("coerces a `values`-mapped value to the schema's type", () => {
    const withValues = {
      ...replicate,
      controls: {
        ...replicate.controls,
        duration: { field: "duration", values: { "5": "5" } },
      },
    }
    const schema = {
      ...replicateSchema,
      properties: {
        ...replicateSchema.properties,
        duration: { type: "integer", enum: [5] },
      },
    }
    const out = translateFamilyRequest(
      onReplicate({
        endpoint: withValues,
        endpointSchema: schema,
        params: { duration: "5" },
      })
    )
    expect(out.params).toEqual({ duration: 5 })
  })

  it("accepts the count under its provider field name, as planBatch sets it", () => {
    const out = translateFamilyRequest(
      onReplicate({ params: { num_outputs: 3 } })
    )
    expect(out.params).toEqual({ num_outputs: 3 })
  })

  it("rejects a canonical control the endpoint does not map", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({
          endpoint: openrouter,
          endpointSchema: openrouterSchema,
          params: { duration: "5" },
          references: [asset("first_frame")],
        })
      )
    ).toThrow("Seedance 2.5 on OpenRouter has no duration control")
  })

  it("passes an unmapped control through when the schema has that field", () => {
    const out = translateFamilyRequest(
      onReplicate({
        endpoint: openrouter,
        endpointSchema: openrouterSchema,
        params: { seed: 7 },
        references: [asset("first_frame")],
      })
    )
    expect(out.params).toEqual({ seed: 7 })
  })

  it("rejects a raw field that would overwrite a passed-through control", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({
          endpoint: openrouter,
          endpointSchema: openrouterSchema,
          params: { seed: 7, "raw:seed": 8 },
          references: [asset("first_frame")],
        })
      )
    ).toThrow("Seedance 2.5 on OpenRouter may not overwrite the field seed")
  })

  it("drops an empty prompt on an endpoint with no prompt, which means unset", () => {
    const noPrompt = { ...replicate, controls: {} }
    const properties = Object.fromEntries(
      Object.entries(replicateSchema.properties).filter(([k]) => k !== "prompt")
    )
    const schema = { type: "object", properties }
    const out = translateFamilyRequest(
      onReplicate({
        endpoint: noPrompt,
        endpointSchema: schema,
        params: { prompt: "" },
      })
    )
    expect(out.params).toEqual({})
    expect(() =>
      translateFamilyRequest(
        onReplicate({
          endpoint: noPrompt,
          endpointSchema: schema,
          params: { prompt: "a fox" },
        })
      )
    ).toThrow("Seedance 2.5 on Replicate has no prompt control")
  })
})

describe("translateFamilyRequest — raw fields", () => {
  it("passes a bare unmapped field through", () => {
    const out = translateFamilyRequest(
      onReplicate({ params: { watermark: true } })
    )
    expect(out.params).toEqual({ watermark: true })
  })

  it("strips the raw: prefix from a colliding field", () => {
    const out = translateFamilyRequest(
      onReplicate({
        params: { aspect_ratio: "16:9", "raw:aspect_ratio": "custom" },
      })
    )
    expect(out.params).toEqual({ ratio: "16:9", aspect_ratio: "custom" })
  })

  it("rejects a raw field that would overwrite a mapped control field", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({ params: { aspect_ratio: "16:9", ratio: "9:16" } })
      )
    ).toThrow(
      "Seedance 2.5 on Replicate may not overwrite the mapped field ratio"
    )
    expect(() =>
      translateFamilyRequest(onReplicate({ params: { "raw:ratio": "9:16" } }))
    ).toThrow("may not overwrite the mapped field ratio")
  })

  it("rejects a raw field that would overwrite a mapped input field", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({ params: { image: "https://x.test/a.png" } })
      )
    ).toThrow("may not overwrite the mapped field image")
  })

  it("rejects a raw field the endpoint does not have", () => {
    expect(() =>
      translateFamilyRequest(onReplicate({ params: { cfg_scale: 0.5 } }))
    ).toThrow("Seedance 2.5 on Replicate has no cfg_scale field")
  })

  it("merges raw fields last", () => {
    const out = translateFamilyRequest(
      onReplicate({
        params: { "raw:aspect_ratio": "x", prompt: "p", watermark: false },
      })
    )
    expect(Object.keys(out.params)).toEqual([
      "prompt",
      "aspect_ratio",
      "watermark",
    ])
  })
})

describe("translateFamilyRequest — references", () => {
  it("renames slot keys to provider fields, keeping positions", () => {
    const out = translateFamilyRequest(
      onReplicate({
        references: [
          asset("first_frame", 0, "f"),
          asset("reference", 1, "r1"),
          asset("reference", 0, "r0"),
          asset("reference:2", 0, "v"),
        ],
      })
    )
    expect(out.references).toEqual([
      { slotField: "image", assetId: "f", position: 0 },
      { slotField: "reference_images", assetId: "r1", position: 1 },
      { slotField: "reference_images", assetId: "r0", position: 0 },
      { slotField: "reference_videos", assetId: "v", position: 0 },
    ])
  })

  it("rejects a role the endpoint cannot take", () => {
    expect(() =>
      translateFamilyRequest(onReplicate({ references: [asset("character")] }))
    ).toThrow(
      new RegistryTranslationError(
        "Seedance 2.5 on Replicate cannot take a Character input"
      )
    )
  })

  it("rejects more assets than the input's max", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({
          references: [0, 1, 2, 3].map((p) => asset("reference", p)),
        })
      )
    ).toThrow("Seedance 2.5 on Replicate takes at most 3 Reference inputs")
  })

  it("rejects a second asset in a single-URL field", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({
          references: [asset("first_frame", 0), asset("first_frame", 1)],
        })
      )
    ).toThrow("takes at most 1 First frame input")
  })

  it("rejects a request missing a required input", () => {
    expect(() =>
      translateFamilyRequest(
        onReplicate({ endpoint: openrouter, endpointSchema: openrouterSchema })
      )
    ).toThrow("Seedance 2.5 on OpenRouter needs a First frame input")
  })
})

describe("translateFamilyParams", () => {
  it("translates controls and raw fields without references", () => {
    expect(
      translateFamilyParams({
        family,
        endpoint: openrouter,
        endpointSchema: openrouterSchema,
        params: { prompt: "p", seed: "3" },
      })
    ).toEqual({ prompt: "p", seed: 3 })
  })
})
