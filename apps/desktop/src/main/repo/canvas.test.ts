/**
 * The canvas repository, against an in-memory database.
 *
 * The delete rules are the point of most of these: a node is a placement, so
 * removing it must never take an asset or a generation with it, while removing
 * the *asset* under a media node must take the node, because a media node with
 * no asset is nothing at all.
 *
 * ⛔ Nothing here calls a provider. A canvas edge is a row.
 */
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseHandle } from "../db/client"
import { resolveMigrationsFolder, runMigrations } from "../db/migrate"
import {
  assets,
  canvasEdges,
  canvasNodes,
  generations,
  projects,
} from "../db/schema"
import {
  createEdge,
  createNode,
  deleteEdges,
  deleteNodes,
  getCanvas,
  moveNodes,
  pickNode,
  updateEdge,
  updateNode,
} from "./canvas"

const NOW = 1_763_000_000_000
const PROJECT = "p1"

let handle: DatabaseHandle

function db() {
  return handle.db
}

function seedAsset(id: string): string {
  db()
    .insert(assets)
    .values({
      id,
      projectId: PROJECT,
      kind: "image",
      relPath: `assets/2026/09/${id}.png`,
      mimeType: "image/png",
      createdAt: NOW,
    })
    .run()
  return id
}

function seedGeneration(id: string): string {
  db()
    .insert(generations)
    .values({
      id,
      projectId: PROJECT,
      provider: "replicate",
      modelSlug: "bytedance/seedance-2.5",
      kind: "image",
      paramsJson: "{}",
      status: "succeeded",
      createdAt: NOW,
    })
    .run()
  return id
}

beforeEach(() => {
  handle = createDatabase(":memory:")
  runMigrations(handle, resolveMigrationsFolder(__dirname))
  handle.db
    .insert(projects)
    .values({
      id: PROJECT,
      name: "Infinite Hotel",
      path: "/tmp/p1",
      createdAt: NOW,
    })
    .run()
})

afterEach(() => {
  handle.close()
})

function mediaNode(assetId: string, id?: string) {
  return createNode(db(), {
    projectId: PROJECT,
    type: "media",
    x: 0,
    y: 0,
    width: 320,
    height: 320,
    assetId,
    id,
    now: NOW,
  })
}

function generateNode(overrides: Record<string, unknown> = {}) {
  return createNode(db(), {
    projectId: PROJECT,
    type: "image_gen",
    x: 400,
    y: 0,
    width: 512,
    height: 512,
    now: NOW,
    ...overrides,
  })
}

describe("createNode", () => {
  it("places a text node with its note and no media", () => {
    const node = createNode(db(), {
      projectId: PROJECT,
      type: "text",
      x: 10,
      y: 20,
      width: 200,
      height: 120,
      text: "golden hour, wide lens",
      color: "amber",
      now: NOW,
    })
    expect(node.type).toBe("text")
    expect(node.text).toBe("golden hour, wide lens")
    expect(node.asset).toBeNull()
    expect(node.generation).toBeNull()
    expect(node.createdAt).toBe(NOW)
    expect(node.updatedAt).toBe(NOW)
  })

  it("resolves a media node's asset so one fetch can render it", () => {
    const node = mediaNode(seedAsset("a1"))
    expect(node.asset?.id).toBe("a1")
    // The renderer is handed an `asset://` URL, never a disk path.
    expect(node.asset?.url).toMatch(/^asset:\/\//)
  })

  it("refuses a node whose asset is not in the project", () => {
    expect(() =>
      createNode(db(), {
        projectId: PROJECT,
        type: "media",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        assetId: "nope",
        now: NOW,
      })
    ).toThrow(/FOREIGN KEY/i)
  })
})

describe("getCanvas", () => {
  it("returns every node and edge for the project, oldest first", () => {
    const source = mediaNode(seedAsset("a1"), "n1")
    const target = generateNode({
      id: "n2",
      generationId: seedGeneration("g1"),
    })
    createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      slotField: "reference_images",
      now: NOW,
    })

    const canvas = getCanvas(db(), PROJECT)
    expect(canvas.nodes.map((node) => node.id)).toEqual(["n1", "n2"])
    expect(canvas.nodes[0]?.asset?.id).toBe("a1")
    expect(canvas.nodes[1]?.generation?.id).toBe("g1")
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.edges[0]?.slotField).toBe("reference_images")
  })

  it("is empty for a project with nothing on it", () => {
    expect(getCanvas(db(), PROJECT)).toEqual({ nodes: [], edges: [] })
  })

  it("shows a generate node's pick as its asset", () => {
    const node = generateNode({ pickAssetId: seedAsset("a2") })
    expect(node.asset?.id).toBe("a2")
    expect(getCanvas(db(), PROJECT).nodes[0]?.asset?.id).toBe("a2")
  })
})

