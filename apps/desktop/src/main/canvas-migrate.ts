/**
 * Lineage to layout: the one-time migration that gives a project that predates
 * the canvas a canvas to open.
 *
 * A project's history is already a graph. `generations.parentGenerationId`
 * says "this run came from that one" and `generation_inputs` says "this asset
 * was fed into that slot of that run". The canvas is the same graph with
 * coordinates, so the migration is a read of the lineage, a layered layout,
 * and one transaction.
 *
 * Three rules it keeps, all from the design:
 *
 * - **`canvas:get` never migrates.** Migration is explicit — `canvas:migrate`,
 *   called once by the renderer when it finds an empty canvas on a project
 *   that has generations. Opening a project must not silently rewrite it.
 * - **A project that already has canvas rows is left alone** and handed back
 *   as it is. Running the migration twice is a no-op, not a duplicate board.
 * - **Nothing is written if the layout throws.** Everything — rows, sizes,
 *   positions — is computed first, and only then written in a single
 *   transaction. A half-laid-out canvas would be worse than none, because the
 *   "is this project migrated yet?" test is "does it have any nodes".
 *
 * ⛔ Nothing here can start a paid generation. It reads runs that already
 * happened and writes placements for them. No provider is contacted, no job
 * is queued, and an edge it writes is a statement about a *future* run that
 * still needs a click.
 *
 * Pure Drizzle and elkjs, no Electron, so `canvas-migrate.test.ts` can drive
 * it against `:memory:` — and the layout function is a parameter, so a test
 * can inject one that throws and assert that nothing landed.
 */
import { randomUUID } from "node:crypto"

import type { CanvasDto, CanvasNodeType } from "@opendirect/contract"
import { asc, eq, inArray } from "drizzle-orm"
import ELK from "elkjs"

import type { ProjectDatabase } from "./db/client"
import {
  assets,
  canvasEdges,
  canvasNodes,
  generationInputs,
  generations,
  type Asset,
  type CanvasEdge,
  type CanvasNode,
  type Generation,
} from "./db/schema"
import { getCanvas } from "./repo/canvas"

/* -------------------------------------------------------------------------- */
/* Sizing                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The sizing rule, deliberately small.
 *
 * Every migrated node is one column wide and its height follows the aspect
 * ratio of the picture it shows — a generate node's first output, a media
 * node's own asset — so a row of 16:9 videos and a row of portrait stills both
 * read as themselves rather than as identical squares. An asset with no
 * recorded dimensions is square, which is the least wrong guess.
 *
 * The clamp exists because a 1:8 panorama laid out at true ratio produces a
 * node nothing can see at a sensible zoom. This is the *migration's* rule
 * only: the canvas itself sizes live nodes in `apps/web/lib/canvas/layout.ts`,
 * and main deliberately does not import the renderer.
 */
const NODE_WIDTH = 320
const MIN_NODE_HEIGHT = 180
const MAX_NODE_HEIGHT = 480
/** Square, for an asset whose width and height were never recorded. */
const DEFAULT_ASPECT = 1

function aspectOf(asset: Asset | undefined): number {
  if (!asset?.width || !asset.height) return DEFAULT_ASPECT
  if (asset.width <= 0 || asset.height <= 0) return DEFAULT_ASPECT
  return asset.width / asset.height
}

function sizeFor(asset: Asset | undefined): { width: number; height: number } {
  const height = Math.round(NODE_WIDTH / aspectOf(asset))
  return {
    width: NODE_WIDTH,
    height: Math.min(MAX_NODE_HEIGHT, Math.max(MIN_NODE_HEIGHT, height)),
  }
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

export interface LayoutBox {
  id: string
  width: number
  height: number
}

export interface LayoutLink {
  id: string
  source: string
  target: string
}

export interface LayoutPosition {
  x: number
  y: number
}

/**
 * Boxes and links in, top-left corners out.
 *
 * A parameter rather than a hard dependency so the migration can be tested
 * without elkjs, and — the point of the whole exercise — so a layout that
 * throws can be shown to write nothing.
 */
export type CanvasLayoutFn = (
  boxes: readonly LayoutBox[],
  links: readonly LayoutLink[]
) => Promise<ReadonlyMap<string, LayoutPosition>>

/**
 * Left-to-right layered layout: references and parents on the left, what came
 * out of them on the right, which is the direction the canvas's own handles
 * read in.
 *
 * Disconnected nodes are not a special case. ELK's layered algorithm places an
 * unconnected node in its own component and packs the components, so an asset
 * that was never fed to anything still lands somewhere sensible instead of at
 * the origin under everything else.
 */
const ELK_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "120",
  "elk.spacing.nodeNode": "48",
  "elk.padding": "[top=48,left=48,bottom=48,right=48]",
} as const

