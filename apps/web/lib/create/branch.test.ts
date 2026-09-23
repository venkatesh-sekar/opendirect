import { describe, expect, it } from "vitest"
import type { AssetDto, GenerationDto } from "@opendirect/contract"

import type { SchemaSplit } from "../schema-form/split-schema"

import { branchPrefill, partitionParams } from "./branch"

function generation(overrides: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: "gen-42",
    projectId: "p1",
    containerId: "c1",
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: "ver-1",
    kind: "video",
    prompt: "a bellhop opens the lift",
    paramsJson: JSON.stringify({
      prompt: "a bellhop opens the lift",
      duration: 5,
      resolution: "720p",
      seed: 7,
      watermark: false,
      reference_images: ["ignored"],
    }),
    requestJson: null,
    responseJson: null,
    status: "succeeded",
    error: null,
    providerJobId: "pred-1",
    estimatedCostUsd: 0.64,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: "estimated",
    parentGenerationId: null,
    batchId: null,
    branchNote: null,
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    ...overrides,
  }
}

function asset(id: string): AssetDto {
  return {
    id,
    projectId: "p1",
    kind: "image",
    relPath: `assets/${id}.png`,
    text: null,
    mimeType: "image/png",
    width: 100,
    height: 100,
    durationMs: null,
    bytes: 10,
    sha256: id,
    thumbnailRelPath: null,
    label: id,
    originalName: `${id}.png`,
    pinned: false,
    generationId: null,
    createdAt: 1,
    url: `asset://p1/assets/${id}.png`,
    thumbnailUrl: null,
  }
}

const split: SchemaSplit = {
  common: [
    {
      control: "prompt",
      field: "prompt",
      label: "Prompt",
      schema: { type: "string" },
      required: true,
    },
    {
      control: "duration",
      field: "duration",
      label: "Duration",
      schema: { type: "number" },
      required: false,
    },
    {
      control: "resolution",
      field: "resolution",
      label: "Resolution",
      schema: { type: "string" },
      required: false,
    },
  ],
  slots: [
    {
      field: "reference_images",
      label: "Reference Images",
      kind: "image",
      multiple: true,
      max: 4,
      role: "reference",
      verified: false,
      required: false,
      shape: null,
    },
  ],
  advanced: { type: "object", properties: {}, required: [] },
}

describe("branchPrefill", () => {
  it("carries the parent's model, prompt, params and references", () => {
    const prefill = branchPrefill({
      generation: generation(),
      inputs: [
        { slotField: "reference_images", position: 1, asset: asset("a2") },
        { slotField: "reference_images", position: 0, asset: asset("a1") },
      ],
    })

    expect(prefill).toMatchObject({
      modelKey: "replicate:bytedance/seedance-2.5",
      prompt: "a bellhop opens the lift",
      parentGenerationId: "gen-42",
      references: { reference_images: ["a1", "a2"] },
    })
    expect(prefill.params).toMatchObject({ duration: 5, resolution: "720p" })
    expect(prefill.assets.map((item) => item.id)).toEqual(["a1", "a2"])
  })

  it("never carries a slot field in params — references hold those", () => {
    const prefill = branchPrefill({ generation: generation(), inputs: [] })
    // The raw params still hold whatever was recorded; partitioning is what
    // drops the slot fields, and it is told the slots by the split.
    const { common, advanced } = partitionParams(split, prefill.params)
    expect(common).not.toHaveProperty("reference_images")
    expect(advanced).not.toHaveProperty("reference_images")
  })

  it("falls back to the recorded prompt field when the column is null", () => {
    const prefill = branchPrefill({
      generation: generation({ prompt: null }),
      inputs: [],
    })
    expect(prefill.prompt).toBe("")
    expect(partitionParams(split, prefill.params).prompt).toBe(
      "a bellhop opens the lift"
    )
  })

  it("survives a params blob that is not JSON", () => {
    const prefill = branchPrefill({
      generation: generation({ paramsJson: "not json" }),
      inputs: [],
    })
    expect(prefill.params).toEqual({})
  })
})

describe("partitionParams", () => {
  it("routes each param to the control that renders it", () => {
    const partitioned = partitionParams(split, {
      prompt: "a bellhop opens the lift",
      duration: 5,
      resolution: "720p",
      seed: 7,
      reference_images: ["x"],
    })

    expect(partitioned.prompt).toBe("a bellhop opens the lift")
    expect(partitioned.common).toEqual({ duration: 5, resolution: "720p" })
    expect(partitioned.advanced).toEqual({ seed: 7 })
  })

  it("keeps a field the model never published under Advanced", () => {
    const partitioned = partitionParams(split, { mystery_knob: "on" })
    expect(partitioned.advanced).toEqual({ mystery_knob: "on" })
    expect(partitioned.prompt).toBeNull()
  })
})