describe("updateNode", () => {
  it("leaves an omitted field alone and clears an explicit null", () => {
    const node = generateNode({ pickAssetId: seedAsset("a1"), text: "note" })

    const moved = updateNode(db(), node.id, { x: 99 }, NOW + 1)
    expect(moved.x).toBe(99)
    expect(moved.pickAssetId).toBe("a1")
    expect(moved.text).toBe("note")
    expect(moved.updatedAt).toBe(NOW + 1)

    const cleared = updateNode(db(), node.id, { pickAssetId: null }, NOW + 2)
    expect(cleared.pickAssetId).toBeNull()
    expect(cleared.asset).toBeNull()
  })

  /**
   * The model a generate node is set to run has to survive the window, because
   * a fresh edge's slot is resolved from it before the node has ever run.
   */
  it("records the chosen model, and clears it on an explicit null", () => {
    const node = generateNode()
    expect(node.modelKey).toBeNull()

    const chosen = updateNode(
      db(),
      node.id,
      { modelKey: "replicate:google/nano-banana-2" },
      NOW + 1
    )
    expect(chosen.modelKey).toBe("replicate:google/nano-banana-2")
    expect(getCanvas(db(), PROJECT).nodes[0]?.modelKey).toBe(
      "replicate:google/nano-banana-2"
    )

    // An omitted key is left alone; a null is the user clearing it.
    expect(updateNode(db(), node.id, { x: 1 }, NOW + 2).modelKey).toBe(
      "replicate:google/nano-banana-2"
    )
    expect(
      updateNode(db(), node.id, { modelKey: null }, NOW + 3).modelKey
    ).toBe(null)
  })

  /**
   * A family node's provider override (planning decision 11) lives on the
   * row, so every view of the node — the bar, the edge labels, a new edge's
   * slot — chooses the same endpoint.
   */
  it("records a provider override, and reads a node created without one as null", () => {
    const node = generateNode()
    expect(node.providerOverride).toBeNull()
    expect(getCanvas(db(), PROJECT).nodes[0]?.providerOverride).toBeNull()

    const chosen = updateNode(
      db(),
      node.id,
      { providerOverride: "openrouter" },
      NOW + 1
    )
    expect(chosen.providerOverride).toBe("openrouter")
    expect(getCanvas(db(), PROJECT).nodes[0]?.providerOverride).toBe(
      "openrouter"
    )

    expect(updateNode(db(), node.id, { x: 1 }, NOW + 2).providerOverride).toBe(
      "openrouter"
    )
    expect(
      updateNode(db(), node.id, { providerOverride: null }, NOW + 3)
        .providerOverride
    ).toBeNull()
  })

  it("reads a stored override that is no known provider as none", () => {
    // A hand-edited project, or a provider an older build knew: the column is
    // plain text, and an unknown id must not reach the renderer as one.
    const node = generateNode()
    db()
      .update(canvasNodes)
      .set({ providerOverride: "fal" })
      .where(eq(canvasNodes.id, node.id))
      .run()

    expect(getCanvas(db(), PROJECT).nodes[0]?.providerOverride).toBeNull()
  })

  it("refuses a node that is not there", () => {
    expect(() => updateNode(db(), "nope", { x: 1 })).toThrow(/was not found/)
  })
})

describe("moveNodes", () => {
  it("writes a whole gesture in one call, resizing only when asked", () => {
    const a = generateNode({ id: "n1" })
    const b = mediaNode(seedAsset("a1"), "n2")

    moveNodes(
      db(),
      [
        { id: a.id, x: 10, y: 20 },
        { id: b.id, x: 30, y: 40, width: 100, height: 100 },
      ],
      NOW + 5
    )

    const canvas = getCanvas(db(), PROJECT)
    const [first, second] = canvas.nodes
    expect([first?.x, first?.y]).toEqual([10, 20])
    // Untouched by a move-only entry.
    expect(first?.width).toBe(512)
    expect([second?.width, second?.height]).toEqual([100, 100])
    expect(second?.updatedAt).toBe(NOW + 5)
  })

  it("does nothing at all for an empty gesture", () => {
    const node = generateNode()
    moveNodes(db(), [])
    expect(getCanvas(db(), PROJECT).nodes[0]?.x).toBe(node.x)
  })
})

describe("pickNode", () => {
  it("points downstream edges at a different tile without deleting anything", () => {
    seedAsset("a1")
    seedAsset("a2")
    const node = generateNode({ pickAssetId: "a1", batchId: "b1" })

    const picked = pickNode(db(), node.id, "a2")
    expect(picked.pickAssetId).toBe("a2")
    expect(picked.asset?.id).toBe("a2")
    // The tile that was the pick is still in the project.
    expect(db().select().from(assets).all()).toHaveLength(2)
  })

  it("refuses a pick that is not an asset in this project", () => {
    const node = generateNode()
    expect(() => pickNode(db(), node.id, "nope")).toThrow(/not in this project/)
  })
})