/**
 * One instance, made on first use and kept.
 *
 * The bare `elkjs` entry point (`lib/main.js`) is the package's documented
 * Node entry. Given no `workerUrl` it falls back to the in-process "fake
 * worker" in `lib/elk-worker.min.js`, so the layout runs on the main process's
 * own event loop: no `web-worker` package, no thread, nothing for Electron's
 * packaging to get wrong. That fake worker has no `terminate`, which is why
 * `terminateWorker()` is never called here — calling it would throw.
 */
let elk: InstanceType<typeof ELK> | undefined

function getElk(): InstanceType<typeof ELK> {
  elk ??= new ELK()
  return elk
}

export const elkLayeredLayout: CanvasLayoutFn = async (boxes, links) => {
  const graph = await getElk().layout({
    id: "root",
    layoutOptions: { ...ELK_OPTIONS },
    children: boxes.map((box) => ({
      id: box.id,
      width: box.width,
      height: box.height,
    })),
    edges: links.map((link) => ({
      id: link.id,
      sources: [link.source],
      targets: [link.target],
    })),
  })

  return new Map(
    (graph.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ])
  )
}

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

export interface CanvasMigrateContext {
  db: ProjectDatabase
  project: { id: string }
}

/**
 * A generate node's kind, read the way the rest of main reads it: the coarse
 * output modality already stored on the row (`modelKindSchema`). Only `video`
 * is a video node; everything else that produced media is an image node,
 * because those are the two generate types v1 has.
 */
function nodeTypeFor(generation: Generation): CanvasNodeType {
  return generation.kind === "video" ? "video_gen" : "image_gen"
}

/** The two asset kinds a media node can actually show. */
function isDisplayable(asset: Asset): boolean {
  return asset.kind === "image" || asset.kind === "video"
}

interface EdgeDraft {
  id: string
  sourceNodeId: string
  targetNodeId: string
  slotField: string | null
  createdAt: number
}

/**
 * Turns a project's lineage into a canvas, once.
 *
 * Returns the canvas either way: untouched when the project already has one,
 * freshly laid out when it did not. Throws whatever the layout threw, so
 * `canvas:migrate` can surface the real reason and the renderer can offer to
 * try again — there is nothing to clean up first, because nothing was written.
 */
