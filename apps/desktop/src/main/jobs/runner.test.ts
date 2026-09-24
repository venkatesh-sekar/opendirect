/**
 * The job runner's state machine.
 *
 * ⛔ Not one test here reaches a real provider. Most drive a scripted fake
 * adapter; the end-to-end case drives the *real* Replicate adapter against
 * `msw` handlers backed by the same fixture shape as `replicate.test.ts`. The
 * root harness runs with `onUnhandledRequest: "error"`, so an escaped request
 * fails the suite instead of spending money.
 *
 * Time is injected rather than faked globally: `wait` is a recorder, so every
 * poll interval and every backoff delay is asserted directly and no test has to
 * interleave `p-queue`'s promises with a fake clock.
 */
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import type { JobDto } from "@opendirect/contract"
import { HttpResponse, http } from "msw"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { server } from "../../../../../test/msw/server"
import { createProject, openProject, type OpenProject } from "../project"
import { createReplicateProvider } from "../providers/replicate"
import type {
  GenerationRequest,
  ModelProvider,
  ProviderJobRef,
  ProviderJobState,
} from "../providers/types"
import { importFiles, listByContainer as listAssets } from "../repo/assets"
import { createContainer } from "../repo/containers"
import {
  createGeneration,
  getGeneration,
  updateStatus,
} from "../repo/generations"
import { createJob, getJobForGeneration, listJobs } from "../repo/jobs"
import { MAX_ATTEMPTS } from "./poll"
import { createJobRunner, type JobRunner } from "./runner"

let root: string
let opened: OpenProject
let containerId: string
let waits: number[]
let updates: JobDto[]
let runner: JobRunner | null

/** A provider whose every answer the test writes itself. */
interface FakeProvider extends ModelProvider {
  submissions: GenerationRequest[]
  cancelled: string[]
}

interface FakeOptions {
  /** One entry per poll; the last one repeats. */
  states?: Partial<ProviderJobState>[]
  onSubmit?: (req: GenerationRequest, attempt: number) => void | Promise<void>
}

function fakeProvider(options: FakeOptions = {}): FakeProvider {
  const submissions: GenerationRequest[] = []
  const cancelled: string[] = []
  const states = options.states ?? [{ status: "succeeded" }]
  let polls = 0

  return {
    id: "replicate",
    submissions,
    cancelled,
    isConfigured: () => true,
    listModels: async () => [],
    getModel: async () => {
      throw new Error("not used")
    },
    async submit(req) {
      submissions.push(req)
      await options.onSubmit?.(req, submissions.length)
      return { provider: "replicate", id: `pred-${submissions.length}` }
    },
    async poll(ref: ProviderJobRef): Promise<ProviderJobState> {
      const next = states[Math.min(polls, states.length - 1)] ?? {}
      polls += 1
      return {
        ref,
        status: next.status ?? "running",
        progress: next.progress ?? null,
        outputUrls: next.outputUrls ?? [],
        costUsd: next.costUsd ?? null,
        predictTimeSeconds: next.predictTimeSeconds ?? null,
        error: next.error ?? null,
        raw: next.raw ?? { id: ref.id },
      }
    },
    async cancel(ref) {
      cancelled.push(ref.id)
    },
  }
}

/** A download that writes a file into the project without any network. */
async function fakeDownload(input: {
  url: string
  project: { path: string }
  generationId: string
  index: number
}) {
  const relPath = `generations/${input.generationId}/${input.index}.mp4`
  const absolute = join(input.project.path, relPath)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `bytes for ${input.url}`)
  return { relPath, bytes: 10, sha256: "abc", mimeType: "video/mp4" }
}

function build(
  provider: ModelProvider,
  overrides: Partial<Parameters<typeof createJobRunner>[0]> = {}
): JobRunner {
  runner = createJobRunner({
    db: opened.handle.db,
    project: opened.project,
    getProvider: () => provider,
    settings: () => ({ maxConcurrentJobs: 2, pollIntervalMs: 3000 }),
    download: fakeDownload,
    onUpdate: (job) => updates.push(job),
    wait: async (ms: number) => {
      waits.push(ms)
    },
    random: () => 0,
    ...overrides,
  })
  return runner
}

