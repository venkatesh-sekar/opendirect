/**
 * Generations: one row per model run, its inputs, its outputs and its lineage.
 *
 * A generation is a *record*, not an action — nothing here talks to a provider
 * or submits anything. The job runner is what calls `updateStatus` and
 * `attachOutputs` as a run progresses; keeping those as plain database writes
 * is what lets the runner be tested without a network at all.
 *
 * ⛔ No function in this module can trigger a paid generation.
 *
 * Lineage is a branch tree: "make a variant of this" records
 * `parentGenerationId`, and deleting a run only *detaches* its children
 * (`on delete set null` in the schema), so pruning never destroys history.
 */
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"

import type {
  AssetDto,
  AssetKind,
  GenerationDto,
  GenerationStatus,
  Lineage,
} from "@opendirect/contract"
import { and, asc, count, desc, eq, inArray } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import {
  assets,
  generationInputs,
  generations,
  type Generation,
  type GenerationInput,
} from "../db/schema"
import { assetKindFor, contentTypeFor } from "../media"
import { resolveAssetPath, type ProjectRef } from "../project"
import { addToContainer, toAssetDto, type AssetContext } from "./assets"
import { hashFile } from "./hash"
import { createPreview, NO_PREVIEW, type Thumbnailer } from "./thumbnails"

/** Statuses after which a run will not change again. */
const TERMINAL: ReadonlySet<GenerationStatus> = new Set([
  "succeeded",
  "failed",
  "canceled",
])

export interface GenerationInputSlot {
  assetId: string
  /** The provider's own field name: `reference_images`, `first_frame`, … */
  slotField: string
  position?: number
}

export interface CreateGenerationInput {
  projectId: string
  containerId?: string | null
  provider: string
  modelSlug: string
  modelVersion?: string | null
  kind: string
  prompt?: string | null
  /** Serialized verbatim so a run can be replayed exactly as it was sent. */
  params: unknown
  request?: unknown
  estimatedCostUsd?: number | null
  costConfidence?: string | null
  parentGenerationId?: string | null
  /** Groups the sibling runs of one canvas batch. Null for every other run. */
  batchId?: string | null
  branchNote?: string | null
  inputs?: GenerationInputSlot[]
  status?: GenerationStatus
  id?: string
  now?: number
}

/** `status` is a plain text column in SQLite; the contract narrows it. */
export function toGenerationDto(row: Generation): GenerationDto {
  return { ...row, status: row.status as GenerationStatus }
}

export function getGeneration(
  db: ProjectDatabase,
  id: string,
  options: { withInputs?: boolean } = {}
): (Generation & { inputs?: GenerationInput[] }) | undefined {
  const row = db.select().from(generations).where(eq(generations.id, id)).get()
  if (!row) return undefined
  if (!options.withInputs) return row
  return {
    ...row,
    inputs: db
      .select()
      .from(generationInputs)
      .where(eq(generationInputs.generationId, id))
      .orderBy(asc(generationInputs.position))
      .all(),
  }
}

function requireGeneration(db: ProjectDatabase, id: string): Generation {
  const found = db
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .get()
  if (!found) throw new Error(`Generation ${id} was not found`)
  return found
}

export function createGeneration(
  db: ProjectDatabase,
  input: CreateGenerationInput
): GenerationDto {
  if (input.parentGenerationId) {
    requireGeneration(db, input.parentGenerationId)
  }

  const row = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    containerId: input.containerId ?? null,
    provider: input.provider,
    modelSlug: input.modelSlug,
    modelVersion: input.modelVersion ?? null,
    kind: input.kind,
    prompt: input.prompt ?? null,
    paramsJson: JSON.stringify(input.params ?? {}),
    requestJson:
      input.request === undefined ? null : JSON.stringify(input.request),
    responseJson: null,
    status: input.status ?? ("queued" satisfies GenerationStatus),
    error: null,
    providerJobId: null,
    estimatedCostUsd: input.estimatedCostUsd ?? null,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: input.costConfidence ?? null,
    parentGenerationId: input.parentGenerationId ?? null,
    batchId: input.batchId ?? null,
    branchNote: input.branchNote ?? null,
    createdAt: input.now ?? Date.now(),
    startedAt: null,
    completedAt: null,
  }

  db.transaction((tx) => {
    tx.insert(generations).values(row).run()
    input.inputs?.forEach((slot, index) => {
      tx.insert(generationInputs)
        .values({
          id: randomUUID(),
          generationId: row.id,
          assetId: slot.assetId,
          slotField: slot.slotField,
          position: slot.position ?? index,
        })
        .run()
    })
  })

  return toGenerationDto(row)
}

