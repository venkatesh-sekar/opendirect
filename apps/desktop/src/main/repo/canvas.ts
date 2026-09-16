/**
 * The canvas: nodes, edges, and the rows behind them.
 *
 * Pure Drizzle and no Electron, like every other repository here — which is
 * what lets `canvas.test.ts` drive it against `:memory:`.
 *
 * Two things this module is deliberately not:
 *
 * - **It is not a workflow engine.** An edge is a row that says "when the
 *   target runs, feed it the source". Writing one runs nothing, marks nothing
 *   stale and schedules nothing.
 * - **It is not ownership.** Deleting a node deletes the node and its edges.
 *   The asset and the generation survive in the project, reachable from the
 *   sidebar container they were always filed under. The schema's delete rules
 *   are the enforcement; this module just does not go around them.
 *
 * ⛔ Nothing here can trigger a paid generation.
 */
import { randomUUID } from "node:crypto"

import type {
  CanvasDto,
  CanvasEdgeDto,
  CanvasNodeDto,
  CanvasNodeMove,
  CanvasNodePatch,
  CanvasNodeType,
} from "@opendirect/contract"
import { asc, eq, inArray } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import {
  assets,
  canvasEdges,
  canvasNodes,
  generations,
  type Asset,
  type CanvasEdge,
  type CanvasNode,
  type Generation,
} from "../db/schema"
import { toAssetDto } from "./assets"
import { toGenerationDto } from "./generations"

/** An edge row is already the contract shape; this names the boundary. */
function toEdgeDto(row: CanvasEdge): CanvasEdgeDto {
  return row
}

/**
 * The renderer's view of a node.
 *
 * `asset` is the media node's own asset, or — for a generate node — whatever
 * the pick resolves to, because those are the two cases where a node has one
 * picture to show and downstream edges have one asset to carry.
 */
function toNodeDto(
  row: CanvasNode,
  asset: Asset | undefined,
  generation: Generation | undefined
): CanvasNodeDto {
  return {
    ...row,
    type: row.type as CanvasNodeType,
    asset: asset ? toAssetDto(asset) : null,
    generation: generation ? toGenerationDto(generation) : null,
  }
}

function getAssetRow(
  db: ProjectDatabase,
  id: string | null
): Asset | undefined {
  if (!id) return undefined
  return db.select().from(assets).where(eq(assets.id, id)).get()
}

function getGenerationRow(
  db: ProjectDatabase,
  id: string | null
): Generation | undefined {
  if (!id) return undefined
  return db.select().from(generations).where(eq(generations.id, id)).get()
}

/** Which asset a node shows: its own for media, its pick for a run. */
function displayAssetId(row: CanvasNode): string | null {
  return row.assetId ?? row.pickAssetId
}

function hydrate(db: ProjectDatabase, row: CanvasNode): CanvasNodeDto {
  return toNodeDto(
    row,
    getAssetRow(db, displayAssetId(row)),
    getGenerationRow(db, row.generationId)
  )
}

export function getNode(
  db: ProjectDatabase,
  id: string
): CanvasNode | undefined {
  return db.select().from(canvasNodes).where(eq(canvasNodes.id, id)).get()
}

function requireNode(db: ProjectDatabase, id: string): CanvasNode {
  const found = getNode(db, id)
  if (!found) throw new Error(`Canvas node ${id} was not found`)
  return found
}

function requireEdge(db: ProjectDatabase, id: string): CanvasEdge {
  const found = db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.id, id))
    .get()
  if (!found) throw new Error(`Canvas edge ${id} was not found`)
  return found
}

/**
 * The whole surface for one project, with every node's asset and generation
 * already resolved.
 *
 * Resolved in two indexed batch queries rather than one join per node: a
 * project with a few hundred nodes would otherwise open with a few hundred
 * round trips through Drizzle for rows that mostly repeat.
 */
export function getCanvas(db: ProjectDatabase, projectId: string): CanvasDto {
  const nodes = db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.projectId, projectId))
    .orderBy(asc(canvasNodes.createdAt), asc(canvasNodes.id))
    .all()

  const assetIds = [
    ...new Set(nodes.map(displayAssetId).filter((id): id is string => !!id)),
  ]
  const generationIds = [
    ...new Set(
      nodes
        .map((node) => node.generationId)
        .filter((id): id is string => id !== null)
    ),
  ]

  const assetsById = new Map(
    (assetIds.length === 0
      ? []
      : db.select().from(assets).where(inArray(assets.id, assetIds)).all()
    ).map((row) => [row.id, row])
  )
  const generationsById = new Map(
    (generationIds.length === 0
      ? []
      : db
          .select()
          .from(generations)
          .where(inArray(generations.id, generationIds))
          .all()
    ).map((row) => [row.id, row])
  )

  const edges = db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.projectId, projectId))
    .orderBy(asc(canvasEdges.createdAt), asc(canvasEdges.id))
    .all()

  return {
    nodes: nodes.map((node) =>
      toNodeDto(
        node,
        assetsById.get(displayAssetId(node) ?? ""),
        generationsById.get(node.generationId ?? "")
      )
    ),
    edges: edges.map(toEdgeDto),
  }
}