function queued(overrides: Record<string, unknown> = {}) {
  return createGeneration(opened.handle.db, {
    projectId: opened.project.id,
    containerId,
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: "ver-1",
    kind: "video",
    prompt: "a bellhop opens the lift",
    params: { duration: 5, resolution: "720p" },
    status: "queued",
    ...overrides,
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-runner-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  containerId = createContainer(opened.handle.db, {
    projectId: project.id,
    kind: "scene",
    name: "Lobby",
  }).id
  waits = []
  updates = []
  runner = null
})

afterEach(async () => {
  runner?.dispose()
  opened.close()
  await rm(root, { recursive: true, force: true })
})

describe("the happy path", () => {
  it("submits, polls, downloads and records the run as succeeded", async () => {
    const provider = fakeProvider({
      states: [
        { status: "queued" },
        { status: "running" },
        {
          status: "succeeded",
          outputUrls: ["https://replicate.delivery/out.mp4"],
          costUsd: 0.64,
          raw: { id: "pred-1", status: "succeeded" },
        },
      ],
    })
    const generation = queued()

    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    expect(provider.submissions[0]).toMatchObject({
      slug: "bytedance/seedance-2.5",
      versionId: "ver-1",
      params: { duration: 5, resolution: "720p" },
    })

    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.status).toBe("succeeded")
    expect(row.providerJobId).toBe("pred-1")
    expect(row.completedAt).not.toBeNull()
    expect(JSON.parse(row.responseJson!)).toMatchObject({ id: "pred-1" })

    const job = getJobForGeneration(opened.handle.db, generation.id)!
    expect(job.state).toBe("succeeded")
  })

  it("walks the job through every state in order", async () => {
    const provider = fakeProvider({
      states: [
        { status: "running" },
        { status: "succeeded", outputUrls: ["https://x/out.mp4"] },
      ],
    })
    build(provider).enqueue(queued().id)
    await runner!.idle()

    expect(updates.map((job) => job.state)).toEqual([
      "queued",
      "submitting",
      "running",
      "running",
      "downloading",
      "succeeded",
    ])
  })

  it("records the provider's actual cost as exact", async () => {
    const provider = fakeProvider({
      states: [
        {
          status: "succeeded",
          outputUrls: ["https://x/out.mp4"],
          costUsd: 0.42,
        },
      ],
    })
    const generation = queued({
      estimatedCostUsd: 0.5,
      costConfidence: "estimated",
    })
    build(provider).enqueue(generation.id)
    await runner!.idle()

    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.actualCostUsd).toBe(0.42)
    expect(row.costConfidence).toBe("exact")
    expect(row.estimatedCostUsd).toBe(0.5)
  })

  it("leaves the estimate alone when the provider reports no cost", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const generation = queued({
      estimatedCostUsd: 0.5,
      costConfidence: "estimated",
    })
    build(provider).enqueue(generation.id)
    await runner!.idle()

    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.actualCostUsd).toBeNull()
    expect(row.costConfidence).toBe("estimated")
  })

  it("files every output on the run's own board", async () => {
    const provider = fakeProvider({
      states: [
        {
          status: "succeeded",
          outputUrls: ["https://x/a.mp4", "https://x/b.mp4"],
        },
      ],
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    const page = listAssets(opened.handle.db, { containerId })
    expect(page.items).toHaveLength(2)
    expect(
      page.items.every((asset) => asset.generationId === generation.id)
    ).toBe(true)
  })

  it("polls at the configured interval", async () => {
    const provider = fakeProvider({
      states: [{ status: "running" }, { status: "succeeded" }],
    })
    build(provider).enqueue(queued().id)
    await runner!.idle()

    expect(waits).toEqual([3000, 3000])
  })
})

describe("concurrency", () => {
  it("runs no more jobs at once than the settings allow", async () => {
    let inFlight = 0
    let peak = 0
    const provider = fakeProvider({
      states: [{ status: "succeeded" }],
      onSubmit: async () => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await Promise.resolve()
      },
    })
    // Released when the job finishes, which is after its first poll.
    const original = provider.poll.bind(provider)
    provider.poll = async (ref) => {
      const state = await original(ref)
      if (state.status !== "running") inFlight -= 1
      return state
    }

    const runnerUnderTest = build(provider, {
      settings: () => ({ maxConcurrentJobs: 2, pollIntervalMs: 1000 }),
    })
    for (let i = 0; i < 5; i += 1) runnerUnderTest.enqueue(queued().id)
    await runnerUnderTest.idle()

    expect(provider.submissions).toHaveLength(5)
    expect(peak).toBeLessThanOrEqual(2)
  })
})

