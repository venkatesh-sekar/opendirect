import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GenerationRequest, ModelDescriptor } from "@opendirect/contract"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { submitBatch, submitGeneration } from "./generations-submit"
import { createProject, openProject, type OpenProject } from "./project"
import { importFiles } from "./repo/assets"
import { createContainer } from "./repo/containers"
import { getGeneration, listByContainer, listInputs } from "./repo/generations"

let root: string
let opened: OpenProject
let containerId: string
let assetId: string

const descriptor: ModelDescriptor = {
  key: "replicate:bytedance/seedance-2.5",
  provider: "replicate",
  slug: "bytedance/seedance-2.5",
  name: "Seedance 2.5",
  description: null,
  kind: "video",
  versionId: "version-1",
  coverImageUrl: null,
  inputSchema: { type: "object", properties: {} },
  outputSchema: null,
  referenceSlots: [
    {
      field: "reference_images",
      label: "Reference Images",
      kind: "image",
      multiple: true,
      max: 12,
      role: "reference",
    },
  ],
  commonControls: {
    prompt: "prompt",
    aspectRatio: null,
    duration: "duration",
    resolution: "resolution",
    seed: null,
    audio: null,
  },
  pricing: {
    basis: "per_second",
    currency: "USD",
    skus: {},
    estimate: null,
    source: "local_table",
    note: null,
  },
  raw: null,
  fetchedAt: 0,
}

function deps(overrides: Partial<ModelDescriptor> = {}) {
  return {
    getModel: vi.fn(async () => ({ ...descriptor, ...overrides })),
  }
}

function request(
  overrides: Partial<GenerationRequest> = {}
): GenerationRequest {
  return {
    modelKey: "replicate:bytedance/seedance-2.5",
    containerId,
    prompt: "a bellhop opens the lift",
    params: { duration: 5, resolution: "720p" },
    references: [],
    estimatedCostUsd: 1.156,
    costConfidence: "estimated",
    parentGenerationId: null,
    batchId: null,
    ...overrides,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-submit-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  containerId = createContainer(opened.handle.db, {
    projectId: project.id,
    kind: "scene",
    name: "Lobby",
  }).id

  const source = join(root, "reference.png")
  await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 8, g: 8, b: 8 },
    },
  })
    .png()
    .toFile(source)
  const imported = await importFiles(
    { db: opened.handle.db, project: opened.project },
    { paths: [source], containerId }
  )
  assetId = imported.assets[0]!.id
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

function context() {
  return { db: opened.handle.db, project: opened.project }
}

describe("submitGeneration", () => {
  it("records a queued run and nothing else", async () => {
    const generation = await submitGeneration(context(), deps(), request())

    expect(generation.status).toBe("queued")
    expect(generation.providerJobId).toBeNull()
    expect(generation.startedAt).toBeNull()
    expect(generation.responseJson).toBeNull()
  })

  it("stamps the run with the model the catalog resolved", async () => {
    const generation = await submitGeneration(context(), deps(), request())

    expect(generation.provider).toBe("replicate")
    expect(generation.modelSlug).toBe("bytedance/seedance-2.5")
    expect(generation.modelVersion).toBe("version-1")
    expect(generation.kind).toBe("video")
    expect(generation.containerId).toBe(containerId)
  })

  it("stores the params verbatim so the run can be replayed", async () => {
    const generation = await submitGeneration(context(), deps(), request())

    expect(JSON.parse(generation.paramsJson)).toEqual({
      duration: 5,
      resolution: "720p",
    })
    expect(JSON.parse(generation.requestJson!)).toMatchObject({
      modelKey: "replicate:bytedance/seedance-2.5",
      prompt: "a bellhop opens the lift",
    })
  })

  it("keeps the quote it was submitted with", async () => {
    const generation = await submitGeneration(context(), deps(), request())

    expect(generation.estimatedCostUsd).toBeCloseTo(1.156)
    expect(generation.costConfidence).toBe("estimated")
    expect(generation.actualCostUsd).toBeNull()
  })

  it("links the chosen references to their slots", async () => {
    const generation = await submitGeneration(
      context(),
      deps(),
      request({
        references: [{ slotField: "reference_images", assetId, position: 0 }],
      })
    )

    expect(listInputs(opened.handle.db, generation.id)).toEqual([
      expect.objectContaining({ slotField: "reference_images", position: 0 }),
    ])
  })

  it("refuses a reference that is not an asset in this project", async () => {
    await expect(
      submitGeneration(
        context(),
        deps(),
        request({
          references: [
            { slotField: "reference_images", assetId: "ghost", position: 0 },
          ],
        })
      )
    ).rejects.toThrow(/ghost/)
  })

  it("refuses a reference aimed at a slot the model does not have", async () => {
    await expect(
      submitGeneration(
        context(),
        deps(),
        request({
          references: [{ slotField: "motion_video", assetId, position: 0 }],
        })
      )
    ).rejects.toThrow(/motion_video/)
  })

  it("refuses a key that is not a catalog key", async () => {
    await expect(
      submitGeneration(context(), deps(), request({ modelKey: "seedance" }))
    ).rejects.toThrow(/seedance/)
  })

  it("asks the catalog for the model exactly once", async () => {
    const catalog = deps()
    await submitGeneration(context(), catalog, request())
    expect(catalog.getModel).toHaveBeenCalledTimes(1)
    expect(catalog.getModel).toHaveBeenCalledWith(
      "replicate:bytedance/seedance-2.5"
    )
  })

  it("puts the run on the container's board", async () => {
    const generation = await submitGeneration(context(), deps(), request())
    expect(listByContainer(opened.handle.db, { containerId }).items).toEqual([
      expect.objectContaining({ id: generation.id, status: "queued" }),
    ])
  })
})

