/**
 * Built from the schemas the providers really published: the recorded
 * fixtures under `test/fixtures/`, read off disk rather than retyped, so a
 * grid that would not survive a real model fails here.
 *
 * ⛔ No network. The fixtures are files; msw's `onUnhandledRequest: "error"`
 * never has anything to catch.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ModelDescriptor } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  humanizeField,
  propertiesOf,
  splitSchema,
} from "../schema-form/split-schema"
import {
  buildIconGrid,
  cellLabel,
  iconGridSummary,
  withoutIconGridFields,
} from "./icon-grid"

type Json = Record<string, unknown>

function fixture(provider: string, name: string): Json {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures", provider, `${name}.json`),
      "utf8"
    )
  ) as Json
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Cog writes an enum input as `{ allOf: [{ $ref: … }] }`, which the Replicate
 * adapter flattens before the descriptor ever reaches the renderer. The same
 * flattening, in miniature, so the fixture is used as recorded.
 */
function dereference(schema: unknown, schemas: Json): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => dereference(item, schemas))
  }
  if (!isObject(schema)) return schema
  const out: Json = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === "allOf" || key === "$ref") continue
    out[key] = dereference(value, schemas)
  }
  const ref = typeof schema.$ref === "string" ? schema.$ref : null
  if (ref?.startsWith("#/components/schemas/")) {
    Object.assign(
      out,
      dereference(schemas[ref.slice("#/components/schemas/".length)], schemas)
    )
  }
  if (Array.isArray(schema.allOf)) {
    for (const member of schema.allOf) {
      Object.assign(out, dereference(member, schemas) as Json)
    }
  }
  return out
}

/**
 * The structural slot rule, in miniature: a URI string, or an array of them.
 * The main process's `deriveReferenceSlots` is the real one — it lives behind
 * the IPC boundary, so the renderer's test restates the shape rather than
 * reaching across the app boundary for it.
 */
function slotsOf(inputSchema: Json) {
  const uri = (schema: unknown) =>
    isObject(schema) && schema.type === "string" && schema.format === "uri"
  return Object.entries(propertiesOf(inputSchema))
    .filter(
      ([, schema]) =>
        uri(schema) || (schema.type === "array" && uri(schema.items))
    )
    .map(([field, schema]) => ({
      field,
      label: humanizeField(field),
      kind: "any" as const,
      multiple: schema.type === "array",
      max: null,
      role: "unknown" as const,
    }))
}

function descriptorOf(overrides: Partial<ModelDescriptor>): ModelDescriptor {
  const inputSchema = (overrides.inputSchema ?? {}) as Json
  return {
    key: "replicate:test/model",
    provider: "replicate",
    slug: "test/model",
    name: "Test",
    description: null,
    kind: "image",
    versionId: null,
    coverImageUrl: null,
    inputSchema,
    outputSchema: null,
    referenceSlots: slotsOf(inputSchema),
    commonControls: {
      prompt: null,
      aspectRatio: null,
      duration: null,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: { basis: "unknown", sku: null, rates: [], source: "none" },
    raw: null,
    fetchedAt: 0,
    ...overrides,
  } as ModelDescriptor
}

/** `bytedance/seedance-2.5`, exactly as Replicate published it. */
function seedance(): ModelDescriptor {
  const model = fixture("replicate", "model-seedance-2.5")
  const openapi = (model.latest_version as Json).openapi_schema as Json
  const schemas = (openapi.components as Json).schemas as Json
  const inputSchema = dereference(schemas.Input, schemas) as Json
  return descriptorOf({
    key: "replicate:bytedance/seedance-2.5",
    slug: "bytedance/seedance-2.5",
    kind: "video",
    inputSchema,
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: "duration",
      resolution: "resolution",
      seed: "seed",
      audio: "generate_audio",
    },
  })
}

/**
 * `openai/gpt-image-2.5-sunburst`, as OpenRouter's image endpoint describes
 * it: a `quality` enum, an `aspect_ratio` enum, and no resolution at all.
 */