describe("retries", () => {
  it("retries a 5xx with exponential backoff, three attempts in all", async () => {
    const provider = fakeProvider({
      onSubmit: () => {
        throw Object.assign(new Error("Replicate is down"), {
          response: { status: 503 },
        })
      },
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(3)
    // Two backoffs between three attempts, and no poll interval in between.
    expect(waits).toEqual([1000, 2000])

    const job = getJobForGeneration(opened.handle.db, generation.id)!
    expect(job.state).toBe("failed")
    expect(job.attempts).toBe(3)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "failed"
    )
    expect(getGeneration(opened.handle.db, generation.id)!.error).toMatch(
      /Replicate is down/
    )
  })

  it("fails a 4xx immediately — the request itself is wrong", async () => {
    const provider = fakeProvider({
      onSubmit: () => {
        throw Object.assign(new Error("Invalid input: duration"), {
          response: { status: 422 },
        })
      },
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    expect(waits).toEqual([])
    expect(getJobForGeneration(opened.handle.db, generation.id)!.attempts).toBe(
      1
    )
  })

  it("does not re-submit a run the provider itself reported as failed", async () => {
    const provider = fakeProvider({
      states: [{ status: "failed", error: "NSFW content detected" }],
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    expect(getGeneration(opened.handle.db, generation.id)!.error).toBe(
      "NSFW content detected"
    )
  })
})

describe("downloading", () => {
  it("fails the run without paying for it twice when a download fails", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const generation = queued()
    build(provider, {
      download: () => Promise.reject(new Error("connection reset")),
    }).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.status).toBe("failed")
    expect(row.error).toMatch(/could not be downloaded/i)
    expect(row.error).toMatch(/connection reset/)
    expect(getJobForGeneration(opened.handle.db, generation.id)!.state).toBe(
      "failed"
    )
    expect(listAssets(opened.handle.db, { containerId }).items).toHaveLength(0)
  })
})

describe("cancel", () => {
  it("cancels the provider job and stops polling", async () => {
    const provider = fakeProvider({ states: [{ status: "running" }] })
    const generation = queued()
    const underTest = build(provider, {
      // Cancel lands while the job is between polls.
      wait: async (ms: number) => {
        waits.push(ms)
        const job = getJobForGeneration(opened.handle.db, generation.id)
        if (job && waits.length === 1) await underTest.cancel(job.id)
      },
    })
    underTest.enqueue(generation.id)
    await underTest.idle()

    expect(provider.cancelled).toEqual(["pred-1"])
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "canceled"
    )
    expect(getJobForGeneration(opened.handle.db, generation.id)!.state).toBe(
      "canceled"
    )
    // The loop stopped rather than polling on forever.
    expect(waits.length).toBeLessThan(3)
  })

  it("marks a queued job cancelled without asking the provider", async () => {
    const provider = fakeProvider()
    const underTest = build(provider)
    const generation = queued()
    const job = underTest.enqueue(generation.id)
    await underTest.cancel(job.id)
    await underTest.idle()

    expect(provider.cancelled).toEqual([])
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "canceled"
    )
  })
})

describe("crash recovery", () => {
  it("re-attaches to a provider job that was still running", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const generation = queued()
    // What a crash mid-run leaves behind: a running row with a provider job id,
    // and a `jobs` row nobody is polling any more.
    updateStatus(opened.handle.db, generation.id, {
      status: "running",
      providerJobId: "pred-restored",
    })
    createJob(opened.handle.db, {
      generationId: generation.id,
      state: "running",
    })

    const recovered = build(provider)
    await recovered.recover()
    await recovered.idle()

    expect(provider.submissions).toHaveLength(0)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
  })

  it("fails a job that crashed before its provider job existed", async () => {
    const provider = fakeProvider()
    const generation = queued()
    updateStatus(opened.handle.db, generation.id, { status: "submitted" })
    createJob(opened.handle.db, {
      generationId: generation.id,
      state: "submitting",
    })

    const recovered = build(provider)
    await recovered.recover()
    await recovered.idle()

    // Nothing to re-attach to, and re-submitting might pay twice for a run the
    // provider may already have accepted.
    expect(provider.submissions).toHaveLength(0)
    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.status).toBe("failed")
    expect(row.error).toMatch(/restart|quit|interrupted/i)
  })

  it("never submits a job that was still queued — it waits to be resumed", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const generation = queued()
    createJob(opened.handle.db, { generationId: generation.id })

    const recovered = build(provider)
    const jobs = await recovered.recover()
    await recovered.idle()

    // ⛔ The whole point: restarting the app must not spend money.
    expect(provider.submissions).toHaveLength(0)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "queued"
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.awaitingResume).toBe(true)
    expect(jobs[0]!.state).toBe("queued")
    // And the list the renderer reads says the same thing.
    expect(recovered.list().at(0)?.awaitingResume).toBe(true)
  })

  it("submits a held job only when it is explicitly resumed", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const generation = queued()
    const job = createJob(opened.handle.db, { generationId: generation.id })

    const recovered = build(provider)
    await recovered.recover()
    await recovered.idle()
    expect(provider.submissions).toHaveLength(0)

    const resumed = await recovered.resume(job.id)
    await recovered.idle()

    expect(resumed.awaitingResume).toBe(false)
    expect(provider.submissions).toHaveLength(1)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
  })

  it("refuses to resume a run it is not holding, so nothing pays twice", async () => {
    const provider = fakeProvider()
    const underTest = build(provider)
    const generation = queued()
    const job = underTest.enqueue(generation.id)
    await underTest.idle()

    // This one was started by the user in this session — resuming it would be
    // a second submission of a run that is already going or already paid for.
    await expect(underTest.resume(job.id)).rejects.toThrow(/not waiting/i)
  })

  it("stops holding a job once it is cancelled", async () => {
    const provider = fakeProvider()
    const generation = queued()
    const job = createJob(opened.handle.db, { generationId: generation.id })

    const recovered = build(provider)
    await recovered.recover()
    await recovered.cancel(job.id)
    await recovered.idle()

    expect(provider.submissions).toHaveLength(0)
    await expect(recovered.resume(job.id)).rejects.toThrow(/not waiting/i)
  })
})

