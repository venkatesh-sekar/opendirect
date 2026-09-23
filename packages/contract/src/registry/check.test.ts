import { describe, expect, it } from "vitest"

import fixture from "../../../../test/fixtures/replicate/model-seedance-2.5.json"
import { dereferenceCogSchema } from "../../../../apps/desktop/src/main/providers/replicate"
import { checkEndpointAgainstSchema } from "./check"
import { mappingEndpointSchema, type MappingEndpoint } from "./schema"

const schemas = fixture.latest_version.openapi_schema.components
  .schemas as Record<string, unknown>
/** Seedance 2.5's real input schema, enums resolved as the adapter does. */
const inputSchema = dereferenceCogSchema(schemas.Input, schemas)

const good = {
  provider: "replicate",
  model: "bytedance/seedance-2.5",
  inputs: {
    first_frame: { field: "image", kind: "image" },
    last_frame: { field: "last_frame_image", kind: "image" },
    reference: { field: "reference_images", kind: "image", max: 30 },
    "reference:2": { field: "reference_videos", kind: "video" },
    soundtrack: { field: "reference_audios", kind: "audio" },
  },
  controls: {
    prompt: { field: "prompt" },
    aspect_ratio: { field: "aspect_ratio" },
    duration: { field: "duration", values: { "5": 5, "10": 10 } },
    resolution: { field: "resolution", values: { "720p": "720p" } },
    seed: { field: "seed" },
    generate_audio: { field: "generate_audio" },
  },
}

function endpoint(patch: (base: typeof good) => unknown): MappingEndpoint {
  return mappingEndpointSchema.parse(
    patch(JSON.parse(JSON.stringify(good)) as typeof good)
  )
}

describe("checkEndpointAgainstSchema", () => {
  it("finds nothing wrong with a correct mapping", () => {
    expect(
      checkEndpointAgainstSchema(
        endpoint((base) => base),
        inputSchema
      )
    ).toEqual([])
  })

  it("flags a misspelled field", () => {
    const issues = checkEndpointAgainstSchema(
      endpoint((base) => ({
        ...base,
        inputs: {
          ...base.inputs,
          first_frame: { field: "imgae", kind: "image" },
        },
      })),
      inputSchema
    )
    expect(issues).toEqual([
      {
        path: "inputs.first_frame",
        message: expect.stringContaining(`"imgae"`),
      },
    ])
  })

  it("flags an input mapped to a field that takes no URL", () => {
    const issues = checkEndpointAgainstSchema(
      endpoint((base) => {
        delete (base.controls as Partial<typeof base.controls>).prompt
        return {
          ...base,
          inputs: { ...base.inputs, style: { field: "prompt", kind: "image" } },
        }
      }),
      inputSchema
    )
    expect(issues).toEqual([
      { path: "inputs.style", message: expect.stringContaining(`"prompt"`) },
    ])
  })

  it("flags a control value the provider's enum does not have", () => {
    const issues = checkEndpointAgainstSchema(
      endpoint((base) => ({
        ...base,
        controls: {
          ...base.controls,
          resolution: { field: "resolution", values: { "8K": "8K" } },
        },
      })),
      inputSchema
    )
    expect(issues).toEqual([
      {
        path: "controls.resolution.values.8K",
        message: expect.stringContaining(`"8K"`),
      },
    ])
  })

  it("compares control values after the same type coercion translation applies", () => {
    // Translation coerces a string to the property's type ("5" → 5 for an
    // integer, "true" → true for a boolean), so the check must agree.
    const schema = {
      type: "object",
      properties: {
        duration: { type: "integer", enum: [5, 10] },
        resolution: { type: "string", enum: ["720p"] },
        generate_audio: { type: "boolean", enum: [true] },
      },
    }
    const map = (controls: Record<string, unknown>) =>
      mappingEndpointSchema.parse({
        provider: "replicate",
        model: "a/b",
        controls,
      })

    expect(
      checkEndpointAgainstSchema(
        map({
          duration: { field: "duration", values: { "5": "5", "10": 10 } },
          generate_audio: { field: "generate_audio", values: { on: "true" } },
        }),
        schema
      )
    ).toEqual([])

    // Real mismatches still fail, coerced or not.
    expect(
      checkEndpointAgainstSchema(
        map({
          duration: {
            field: "duration",
            values: { "7": "7", five: "five", hex: "0x5", float: "5.0" },
          },
          resolution: { field: "resolution", values: { hd: 720 } },
          generate_audio: { field: "generate_audio", values: { off: "false" } },
        }),
        schema
      ).map((issue) => issue.path)
    ).toEqual([
      "controls.duration.values.7",
      "controls.duration.values.five",
      "controls.duration.values.hex",
      "controls.duration.values.float",
      "controls.resolution.values.hd",
      "controls.generate_audio.values.off",
    ])
  })

  it("flags max > 1 on a single-URL field", () => {
    const issues = checkEndpointAgainstSchema(
      endpoint((base) => ({
        ...base,
        inputs: {
          ...base.inputs,
          first_frame: { field: "image", kind: "image", max: 2 },
        },
      })),
      inputSchema
    )
    expect(issues).toEqual([
      { path: "inputs.first_frame.max", message: expect.any(String) },
    ])
  })

  it("flags a shape on a single-URL field", () => {
    const issues = checkEndpointAgainstSchema(
      endpoint((base) => ({
        ...base,
        inputs: {
          ...base.inputs,
          first_frame: {
            field: "image",
            kind: "image",
            shape: "kling-elements",
          },
        },
      })),
      inputSchema
    )
    expect(issues).toEqual([
      { path: "inputs.first_frame.shape", message: expect.any(String) },
    ])
  })

  it("allows a shape on a non-URI field", () => {
    const schema = {
      type: "object",
      properties: { elements: { type: "array", items: { type: "object" } } },
    }
    const issues = checkEndpointAgainstSchema(
      mappingEndpointSchema.parse({
        provider: "replicate",
        model: "kwaivgi/kling-v3-pro",
        inputs: {
          character: {
            field: "elements",
            kind: "image",
            shape: "kling-elements",
          },
        },
      }),
      schema
    )
    expect(issues).toEqual([])
  })

  it("flags an input the provider requires but the mapping does not", () => {
    const schema = {
      type: "object",
      required: ["image"],
      properties: { image: { type: "string", format: "uri" } },
    }
    const map = (required?: boolean) =>
      mappingEndpointSchema.parse({
        provider: "replicate",
        model: "a/b",
        inputs: { first_frame: { field: "image", kind: "image", required } },
      })
    expect(checkEndpointAgainstSchema(map(true), schema)).toEqual([])
    expect(checkEndpointAgainstSchema(map(), schema)).toEqual([
      {
        path: "inputs.first_frame.required",
        message: expect.stringContaining("mark it required"),
      },
    ])
  })

  it("reports every field missing when the schema has no properties", () => {
    expect(
      checkEndpointAgainstSchema(
        endpoint((base) => base),
        null
      )
    ).toHaveLength(11)
  })
})
