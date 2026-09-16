import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  assetRelPath,
  createProject,
  openProject,
  type OpenProject,
} from "../project"
import { listByContainer as listAssetsByContainer } from "./assets"
import { createContainer } from "./containers"
import {
  attachOutputs,
  createGeneration,
  getGeneration,
  lineage,
  listByContainer,
  updateStatus,
} from "./generations"

let root: string
let opened: OpenProject
let containerId: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-generations-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  containerId = createContainer(opened.handle.db, {
    projectId: project.id,
    kind: "scene",
    name: "Lobby",
  }).id
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

function make(overrides: Record<string, unknown> = {}) {
  return createGeneration(opened.handle.db, {
    projectId: opened.project.id,
    containerId,
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    kind: "video",
    prompt: "a bellhop opens the lift",
    params: { duration: 5, resolution: "720p" },
    ...overrides,
  })
}

describe("createGeneration", () => {
  it("records a queued run with its params serialized verbatim", () => {
    const generation = make()
    expect(generation.status).toBe("queued")
    expect(JSON.parse(generation.paramsJson)).toEqual({
      duration: 5,
      resolution: "720p",
    })
    expect(getGeneration(opened.handle.db, generation.id)?.id).toBe(
      generation.id
    )
  })

  it("records which asset was fed into which input slot", async () => {
    const parentless = make({
      inputs: [],
    })
    expect(parentless.id).toBeTruthy()

    const relPath = "assets/2026/09/ref.png"
    await mkdir(join(opened.project.path, "assets", "2026", "09"), {
      recursive: true,
    })
    await writeFile(join(opened.project.path, relPath), "x")
    const { assets: outputs } = await attachOutputs(
      { db: opened.handle.db, project: opened.project },
      {
        generationId: parentless.id,
        outputs: [{ relPath, kind: "image" }],
      }
    )

    const generation = make({
      inputs: [{ assetId: outputs[0]!.id, slotField: "reference_images" }],
    })
    expect(
      getGeneration(opened.handle.db, generation.id, { withInputs: true })
        ?.inputs
    ).toMatchObject([
      { assetId: outputs[0]!.id, slotField: "reference_images", position: 0 },
    ])
  })

  it("rejects an unknown parent generation", () => {
    expect(() => make({ parentGenerationId: "nope" })).toThrow(/not found/i)
  })
})

describe("updateStatus", () => {
  it("stamps startedAt when a run begins and completedAt when it ends", () => {
    const generation = make()
    const running = updateStatus(opened.handle.db, generation.id, {
      status: "running",
      providerJobId: "pred_1",
      now: 1_000,
    })
    expect(running.startedAt).toBe(1_000)
    expect(running.completedAt).toBeNull()
    expect(running.providerJobId).toBe("pred_1")

    const done = updateStatus(opened.handle.db, generation.id, {
      status: "succeeded",
      response: { output: ["https://example.test/a.mp4"] },
      actualCostUsd: 0.42,
      now: 2_000,
    })
    expect(done.completedAt).toBe(2_000)
    // The first startedAt is not overwritten by a later transition.
    expect(done.startedAt).toBe(1_000)
    expect(JSON.parse(done.responseJson!)).toEqual({
      output: ["https://example.test/a.mp4"],
    })
    expect(done.actualCostUsd).toBe(0.42)
  })

  it("stores the failure message", () => {
    const generation = make()
    const failed = updateStatus(opened.handle.db, generation.id, {
      status: "failed",
      error: "provider said no",
      now: 5,
    })
    expect(failed.status).toBe("failed")
    expect(failed.error).toBe("provider said no")
  })

  it("rejects an unknown generation", () => {
    expect(() =>
      updateStatus(opened.handle.db, "nope", { status: "running" })
    ).toThrow(/not found/i)
  })
})

describe("attachOutputs", () => {
  async function writeOutput(
    generationId: string,
    index: number
  ): Promise<string> {
    const relPath = assetRelPath({
      source: "generation",
      generationId,
      index,
      ext: "png",
    })
    const target = join(opened.project.path, relPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(
      target,
      await sharp({
        create: {
          width: 800,
          height: 600,
          channels: 3,
          background: { r: 10, g: 10, b: 10 },
        },
      })
        .png()
        .toBuffer()
    )
    return relPath
  }

  it("creates assets carrying the generation's provenance and files them in its container", async () => {
    const generation = make()
    const relPath = await writeOutput(generation.id, 0)

    const { assets } = await attachOutputs(
      { db: opened.handle.db, project: opened.project },
      { generationId: generation.id, outputs: [{ relPath, kind: "image" }] }
    )

    expect(assets).toHaveLength(1)
    expect(assets[0]!.generationId).toBe(generation.id)
    expect(assets[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(assets[0]!.bytes).toBeGreaterThan(0)
    expect(assets[0]!.thumbnailRelPath).toMatch(/^thumbnails\//)
    expect(assets[0]!.url).toBe(`asset://media/${relPath}`)

    // The output lands on the board of the container that asked for it.
    expect(
      listAssetsByContainer(opened.handle.db, { containerId }).items.map(
        (item) => item.id
      )
    ).toEqual([assets[0]!.id])
  })

  it("refuses an output path outside the project folder", async () => {
    const generation = make()
    await expect(
      attachOutputs(
        { db: opened.handle.db, project: opened.project },
        {
          generationId: generation.id,
          outputs: [{ relPath: "../escape.png", kind: "image" }],
        }
      )
    ).rejects.toThrow(/outside the project/i)
  })
})

describe("listByContainer", () => {
  it("lists a container's generations newest first, paginated", () => {
    const ids = [0, 1, 2].map(
      (index) => make({ prompt: `take ${index}`, now: 1_000 + index }).id
    )
    const page = listByContainer(opened.handle.db, { containerId, limit: 2 })
    expect(page.items.map((item) => item.id)).toEqual([ids[2], ids[1]])
    expect(page.total).toBe(3)
    expect(page.nextOffset).toBe(2)
  })
})

describe("lineage", () => {
  it("returns every ancestor oldest-first and every descendant", () => {
    const root = make({ prompt: "root", now: 1 })
    const child = make({ parentGenerationId: root.id, prompt: "child", now: 2 })
    const grandchild = make({
      parentGenerationId: child.id,
      prompt: "grandchild",
      now: 3,
    })
    const sibling = make({
      parentGenerationId: root.id,
      prompt: "sibling",
      now: 4,
    })

    const result = lineage(opened.handle.db, child.id)
    expect(result.generation.id).toBe(child.id)
    expect(result.ancestors.map((item) => item.id)).toEqual([root.id])
    expect(result.descendants.map((item) => item.id)).toEqual([grandchild.id])

    const fromRoot = lineage(opened.handle.db, root.id)
    expect(fromRoot.ancestors).toEqual([])
    expect(fromRoot.descendants.map((item) => item.id)).toEqual([
      child.id,
      sibling.id,
      grandchild.id,
    ])
  })

  it("rejects an unknown generation", () => {
    expect(() => lineage(opened.handle.db, "nope")).toThrow(/not found/i)
  })
})