export interface CreateNodeInput {
  projectId: string
  type: CanvasNodeType
  x: number
  y: number
  width: number
  height: number
  assetId?: string | null
  generationId?: string | null
  batchId?: string | null
  pickAssetId?: string | null
  modelKey?: string | null
  text?: string | null
  color?: string | null
  id?: string
  now?: number
}

export function createNode(
  db: ProjectDatabase,
  input: CreateNodeInput
): CanvasNodeDto {
  const now = input.now ?? Date.now()
  const row: CanvasNode = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    type: input.type,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    assetId: input.assetId ?? null,
    generationId: input.generationId ?? null,
    batchId: input.batchId ?? null,
    pickAssetId: input.pickAssetId ?? null,
    modelKey: input.modelKey ?? null,
    text: input.text ?? null,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(canvasNodes).values(row).run()
  return hydrate(db, row)
}

/**
 * Applies a patch. An absent key is left alone; an explicit `null` clears the
 * column, because "no pick" and "don't touch the pick" are different
 * instructions and the canvas needs to be able to say both.
 */
export function updateNode(
  db: ProjectDatabase,
  id: string,
  patch: CanvasNodePatch,
  now: number = Date.now()
): CanvasNodeDto {
  const current = requireNode(db, id)
  const next: Partial<CanvasNode> = { updatedAt: now }
  for (const key of [
    "x",
    "y",
    "width",
    "height",
    "text",
    "color",
    "pickAssetId",
    "generationId",
    "batchId",
    "modelKey",
  ] as const) {
    if (patch[key] !== undefined) {
      Object.assign(next, { [key]: patch[key] })
    }
  }
  db.update(canvasNodes).set(next).where(eq(canvasNodes.id, id)).run()
  return hydrate(db, { ...current, ...next } as CanvasNode)
}

/**
 * One gesture, one transaction. Box-select then drag moves many nodes, and the
 * renderer debounces the whole gesture into a single call — so a half-written
 * layout is not a state the canvas can be found in.
 */
export function moveNodes(
  db: ProjectDatabase,
  moves: readonly CanvasNodeMove[],
  now: number = Date.now()
): void {
  if (moves.length === 0) return
  db.transaction((tx) => {
    for (const move of moves) {
      tx.update(canvasNodes)
        .set({
          x: move.x,
          y: move.y,
          ...(move.width === undefined ? {} : { width: move.width }),
          ...(move.height === undefined ? {} : { height: move.height }),
          updatedAt: now,
        })
        .where(eq(canvasNodes.id, move.id))
        .run()
    }
  })
}

/**
 * Removes nodes and — by `on delete cascade` — the edges attached to them.
 *
 * ⛔ The asset and the generation are untouched. Deleting a node is taking it
 * off the board, not destroying a file the user paid for.
 */
export function deleteNodes(db: ProjectDatabase, ids: readonly string[]): void {
  if (ids.length === 0) return
  db.delete(canvasNodes)
    .where(inArray(canvasNodes.id, [...ids]))
    .run()
}

/**
 * Chooses which tile of a batch downstream edges resolve to.
 *
 * Nothing is deleted and nothing re-runs: the previous pick's asset is still
 * in the project, and every downstream node keeps whatever it last produced
 * until the user runs it again.
 */
export function pickNode(
  db: ProjectDatabase,
  id: string,
  assetId: string,
  now: number = Date.now()
): CanvasNodeDto {
  if (!getAssetRow(db, assetId)) {
    throw new Error(`Asset ${assetId} is not in this project`)
  }
  return updateNode(db, id, { pickAssetId: assetId }, now)
}

export interface CreateEdgeInput {
  projectId: string
  sourceNodeId: string
  targetNodeId: string
  /** Null for a text edge, which prepends to the prompt rather than filling a slot. */
  slotField?: string | null
  id?: string
  now?: number
}

/**
 * Wires one node into another's next run.
 *
 * A node cannot feed itself — that is a cycle whose only meaning would be "use
 * my own output as my own input", which is not a thing a run can do.
 */
export function createEdge(
  db: ProjectDatabase,
  input: CreateEdgeInput
): CanvasEdgeDto {
  if (input.sourceNodeId === input.targetNodeId) {
    throw new Error("A node cannot be wired into itself")
  }
  requireNode(db, input.sourceNodeId)
  requireNode(db, input.targetNodeId)

  const row: CanvasEdge = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    slotField: input.slotField ?? null,
    createdAt: input.now ?? Date.now(),
  }
  db.insert(canvasEdges).values(row).run()
  return toEdgeDto(row)
}

/** Moves an edge to a different input slot of the same target. */
export function updateEdge(
  db: ProjectDatabase,
  id: string,
  slotField: string | null
): CanvasEdgeDto {
  const current = requireEdge(db, id)
  db.update(canvasEdges).set({ slotField }).where(eq(canvasEdges.id, id)).run()
  return toEdgeDto({ ...current, slotField })
}

export function deleteEdges(db: ProjectDatabase, ids: readonly string[]): void {
  if (ids.length === 0) return
  db.delete(canvasEdges)
    .where(inArray(canvasEdges.id, [...ids]))
    .run()
}
