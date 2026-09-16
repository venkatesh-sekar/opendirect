/**
 * The background job runner.
 *
 * One `p-queue` decides how many runs are in flight; SQLite decides what they
 * are. Every state change is written to the `jobs` row *before* it is pushed to
 * the renderer, so the queue can be rebuilt from the database after a crash and
 * the job list never shows a state the database does not agree with.
 *
 * The shape of a run:
 *
 *   queued → submitting → running → downloading → succeeded
 *                     ↘            ↘
 *                      failed       canceled
 *
 * Deliberate choices:
 *
 * - **Polling is ours, not the SDK's.** `replicate.wait()` blocks a socket for
 *   the life of the prediction: it cannot be cancelled, it cannot survive a
 *   restart, and it tells the database nothing. A loop driven by the configured
 *   interval can do all three.
 * - **A retry is a second payment.** Only a transport-level failure is retried
 *   (see `poll.ts`); a 4xx, and a run the provider itself reported as failed,
 *   are final. A download that fails is also final — the provider has already
 *   been paid, and re-submitting would pay again for an output that exists.
 * - **The provider is asked for nothing the row does not already say.** The
 *   payload is rebuilt from `params_json` plus the run's own reference assets,
 *   so a resumed job sends exactly what the original would have.
 *
 * ⛔ `provider.submit` is the one paid call in the app, and this is the only
 * module that makes it. It happens for a `queued` row the user created by
 * pressing Generate, or for an explicit Retry — never on a timer, never on
 * startup for a run that was not already submitted.
 */
import { readFile } from "node:fs/promises"
import { basename } from "node:path"

import type { JobDto, JobState, ProviderId } from "@opendirect/contract"
import PQueue from "p-queue"

import { contentTypeFor } from "../media"
import { resolveAssetPath, type ProjectRef } from "../project"
import type { ProjectDatabase } from "../db/client"
import type {
  ModelProvider,
  ProviderJobRef,
  ProviderJobState,
} from "../providers/types"
import {
  attachOutputs,
  getGeneration,
  listInputs,
  updateStatus,
} from "../repo/generations"
import {
  createJob,
  getJob,
  getJobForGeneration,
  isActiveState,
  listActiveJobs,
  listJobs,
  requireJob,
  toJobDto,
  updateJob,
} from "../repo/jobs"
import {
  downloadOutput,
  type DownloadRequest,
  type DownloadedOutput,
} from "./download"
import {
  backoffDelay,
  isRetryable,
  nextPollDelay,
  MAX_ATTEMPTS,
  ProviderReportedFailure,
  TerminalJobError,
} from "./poll"

/**
 * A run whose outputs could not be brought into the project.
 *
 * Terminal by construction: the provider has already produced (and charged
 * for) the output, so a retry would pay twice for a file that exists. The user
 * is told what happened and can retry deliberately from the job list.
 */
class DownloadFailure extends TerminalJobError {
  constructor(detail: string) {
    super(`The run finished but its output could not be downloaded: ${detail}`)
    this.name = "DownloadFailure"
  }
}

/** What a run needs to know about the model beyond what its row records. */
export interface RunnerModelShape {
  referenceSlots: { field: string; label: string; multiple: boolean }[]
}

export interface JobRunnerSettings {
  maxConcurrentJobs: number
  pollIntervalMs: number
}

export interface JobRunnerDeps {
  db: ProjectDatabase
  project: Pick<ProjectRef, "id" | "path">
  /** The registry, as the runner's one way to reach an adapter. */
  getProvider: (id: ProviderId) => ModelProvider
  /** Read fresh on every enqueue, so changing them takes effect immediately. */
  settings: () => JobRunnerSettings
  /** The catalog, for a model's reference slots. Optional: a run with no
   *  references never needs it, and an offline catalog must not block one. */
  getModel?: (key: string) => Promise<RunnerModelShape>
  download?: (request: DownloadRequest) => Promise<DownloadedOutput>
  /** Pushed to the renderer as a `jobs:update` event. */
  onUpdate?: (job: JobDto) => void
  now?: () => number
  /** Injected so tests drive the clock instead of waiting on it. */
  wait?: (ms: number) => Promise<void>
  random?: () => number
  log?: (message: string, error: unknown) => void
}

