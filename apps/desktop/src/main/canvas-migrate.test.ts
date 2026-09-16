/**
 * The lineage-to-canvas migration, against an in-memory database.
 *
 * The real elkjs layout runs here rather than a stub, because the thing worth
 * proving is that it runs at all in a plain Node process — in-process, with no
 * web worker and no network. The only injected layout is the one that throws,
 * which is how the "nothing is written on failure" rule is checked.
 *
 * ⛔ Nothing here calls a provider. Migration reads runs that already happened.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { migrateCanvas } from "./canvas-migrate"
import { createDatabase, type DatabaseHandle } from "./db/client"
import { resolveMigrationsFolder, runMigrations } from "./db/migrate"
import {
  assets,
  canvasEdges,
  canvasNodes,
  generationInputs,
  generations,
  projects,
} from "./db/schema"
import { createNode, getCanvas } from "./repo/canvas"

const NOW = 1_763_000_000_000
const PROJECT = "p1"

let handle: DatabaseHandle

function db() {
  return handle.db
}

function ctx() {
  return { db: db(), project: { id: PROJECT } }
}

interface SeedAsset {
  generationId?: string | null
  kind?: string
  width?: number | null
  height?: number | null
  createdAt?: number
}

function seedAsset(id: string, options: SeedAsset = {}): string {
  db()
    .insert(assets)
    .values({
      id,
      projectId: PROJECT,
      kind: options.kind ?? "image",
      relPath: `assets/2026/09/${id}.png`,
      mimeType: "image/png",
      width: options.width ?? 1024,
      height: options.height ?? 1024,
      generationId: options.generationId ?? null,
      createdAt: options.createdAt ?? NOW,
    })
    .run()
  return id
}

interface SeedGeneration {
  kind?: string
  parentGenerationId?: string | null
  batchId?: string | null
  createdAt?: number
}

function seedGeneration(id: string, options: SeedGeneration = {}): string {
  db()
    .insert(generations)
    .values({
      id,
      projectId: PROJECT,
      provider: "replicate",
      modelSlug: "bytedance/seedance-2.5",
      kind: options.kind ?? "image",
      paramsJson: "{}",
      status: "succeeded",
      batchId: options.batchId ?? null,
      parentGenerationId: options.parentGenerationId ?? null,
      createdAt: options.createdAt ?? NOW,
    })
    .run()
  return id
}

function seedInput(
  id: string,
  generationId: string,
  assetId: string,
  slotField: string,
  position = 0
): void {
  db()
    .insert(generationInputs)
    .values({ id, generationId, assetId, slotField, position })
    .run()
}

beforeEach(() => {
  handle = createDatabase(":memory:")
  runMigrations(handle, resolveMigrationsFolder(__dirname))
  db()
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

/**
 * The shape most tests use:
 *
 *   ref.png ──reference_images──▶ g1 ──▶ out1.png
 *                                  │ (parentGenerationId)
 *                                  ▼
 *   out1.png ──first_frame──────▶ g2 (video) ──▶ out2.mp4
 *
 * plus `orphan.png`, imported and never used for anything.
 */
function seedLineage(): void {
  seedAsset("ref", { createdAt: NOW })
  seedGeneration("g1", { createdAt: NOW + 1 })
  seedInput("i1", "g1", "ref", "reference_images")
  seedAsset("out1", { generationId: "g1", createdAt: NOW + 2 })

  seedGeneration("g2", {
    kind: "video",
    parentGenerationId: "g1",
    batchId: "b1",
    createdAt: NOW + 3,
  })
  seedInput("i2", "g2", "out1", "first_frame")
  seedAsset("out2", {
    generationId: "g2",
    kind: "video",
    width: 1920,
    height: 1080,
    createdAt: NOW + 4,
  })

  seedAsset("orphan", { createdAt: NOW + 5 })
}