export interface UpdateStatusInput {
  status: GenerationStatus
  error?: string | null
  providerJobId?: string | null
  request?: unknown
  response?: unknown
  actualCostUsd?: number | null
  /** Set to `"exact"` when the provider reported what the run actually cost. */
  costConfidence?: string | null
  /** Compute seconds the provider reported for the finished run. */
  predictTimeSeconds?: number | null
  now?: number
}

/**
 * Moves a run to a new status, stamping `startedAt` the first time it leaves
 * the queue and `completedAt` when it reaches a terminal state. Both stamps are
 * write-once, so a retry's poll cannot rewrite the original timeline.
 */
export function updateStatus(
  db: ProjectDatabase,
  id: string,
  input: UpdateStatusInput
): GenerationDto {
  const current = requireGeneration(db, id)
  const now = input.now ?? Date.now()
  const started = input.status !== "queued" && current.startedAt === null

  db.update(generations)
    .set({
      status: input.status,
      error: input.error === undefined ? current.error : input.error,
      providerJobId:
        input.providerJobId === undefined
          ? current.providerJobId
          : input.providerJobId,
      requestJson:
        input.request === undefined
          ? current.requestJson
          : JSON.stringify(input.request),
      responseJson:
        input.response === undefined
          ? current.responseJson
          : JSON.stringify(input.response),
      actualCostUsd:
        input.actualCostUsd === undefined
          ? current.actualCostUsd
          : input.actualCostUsd,
      costConfidence:
        input.costConfidence === undefined
          ? current.costConfidence
          : input.costConfidence,
      predictTimeSeconds:
        input.predictTimeSeconds === undefined
          ? current.predictTimeSeconds
          : input.predictTimeSeconds,
      startedAt: started ? now : current.startedAt,
      completedAt: TERMINAL.has(input.status) ? now : current.completedAt,
    })
    .where(eq(generations.id, id))
    .run()

  return toGenerationDto(requireGeneration(db, id))
}

export interface OutputDescriptor {
  /** Project-relative path of a file already written into the project. */
  relPath: string
  kind?: AssetKind
  mimeType?: string | null
  durationMs?: number | null
  label?: string | null
}

export interface AttachOutputsInput {
  generationId: string
  outputs: OutputDescriptor[]
  /** Defaults to the generation's own container. */
  containerId?: string | null
  thumbnailer?: Thumbnailer
  now?: number
}

/**
 * Records a finished run's files as assets and files them on the board.
 *
 * The files must already be inside the project folder (the job runner downloads
 * into `tmp/` and moves them into `generations/<id>/`); every path is re-checked
 * with `resolveAssetPath` so a provider-supplied filename cannot walk out of the
 * project.
 */
