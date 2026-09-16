/**
 * Submitting a generation — the queue half.
 *
 * ⛔ **This calls no provider.** A submission writes one `queued` row, links
 * the chosen reference assets to their slots, and returns. The job runner
 * (`jobs/runner.ts`) is what picks queued rows up, builds the provider payload
 * and makes the HTTP call — the `generations:submit` handler hands it the row
 * only after it is safely in SQLite.
 *
 * What it *does* do is validate: the model key must resolve in the catalog, a
 * reference must name a slot the model actually declares and an asset that
 * actually exists in this project. Catching those here means the runner can
 * assume a queued row is coherent, and the renderer gets a sentence it can
 * show rather than a foreign-key error.
 *
 * The whole `GenerationRequest` is stored in `requestJson` alongside the
 * params, so a run can be replayed exactly as it was asked for even after the
 * model's schema has moved on.
 */
import {
  parseModelKey,
  planBatch,
  type GenerationDto,
  type GenerationRequest,
  type ModelDescriptor,
} from "@opendirect/contract"

import type { ProjectDatabase } from "./db/client"
import type { ProjectRef } from "./project"
import { getAsset } from "./repo/assets"
import { createGeneration } from "./repo/generations"

export interface SubmitContext {
  db: ProjectDatabase
  project: Pick<ProjectRef, "id">
}

/** The catalog, as the one thing submission needs from it. */
export interface SubmitDeps {
  getModel(key: string): Promise<ModelDescriptor>
}

/**
 * Resolves the model and refuses a request that could not be run.
 *
 * Shared by the single and the batch path so a sibling cannot slip past a
 * check the lone run has to pass, and so the catalog is asked once per
 * submission rather than once per job.
 */
async function resolveForSubmission(
  ctx: SubmitContext,
  deps: SubmitDeps,
  request: GenerationRequest
): Promise<ModelDescriptor> {
  if (!parseModelKey(request.modelKey)) {
    throw new Error(
      `"${request.modelKey}" is not a catalog model key (expected "provider:slug")`
    )
  }

  const descriptor = await deps.getModel(request.modelKey)
  const slots = new Set(descriptor.referenceSlots.map((slot) => slot.field))

  for (const reference of request.references) {
    if (!slots.has(reference.slotField)) {
      throw new Error(
        `${descriptor.name} has no reference slot called "${reference.slotField}"`
      )
    }
    if (!getAsset(ctx.db, reference.assetId)) {
      throw new Error(
        `Reference asset "${reference.assetId}" is not in this project`
      )
    }
  }

  return descriptor
}

/** The `queued` row itself. No provider, no network — just SQLite. */
function record(
  ctx: SubmitContext,
  descriptor: ModelDescriptor,
  request: GenerationRequest
): GenerationDto {
  return createGeneration(ctx.db, {
    projectId: ctx.project.id,
    containerId: request.containerId,
    provider: descriptor.provider,
    modelSlug: descriptor.slug,
    modelVersion: descriptor.versionId,
    kind: descriptor.kind,
    prompt: request.prompt,
    params: request.params,
    request,
    estimatedCostUsd: request.estimatedCostUsd,
    costConfidence: request.costConfidence,
    parentGenerationId: request.parentGenerationId,
    // Set only by the canvas, for the sibling runs of one batch — the column
    // write that makes them findable without scanning `request_json`.
    batchId: request.batchId,
    inputs: request.references.map((reference) => ({
      assetId: reference.assetId,
      slotField: reference.slotField,
      position: reference.position,
    })),
    // Explicit, because it is the point: the row exists, and costs nothing,
    // before the runner is told about it.
    status: "queued",
  })
}

export async function submitGeneration(
  ctx: SubmitContext,
  deps: SubmitDeps,
  request: GenerationRequest
): Promise<GenerationDto> {
  return record(ctx, await resolveForSubmission(ctx, deps, request), request)
}

export interface BatchSubmission {
  /** Shared by every row written, and by the canvas node that asked for them. */
  batchId: string
  /** One per job, in plan order — a native-count run is a batch of one. */
  generations: GenerationDto[]
}

/**
 * Asking a model for N results.
 *
 * `planBatch` decides whether that is one prediction with the model's own
 * count field set to N, several of them when N is over the field's declared
 * maximum, or N identical siblings for a model that counts nothing. This
 * function does no deciding of its own: it validates once, writes what the
 * plan says, and hands back the ids.
 *
 * ⛔ Still no provider call. Every row is `queued` when this returns, and the
 * runner is told about them afterwards by the handler — same order, same
 * guarantee, N times.
 */
export async function submitBatch(
  ctx: SubmitContext,
  deps: SubmitDeps,
  request: GenerationRequest,
  count: number
): Promise<BatchSubmission> {
  const descriptor = await resolveForSubmission(ctx, deps, request)
  const plan = planBatch({
    request,
    count,
    inputSchema: descriptor.inputSchema,
    batchId: request.batchId ?? undefined,
  })

  return {
    batchId: plan.batchId,
    generations: plan.requests.map((one) => record(ctx, descriptor, one)),
  }
}