function gptImage(): ModelDescriptor {
  const listing = fixture(
    "openrouter",
    "image-endpoints-gpt-image-2.5-sunburst"
  )
  const endpoint = (listing.endpoints as Json[])[0]!
  const supported = endpoint.supported_parameters as Record<string, Json>

  const properties: Json = { prompt: { type: "string", title: "Prompt" } }
  for (const [field, spec] of Object.entries(supported)) {
    if (spec.type === "enum" && Array.isArray(spec.values)) {
      properties[field] = { type: "string", enum: spec.values }
      continue
    }
    properties[field] = {
      type: "integer",
      minimum: spec.min,
      maximum: spec.max,
    }
  }

  return descriptorOf({
    key: "openrouter:openai/gpt-image-2.5-sunburst",
    provider: "openrouter",
    slug: "openai/gpt-image-2.5-sunburst",
    inputSchema: {
      type: "object",
      required: ["prompt"],
      properties,
    },
    commonControls: {
      prompt: "prompt",
      aspectRatio: "aspect_ratio",
      duration: null,
      // The adapter reads `resolution` then `size`; this model has neither.
      resolution: null,
      seed: null,
      audio: null,
    },
  })
}

describe("buildIconGrid", () => {
  it("renders exactly the values a real schema lists, in schema order", () => {
    const grid = buildIconGrid(seedance())
    expect(grid.rows.map((row) => row.kind)).toEqual([
      "resolution",
      "aspectRatio",
    ])

    const resolution = grid.rows[0]!
    expect(resolution.field).toBe("resolution")
    expect(resolution.cells.map((cell) => cell.value)).toEqual(["480p", "720p"])
    expect(resolution.default).toBe("720p")

    const aspect = grid.rows[1]!
    expect(aspect.field).toBe("aspect_ratio")
    expect(aspect.cells.map((cell) => cell.value)).toEqual([
      "16:9",
      "4:3",
      "1:1",
      "3:4",
      "9:16",
      "21:9",
      "adaptive",
    ])
    expect(aspect.default).toBe("16:9")
  })

  it("gives a model with no resolution field no resolution row", () => {
    const grid = buildIconGrid(gptImage())
    expect(grid.rows.map((row) => row.kind)).toEqual(["quality", "aspectRatio"])
    expect(grid.rows.some((row) => row.kind === "resolution")).toBe(false)
  })

  it("reads a quality row off the model's own enum", () => {
    const quality = buildIconGrid(gptImage()).rows[0]!
    expect(quality.field).toBe("quality")
    expect(quality.cells.map((cell) => cell.value)).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ])
    // The schema states no default, so the row claims none.
    expect(quality.default).toBeNull()
    expect(quality.cells.every((cell) => cell.icon !== null)).toBe(true)
  })

  it("states no default when the schema's default is not one of the values", () => {
    const descriptor = descriptorOf({
      inputSchema: {
        type: "object",
        properties: {
          resolution: { type: "string", enum: ["480p"], default: "4k" },
        },
      },
      commonControls: {
        prompt: null,
        aspectRatio: null,
        duration: null,
        resolution: "resolution",
        seed: null,
        audio: null,
      },
    })
    expect(buildIconGrid(descriptor).rows[0]!.default).toBeNull()
  })

  it("has no row for a field the model does not declare at all", () => {
    const grid = buildIconGrid(
      descriptorOf({
        inputSchema: {
          type: "object",
          properties: { prompt: { type: "string" } },
        },
        commonControls: {
          prompt: "prompt",
          aspectRatio: null,
          duration: null,
          resolution: null,
          seed: null,
          audio: null,
        },
      })
    )
    expect(grid.rows).toEqual([])
    expect(grid.fields).toEqual([])
  })

  it("has no row for a promoted control that is not an enum", () => {
    const grid = buildIconGrid(
      descriptorOf({
        inputSchema: {
          type: "object",
          properties: { resolution: { type: "string" } },
        },
        commonControls: {
          prompt: null,
          aspectRatio: null,
          duration: null,
          resolution: "resolution",
          seed: null,
          audio: null,
        },
      })
    )
    expect(grid.rows).toEqual([])
  })

  it("never turns an integer `output_quality` into a quality row", () => {
    const grid = buildIconGrid(
      descriptorOf({
        inputSchema: {
          type: "object",
          properties: {
            output_quality: { type: "integer", minimum: 0, maximum: 100 },
          },
        },
      })
    )
    expect(grid.rows).toEqual([])
  })

  it("carries the proportions of every ratio it could parse, and none it could not", () => {
    const cells = buildIconGrid(seedance()).rows[1]!.cells
    const byValue = new Map(cells.map((cell) => [cell.value, cell]))
    expect(byValue.get("16:9")!.ratio).toEqual({ w: 16, h: 9 })
    expect(byValue.get("1:1")!.ratio).toEqual({ w: 1, h: 1 })
    expect(byValue.get("9:16")!.ratio).toEqual({ w: 9, h: 16 })
    expect(byValue.get("adaptive")!.ratio).toBeNull()
    // Every cell still reads as its own value, icon or not.
    expect(byValue.get("adaptive")!.label).toBe("Adaptive")
    expect(byValue.get("16:9")!.label).toBe("16:9")
  })

  it("gives landscape, square and portrait three different shapes", () => {
    const cells = buildIconGrid(seedance()).rows[1]!.cells
    const icon = (value: string) =>
      cells.find((cell) => cell.value === value)!.icon
    expect(icon("16:9")).not.toBe(icon("1:1"))
    expect(icon("1:1")).not.toBe(icon("9:16"))
    expect(icon("16:9")).not.toBe(icon("9:16"))
    // Two landscape ratios are the same shape — the box is drawn from `ratio`.
    expect(icon("16:9")).toBe(icon("21:9"))
    expect(icon("adaptive")).not.toBe(icon("16:9"))
  })

  it("marks a required grid field as required", () => {
    const descriptor = descriptorOf({
      inputSchema: {
        type: "object",
        required: ["aspect_ratio"],
        properties: {
          aspect_ratio: { type: "string", enum: ["1:1"] },
        },
      },
      commonControls: {
        prompt: null,
        aspectRatio: "aspect_ratio",
        duration: null,
        resolution: null,
        seed: null,
        audio: null,
      },
    })
    expect(buildIconGrid(descriptor).rows[0]!.required).toBe(true)
  })
})