describe("migrateCanvas", () => {
  it("turns a lineage into nodes and edges", async () => {
    seedLineage()

    const canvas = await migrateCanvas(ctx())

    // Two runs, one import that is not an output, one orphan.
    expect(canvas.nodes).toHaveLength(4)

    const byGeneration = new Map(
      canvas.nodes
        .filter((node) => node.generationId)
        .map((node) => [node.generationId, node])
    )
    const image = byGeneration.get("g1")
    const video = byGeneration.get("g2")
    const ref = canvas.nodes.find((node) => node.assetId === "ref")

    // The node kind comes off the run's own modality, as everywhere else.
    expect(image?.type).toBe("image_gen")
    expect(video?.type).toBe("video_gen")
    expect(ref?.type).toBe("media")

    // First output is the pick; the batch grouping is carried over verbatim.
    expect(image?.pickAssetId).toBe("out1")
    expect(image?.asset?.id).toBe("out1")
    expect(image?.batchId).toBeNull()
    expect(video?.pickAssetId).toBe("out2")
    expect(video?.batchId).toBe("b1")

    // An output asset is shown by the run that made it, not by its own node.
    expect(canvas.nodes.some((node) => node.assetId === "out1")).toBe(false)

    const wires = canvas.edges.map(
      (edge) => `${edge.sourceNodeId}>${edge.targetNodeId}|${edge.slotField}`
    )
    expect(wires).toContain(`${ref?.id}>${image?.id}|reference_images`)
    expect(wires).toContain(`${image?.id}>${video?.id}|first_frame`)
    // The branch between g1 and g2 says strictly less than the input edge that
    // already connects them, so it is not written a second time.
    expect(canvas.edges).toHaveLength(2)
  })

  it("lays a branch out as an edge with no slot when nothing else connects the two", async () => {
    seedGeneration("g1", { createdAt: NOW })
    seedGeneration("g2", { parentGenerationId: "g1", createdAt: NOW + 1 })

    const canvas = await migrateCanvas(ctx())

    expect(canvas.edges).toHaveLength(1)
    expect(canvas.edges[0]?.slotField).toBeNull()
  })

  it("places every generation exactly once", async () => {
    seedLineage()
    // A third run fed by the same reference, so the shared input cannot make
    // a node appear twice either.
    seedGeneration("g3", { createdAt: NOW + 6 })
    seedInput("i3", "g3", "ref", "reference_images")

    const canvas = await migrateCanvas(ctx())

    const generationIds = canvas.nodes
      .map((node) => node.generationId)
      .filter((id): id is string => id !== null)
    expect(generationIds.toSorted()).toEqual(["g1", "g2", "g3"])
    expect(new Set(generationIds).size).toBe(generationIds.length)
  })

  it("still places an asset that was never wired into anything", async () => {
    seedLineage()

    const canvas = await migrateCanvas(ctx())

    const orphan = canvas.nodes.find((node) => node.assetId === "orphan")
    expect(orphan).toBeDefined()
    expect(orphan?.type).toBe("media")
    expect(Number.isFinite(orphan?.x)).toBe(true)
    expect(Number.isFinite(orphan?.y)).toBe(true)
    // It is not stacked on top of the rest at the origin.
    expect(
      canvas.edges.some(
        (edge) =>
          edge.sourceNodeId === orphan?.id || edge.targetNodeId === orphan?.id
      )
    ).toBe(false)
  })

  it("lays the graph out left to right, sized to its aspect ratio", async () => {
    seedLineage()

    const canvas = await migrateCanvas(ctx())
    const ref = canvas.nodes.find((node) => node.assetId === "ref")
    const image = canvas.nodes.find((node) => node.generationId === "g1")
    const video = canvas.nodes.find((node) => node.generationId === "g2")

    // A reference sits to the left of what it feeds.
    expect(ref?.x).toBeLessThan(image?.x ?? 0)
    expect(image?.x).toBeLessThan(video?.x ?? 0)

    // One column wide; height follows the picture. 1:1 stays square, 16:9 is
    // shorter, and both are clamped into something visible at a sane zoom.
    expect(image?.width).toBe(320)
    expect(image?.height).toBe(320)
    expect(video?.width).toBe(320)
    expect(video?.height).toBe(180)
  })

  it("leaves a project that already has a canvas exactly as it is", async () => {
    seedLineage()
    const placed = createNode(db(), {
      projectId: PROJECT,
      type: "media",
      x: 42,
      y: 43,
      width: 200,
      height: 200,
      assetId: "ref",
      now: NOW,
    })

    const canvas = await migrateCanvas(ctx())

    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.nodes[0]?.id).toBe(placed.id)
    expect([canvas.nodes[0]?.x, canvas.nodes[0]?.y]).toEqual([42, 43])
    expect(db().select().from(canvasNodes).all()).toHaveLength(1)
  })

  it("writes nothing at all when the layout throws, and rethrows", async () => {
    seedLineage()
    const boom = () => Promise.reject(new Error("elk fell over"))

    await expect(migrateCanvas(ctx(), boom)).rejects.toThrow("elk fell over")

    expect(db().select().from(canvasNodes).all()).toEqual([])
    expect(db().select().from(canvasEdges).all()).toEqual([])
    // Still migratable: the canvas is empty, which is the "not yet" state.
    expect(getCanvas(db(), PROJECT)).toEqual({ nodes: [], edges: [] })
  })

  it("is a no-op on a project with no history", async () => {
    expect(await migrateCanvas(ctx())).toEqual({ nodes: [], edges: [] })
    expect(db().select().from(canvasNodes).all()).toEqual([])
  })
})