describe("the job list", () => {
  it("sorts active jobs ahead of finished ones", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const done = queued()
    build(provider).enqueue(done.id)
    await runner!.idle()

    const waiting = queued()
    runner!.enqueue(waiting.id)

    const list = listJobs(opened.handle.db)
    expect(list).toHaveLength(2)
    expect(list[0]!.generationId).toBe(waiting.id)
    expect(list[0]!.generation.modelSlug).toBe("bytedance/seedance-2.5")
    await runner!.idle()
  })
})

describe("end to end against msw", () => {
  it("drives the real Replicate adapter from submit to a downloaded file", async () => {
    const prediction = (status: string, output?: string) => ({
      id: "pred-e2e",
      model: "bytedance/seedance-2.5",
      version: "ver-1",
      input: {},
      status,
      output: output ?? null,
      error: null,
      logs: "",
      created_at: "2026-09-16T00:00:00Z",
      urls: { get: "https://api.replicate.com/v1/predictions/pred-e2e" },
      metrics: { predict_time: 12.5 },
    })

    let created = 0
    server.use(
      http.post("https://api.replicate.com/v1/predictions", () => {
        created += 1
        return HttpResponse.json(prediction("starting"))
      }),
      http.get("https://api.replicate.com/v1/predictions/pred-e2e", () =>
        HttpResponse.json(
          prediction("succeeded", "https://replicate.delivery/pbxt/out.mp4")
        )
      ),
      http.get("https://replicate.delivery/pbxt/out.mp4", () =>
        HttpResponse.arrayBuffer(
          new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
          {
            headers: { "Content-Type": "video/mp4", "Content-Length": "3" },
          }
        )
      )
    )

    const provider = createReplicateProvider({ getKey: () => "r8_test" })
    const generation = queued()
    build(provider, { download: undefined }).enqueue(generation.id)
    await runner!.idle()

    expect(created).toBe(1)
    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.status).toBe("succeeded")
    const page = listAssets(opened.handle.db, { containerId })
    expect(page.items[0]!.relPath).toBe(`generations/${generation.id}/0.mp4`)
    expect(page.items[0]!.bytes).toBe(3)
  })
})

