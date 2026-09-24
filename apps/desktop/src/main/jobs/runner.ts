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

import {
  applyShape,
  isShapeName,
  type JobDto,
  type JobState,
  type ProviderId,
} from "@opendirect/contract"
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
  httpStatusOf,
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
/**
 * A submit whose outcome nobody knows — no status came back, so the provider
 * may have accepted it. Terminal: the one thing worse than a failed run is two
 * of them.
 */
class SubmitOutcomeUnknown extends TerminalJobError {
  constructor(cause: unknown) {
    super(
      `The run could not be confirmed as submitted (${messageOf(cause)}). It was not sent again, because the provider may have accepted it — check the provider's dashboard before retrying.`
    )
    this.name = "SubmitOutcomeUnknown"
  }
}

class DownloadFailure extends TerminalJobError {
  constructor(detail: string) {
    super(`The run finished but its output could not be downloaded: ${detail}`)
    this.name = "DownloadFailure"
  }
}

/** What a run needs to know about the model beyond what its row records. */
export interface RunnerModelShape {
  referenceSlots: {
    field: string
    label: string
    multiple: boolean
    /**
     * A named payload shape from the slot's mapping (design §3), applied to
     * the uploaded URLs. Null or absent: the plain URL, or the list of them.
     */
    shape?: string | null
  }[]
}

/**
 * A mapping (say, a newer remote registry) that names a shape this build
 * does not ship. Terminal, and thrown before the submit: sending the URLs
 * unshaped would pay for a run that ignores what the mapping meant.
 */
class UnknownShape extends TerminalJobError {
  constructor(shape: string) {
    super(
      `This model's mapping names a shape (${shape}) this version of OpenDirect does not have. Update the app or remove the mapping.`
    )
    this.name = "UnknownShape"
  }
}

/**
 * A family run whose row does not say how its inputs are shaped. Translation
 * always records them, so this is a damaged or hand-edited row; guessing
 * from today's registry could send a payload the run was not queued with.
 */
