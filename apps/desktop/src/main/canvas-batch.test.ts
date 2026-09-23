/**
 * ⛔ Nothing in this file submits anything. `planBatch` produces
 * `GenerationRequest` values and the assertions stop at their shape — which is
 * the whole point of testing the batch strategy separately from the channel
 * that would queue it.
 *
 * `planBatch` itself lives in `@opendirect/contract`, because the renderer's
 * cost line has to reach the same verdict before anything is submitted. The
 * test lives here, where Node's types and the recorded fixtures are.
 *
 * The schemas are the ones the providers actually published, read straight out
 * of the recorded fixtures under `test/fixtures/`. A hand-written schema would
 * prove the heuristic matches itself; a recorded one proves it matches
 * Replicate's and OpenRouter's real spelling of "how many do you want".
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  detectOutputCountField,
  planBatch,
  type GenerationRequest,
} from "@opendirect/contract"

/** The `Input` schema Replicate recorded for a model, as plain JSON Schema. */
function replicateInputSchema(name: string): Record<string, unknown> {
  const model = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/replicate", `${name}.json`),
      "utf8"
    )
  ) as {
    latest_version: {
      openapi_schema: {
        components: { schemas: { Input: Record<string, unknown> } }
      }
    }
  }
  return model.latest_version.openapi_schema.components.schemas.Input
}

/**
 * OpenRouter publishes `supported_parameters` rather than JSON Schema, so the
 * recorded ranges are narrowed the same way `openrouter-schema.ts` narrows
 * them in main: a `range` is an integer with both bounds.
 */
function openrouterInputSchema(name: string): Record<string, unknown> {
  const listing = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test/fixtures/openrouter", `${name}.json`),
      "utf8"
    )
  ) as {
    endpoints: {
      supported_parameters: Record<
        string,
        { type: string; min?: number; max?: number; values?: string[] }
      >
    }[]
  }

  const properties: Record<string, unknown> = {}
  for (const [field, spec] of Object.entries(
    listing.endpoints[0]!.supported_parameters
  )) {
    properties[field] =
      spec.type === "range"
        ? { type: "integer", minimum: spec.min, maximum: spec.max }
        : { type: "string", enum: spec.values ?? [] }
  }
  return { type: "object", properties }
}

/**
 * No fixture in the tree declares `num_images` — no model we have recorded
 * uses that spelling. This is the minimal shape one would publish, so the
 * third spelling the design names is covered rather than assumed.
 */
const NUM_IMAGES_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", title: "Prompt" },
    num_images: {
      type: "integer",
      title: "Num Images",
      default: 1,
      minimum: 1,
      maximum: 4,
      description: "How many images to generate",
    },
  },
}