describe("references", () => {
  it("resolves reference assets into URLs the provider can fetch", async () => {
    const source = join(root, "ref.png")
    await writeFile(source, Buffer.from([137, 80, 78, 71]))
    const imported = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )
    const assetId = imported.assets[0]!.id

    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: [] }],
    })
    const uploaded: string[] = []
    provider.uploadReference = async (input) => {
      uploaded.push(input.filename)
      return `https://api.replicate.com/v1/files/${input.filename}`
    }

    const generation = queued({
      inputs: [{ assetId, slotField: "reference_images", position: 0 }],
    })
    build(provider, {
      getModel: async () => ({
        referenceSlots: [
          { field: "reference_images", label: "References", multiple: true },
        ],
      }),
    }).enqueue(generation.id)
    await runner!.idle()

    expect(uploaded).toHaveLength(1)
    expect(provider.submissions[0]!.params.reference_images).toEqual([
      expect.stringContaining("https://api.replicate.com/v1/files/"),
    ])
  })

  it("falls back to a data URL for a provider that cannot take an upload", async () => {
    const source = join(root, "ref2.png")
    await writeFile(source, Buffer.from([137, 80, 78, 71]))
    const imported = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )

    const provider = fakeProvider({ states: [{ status: "succeeded" }] })
    const generation = queued({
      inputs: [
        {
          assetId: imported.assets[0]!.id,
          slotField: "image",
          position: 0,
        },
      ],
    })
    build(provider, {
      getModel: async () => ({
        referenceSlots: [{ field: "image", label: "Image", multiple: false }],
      }),
    }).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions[0]!.params.image).toMatch(
      /^data:image\/png;base64,/
    )
  })
})

/**
 * Named shapes (design §3): a mapped slot may say its URLs go out nested.
 * They run here, after upload, because only then are the final URLs known.
 */
describe("shapes", () => {
  async function twoAssets() {
    const paths = await Promise.all(
      ["front.png", "side.png"].map(async (name, index) => {
        const path = join(root, name)
        // Distinct bytes, or the import would dedupe them into one asset.
        await writeFile(path, Buffer.from([137, 80, 78, 71, index]))
        return path
      })
    )
    const imported = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths, containerId }
    )
    return imported.assets
  }

  /** The URL `uploading` hands back for an asset. */
  function urlOf(asset: { relPath: string | null }) {
    return `https://api.replicate.com/v1/files/${basename(asset.relPath!)}`
  }

  function uploading(provider: FakeProvider) {
    provider.uploadReference = async (input) =>
      `https://api.replicate.com/v1/files/${input.filename}`
    return provider
  }

  it("applies the slot's shape to its URLs, in position order", async () => {
    const [front, side] = await twoAssets()
    const provider = uploading(
      fakeProvider({ states: [{ status: "succeeded" }] })
    )
    // Written out of order: position, not insertion, decides the frontal photo.
    const generation = queued({
      inputs: [
        { assetId: side!.id, slotField: "elements", position: 1 },
        { assetId: front!.id, slotField: "elements", position: 0 },
      ],
    })
    build(provider, {
      getModel: async () => ({
        referenceSlots: [
          {
            field: "elements",
            label: "Characters",
            multiple: true,
            shape: "kling-elements",
          },
        ],
      }),
    }).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions[0]!.params.elements).toEqual([
      {
        frontal_image_url: urlOf(front!),
        reference_image_urls: [urlOf(side!)],
      },
    ])
    // What is recorded is for people: the asset marks, never the shape.
    const recorded = JSON.parse(
      getGeneration(opened.handle.db, generation.id)!.requestJson!
    ) as Record<string, unknown>
    expect(recorded.elements).toEqual([
      { assetId: front!.id, slot: "elements" },
      { assetId: side!.id, slot: "elements" },
    ])
  })

  it("fails a shape this version does not have before anything is paid for", async () => {
    const [front] = await twoAssets()
    const provider = uploading(
      fakeProvider({ states: [{ status: "succeeded" }] })
    )
    const submit = vi.spyOn(provider, "submit")
    const generation = queued({
      inputs: [{ assetId: front!.id, slotField: "elements", position: 0 }],
    })
    build(provider, {
      getModel: async () => ({
        referenceSlots: [
          {
            field: "elements",
            label: "Characters",
            multiple: true,
            shape: "from-the-future",
          },
        ],
      }),
    }).enqueue(generation.id)
    await runner!.idle()

    expect(submit).not.toHaveBeenCalled()
    const failed = getGeneration(opened.handle.db, generation.id)!
    expect(failed.status).toBe("failed")
    expect(failed.error).toBe(
      "This model's mapping names a shape (from-the-future) this version of OpenDirect does not have. Update the app or remove the mapping."
    )
    // Terminal: no retry, no backoff.
    expect(waits).toEqual([])
  })
})

