import { describe, expect, it } from "vitest"
import type { GenerationDto, Lineage } from "@opendirect/contract"

import { buildLineageTree } from "./lineage-tree"

function gen(
  id: string,
  parentGenerationId: string | null = null,
  overrides: Partial<GenerationDto> = {}
): GenerationDto {
  return {
    id,
    projectId: "p1",
    containerId: "c1",
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: null,
    kind: "video",
    prompt: id,
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "succeeded",
    error: null,
    providerJobId: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: null,
    parentGenerationId,
    branchNote: null,
    createdAt: 1,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

/** portrait → image-42 → { video-53, video-56 } */
const lineage: Lineage = {
  generation: gen("image-42", "portrait"),
  ancestors: [gen("portrait")],
  descendants: [gen("video-53", "image-42"), gen("video-56", "image-42")],
}

describe("buildLineageTree", () => {
  it("lists every generation once, oldest ancestor first", () => {
    const tree = buildLineageTree(lineage)
    expect(tree.nodes.map((node) => node.generation.id)).toEqual([
      "portrait",
      "image-42",
      "video-53",
      "video-56",
    ])
  })

  it("nests each node one level below its parent", () => {
    const tree = buildLineageTree(lineage)
    expect(tree.nodes.map((node) => node.depth)).toEqual([0, 1, 2, 2])
  })

  it("marks the generation the view is focused on", () => {
    const tree = buildLineageTree(lineage)
    expect(tree.nodes.filter((node) => node.current)).toHaveLength(1)
    expect(tree.nodes.find((node) => node.current)?.generation.id).toBe(
      "image-42"
    )
  })

  it("draws one edge per parent link it can resolve", () => {
    const tree = buildLineageTree(lineage)
    expect(tree.edges).toEqual([
      { from: "portrait", to: "image-42" },
      { from: "image-42", to: "video-53" },
      { from: "image-42", to: "video-56" },
    ])
  })

  it("drops a duplicate the payload happens to repeat", () => {
    const tree = buildLineageTree({
      ...lineage,
      descendants: [...lineage.descendants, gen("video-53", "image-42")],
    })
    expect(tree.nodes).toHaveLength(4)
  })

  it("keeps a grandchild below its own parent, not below the root", () => {
    const tree = buildLineageTree({
      generation: gen("image-42"),
      ancestors: [],
      descendants: [gen("video-53", "image-42"), gen("cut-9", "video-53")],
    })
    expect(
      tree.nodes.map((node) => [node.generation.id, node.depth])
    ).toEqual([
      ["image-42", 0],
      ["video-53", 1],
      ["cut-9", 2],
    ])
  })

  it("keeps an orphan whose parent is not in the payload", () => {
    const tree = buildLineageTree({
      generation: gen("image-42"),
      ancestors: [],
      descendants: [gen("stray", "gone")],
    })
    expect(tree.nodes.map((node) => node.generation.id)).toEqual([
      "image-42",
      "stray",
    ])
    expect(tree.edges).toEqual([])
  })
})