export interface JobRunner {
  /** ⛔ Schedules the paid call for a `queued` run. */
  enqueue(generationId: string): JobDto
  list(limit?: number): JobDto[]
  cancel(jobId: string): Promise<JobDto>
  /** ⛔ Re-submits a finished-unhappily run. Paid; user-initiated only. */
  retry(jobId: string): Promise<JobDto>
  /** Rebuilds the queue from SQLite after a restart. */
  recover(): Promise<JobDto[]>
  /** Resolves when nothing is queued or running. */
  idle(): Promise<void>
  dispose(): void
}

const CRASHED_MESSAGE =
  "OpenDirect quit while this run was being submitted, so it could not be resumed after the restart. Nothing was downloaded; check the provider's dashboard before retrying so the same run is not paid for twice."

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "Unknown job failure"
}

export function createJobRunner(deps: JobRunnerDeps): JobRunner {
  const { db, project } = deps
  const now = deps.now ?? Date.now
  const wait =
    deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = deps.random ?? Math.random
  const download = deps.download ?? downloadOutput
  const log = deps.log ?? (() => {})

  const queue = new PQueue({ concurrency: deps.settings().maxConcurrentJobs })
  /** Jobs the user stopped. Set synchronously, so a job can be cancelled
   *  between `enqueue` and the moment the queue gets round to it. */
  const cancelled = new Set<string>()
  /** Last reported progress per job; not persisted — see `jobSchema`. */
  const progress = new Map<string, number | null>()
  let disposed = false

  function publish(jobId: string): JobDto {
    const job = requireJob(db, jobId)
    const generation = getGeneration(db, job.generationId)
    if (!generation)
      throw new Error(`Generation ${job.generationId} was not found`)
    const dto = toJobDto(job, generation, progress.get(jobId) ?? null)
    try {
      deps.onUpdate?.(dto)
    } catch (error) {
      // A renderer that has gone away must not take the run down with it.
      log("Could not push a job update", error)
    }
    return dto
  }

  function move(
    jobId: string,
    state: JobState,
    patch: Parameters<typeof updateJob>[2] = {}
  ): JobDto {
    updateJob(db, jobId, { ...patch, state })
    return publish(jobId)
  }

  function providerFor(id: string): ModelProvider {
    return deps.getProvider(id as ProviderId)
  }

  /**
   * The run's reference assets, as URLs its provider can actually read.
   *
   * An adapter that can upload (Replicate) gets a hosted URL; one that cannot
   * gets a `data:` URL, which both providers accept for images. The slot's own
   * multiplicity decides whether the field is a list, so a single-image slot
   * does not arrive as a one-element array the model will reject.
   */
  async function referenceParams(
    provider: ModelProvider,
    generationId: string,
    modelKey: string
  ): Promise<Record<string, unknown>> {
    const inputs = listInputs(db, generationId)
    if (inputs.length === 0) return {}

    let slots: RunnerModelShape["referenceSlots"] = []
    if (deps.getModel) {
      try {
        slots = (await deps.getModel(modelKey)).referenceSlots
      } catch (error) {
        // The catalog being unreachable must not lose the user's references;
        // the multiplicity is inferred from how many were chosen instead.
        log(`Could not read reference slots for ${modelKey}`, error)
      }
    }
    const multiple = new Map(slots.map((slot) => [slot.field, slot.multiple]))

    const byField = new Map<string, string[]>()
    for (const input of inputs) {
      if (!input.asset.relPath) continue
      const absolute = resolveAssetPath(project, input.asset.relPath)
      const filename = basename(input.asset.relPath)
      const contentType = input.asset.mimeType ?? contentTypeFor(filename)

      const url = provider.uploadReference
        ? await provider.uploadReference({
            path: absolute,
            filename,
            contentType,
          })
        : `data:${contentType};base64,${(await readFile(absolute)).toString("base64")}`

      byField.set(input.slotField, [
        ...(byField.get(input.slotField) ?? []),
        url,
      ])
    }

    const params: Record<string, unknown> = {}
    for (const [field, urls] of byField) {
      const many = multiple.get(field) ?? urls.length > 1
      params[field] = many ? urls : urls[0]
    }
    return params
  }

  /** Downloads a finished run's outputs and records it as succeeded. */
  async function complete(
    jobId: string,
    generationId: string,
    state: ProviderJobState
  ): Promise<void> {
    move(jobId, "downloading")

    const outputs: DownloadedOutput[] = []
    try {
      for (const [index, url] of state.outputUrls.entries()) {
        outputs.push({
          ...(await download({ url, project, generationId, index })),
        })
      }
    } catch (error) {
      // The provider has already been paid and the job cannot be re-submitted
      // for free, so this is terminal — and said in those words.
      throw new DownloadFailure(messageOf(error))
    }

    // `attachOutputs` is what turns files into assets, thumbnails and board
    // links; the runner deliberately owns none of that.
    await attachOutputs(
      { db, project: { id: deps.project.id, path: deps.project.path } },
      {
        generationId,
        outputs: outputs.map((output) => ({
          relPath: output.relPath,
          mimeType: output.mimeType,
        })),
      }
    )

    updateStatus(db, generationId, {
      status: "succeeded",
      error: null,
      response: state.raw,
      // Only OpenRouter reports what a run actually cost; Replicate never
      // does, and inventing a number would be worse than leaving the estimate.
      ...(state.costUsd === null
        ? {}
        : { actualCostUsd: state.costUsd, costConfidence: "exact" }),
    })
    move(jobId, "succeeded", { error: null })
  }

  async function poll(
    jobId: string,
    generationId: string,
    provider: ModelProvider,
    initial: ProviderJobRef
  ): Promise<void> {
    let ref = initial
    for (;;) {
      if (cancelled.has(jobId) || disposed) return

      const interval = nextPollDelay(deps.settings().pollIntervalMs, random)
      updateJob(db, jobId, { nextPollAt: now() + interval })
      await wait(interval)
      if (cancelled.has(jobId) || disposed) return

      const state = await provider.poll(ref)
      ref = state.ref
      progress.set(jobId, state.progress)

      if (state.status === "succeeded") {
        updateJob(db, jobId, { lastPolledAt: now() })
        await complete(jobId, generationId, state)
        return
      }
      if (state.status === "failed") {
        updateStatus(db, generationId, {
          status: "running",
          response: state.raw,
        })
        throw new ProviderReportedFailure(
          state.error ?? "The provider reported the run as failed."
        )
      }
      if (state.status === "canceled") {
        cancelled.add(jobId)
        updateStatus(db, generationId, { status: "canceled" })
        move(jobId, "canceled")
        return
      }

      move(jobId, "running", { lastPolledAt: now() })
    }
  }

  /** One attempt: submit (or re-attach) and then poll to a conclusion. */
  async function attempt(jobId: string, resume: boolean): Promise<void> {
    const job = requireJob(db, jobId)
    const generation = getGeneration(db, job.generationId)
    if (!generation)
      throw new Error(`Generation ${job.generationId} was not found`)
    const provider = providerFor(generation.provider)

    if (resume && generation.providerJobId) {
      move(jobId, "running")
      await poll(jobId, generation.id, provider, {
        provider: generation.provider as ProviderId,
        id: generation.providerJobId,
        pollUrl: null,
      })
      return
    }

    move(jobId, "submitting", { error: null })
    updateStatus(db, generation.id, { status: "submitted", error: null })

    const params = {
      ...(JSON.parse(generation.paramsJson) as Record<string, unknown>),
      ...(await referenceParams(
        provider,
        generation.id,
        `${generation.provider}:${generation.modelSlug}`
      )),
    }
    if (cancelled.has(jobId) || disposed) return

    // ⛔ The paid call.
    const ref = await provider.submit({
      slug: generation.modelSlug,
      versionId: generation.modelVersion,
      params,
    })

    updateStatus(db, generation.id, {
      status: "running",
      providerJobId: ref.id,
      // The payload is recorded as it was actually sent, references and all.
      request: params,
    })
    move(jobId, "running")

    await poll(jobId, generation.id, provider, ref)
  }

  function fail(jobId: string, generationId: string, message: string): void {
    updateStatus(db, generationId, { status: "failed", error: message })
    move(jobId, "failed", { error: message })
  }

  /** The retry loop around `attempt`. */
  async function execute(jobId: string, resume: boolean): Promise<void> {
    const job = getJob(db, jobId)
    if (!job || cancelled.has(jobId) || disposed) return

    let attempts = job.attempts
    for (;;) {
      if (cancelled.has(jobId) || disposed) return
      attempts += 1
      updateJob(db, jobId, { attempts })

      try {
        await attempt(jobId, resume && attempts === job.attempts + 1)
        return
      } catch (error) {
        if (cancelled.has(jobId) || disposed) return
        const message = messageOf(error)

        if (attempts < MAX_ATTEMPTS && isRetryable(error)) {
          move(jobId, "queued", { error: message })
          await wait(backoffDelay(attempts, { random }))
          if (cancelled.has(jobId) || disposed) return
          continue
        }

        fail(jobId, job.generationId, message)
        return
      }
    }
  }

  function schedule(jobId: string, resume: boolean): void {
    queue.concurrency = deps.settings().maxConcurrentJobs
    void queue
      .add(() => execute(jobId, resume))
      .catch((error: unknown) => {
        log(`Job ${jobId} crashed`, error)
        try {
          const job = getJob(db, jobId)
          if (job) fail(jobId, job.generationId, messageOf(error))
        } catch (failure) {
          log(`Job ${jobId} could not be marked failed`, failure)
        }
      })
  }

  return {
    enqueue(generationId) {
      const generation = getGeneration(db, generationId)
      if (!generation)
        throw new Error(`Generation ${generationId} was not found`)
      if (generation.status !== "queued") {
        throw new Error(
          `Generation ${generationId} is ${generation.status}, not queued — only a queued run can be started.`
        )
      }

      const existing = getJobForGeneration(db, generationId)
      if (existing && isActiveState(existing.state)) {
        return publish(existing.id)
      }

      const job = existing
        ? updateJob(db, existing.id, {
            state: "queued",
            attempts: 0,
            error: null,
          })
        : createJob(db, { generationId, now: now() })

      cancelled.delete(job.id)
      const dto = publish(job.id)
      schedule(job.id, false)
      return dto
    },

    list(limit) {
      return listJobs(db, { limit }).map((job) => ({
        ...job,
        progress: progress.get(job.id) ?? null,
      }))
    },

    async cancel(jobId) {
      // Synchronous, before any await: a job may be between two awaits right
      // now, and this is what it checks.
      cancelled.add(jobId)
      const job = requireJob(db, jobId)
      const generation = getGeneration(db, job.generationId)
      if (!generation)
        throw new Error(`Generation ${job.generationId} was not found`)

      let note: string | null = null
      if (generation.providerJobId && isActiveState(job.state)) {
        try {
          await providerFor(generation.provider).cancel({
            provider: generation.provider as ProviderId,
            id: generation.providerJobId,
            pollUrl: null,
          })
        } catch (error) {
          // OpenRouter has no cancel endpoint at all: the run is still stopped
          // here, and the reason it may still be billed is recorded on the row.
          note = messageOf(error)
        }
      }

      if (isActiveState(job.state)) {
        updateStatus(db, job.generationId, { status: "canceled", error: note })
        return move(jobId, "canceled", { error: note })
      }
      return publish(jobId)
    },

    async retry(jobId) {
      const job = requireJob(db, jobId)
      if (isActiveState(job.state)) {
        throw new Error("That run is still going; cancel it before retrying.")
      }

      updateStatus(db, job.generationId, {
        status: "queued",
        error: null,
        providerJobId: null,
      })
      updateJob(db, jobId, { state: "queued", attempts: 0, error: null })
      cancelled.delete(jobId)
      progress.delete(jobId)

      const dto = publish(jobId)
      schedule(jobId, false)
      return dto
    },

    async recover() {
      const recovered: JobDto[] = []
      for (const job of listActiveJobs(db)) {
        const generation = getGeneration(db, job.generationId)
        if (!generation) continue

        if (generation.providerJobId) {
          // The provider job outlived us; re-attach and keep polling rather
          // than paying for the same run twice.
          recovered.push(move(job.id, "running"))
          schedule(job.id, true)
          continue
        }

        if (job.state === "queued" && generation.status === "queued") {
          // Never submitted, so nothing has been spent: start it properly.
          recovered.push(publish(job.id))
          schedule(job.id, false)
          continue
        }

        // Interrupted mid-submit with no provider job id to show for it. The
        // honest answer is "failed, go and look", not a silent re-submission.
        updateStatus(db, job.generationId, {
          status: "failed",
          error: CRASHED_MESSAGE,
        })
        recovered.push(move(job.id, "failed", { error: CRASHED_MESSAGE }))
      }
      return recovered
    },

    async idle() {
      await queue.onIdle()
    },

    dispose() {
      disposed = true
      queue.clear()
    },
  }
}
