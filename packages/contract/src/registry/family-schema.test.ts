import { describe, expect, it } from "vitest"

import fixture from "../../../../test/fixtures/replicate/model-seedance-2.5.json"
import { dereferenceCogSchema } from "../../../../apps/desktop/src/main/providers/replicate"
import { familyInputSchema } from "./family-schema"
import { mappingEndpointSchema } from "./schema"

const schemas = fixture.latest_version.openapi_schema.components
  .schemas as Record<string, unknown>
/** Seedance 2.5's real input schema, enums resolved as the adapter does. */
const seedanceSchema = dereferenceCogSchema(schemas.Input, schemas)

/** The bundled seedance-2-5 Replicate endpoint, copied in as a literal. */
const seedanceEndpoint = mappingEndpointSchema.parse({
  provider: "replicate",
  model: "bytedance/seedance-2.5",
  inputs: {
    first_frame: { field: "image", kind: "image" },
    last_frame: { field: "last_frame_image", kind: "image" },
    reference: { field: "reference_images", kind: "image", max: 30 },
    "reference:2": { field: "reference_videos", kind: "video", max: 10 },
    soundtrack: { field: "reference_audios", kind: "audio", max: 10 },
  },
  controls: {
    prompt: { field: "prompt" },
    aspect_ratio: { field: "aspect_ratio" },
    duration: { field: "duration" },
    resolution: { field: "resolution" },
    seed: { field: "seed" },
    generate_audio: { field: "generate_audio" },
  },
})

function propertiesOf(schema: Record<string, unknown>) {
  return schema.properties as Record<string, Record<string, unknown>>
}

describe("familyInputSchema on Seedance 2.5 (Replicate)", () => {
  const { inputSchema, commonControls } = familyInputSchema(
    seedanceEndpoint,
    seedanceSchema
  )
  const properties = propertiesOf(inputSchema)

  it("removes every mapped input field", () => {
    for (const field of [
      "image",
      "last_frame_image",
      "reference_images",
      "reference_videos",
      "reference_audios",
    ]) {
      expect(properties).not.toHaveProperty(field)
    }
  })

  it("keeps the mapped controls under their canonical names", () => {
    expect(properties.duration).toMatchObject({ type: "integer", default: 5 })
    expect(properties.aspect_ratio!.enum).toContain("16:9")
  })

  it("leaves unmapped fields in place for Advanced", () => {
    expect(properties.watermark).toMatchObject({ type: "boolean" })
    expect(properties).toHaveProperty("output_format")
  })

  it("names the common controls canonically", () => {
    expect(commonControls).toEqual({
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
    })
  })
})

describe("familyInputSchema rules", () => {
  const endpoint = mappingEndpointSchema.parse({
    provider: "openrouter",
    model: "acme/v",
    inputs: { first_frame: { field: "start", kind: "image" } },
    controls: {
      prompt: { field: "text" },
      duration: { field: "seconds", values: { "5": 5, "10": 10, "15": 15 } },
      resolution: { field: "size", values: { "720p": "1280x720" } },
      count: { field: "num_outputs" },
    },
  })
  const schema = {
    type: "object",
    title: "Input",
    required: ["text", "start", "prompt", "num_outputs"],
    properties: {
      text: { type: "string", title: "Text", "x-order": 0 },
      start: { type: "string", format: "uri" },
      seconds: {
        type: "integer",
        title: "Seconds",
        description: "Length",
        "x-order": 2,
        enum: [5, 10],
        default: 10,
        minimum: 5,
      },
      size: { type: "string", default: "1920x1080" },
      num_outputs: { type: "integer", maximum: 4 },
      prompt: { type: "string", title: "Legacy prompt" },
      resolution: { type: "string", title: "Unrelated" },
      seed: { type: "integer" },
    },
  }
  const { inputSchema, commonControls } = familyInputSchema(endpoint, schema)
  const properties = propertiesOf(inputSchema)

  it("renames controls and moves colliding unmapped fields to raw:", () => {
    expect(Object.keys(properties)).toEqual([
      "prompt",
      "duration",
      "resolution",
      "num_outputs",
      "raw:prompt",
      "raw:resolution",
      "seed",
    ])
    expect(properties.prompt).toEqual({
      type: "string",
      title: "Text",
      "x-order": 0,
    })
    expect(properties["raw:prompt"]!.title).toBe("Legacy prompt")
  })

  it("offers the canonical values the provider enum allows, reverse-mapping the default", () => {
    expect(properties.duration).toEqual({
      type: "string",
      title: "Seconds",
      description: "Length",
      "x-order": 2,
      enum: ["5", "10"],
      default: "10",
    })
  })

  it("offers every canonical value when there is no provider enum, and drops an unmappable default", () => {
    expect(properties.resolution).toEqual({ type: "string", enum: ["720p"] })
  })

  it("keeps count under its provider field name", () => {
    expect(properties.num_outputs).toEqual({ type: "integer", maximum: 4 })
    expect(properties).not.toHaveProperty("count")
  })

  it("rewrites required the same way", () => {
    expect(inputSchema.required).toEqual([
      "prompt",
      "raw:prompt",
      "num_outputs",
    ])
  })

  it("keeps the other root keys", () => {
    expect(inputSchema).toMatchObject({ type: "object", title: "Input" })
  })

  it("reads null for a control the endpoint does not map", () => {
    expect(commonControls).toEqual({
      prompt: "prompt",
      aspectRatio: null,
      duration: "duration",
      resolution: "resolution",
      seed: null,
      audio: null,
    })
  })
})
