/**
 * Submitting a generation — the queue half.
 *
 * ⛔ **This calls no provider.** A submission writes one `queued` row, links
 * the chosen reference assets to their slots, and returns. Task 16's job
 * runner is what picks queued rows up, builds the provider payload and makes
 * the HTTP call; until it exists, pressing Generate costs nothing.
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

export async function submitGeneration(
  ctx: SubmitContext,
  deps: SubmitDeps,
  request: GenerationRequest
): Promise<GenerationDto> {
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
    inputs: request.references.map((reference) => ({
      assetId: reference.assetId,
      slotField: reference.slotField,
      position: reference.position,
    })),
    // Explicit, because it is the point: the row waits for Task 16's runner.
    status: "queued",
  })
}