describe("edges", () => {
  it("wires a text node in with no slot field at all", () => {
    const text = createNode(db(), {
      projectId: PROJECT,
      type: "text",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      text: "golden hour",
      now: NOW,
    })
    const target = generateNode()
    const edge = createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: text.id,
      targetNodeId: target.id,
      now: NOW,
    })
    expect(edge.slotField).toBeNull()
  })

  it("moves an edge to a different slot", () => {
    const source = mediaNode(seedAsset("a1"))
    const target = generateNode()
    const edge = createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      slotField: "reference_images",
      now: NOW,
    })
    expect(updateEdge(db(), edge.id, "first_frame").slotField).toBe(
      "first_frame"
    )
    expect(getCanvas(db(), PROJECT).edges[0]?.slotField).toBe("first_frame")
  })

  it("refuses to wire a node into itself", () => {
    const node = generateNode()
    expect(() =>
      createEdge(db(), {
        projectId: PROJECT,
        sourceNodeId: node.id,
        targetNodeId: node.id,
      })
    ).toThrow(/into itself/)
  })

  it("refuses an edge to a node that is not there", () => {
    const node = generateNode()
    expect(() =>
      createEdge(db(), {
        projectId: PROJECT,
        sourceNodeId: node.id,
        targetNodeId: "nope",
      })
    ).toThrow(/was not found/)
  })

  it("deletes the edges it is given and leaves the nodes", () => {
    const source = mediaNode(seedAsset("a1"))
    const target = generateNode()
    const edge = createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      slotField: "reference_images",
      now: NOW,
    })
    deleteEdges(db(), [edge.id])
    const canvas = getCanvas(db(), PROJECT)
    expect(canvas.edges).toEqual([])
    expect(canvas.nodes).toHaveLength(2)
  })
})

describe("delete rules", () => {
  it("deleting a node leaves the asset and the generation alone", () => {
    const assetId = seedAsset("a1")
    const generationId = seedGeneration("g1")
    const node = generateNode({ pickAssetId: assetId, generationId })

    deleteNodes(db(), [node.id])

    expect(getCanvas(db(), PROJECT).nodes).toEqual([])
    expect(db().select().from(assets).all()).toHaveLength(1)
    expect(db().select().from(generations).all()).toHaveLength(1)
  })

  it("deleting a node cascades its edges, in both directions", () => {
    const source = mediaNode(seedAsset("a1"), "n1")
    const middle = generateNode({ id: "n2" })
    const sink = generateNode({ id: "n3" })
    createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: source.id,
      targetNodeId: middle.id,
      slotField: "reference_images",
      now: NOW,
    })
    createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: middle.id,
      targetNodeId: sink.id,
      slotField: "reference_images",
      now: NOW,
    })

    deleteNodes(db(), [middle.id])

    expect(db().select().from(canvasEdges).all()).toEqual([])
    expect(db().select().from(canvasNodes).all()).toHaveLength(2)
  })

  it("deleting a generation nulls generationId and keeps the node", () => {
    const generationId = seedGeneration("g1")
    const node = generateNode({ generationId, batchId: "b1" })

    db().delete(generations).where(eq(generations.id, generationId)).run()

    const [row] = getCanvas(db(), PROJECT).nodes
    expect(row?.id).toBe(node.id)
    expect(row?.generationId).toBeNull()
    expect(row?.generation).toBeNull()
    // The node is empty and ready to run again — the batch grouping survives.
    expect(row?.batchId).toBe("b1")
  })

  it("deleting an asset cascades a media node and only nulls a pick", () => {
    const assetId = seedAsset("a1")
    const media = mediaNode(assetId, "n1")
    const run = generateNode({
      id: "n2",
      pickAssetId: assetId,
      generationId: seedGeneration("g1"),
    })

    db().delete(assets).where(eq(assets.id, assetId)).run()

    const canvas = getCanvas(db(), PROJECT)
    expect(canvas.nodes.map((node) => node.id)).toEqual([run.id])
    expect(canvas.nodes[0]?.pickAssetId).toBeNull()
    expect(canvas.nodes[0]?.asset).toBeNull()
    // A run that happened is still a run that happened.
    expect(canvas.nodes[0]?.generation?.id).toBe("g1")
    expect(media.id).toBe("n1")
  })

  it("deleting the project takes the whole canvas with it", () => {
    const source = mediaNode(seedAsset("a1"))
    const target = generateNode()
    createEdge(db(), {
      projectId: PROJECT,
      sourceNodeId: source.id,
      targetNodeId: target.id,
      now: NOW,
    })

    db().delete(projects).where(eq(projects.id, PROJECT)).run()

    expect(db().select().from(canvasNodes).all()).toEqual([])
    expect(db().select().from(canvasEdges).all()).toEqual([])
  })
})