it("never submits a generation that is not queued", async () => {
  const provider = fakeProvider()
  const generation = queued({ status: "succeeded" })
  const underTest = build(provider)
  expect(() => underTest.enqueue(generation.id)).toThrow(/queued/i)
  await underTest.idle()
  expect(provider.submissions).toHaveLength(0)
})

describe("never paying twice", () => {
  it("re-attaches instead of re-submitting when a poll fails transiently", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const original = provider.poll.bind(provider)
    let polls = 0
    provider.poll = async (ref) => {
      polls += 1
      if (polls === 1) {
        throw Object.assign(new Error("Replicate is down"), {
          response: { status: 503 },
        })
      }
      return original(ref)
    }

    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    // The prediction was already created and billed; the retry must poll it,
    // not create a second one.
    expect(provider.submissions).toHaveLength(1)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
  })

  it("does not re-send a submit whose outcome is unknown", async () => {
    const provider = fakeProvider({
      onSubmit: () => {
        // No HTTP status at all: the request may have been accepted before the
        // connection died.
        throw new Error("fetch failed")
      },
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    const row = getGeneration(opened.handle.db, generation.id)!
    expect(row.status).toBe("failed")
    expect(row.error).toMatch(/dashboard/i)
  })

  it("still retries a 5xx the provider answered with", async () => {
    const provider = fakeProvider({
      onSubmit: (_req, attemptNumber) => {
        if (attemptNumber === 1) {
          throw Object.assign(new Error("bad gateway"), {
            response: { status: 502 },
          })
        }
      },
      states: [{ status: "succeeded", outputUrls: [] }],
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(2)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
  })

  it("cancels the prediction a cancelled job had already created", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
      onSubmit: async () => {
        // Cancel lands while the submit is in flight: the provider job exists
        // by the time the runner hears about it.
        const job = getJobForGeneration(opened.handle.db, generationId)
        if (job) await runner!.cancel(job.id)
      },
    })
    const generation = queued()
    const generationId = generation.id
    build(provider).enqueue(generationId)
    await runner!.idle()

    const row = getGeneration(opened.handle.db, generationId)!
    expect(row.status).toBe("canceled")
    // The id is persisted even though cancel arrived first, so the run can be
    // found on the provider's dashboard.
    expect(row.providerJobId).toBe("pred-1")
    expect(provider.cancelled).toEqual(["pred-1"])
    expect(getJobForGeneration(opened.handle.db, generationId)!.state).toBe(
      "canceled"
    )
  })

  it("retries only the download when the outputs were already produced", async () => {
    const provider = fakeProvider({
      states: [
        {
          status: "succeeded",
          outputUrls: ["https://x/out.mp4"],
          raw: { id: "pred-1", status: "succeeded" },
        },
      ],
    })
    let failing = true
    const generation = queued()
    const underTest = build(provider, {
      download: async (input) => {
        if (failing) throw new Error("connection reset")
        return fakeDownload(input)
      },
    })
    const job = underTest.enqueue(generation.id)
    await underTest.idle()

    const failed = getGeneration(opened.handle.db, generation.id)!
    expect(failed.status).toBe("failed")
    // Both are what makes the retry free.
    expect(failed.providerJobId).toBe("pred-1")
    expect(JSON.parse(failed.responseJson!)).toMatchObject({ id: "pred-1" })

    failing = false
    await underTest.retry(job.id)
    await underTest.idle()

    expect(provider.submissions).toHaveLength(1)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
    expect(listAssets(opened.handle.db, { containerId }).items).toHaveLength(1)
  })

  it("refuses to retry a run that already succeeded", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: [] }],
    })
    const generation = queued()
    const underTest = build(provider)
    const job = underTest.enqueue(generation.id)
    await underTest.idle()

    await expect(underTest.retry(job.id)).rejects.toThrow(/succeeded/i)
    expect(provider.submissions).toHaveLength(1)
  })

  it("keeps polling a flaky prediction rather than spending the submit budget", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
    })
    const original = provider.poll.bind(provider)
    let polls = 0
    provider.poll = async (ref) => {
      polls += 1
      // More transient poll failures than a submit is ever allowed: a free
      // GET against an already-paid-for prediction must not be rationed by
      // the budget that decides whether to *pay* a second time.
      if (polls <= MAX_ATTEMPTS) {
        throw Object.assign(new Error("Replicate is down"), {
          response: { status: 503 },
        })
      }
      return original(ref)
    }

    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(provider.submissions).toHaveLength(1)
    expect(getGeneration(opened.handle.db, generation.id)!.status).toBe(
      "succeeded"
    )
  })

  it("starts a cancelled run over instead of polling a dead prediction", async () => {
    const provider = fakeProvider({
      states: [{ status: "succeeded", outputUrls: ["https://x/out.mp4"] }],
      onSubmit: async (_req, attemptNumber) => {
        if (attemptNumber > 1) return
        const job = getJobForGeneration(opened.handle.db, generationId)
        if (job) await runner!.cancel(job.id)
      },
    })
    const generation = queued()
    const generationId = generation.id
    const underTest = build(provider)
    const job = underTest.enqueue(generationId)
    await underTest.idle()

    const cancelledRow = getGeneration(opened.handle.db, generationId)!
    expect(cancelledRow.status).toBe("canceled")
    expect(cancelledRow.providerJobId).toBe("pred-1")

    await underTest.retry(job.id)
    await underTest.idle()

    // `pred-1` was cancelled at the provider, so re-attaching to it would poll
    // a run that will never finish. A retry of a cancelled job is a new run.
    expect(provider.submissions).toHaveLength(2)
    const row = getGeneration(opened.handle.db, generationId)!
    expect(row.providerJobId).toBe("pred-2")
    expect(row.status).toBe("succeeded")
  })
})

