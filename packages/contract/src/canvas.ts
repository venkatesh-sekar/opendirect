/**
 * The visual canvas: nodes you place, and edges that say "use this as a
 * reference".
 *
 * These mirror the `canvas_nodes` / `canvas_edges` rows in
 * `apps/desktop/src/main/db/schema.ts`, with the same deliberate distance the
 * rest of `project.ts` keeps: the database is main's private detail, this is
 * what the two processes agree on. Two additions on top of the row —
 *
 * - a node carries its resolved `asset` and `generation` where it has one, so
 *   one `canvas:get` renders the whole surface without a second round trip per
 *   node;
 * - timestamps are epoch milliseconds, as everywhere else.
 *
 * ⛔ An edge is a statement about the *next* run, never a trigger. Nothing in
 * this file, and nothing that consumes it, can start a paid generation: that
 * is still `generations:submit` and still needs a click.
 */
import { z } from "zod"

import { assetSchema, generationSchema } from "./project"

/**
 * The four node kinds in v1. `text` is a coloured note whose text is prepended
 * to whatever it feeds; `media` is one imported asset; the two `*_gen` kinds
 * are runs, which are the only ones with an input handle.
 */
export const canvasNodeTypeSchema = z.enum([
  "text",
  "media",
  "image_gen",
  "video_gen",
])
export type CanvasNodeType = z.output<typeof canvasNodeTypeSchema>

export const canvasNodeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: canvasNodeTypeSchema,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  /** The imported asset a media node shows; null for every other type. */
  assetId: z.string().nullable(),
  containerId: z.string().nullable().optional(),
  /** The single run behind a generate node, when it was not a batch. */
  generationId: z.string().nullable(),
  /** Groups the sibling runs of one batch; null for a single run. */
  batchId: z.string().nullable(),
  /**
   * The model a generate node is set to run, as `provider:slug`.
   *
   * The user's choice in the prompt bar, kept on the row rather than in a
   * draft, because it is what an edge's slot is resolved against — including
   * before the node has ever run, when there is no generation to ask.
   */
  modelKey: z.string().nullable(),
  /** Which tile of a batch downstream edges resolve to. The user's choice. */
  pickAssetId: z.string().nullable(),
  text: z.string().nullable(),
  color: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Resolved for a media node, and for a pick; null when there is none. */
  asset: assetSchema.nullable(),
  /** Resolved for a generate node that has run; null before it has. */
  generation: generationSchema.nullable(),
})
export type CanvasNodeDto = z.output<typeof canvasNodeSchema>

export const canvasEdgeSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  /**
   * The model's own input field name — `reference_images`, `first_frame`, …
   * Null for a text edge, whose contribution is a prompt prefix rather than a
   * slot.
   */
  slotField: z.string().nullable(),
  createdAt: z.number(),
})
export type CanvasEdgeDto = z.output<typeof canvasEdgeSchema>

/** One fetch, the whole surface. */
export const canvasSchema = z.object({
  nodes: z.array(canvasNodeSchema),
  edges: z.array(canvasEdgeSchema),
})
export type CanvasDto = z.output<typeof canvasSchema>

/**
 * A partial node update: position, size, text, colour and pick.
 *
 * `generationId` and `batchId` are patchable too, because submitting a run
 * from a node is exactly "this node now points at that run" and there is no
 * other channel that could say so. Every field is optional and an omitted
 * field is left alone — `null` is a value here, not an absence.
 */
export const canvasNodePatchSchema = z.object({
  containerId: z.string().nullable().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  text: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  pickAssetId: z.string().nullable().optional(),
  generationId: z.string().nullable().optional(),
  batchId: z.string().nullable().optional(),
  modelKey: z.string().nullable().optional(),
})
export type CanvasNodePatch = z.output<typeof canvasNodePatchSchema>

/**
 * One node in a move gesture. Box-select then drag moves many at once, so the
 * channel takes an array of these and writes them in one transaction.
 */
export const canvasNodeMoveSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  /** Only present when the gesture was a resize as well as a move. */
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
})
export type CanvasNodeMove = z.output<typeof canvasNodeMoveSchema>