describe("the partition stays total", () => {
  it("accounts for every property of a real schema exactly once", () => {
    for (const descriptor of [seedance(), gptImage()]) {
      const split = splitSchema(descriptor)
      const grid = buildIconGrid(descriptor)
      const advanced = withoutIconGridFields(split.advanced, grid)

      const seen = [
        ...grid.fields,
        ...split.common
          .map((entry) => entry.field)
          .filter((field) => !grid.fields.includes(field)),
        ...split.slots.map((slot) => slot.field),
        ...Object.keys(advanced.properties),
      ]
      expect(new Set(seen).size).toBe(seen.length)
      expect([...seen].sort()).toEqual(
        Object.keys(propertiesOf(descriptor.inputSchema)).sort()
      )
    }
  })

  it("takes the quality field out of Advanced, and leaves the rest", () => {
    const descriptor = gptImage()
    const split = splitSchema(descriptor)
    const grid = buildIconGrid(descriptor)
    expect(Object.keys(split.advanced.properties)).toContain("quality")
    const advanced = withoutIconGridFields(split.advanced, grid)
    expect(Object.keys(advanced.properties)).not.toContain("quality")
    expect(Object.keys(advanced.properties)).toContain("background")
    expect(advanced.required).not.toContain("quality")
  })
})

describe("cellLabel", () => {
  it("leaves a value the model spelled for itself alone", () => {
    expect(cellLabel("720p")).toBe("720p")
    expect(cellLabel("16:9")).toBe("16:9")
    expect(cellLabel("4K")).toBe("4K")
  })

  it("title-cases a plain word and an underscored one", () => {
    expect(cellLabel("high")).toBe("High")
    expect(cellLabel("match_input_image")).toBe("Match Input Image")
  })
})

describe("iconGridSummary", () => {
  it("reads like the chip on the prompt bar", () => {
    const grid = buildIconGrid(seedance())
    expect(
      iconGridSummary(grid, { resolution: "480p", aspect_ratio: "9:16" })
    ).toBe("480p · 9:16")
  })

  it("falls back to the schema's own defaults for what the user has not set", () => {
    const grid = buildIconGrid(seedance())
    expect(iconGridSummary(grid, {})).toBe("720p · 16:9")
  })

  it("says nothing about a value the schema does not offer", () => {
    const grid = buildIconGrid(seedance())
    expect(
      iconGridSummary(grid, { resolution: "8k", aspect_ratio: "1:1" })
    ).toBe("1:1")
  })
})