describe("what is recorded", () => {
  it("records the request with its references redacted, never their URLs", async () => {
    const source = join(root, "secret-ref.png")
    await writeFile(source, Buffer.from([137, 80, 78, 71]))
    const imported = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )
    const assetId = imported.assets[0]!.id

    const provider = fakeProvider({ states: [{ status: "succeeded" }] })
    const generation = queued({
      inputs: [{ assetId, slotField: "image", position: 0 }],
    })
    build(provider, {
      getModel: async () => ({
        referenceSlots: [{ field: "image", label: "Image", multiple: false }],
      }),
    }).enqueue(generation.id)
    await runner!.idle()

    // The provider was sent the real thing…
    expect(provider.submissions[0]!.params.image).toMatch(/^data:image\/png/)
    // …and the row — which travels to the renderer on every `jobs:update` —
    // records which asset filled the slot, not a megabyte of base64.
    const recorded = JSON.parse(
      getGeneration(opened.handle.db, generation.id)!.requestJson!
    ) as Record<string, unknown>
    expect(recorded.image).toEqual({ assetId, slot: "image" })
    expect(JSON.stringify(recorded)).not.toContain("base64")
  })

  it("records the provider's predict time when it reports one", async () => {
    const provider = fakeProvider({
      states: [
        {
          status: "succeeded",
          outputUrls: ["https://x/out.mp4"],
          predictTimeSeconds: 12.5,
        },
      ],
    })
    const generation = queued()
    build(provider).enqueue(generation.id)
    await runner!.idle()

    expect(
      getGeneration(opened.handle.db, generation.id)!.predictTimeSeconds
    ).toBe(12.5)
  })
})
