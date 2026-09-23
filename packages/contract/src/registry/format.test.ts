import { describe, expect, it } from "vitest"

import { formatFamilyJson } from "./format"
import { modelFamilySchema } from "./schema"

const family = modelFamilySchema.parse({
  $schema: "../schema.json",
  id: "seedance-2-5",
  name: "Seedance 2.5",
  kind: "video",
  description: "ByteDance video model.",
  endpoints: [
    {
      provider: "replicate",
      model: "bytedance/seedance-2.5",
      inputs: {
        reference: {
          field: "reference_images",
          kind: "image",
          max: 30,
          label: "Reference images",
        },
        first_frame: { field: "image", kind: "image" },
        "reference:2": { field: "reference_videos", kind: "video" },
        last_frame: { field: "last_frame_image", kind: "image" },
      },
      controls: {
        seed: { field: "seed" },
        prompt: { field: "prompt" },
        resolution: { field: "resolution", values: { "720p": "720p" } },
      },
    },
  ],
})

/** The same family with every object's keys in reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, inner]) => [key, reversed(inner)])
  )
}

describe("formatFamilyJson", () => {
  it("writes keys in the canonical order whatever order they came in", () => {
    const text = formatFamilyJson(family)
    expect(formatFamilyJson(reversed(family) as typeof family)).toBe(text)
    const parsed = JSON.parse(text)
    expect(Object.keys(parsed)).toEqual([
      "$schema",
      "id",
      "name",
      "kind",
      "description",
      "endpoints",
    ])
    const endpoint = parsed.endpoints[0]
    expect(Object.keys(endpoint)).toEqual([
      "provider",
      "model",
      "inputs",
      "controls",
    ])
    expect(Object.keys(endpoint.inputs)).toEqual([
      "first_frame",
      "last_frame",
      "reference",
      "reference:2",
    ])
    expect(Object.keys(endpoint.inputs.reference)).toEqual([
      "field",
      "kind",
      "max",
      "label",
    ])
    expect(Object.keys(endpoint.controls)).toEqual([
      "prompt",
      "resolution",
      "seed",
    ])
  })

  it("indents by two spaces and ends with a newline", () => {
    const text = formatFamilyJson(family)
    expect(text.endsWith("}\n")).toBe(true)
    expect(text.split("\n")[1]).toBe(`  "$schema": "../schema.json",`)
  })

  it("round-trips to the parsed family", () => {
    expect(
      modelFamilySchema.parse(JSON.parse(formatFamilyJson(family)))
    ).toEqual(family)
    expect(JSON.parse(formatFamilyJson(family))).toEqual(family)
  })

  it("omits optional keys that are not set", () => {
    const bare = modelFamilySchema.parse({
      id: "x",
      name: "X",
      kind: "image",
      endpoints: [{ provider: "openrouter", model: "x/y" }],
    })
    expect(JSON.parse(formatFamilyJson(bare))).toEqual({
      id: "x",
      name: "X",
      kind: "image",
      endpoints: [
        { provider: "openrouter", model: "x/y", inputs: {}, controls: {} },
      ],
    })
  })
})