export async function attachOutputs(
  ctx: AssetContext & { project: Pick<ProjectRef, "id" | "path"> },
  input: AttachOutputsInput
): Promise<{ assets: AssetDto[] }> {
  const { db, project } = ctx
  const generation = requireGeneration(db, input.generationId)
  const containerId =
    input.containerId === undefined ? generation.containerId : input.containerId
  const thumbnailer = input.thumbnailer ?? createPreview
  const now = input.now ?? Date.now()

  const created: AssetDto[] = []
  for (const output of input.outputs) {
    const absolute = resolveAssetPath(project, output.relPath)
    const stats = await stat(absolute)
    const sha256 = await hashFile(absolute)

    const id = randomUUID()
    const kind: AssetKind = output.kind ?? assetKindFor(output.relPath)
    const preview = await thumbnailer({
      sourcePath: absolute,
      kind,
      assetId: id,
      projectPath: project.path,
    }).catch(() => NO_PREVIEW)

    const row = {
      id,
      projectId: project.id,
      kind,
      relPath: output.relPath,
      text: null,
      mimeType: output.mimeType ?? contentTypeFor(output.relPath),
      width: preview.width,
      height: preview.height,
      durationMs: output.durationMs ?? null,
      bytes: stats.size,
      sha256,
      thumbnailRelPath: preview.relPath,
      label: output.label ?? null,
      originalName: null,
      pinned: false,
      generationId: generation.id,
      createdAt: now,
    }
    db.transaction((tx) => {
      tx.insert(assets).values(row).run()
      if (containerId) addToContainer(tx, { containerId, assetId: id })
    })
    created.push(toAssetDto(row))
  }

  return { assets: created }
}

export interface GenerationPage {
  items: GenerationDto[]
  total: number
  nextOffset: number | null
}

export const DEFAULT_PAGE_SIZE = 40

/** A container's runs, newest first. */
export function listByContainer(
  db: ProjectDatabase,
  input: { containerId: string; limit?: number; offset?: number }
): GenerationPage {
  const limit = Math.max(1, input.limit ?? DEFAULT_PAGE_SIZE)
  const offset = Math.max(0, input.offset ?? 0)

  const total =
    db
      .select({ value: count() })
      .from(generations)
      .where(eq(generations.containerId, input.containerId))
      .get()?.value ?? 0

  const rows = db
    .select()
    .from(generations)
    .where(eq(generations.containerId, input.containerId))
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(limit)
    .offset(offset)
    .all()

  const nextOffset = offset + rows.length
  return {
    items: rows.map(toGenerationDto),
    total,
    nextOffset: nextOffset < total ? nextOffset : null,
  }
}

/** The assets a run was given, in slot order. */
export function listInputs(
  db: ProjectDatabase,
  generationId: string
): { slotField: string; position: number; asset: AssetDto }[] {
  return db
    .select({ link: generationInputs, asset: assets })
    .from(generationInputs)
    .innerJoin(assets, eq(assets.id, generationInputs.assetId))
    .where(eq(generationInputs.generationId, generationId))
    .orderBy(asc(generationInputs.position))
    .all()
    .map((row) => ({
      slotField: row.link.slotField,
      position: row.link.position,
      asset: toAssetDto(row.asset),
    }))
}

/**
 * A run's branch history: every ancestor (oldest first) and every descendant
 * (breadth-first, each level oldest first).
 *
 * Walked in JavaScript rather than a recursive CTE — the walk is a handful of
 * indexed lookups, it stays readable, and it can defend itself against a cycle
 * that a corrupted `parent_generation_id` could otherwise turn into an infinite
 * recursion inside SQLite.
 */
export function lineage(db: ProjectDatabase, id: string): Lineage {
  const generation = requireGeneration(db, id)

  const ancestors: Generation[] = []
  const seen = new Set<string>([generation.id])
  let cursor = generation.parentGenerationId
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const parent = db
      .select()
      .from(generations)
      .where(eq(generations.id, cursor))
      .get()
    if (!parent) break
    ancestors.unshift(parent)
    cursor = parent.parentGenerationId
  }

  const descendants: Generation[] = []
  let frontier = [generation.id]
  while (frontier.length > 0) {
    const children = db
      .select()
      .from(generations)
      .where(
        and(
          inArray(generations.parentGenerationId, frontier),
          // A self-parenting row would loop forever otherwise.
          eq(generations.projectId, generation.projectId)
        )
      )
      .orderBy(asc(generations.createdAt), asc(generations.id))
      .all()
      .filter((child) => !seen.has(child.id))
    for (const child of children) seen.add(child.id)
    descendants.push(...children)
    frontier = children.map((child) => child.id)
  }

  return {
    generation: toGenerationDto(generation),
    ancestors: ancestors.map(toGenerationDto),
    descendants: descendants.map(toGenerationDto),
  }
}
