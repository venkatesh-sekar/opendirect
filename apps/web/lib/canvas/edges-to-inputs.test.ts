/**
 * ⛔ Nothing in this file submits anything. `edgesToInputs` is a pure function
 * over canvas rows; it describes the run the user has not pressed Generate on.
 */
import type {
  CanvasEdgeDto,
  CanvasNodeDto,
  ReferenceSlot,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  composePrompt,
  edgesToInputs,
  incomingEdges,
  isBlocked,
  type CanvasInputs,
  type CanvasInputsResult,
} from "./edges-to-inputs"

function node(
  overrides: Partial<CanvasNodeDto> & { id: string }
): CanvasNodeDto {
  return {
    projectId: "p1",
    type: "media",
    x: 0,
    y: 0,
    width: 360,
    height: 360,
    assetId: null,
    generationId: null,
    batchId: null,
    pickAssetId: null,
    modelKey: null,
    text: null,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    asset: null,
    generation: null,
    ...overrides,
  }
}

let edgeClock = 0
function edge(
  overrides: Partial<CanvasEdgeDto> & { id: string }
): CanvasEdgeDto {
  edgeClock += 1
  return {
    projectId: "p1",
    sourceNodeId: "n1",
    targetNodeId: "target",
    slotField: "reference_images",
    createdAt: edgeClock,
    ...overrides,
  }
}

function slot(overrides: Partial<ReferenceSlot> = {}): ReferenceSlot {
  return {
    field: "reference_images",
    label: "Reference Images",
    kind: "image",
    multiple: true,
    max: 12,
    role: "reference",
    ...overrides,
  }
}

const SLOTS: ReferenceSlot[] = [
  slot(),
  slot({
    field: "last_frame_image",
    label: "Last Frame Image",
    multiple: false,
    max: null,
    role: "last_frame",
  }),
]

const TARGET = node({ id: "target", type: "image_gen" })

function run(
  nodes: CanvasNodeDto[],
  edges: CanvasEdgeDto[],
  slots: ReferenceSlot[] = SLOTS
): CanvasInputsResult {
  return edgesToInputs({
    targetNodeId: "target",
    nodes: [TARGET, ...nodes],
    edges,
    slots,
  })
}

function ok(result: CanvasInputsResult): CanvasInputs {
  if (isBlocked(result)) throw new Error(`Blocked: ${result.blocked}`)
  return result
}