function request(
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest {
  return {
    modelKey: "replicate:black-forest-labs/flux-schnell",
    containerId: "container-1",
    prompt: "a bellhop opens the lift",
    params: { aspect_ratio: "16:9", num_inference_steps: 4 },
    references: [],
    estimatedCostUsd: 0.003,
    costConfidence: "estimated",
    parentGenerationId: null,
    batchId: null,
    mentionedContainerIds: null,
    ...overrides,
  }
}

describe("detectOutputCountField", () => {
  it("finds `num_outputs` in Replicate's recorded flux-schnell schema", () => {
    expect(
      detectOutputCountField(replicateInputSchema("model-flux-schnell"))
    ).toEqual({ field: "num_outputs", min: 1, max: 4 })
  })

  it("finds `n` in OpenRouter's recorded gpt-image endpoint", () => {
    expect(
      detectOutputCountField(
        openrouterInputSchema("image-endpoints-gpt-image-2.5-sunburst")
      )
    ).toEqual({ field: "n", min: 1, max: 10 })
  })

  it("finds `num_images`", () => {
    expect(detectOutputCountField(NUM_IMAGES_SCHEMA)).toEqual({
      field: "num_images",
      min: 1,
      max: 4,
    })
  })

  it("finds nothing in a model that generates one image per run", () => {
    expect(
      detectOutputCountField(replicateInputSchema("model-nano-banana-pro"))
    ).toBeNull()
  })

  it("never mistakes a step budget or a seed for an output count", () => {
    // flux-schnell declares `num_inference_steps` with exactly the bounds
    // `num_outputs` has (integer, 1–4) and a `seed` alongside it. Only the
    // name tells them apart, so only the name is allowed to.
    const flux = replicateInputSchema("model-flux-schnell")
    expect(detectOutputCountField(flux)?.field).toBe("num_outputs")

    for (const field of [
      "num_inference_steps",
      "seed",
      "output_quality",
      "duration",
      "num_frames",
      "steps",
      "width",
      "height",
      "guidance_scale",
      "num_input_images",
    ]) {
      expect(
        detectOutputCountField({
          type: "object",
          properties: {
            [field]: { type: "integer", minimum: 1, maximum: 4 },
          },
        })
      ).toBeNull()
    }
  })

  it("refuses a count field whose stated maximum is not an output count", () => {
    expect(
      detectOutputCountField({
        type: "object",
        properties: {
          num_outputs: { type: "integer", minimum: 0, maximum: 2147483647 },
        },
      })
    ).toBeNull()
  })

  it("ignores a non-integer field however it is named", () => {
    expect(
      detectOutputCountField({
        type: "object",
        properties: { num_outputs: { type: "string" } },
      })
    ).toBeNull()
  })

  it("answers null for a model with no schema at all", () => {
    expect(detectOutputCountField(undefined)).toBeNull()
    expect(detectOutputCountField({ type: "object" })).toBeNull()
  })
})

describe("planBatch", () => {
  const flux = replicateInputSchema("model-flux-schnell")
  const nanoBanana = replicateInputSchema("model-nano-banana-pro")

  it("asks for N in one request when the model counts its own outputs", () => {
    const plan = planBatch({ request: request(), count: 4, inputSchema: flux })

    expect(plan.countField).toBe("num_outputs")
    expect(plan.runs).toBe(1)
    expect(plan.outputs).toBe(4)
    expect(plan.requests).toHaveLength(1)
    expect(plan.requests[0]!.params).toEqual({
      aspect_ratio: "16:9",
      num_inference_steps: 4,
      num_outputs: 4,
    })
  })

  it("splits into as many native-count jobs as the maximum needs", () => {
    const plan = planBatch({ request: request(), count: 10, inputSchema: flux })

    expect(plan.runs).toBe(3)
    expect(plan.outputs).toBe(10)
    expect(plan.requests.map((one) => one.params.num_outputs)).toEqual([
      4, 4, 2,
    ])
  })

  it("submits N siblings when the model has no count field", () => {
    const plan = planBatch({
      request: request(),
      count: 3,
      inputSchema: nanoBanana,
    })

    expect(plan.countField).toBeNull()
    expect(plan.runs).toBe(3)
    for (const one of plan.requests) {
      expect(one.params).toEqual({
        aspect_ratio: "16:9",
        num_inference_steps: 4,
      })
    }
  })

  it("gives every request in a batch the same id", () => {
    const siblings = planBatch({
      request: request(),
      count: 3,
      inputSchema: nanoBanana,
    })
    const native = planBatch({
      request: request(),
      count: 10,
      inputSchema: flux,
    })

    expect(new Set(siblings.requests.map((one) => one.batchId))).toEqual(
      new Set([siblings.batchId])
    )
    expect(new Set(native.requests.map((one) => one.batchId))).toEqual(
      new Set([native.batchId])
    )
    // Two plans are two batches, however alike they look.
    expect(siblings.batchId).not.toBe(native.batchId)
  })

  it("keeps a batch id it was handed rather than minting another", () => {
    const plan = planBatch({
      request: request(),
      count: 2,
      inputSchema: nanoBanana,
      batchId: "batch-from-the-node",
    })
    expect(plan.batchId).toBe("batch-from-the-node")
    expect(plan.requests[0]!.batchId).toBe("batch-from-the-node")
  })

  it("leaves the rest of the request exactly as it was built", () => {
    const original = request({
      references: [
        { slotField: "image_input", assetId: "asset-1", position: 0 },
      ],
    })
    const plan = planBatch({ request: original, count: 2, inputSchema: flux })

    expect(plan.requests[0]).toMatchObject({
      modelKey: original.modelKey,
      containerId: original.containerId,
      prompt: original.prompt,
      references: original.references,
      estimatedCostUsd: original.estimatedCostUsd,
      costConfidence: original.costConfidence,
      parentGenerationId: null,
    })
    // The request it was handed is untouched: no count field, no batch id.
    expect(original.params).toEqual({
      aspect_ratio: "16:9",
      num_inference_steps: 4,
    })
    expect(original.batchId).toBeNull()
  })

  it("treats a count of one as one run, either way", () => {
    expect(
      planBatch({ request: request(), count: 1, inputSchema: flux }).runs
    ).toBe(1)
    expect(
      planBatch({ request: request(), count: 1, inputSchema: nanoBanana }).runs
    ).toBe(1)
  })

  it("never plans fewer than one run", () => {
    const plan = planBatch({ request: request(), count: 0, inputSchema: flux })
    expect(plan.runs).toBe(1)
    expect(plan.outputs).toBe(1)
  })
})
