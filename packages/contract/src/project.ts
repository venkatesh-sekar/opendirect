/**
 * Wire shapes for the project domain: the project itself, its container tree,
 * its assets and its generations.
 *
 * These mirror the Drizzle rows in `apps/desktop/src/main/db/schema.ts` but are
 * deliberately a *separate* declaration: the database is main's private detail,
 * while this is the contract both processes agree on. Two differences are
 * intentional —
 *
 * - every timestamp is epoch milliseconds (a `Date` does not survive the
 *   structured clone of an IPC round-trip cleanly, and the DB stores integers);
 * - an asset carries `url` / `thumbnailUrl` the renderer can put straight into
 *   an `<img>` or `<video>`, resolved by main to the `asset://` media protocol.
 *   The renderer never sees an absolute filesystem path.
 */
import { z } from "zod"

export const containerKindSchema = z.enum([
  "project",
  "character",
  "scene",
  "folder",
])
export type ContainerKind = z.output<typeof containerKindSchema>

export const assetKindSchema = z.enum([
  "image",
  "video",
  "audio",
  "text",
  "prompt",
])
export type AssetKind = z.output<typeof assetKindSchema>

export const generationStatusSchema = z.enum([
  "queued",
  "submitted",
  "running",
  "succeeded",
  "failed",
  "canceled",
])
export type GenerationStatus = z.output<typeof generationStatusSchema>

export const projectRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Absolute path of the project folder — shown to the user, never fetched. */
  path: z.string(),
  createdAt: z.number(),
})
export type ProjectRefDto = z.output<typeof projectRefSchema>

export const recentProjectSchema = projectRefSchema.extend({
  lastOpenedAt: z.number(),
})
export type RecentProjectDto = z.output<typeof recentProjectSchema>

export const containerSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  kind: containerKindSchema,
  name: z.string(),
  position: z.number(),
  createdAt: z.number(),
})
export type ContainerDto = z.output<typeof containerSchema>

export interface ContainerNodeDto extends ContainerDto {
  children: ContainerNodeDto[]
}

/** The sidebar tree. Recursive, so the type is declared before the schema. */
export const containerNodeSchema: z.ZodType<ContainerNodeDto> =
  containerSchema.extend({
    get children() {
      return z.array(containerNodeSchema)
    },
  })

export const assetSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: assetKindSchema,
  /** POSIX-relative to the project folder; null for text-only assets. */
  relPath: z.string().nullable(),
  text: z.string().nullable(),
  mimeType: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  durationMs: z.number().nullable(),
  bytes: z.number().nullable(),
  sha256: z.string().nullable(),
  thumbnailRelPath: z.string().nullable(),
  label: z.string().nullable(),
  pinned: z.boolean(),
  generationId: z.string().nullable(),
  createdAt: z.number(),
  /** `asset://…` URL for the media itself; null when there is no file. */
  url: z.string().nullable(),
  /**
   * `asset://…` URL for the derived preview. Null for video: OpenDirect does
   * not ship ffmpeg, so the renderer uses the `<video>` element's own poster
   * frame instead (see `docs/DEVELOPMENT.md` → "Thumbnails").
   */
  thumbnailUrl: z.string().nullable(),
})
export type AssetDto = z.output<typeof assetSchema>

export const assetPageSchema = z.object({
  items: z.array(assetSchema),
  total: z.number(),
  /** Offset for the next page, or null when this was the last one. */
  nextOffset: z.number().nullable(),
})
export type AssetPage = z.output<typeof assetPageSchema>

export const importResultSchema = z.object({
  /** Every asset the import touched, new and deduplicated alike. */
  assets: z.array(assetSchema),
  imported: z.number(),
  /** Files whose sha256 already existed in the project. */
  deduped: z.number(),
  /** Per-file failures; an unreadable file never fails the whole import. */
  failures: z.array(z.object({ path: z.string(), message: z.string() })),
})
export type ImportResult = z.output<typeof importResultSchema>

export const generationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  containerId: z.string().nullable(),
  provider: z.string(),
  modelSlug: z.string(),
  modelVersion: z.string().nullable(),
  kind: z.string(),
  prompt: z.string().nullable(),
  paramsJson: z.string(),
  requestJson: z.string().nullable(),
  responseJson: z.string().nullable(),
  status: generationStatusSchema,
  error: z.string().nullable(),
  providerJobId: z.string().nullable(),
  estimatedCostUsd: z.number().nullable(),
  actualCostUsd: z.number().nullable(),
  costConfidence: z.string().nullable(),
  parentGenerationId: z.string().nullable(),
  branchNote: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
})
export type GenerationDto = z.output<typeof generationSchema>

export const generationPageSchema = z.object({
  items: z.array(generationSchema),
  total: z.number(),
  nextOffset: z.number().nullable(),
})
export type GenerationPageDto = z.output<typeof generationPageSchema>

/**
 * A generation's branch history: everything it came from and everything that
 * came from it, oldest ancestor first.
 */
export const lineageSchema = z.object({
  generation: generationSchema,
  ancestors: z.array(generationSchema),
  descendants: z.array(generationSchema),
})
export type Lineage = z.output<typeof lineageSchema>