describe("edgesToInputs", () => {
  it("turns a media node into one reference in the edge's slot", () => {
    const result = ok(
      run(
        [node({ id: "m1", type: "media", assetId: "asset-1" })],
        [edge({ id: "e1", sourceNodeId: "m1" })]
      )
    )
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "asset-1", position: 0 },
    ])
    expect(result.promptPrefix).toBe("")
  })

  it("takes a generate node's pick, never one of its other tiles", () => {
    const result = ok(
      run(
        [
          node({
            id: "g1",
            type: "image_gen",
            generationId: "gen-1",
            pickAssetId: "asset-pick",
          }),
        ],
        [edge({ id: "e1", sourceNodeId: "g1" })]
      )
    )
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "asset-pick", position: 0 },
    ])
  })

  it("numbers positions by edge order within each slot", () => {
    const result = ok(
      run(
        [
          node({ id: "m1", type: "media", assetId: "a1" }),
          node({ id: "m2", type: "media", assetId: "a2" }),
          node({ id: "m3", type: "media", assetId: "a3" }),
        ],
        [
          edge({ id: "e1", sourceNodeId: "m1", createdAt: 10 }),
          edge({
            id: "e2",
            sourceNodeId: "m3",
            slotField: "last_frame_image",
            createdAt: 20,
          }),
          edge({ id: "e3", sourceNodeId: "m2", createdAt: 30 }),
        ]
      )
    )
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
      { slotField: "last_frame_image", assetId: "a3", position: 0 },
      { slotField: "reference_images", assetId: "a2", position: 1 },
    ])
  })

  it("reads edges in creation order, not the order the rows arrived in", () => {
    const later = edge({ id: "e-late", sourceNodeId: "m2", createdAt: 99 })
    const earlier = edge({ id: "e-early", sourceNodeId: "m1", createdAt: 1 })
    const result = ok(
      run(
        [
          node({ id: "m1", type: "media", assetId: "a1" }),
          node({ id: "m2", type: "media", assetId: "a2" }),
        ],
        [later, earlier]
      )
    )
    expect(result.references.map((reference) => reference.assetId)).toEqual([
      "a1",
      "a2",
    ])
  })

  it("breaks a createdAt tie by id, so the answer never wobbles", () => {
    const edges = [
      edge({ id: "b", sourceNodeId: "m2", createdAt: 5 }),
      edge({ id: "a", sourceNodeId: "m1", createdAt: 5 }),
    ]
    expect(incomingEdges(edges, "target").map((one) => one.id)).toEqual([
      "a",
      "b",
    ])
  })

  it("prepends text nodes in edge order and never makes them references", () => {
    const result = ok(
      run(
        [
          node({ id: "t1", type: "text", text: "  golden hour  " }),
          node({ id: "t2", type: "text", text: "shot on 35mm" }),
          node({ id: "t3", type: "text", text: "   " }),
          node({ id: "m1", type: "media", assetId: "a1" }),
        ],
        [
          edge({
            id: "e1",
            sourceNodeId: "t2",
            slotField: null,
            createdAt: 10,
          }),
          edge({
            id: "e2",
            sourceNodeId: "t1",
            slotField: null,
            createdAt: 20,
          }),
          edge({
            id: "e3",
            sourceNodeId: "t3",
            slotField: null,
            createdAt: 30,
          }),
          edge({ id: "e4", sourceNodeId: "m1", createdAt: 40 }),
        ]
      )
    )
    expect(result.promptPrefix).toBe("shot on 35mm\n\ngolden hour")
    expect(result.references).toEqual([
      { slotField: "reference_images", assetId: "a1", position: 0 },
    ])
  })

  it("blocks when an upstream generate node has no pick", () => {
    const result = run(
      [node({ id: "g1", type: "video_gen", generationId: "gen-1" })],
      [edge({ id: "e1", sourceNodeId: "g1" })]
    )
    if (!isBlocked(result)) throw new Error("expected a block")
    expect(result.code).toBe("no-pick")
    expect(result.blocked).toContain("no pick selected")
    expect(result.edgeId).toBe("e1")
    expect(result.nodeId).toBe("g1")
  })

  it("blocks on a slot this model does not declare", () => {
    const result = run(
      [node({ id: "m1", type: "media", assetId: "a1" })],
      [edge({ id: "e1", sourceNodeId: "m1", slotField: "motion_video" })]
    )
    if (!isBlocked(result)) throw new Error("expected a block")
    expect(result.code).toBe("unknown-slot")
    expect(result.blocked).toContain("motion_video")
  })

  it("blocks a media edge that names no slot at all", () => {
    const result = run(
      [node({ id: "m1", type: "media", assetId: "a1" })],
      [edge({ id: "e1", sourceNodeId: "m1", slotField: null })]
    )
    if (!isBlocked(result)) throw new Error("expected a block")
    expect(result.code).toBe("unresolved-slot")
    // The edge label's menu lists this model's slots, so sending the user
    // there is advice they can act on.
    expect(result.blocked).toContain("from the edge label")
  })

  /**
   * With no model chosen — or one that takes no references — the edge label's
   * menu is empty, so "choose the slot from the edge label" is a dead end.
   */
  it("does not send the user to an empty slot menu", () => {
    const result = run(
      [node({ id: "m1", type: "media", assetId: "a1" })],
      [edge({ id: "e1", sourceNodeId: "m1", slotField: null })],
      []
    )
    if (!isBlocked(result)) throw new Error("expected a block")
    expect(result.code).toBe("unresolved-slot")
    expect(result.blocked).not.toContain("from the edge label")
    expect(result.blocked).toMatch(/Pick a model that takes references/)
  })

  it("blocks a media node whose asset row is gone", () => {
    const result = run(
      [node({ id: "m1", type: "media", assetId: null })],
      [edge({ id: "e1", sourceNodeId: "m1" })]
    )
    if (!isBlocked(result)) throw new Error("expected a block")
    expect(result.code).toBe("missing-asset")
  })

  it("ignores edges that do not point at this node", () => {
    const result = ok(
      run(
        [node({ id: "m1", type: "media", assetId: "a1" })],
        [edge({ id: "e1", sourceNodeId: "m1", targetNodeId: "somebody-else" })]
      )
    )
    expect(result.references).toEqual([])
  })

  it("ignores an edge whose source node is gone, rather than blocking", () => {
    const result = ok(run([], [edge({ id: "e1", sourceNodeId: "vanished" })]))
    expect(result.references).toEqual([])
  })

  it("is empty for a node nothing feeds", () => {
    expect(ok(run([], []))).toEqual({ references: [], promptPrefix: "" })
  })
})

describe("composePrompt", () => {
  it("puts the notes ahead of what the user typed", () => {
    expect(composePrompt("golden hour", "a corridor")).toBe(
      "golden hour\n\na corridor"
    )
  })

  it("leaves a prompt alone when nothing feeds it", () => {
    expect(composePrompt("", "  a corridor  ")).toBe("a corridor")
  })

  it("lets the notes stand alone when the prompt is empty", () => {
    expect(composePrompt("golden hour", "   ")).toBe("golden hour")
  })
})