/**
 * ⛔ Not one provider call in here either. A batch is N queued rows, and the
 * assertions stop at what SQLite holds — `deps()` is a stub catalog and msw
 * runs with `onUnhandledRequest: "error"`, so an escape would fail the suite
 * rather than spend money.
 */
describe("submitBatch", () => {
  /** A model that counts its own outputs, capped at four per prediction. */
  const nativeCount = {
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        num_outputs: { type: "integer", minimum: 1, maximum: 4 },
      },
    },
  }

  it("writes one queued row per sibling when the model counts nothing", async () => {
    const batch = await submitBatch(context(), deps(), request(), 3)

    expect(batch.generations).toHaveLength(3)
    for (const generation of batch.generations) {
      expect(generation.status).toBe("queued")
      expect(generation.providerJobId).toBeNull()
      expect(generation.startedAt).toBeNull()
    }
    expect(
      listByContainer(opened.handle.db, { containerId }).items
    ).toHaveLength(3)
  })

  it("gives every sibling the same batch id, in the row and in the request", () => {
    return submitBatch(context(), deps(), request(), 3).then((batch) => {
      const ids = new Set(
        batch.generations.map((generation) => generation.batchId)
      )
      expect(ids).toEqual(new Set([batch.batchId]))

      for (const generation of batch.generations) {
        const row = getGeneration(opened.handle.db, generation.id)
        expect(row?.batchId).toBe(batch.batchId)
        expect(JSON.parse(row!.requestJson!).batchId).toBe(batch.batchId)
      }
    })
  })

  it("writes one row with the count param when the model has a count field", async () => {
    const batch = await submitBatch(
      context(),
      deps(nativeCount),
      request({ params: {} }),
      4
    )

    expect(batch.generations).toHaveLength(1)
    const generation = batch.generations[0]!
    expect(generation.status).toBe("queued")
    expect(JSON.parse(generation.paramsJson)).toEqual({ num_outputs: 4 })
    expect(generation.batchId).toBe(batch.batchId)
  })

  it("splits a count past the field's maximum into native-count siblings", async () => {
    const batch = await submitBatch(
      context(),
      deps(nativeCount),
      request({ params: {} }),
      10
    )

    expect(
      batch.generations.map(
        (generation) => JSON.parse(generation.paramsJson).num_outputs
      )
    ).toEqual([4, 4, 2])
    expect(
      new Set(batch.generations.map((generation) => generation.batchId))
    ).toEqual(new Set([batch.batchId]))
  })

  it("links every sibling's references to their slots", async () => {
    const batch = await submitBatch(
      context(),
      deps(),
      request({
        references: [{ slotField: "reference_images", assetId, position: 0 }],
      }),
      2
    )

    for (const generation of batch.generations) {
      expect(listInputs(opened.handle.db, generation.id)).toEqual([
        expect.objectContaining({ slotField: "reference_images", position: 0 }),
      ])
    }
  })

  it("asks the catalog once for the whole batch", async () => {
    const catalog = deps()
    await submitBatch(context(), catalog, request(), 4)
    expect(catalog.getModel).toHaveBeenCalledTimes(1)
  })

  it("refuses the whole batch rather than queueing a bad half of it", async () => {
    await expect(
      submitBatch(
        context(),
        deps(),
        request({
          references: [
            { slotField: "reference_images", assetId: "ghost", position: 0 },
          ],
        }),
        3
      )
    ).rejects.toThrow(/ghost/)

    expect(listByContainer(opened.handle.db, { containerId }).items).toEqual([])
  })

  it("keeps a batch id the caller already minted for the node", async () => {
    const batch = await submitBatch(
      context(),
      deps(),
      request({ batchId: "batch-from-the-node" }),
      2
    )
    expect(batch.batchId).toBe("batch-from-the-node")
  })
})

describe("submission validation", () => {
  it("rejects slot overflow before creating a run", async () => {
    const limited = deps({
      referenceSlots: [{ ...descriptor.referenceSlots[0]!, max: 1 }],
    })
    await expect(
      submitGeneration(
        context(),
        limited,
        request({
          references: [0, 1].map((position) => ({
            assetId,
            slotField: "reference_images",
            position,
          })),
        })
      )
    ).rejects.toThrow("at most 1")
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(0)
  })

  it("rejects duplicate reference positions", async () => {
    await expect(
      submitGeneration(
        context(),
        deps(),
        request({
          references: [0, 0].map((position) => ({
            assetId,
            slotField: "reference_images",
            position,
          })),
        })
      )
    ).rejects.toThrow("positions must be unique")
  })

  it("does not queue any siblings when account preflight fails", async () => {
    const preflight = vi.fn(async () => {
      throw new Error("Spending limit exceeded")
    })
    await expect(
      submitBatch(context(), { ...deps(), preflight }, request(), 3)
    ).rejects.toThrow("Spending limit")
    expect(preflight).toHaveBeenCalledOnce()
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(0)
  })
})