class UnrecordedShapes extends TerminalJobError {
  constructor() {
    super(
      "This run came from a model family but does not record how its inputs are shaped, so it was not sent. Generate it again."
    )
    this.name = "UnrecordedShapes"
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * What the queued request recorded about shapes: the family it was
 * translated from, and each provider field's shape. Both null for a
 * concrete run (or a row from before shapes were recorded).
 */
function recordedShapes(requestJson: string | null): {
  familyId: string | null
  shapes: Map<string, string | null> | null
} {
  let request: unknown = null
  try {
    request = requestJson === null ? null : JSON.parse(requestJson)
  } catch {
    request = null
  }
  if (!isObject(request)) return { familyId: null, shapes: null }
  const familyId =
    typeof request.familyId === "string" ? request.familyId : null
  const shapes = isObject(request.shapes)
    ? new Map(
        Object.entries(request.shapes).map(([field, shape]) => [
          field,
          typeof shape === "string" ? shape : null,
        ])
      )
    : null
  return { familyId, shapes }
}

/** A run's references, twice: as the provider needs them, and as we record them. */
interface ResolvedReferences {
  /** Real URLs — uploaded or `data:` — sent to the provider. */
  params: Record<string, unknown>
  /** `{ assetId, slot }` marks, safe to store and to send to the renderer. */
  redacted: Record<string, unknown>
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
  /**
   * ⛔ Starts a queued run that `recover()` deliberately left alone. Paid;
   * user-initiated only.
   */
  resume(jobId: string): Promise<JobDto>
  /**
   * Rebuilds the queue from SQLite after a restart.
   *
   * ⛔ It re-attaches to provider jobs (polling is free) and it fails the ones
   * interrupted mid-submit, but it **never submits**. A run still sitting in
   * `queued` is left queued and flagged `awaitingResume`, because launching the
   * app is not the same thing as agreeing to spend money.
   */
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
  /**
   * Queued jobs `recover()` found at startup and declined to start.
   *
   * In memory on purpose: it is a fact about *this* session ("we did not start
   * these"), and the next start re-derives it from the same rows. A job leaves
   * the set the moment something explicitly schedules it.
   */
  const awaitingResume = new Set<string>()
  let disposed = false

  function publish(jobId: string): JobDto {
    const job = requireJob(db, jobId)
    const generation = getGeneration(db, job.generationId)
    if (!generation)
      throw new Error(`Generation ${job.generationId} was not found`)
    const dto = toJobDto(
      job,
      generation,
      progress.get(jobId) ?? null,
      awaitingResume.has(jobId)
    )
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
    modelKey: string,
    requestJson: string | null
  ): Promise<ResolvedReferences> {
    const inputs = listInputs(db, generationId)
    if (inputs.length === 0) return { params: {}, redacted: {} }

    // A family run's shapes were recorded when it was translated: those are
    // the ones it was queued (and priced) with, whatever the registry or the
    // catalog says now.
    const recorded = recordedShapes(requestJson)
    if (recorded.familyId !== null && recorded.shapes === null) {
      throw new UnrecordedShapes()
    }

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
    const shapes =
      recorded.shapes ??
      new Map(slots.map((slot) => [slot.field, slot.shape ?? null]))
    // Checked before any upload, so an unknown shape costs nothing at all.
    for (const input of inputs) {
      const shape = shapes.get(input.slotField) ?? null
      if (shape !== null && !isShapeName(shape)) throw new UnknownShape(shape)
    }

    const byField = new Map<string, string[]>()
    const assetsByField = new Map<string, string[]>()
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
      assetsByField.set(input.slotField, [
        ...(assetsByField.get(input.slotField) ?? []),
        input.asset.id,
      ])
    }

    const params: Record<string, unknown> = {}
    const redacted: Record<string, unknown> = {}
    // `listInputs` returns the inputs in position order, so each field's URLs
    // are too: a shape's "first image" is the one the user put first.
    for (const [field, urls] of byField) {
      const many = multiple.get(field) ?? urls.length > 1
      params[field] = applyShape(shapes.get(field) ?? null, urls, many)

      // What is *recorded* names the asset instead of carrying its bytes: the
      // recorded request travels to the renderer inside every `jobs:update`,
      // and a base64 data URL (or a signed upload URL) has no business there.
      // Never shaped: it is a record for people of which asset filled which
      // field, not a second copy of the payload.
      const marks = (assetsByField.get(field) ?? []).map((assetId) => ({
        assetId,
        slot: field,
      }))
      redacted[field] = many ? marks : marks[0]
    }
    return { params, redacted }
  }

  /** Downloads a finished run's outputs and records it as succeeded. */
  async function complete(
    jobId: string,
    generationId: string,
    state: ProviderJobState
  ): Promise<void> {
    // Recorded *before* the download, and with the provider job id left in
    // place: if a download fails, `retry` can re-attach to the finished
    // prediction and fetch it again instead of paying for a second run.
    updateStatus(db, generationId, {
      status: "running",
      response: state.raw,
      ...(state.costUsd === null
        ? {}
        : { actualCostUsd: state.costUsd, costConfidence: "exact" }),
      ...(state.predictTimeSeconds === null
        ? {}
        : { predictTimeSeconds: state.predictTimeSeconds }),
    })
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

    // Only OpenRouter reports what a run actually cost; Replicate never does,
    // and inventing a number would be worse than leaving the estimate — both
    // were already recorded above, alongside the raw response.
    updateStatus(db, generationId, { status: "succeeded", error: null })
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

  /**
   * One attempt: submit if there is nothing to re-attach to, then poll to a
   * conclusion.
   *
   * The `provider_job_id` is the whole decision. Once it is set the provider
   * has been paid, so *every* subsequent attempt — a retry after a flaky poll,
   * a restart, a user pressing Retry — polls that job rather than creating a
   * second one.
   */
  async function attempt(jobId: string): Promise<void> {
    const job = requireJob(db, jobId)
    const generation = getGeneration(db, job.generationId)
    if (!generation)
      throw new Error(`Generation ${job.generationId} was not found`)
    const provider = providerFor(generation.provider)

    if (generation.providerJobId) {
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

    const own = JSON.parse(generation.paramsJson) as Record<string, unknown>
    const references = await referenceParams(
      provider,
      generation.id,
      `${generation.provider}:${generation.modelSlug}`,
      generation.requestJson
    )
    const params = { ...own, ...references.params }
    if (cancelled.has(jobId) || disposed) return

    // ⛔ The paid call.
    let ref: ProviderJobRef
    try {
      ref = await provider.submit({
        slug: generation.modelSlug,
        versionId: generation.modelVersion,
        params,
      })
    } catch (error) {
      // A failure that carries no HTTP status never got an answer: the request
      // may have been accepted and be running right now. Re-sending it could
      // pay for the same run twice, so it is terminal and says why.
      if (httpStatusOf(error) === null) throw new SubmitOutcomeUnknown(error)
      throw error
    }

    if (cancelled.has(jobId) || disposed) {
      // Cancelled while the submit was in flight. The prediction exists, so its
      // id is recorded (the user can find it on the dashboard) and the provider
      // is asked to stop it — but the run stays cancelled rather than being
      // promoted to running behind the user's back.
      await stopSubmitted(jobId, generation.id, provider, ref)
      return
    }

    updateStatus(db, generation.id, {
      status: "running",
      providerJobId: ref.id,
      // Recorded with its references named rather than expanded: this JSON
      // goes back to the renderer with every job update.
      request: { ...own, ...references.redacted },
    })
    move(jobId, "running")

    await poll(jobId, generation.id, provider, ref)
  }

  /** Cancellation that arrived while a submit was in flight. */
  async function stopSubmitted(
    jobId: string,
    generationId: string,
    provider: ModelProvider,
    ref: ProviderJobRef
  ): Promise<void> {
    let note: string | null = null
    try {
      await provider.cancel(ref)
    } catch (error) {
      // OpenRouter cannot cancel a video job at all; the run is still stopped
      // here, and the reason it may be billed anyway is recorded on the row.
      note = messageOf(error)
    }
    updateStatus(db, generationId, {
      status: "canceled",
      providerJobId: ref.id,
      error: note,
    })
    move(jobId, "canceled", { error: note })
  }

  function fail(jobId: string, generationId: string, message: string): void {
    updateStatus(db, generationId, { status: "failed", error: message })
    move(jobId, "failed", { error: message })
  }

  /** True once the provider has been paid for this run and can be polled. */
  function isAttached(generationId: string): boolean {
    return Boolean(getGeneration(db, generationId)?.providerJobId)
  }

  /**
   * The retry loop around `attempt`.
   *
   * The two phases are budgeted separately, and that is the whole point: a
   * submit may only be tried `MAX_ATTEMPTS` times because each one can be
   * *charged for*, while a poll is a free GET against a prediction that has
   * already been paid for. Sharing one counter meant three flaky polls could
   * strand a finished run as `failed` with its output still sitting at the
   * provider — so a transient poll failure now spends the poll budget and
   * leaves the submit budget untouched.
   *
   * `attempts` on the row stays the total, because that is what the job list
   * means by "attempt 3".
   */
  async function execute(jobId: string): Promise<void> {
    const job = getJob(db, jobId)
    if (!job || cancelled.has(jobId) || disposed) return

    let submits = isAttached(job.generationId) ? 0 : job.attempts
    let polls = 0
    for (;;) {
      if (cancelled.has(jobId) || disposed) return
      // Decided before the attempt: an attempt that starts with a provider job
      // id can only poll, and one that does not has a submit to pay for.
      const polling = isAttached(job.generationId)
      if (polling) polls += 1
      else submits += 1
      updateJob(db, jobId, { attempts: submits + polls })

      try {
        await attempt(jobId)
        return
      } catch (error) {
        if (cancelled.has(jobId) || disposed) return
        const message = messageOf(error)

        if ((polling ? polls : submits) < MAX_ATTEMPTS && isRetryable(error)) {
          move(jobId, "queued", { error: message })
          await wait(backoffDelay(submits + polls, { random }))
          if (cancelled.has(jobId) || disposed) return
          continue
        }

        fail(jobId, job.generationId, message)
        return
      }
    }
  }

  function schedule(jobId: string): void {
    queue.concurrency = deps.settings().maxConcurrentJobs
    void queue
      .add(() => execute(jobId))
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
      schedule(job.id)
      return dto
    },

    list(limit) {
      return listJobs(db, { limit }).map((job) => ({
        ...job,
        progress: progress.get(job.id) ?? null,
        awaitingResume: awaitingResume.has(job.id),
      }))
    },

    async cancel(jobId) {
      // A run the user cancels is no longer one they might resume.
      awaitingResume.delete(jobId)
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
      if (job.state === "succeeded") {
        throw new Error(
          "That run already succeeded; generate a new one instead of retrying it."
        )
      }

      const generation = getGeneration(db, job.generationId)
      if (!generation)
        throw new Error(`Generation ${job.generationId} was not found`)

      // A cancelled run's prediction was asked to stop, so it will never
      // produce anything: re-attaching would poll a corpse until the job aged
      // out. Retrying a cancellation means what the user meant by it — run it
      // again — so the provider job id is cleared and a fresh one is paid for.
      if (generation.providerJobId && job.state !== "canceled") {
        // The provider has already been paid for this run: re-attach to it.
        // Polling it again is a free GET that also hands back fresh output
        // URLs — which is what a failed download needs, since the ones from
        // the first attempt are usually signed and short-lived.
        updateStatus(db, job.generationId, { status: "running", error: null })
      } else {
        updateStatus(db, job.generationId, {
          status: "queued",
          error: null,
          providerJobId: null,
        })
      }

      updateJob(db, jobId, { state: "queued", attempts: 0, error: null })
      cancelled.delete(jobId)
      progress.delete(jobId)
      // Retry is itself the explicit consent Resume was waiting for.
      awaitingResume.delete(jobId)

      const dto = publish(jobId)
      schedule(jobId)
      return dto
    },

    async resume(jobId) {
      const job = requireJob(db, jobId)
      if (!awaitingResume.has(jobId)) {
        // Either it is already going, or it finished, or it was never one of
        // the runs recovery held back. Resuming any of those would be a second
        // paid submission dressed up as a restart.
        throw new Error("That run is not waiting to be resumed.")
      }
      if (job.state !== "queued") {
        throw new Error("That run is no longer queued.")
      }

      awaitingResume.delete(jobId)
      const dto = publish(jobId)
      schedule(jobId)
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
          schedule(job.id)
          continue
        }

        if (job.state === "queued" && generation.status === "queued") {
          // ⛔ Never submitted, so nothing has been spent — and nothing will be
          // spent here either. Starting it would turn "I opened the app" into
          // "I paid for the run I was in the middle of reconsidering when it
          // crashed". It stays queued, flagged, and waits for Resume.
          awaitingResume.add(job.id)
          recovered.push(publish(job.id))
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