export async function migrateCanvas(
  ctx: CanvasMigrateContext,
  layout: CanvasLayoutFn = elkLayeredLayout,
  now: number = Date.now()
): Promise<CanvasDto> {
  const { db } = ctx
  const projectId = ctx.project.id

  // A canvas that exists is the user's arrangement. Never re-derive it.
  const existing = getCanvas(db, projectId)
  if (existing.nodes.length > 0 || existing.edges.length > 0) return existing

  const generationRows = db
    .select()
    .from(generations)
    .where(eq(generations.projectId, projectId))
    .orderBy(asc(generations.createdAt), asc(generations.id))
    .all()

  const assetRows = db
    .select()
    .from(assets)
    .where(eq(assets.projectId, projectId))
    .orderBy(asc(assets.createdAt), asc(assets.id))
    .all()

  if (generationRows.length === 0 && assetRows.length === 0) return existing

  const inputRows =
    generationRows.length === 0
      ? []
      : db
          .select()
          .from(generationInputs)
          .where(
            inArray(
              generationInputs.generationId,
              generationRows.map((row) => row.id)
            )
          )
          .orderBy(asc(generationInputs.position), asc(generationInputs.id))
          .all()

  const knownGenerationIds = new Set(generationRows.map((row) => row.id))

  /** Outputs of each run, oldest first — the first one becomes the pick. */
  const outputsByGeneration = new Map<string, Asset[]>()
  for (const asset of assetRows) {
    if (!asset.generationId) continue
    if (!knownGenerationIds.has(asset.generationId)) continue
    const bucket = outputsByGeneration.get(asset.generationId)
    if (bucket) bucket.push(asset)
    else outputsByGeneration.set(asset.generationId, [asset])
  }

  const nodeDrafts: CanvasNode[] = []
  /** Which node stands for a run, and which stands for an imported file. */
  const nodeIdByGeneration = new Map<string, string>()
  const nodeIdByAsset = new Map<string, string>()

  for (const generation of generationRows) {
    const outputs = outputsByGeneration.get(generation.id) ?? []
    const pick = outputs[0]
    const id = randomUUID()
    nodeIdByGeneration.set(generation.id, id)
    nodeDrafts.push({
      id,
      projectId,
      type: nodeTypeFor(generation),
      x: 0,
      y: 0,
      ...sizeFor(pick),
      assetId: null,
      generationId: generation.id,
      containerId: generation.containerId,
      // Whatever grouping the row already carries. Legacy rows have none.
      batchId: generation.batchId,
      pickAssetId: pick?.id ?? null,
      // The run's own model, so a migrated node resolves edge slots without
      // having to be re-run — the same `provider:slug` the catalog is keyed by.
      modelKey: `${generation.provider}:${generation.modelSlug}`,
      text: null,
      color: null,
      // The node is as old as the run it stands for, so `getCanvas`'s ordering
      // comes out as the history it was derived from.
      createdAt: generation.createdAt,
      updatedAt: now,
    })
  }

  for (const asset of assetRows) {
    // An output is already shown by the node of the run that made it.
    if (asset.generationId && knownGenerationIds.has(asset.generationId)) {
      continue
    }
    // A media node holds one picture. A text or prompt asset is not one, and
    // v1 has no node type for it — it stays in its sidebar container.
    if (!isDisplayable(asset)) continue

    const id = randomUUID()
    nodeIdByAsset.set(asset.id, id)
    nodeDrafts.push({
      id,
      projectId,
      type: "media",
      x: 0,
      y: 0,
      ...sizeFor(asset),
      assetId: asset.id,
      generationId: null,
      containerId: null,
      batchId: null,
      pickAssetId: null,
      modelKey: null,
      text: null,
      color: null,
      createdAt: asset.createdAt,
      updatedAt: now,
    })
  }

  const assetById = new Map(assetRows.map((row) => [row.id, row]))
  const generationById = new Map(generationRows.map((row) => [row.id, row]))

  const edgeDrafts: EdgeDraft[] = []
  /** `source>target|slot`, so the same wire is never written twice. */
  const written = new Set<string>()
  /** `source>target`, so a branch does not shadow a reference it duplicates. */
  const connected = new Set<string>()

  function link(
    sourceNodeId: string | undefined,
    targetNodeId: string | undefined,
    slotField: string | null,
    createdAt: number
  ): void {
    if (!sourceNodeId || !targetNodeId) return
    // A node cannot feed itself; `createEdge` refuses it and so does this.
    if (sourceNodeId === targetNodeId) return
    const key = `${sourceNodeId}>${targetNodeId}|${slotField ?? ""}`
    if (written.has(key)) return
    written.add(key)
    connected.add(`${sourceNodeId}>${targetNodeId}`)
    edgeDrafts.push({
      id: randomUUID(),
      sourceNodeId,
      targetNodeId,
      slotField,
      createdAt,
    })
  }

  // References first: an input carries the model's own slot field, which is
  // the most an edge can say. The source is whatever produced that asset —
  // the run that made it, or the media node it was imported as.
  for (const input of inputRows) {
    const target = nodeIdByGeneration.get(input.generationId)
    const asset = assetById.get(input.assetId)
    if (!asset) continue
    const source =
      asset.generationId && nodeIdByGeneration.has(asset.generationId)
        ? nodeIdByGeneration.get(asset.generationId)
        : nodeIdByAsset.get(asset.id)
    link(
      source,
      target,
      input.slotField,
      generationById.get(input.generationId)?.createdAt ?? now
    )
  }

  // Then branches. `parentGenerationId` records "this run came from that one"
  // without naming a slot, so its edge has none — and it is skipped where the
  // two runs are already wired by a real input, which says strictly more.
  for (const generation of generationRows) {
    if (!generation.parentGenerationId) continue
    const source = nodeIdByGeneration.get(generation.parentGenerationId)
    const target = nodeIdByGeneration.get(generation.id)
    if (!source || !target) continue
    if (connected.has(`${source}>${target}`)) continue
    link(source, target, null, generation.createdAt)
  }

  if (nodeDrafts.length === 0) return existing

  // Everything above is in memory. This is the only step that can fail for a
  // reason outside our control, and it happens before the first write.
  const positions = await layout(
    nodeDrafts.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edgeDrafts.map((edge) => ({
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
    }))
  )

  const placed = nodeDrafts.map((node) => {
    const at = positions.get(node.id)
    return { ...node, x: at?.x ?? node.x, y: at?.y ?? node.y }
  })

  const edgeRows: CanvasEdge[] = edgeDrafts.map((edge) => ({
    id: edge.id,
    projectId,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    slotField: edge.slotField,
    createdAt: edge.createdAt,
  }))

  // One transaction: a project is migrated or it is not.
  db.transaction((tx) => {
    for (const node of placed) tx.insert(canvasNodes).values(node).run()
    for (const edge of edgeRows) tx.insert(canvasEdges).values(edge).run()
  })

  return getCanvas(db, projectId)
}
