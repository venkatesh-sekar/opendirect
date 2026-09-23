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

/**
 * A `shot` is one numbered beat of a scene: a child of the scene, ordered by
 * `position`, labelled by its `description`, and its versions are the runs
 * filed under it. It is not `@`-able and not a sidebar row.
 */
export const containerKindSchema = z.enum([
  "project",
  "character",
  "scene",
  "folder",
  "shot",
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
  /**
   * `venkz` — what this container answers to when it is `@`-mentioned in a
   * prompt. Unique within the project, derived from the name and editable.
   * Null for `project` and `folder` containers, and for a name that slugifies
   * to nothing at all (see `handle.ts`).
   */
  handle: z.string().nullable(),
  /**
   * The user's own words for who or where this is. What `@venkz` becomes in
   * the prompt when the chosen model takes no image.
   */
  description: z.string().nullable(),
  referenceAssetIds: z.array(z.string()).nullable().optional(),
  /**
   * A shot's chosen version: one of the assets its runs made. Null until the
   * user picks, and again when that asset leaves the shot. Always null for
   * any other kind.
   */
  pickedAssetId: z.string().nullable().optional(),
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
  /** The file name this asset was imported from, when it was imported. */
  originalName: z.string().nullable(),
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

/**
 * What a character, scene or folder card shows without opening it: how much
 * is in it, the picture on its face and when anything last happened there.
 *
 * Counts are the container's own — a folder's children are not rolled up —
 * except that a scene's runs, activity and fallback cover include its shots'.
 */
export const containerSummarySchema = z.object({
  id: z.string(),
  /** Assets linked to this container through `container_assets`. */
  assetCount: z.number(),
  /**
   * Runs filed under this container (`generations.container_id`), and for a
   * scene under its shots too.
   */
  generationCount: z.number(),
  /**
   * The first reference image when one is set and still exists, otherwise the
   * newest image in the container; null when it has no image at all.
   */
  coverAsset: assetSchema.nullable(),
  /**
   * Epoch ms of the latest of: the container's creation, a linked asset's
   * creation, a run's submission or a run's completion.
   */
  lastActivityAt: z.number(),
  /**
   * A scene's cast — the characters its runs mentioned, by id, in tree order
   * (see `containers:related`). Empty for every other kind. On the summary so
   * a grid of scene cards draws its avatars from the one query it already
   * makes, rather than one `containers:related` per card.
   */
  castIds: z.array(z.string()),
})
export type ContainerSummaryDto = z.output<typeof containerSummarySchema>

/**
 * Who is in a scene, or which scenes a character is in — the arm follows the
 * kind of the container asked about.
 *
 * Derived, never stored: a character is in a scene when a run filed under the
 * scene mentioned it (`mentionedContainerIds`), or — for a run from before
 * mentions were recorded — was sent one of the character's assets as an
 * input. Both lists are in tree order.
 */
export const relatedContainersSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scene"), characters: z.array(containerSchema) }),
  z.object({ kind: z.literal("character"), scenes: z.array(containerSchema) }),
])
export type RelatedContainersDto = z.output<typeof relatedContainersSchema>

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
  /** Provider-reported compute seconds, when it reports any. */
  predictTimeSeconds: z.number().nullable(),
  costConfidence: z.string().nullable(),
  parentGenerationId: z.string().nullable(),
  /**
   * The batch this run is a sibling of, or null for a run submitted on its
   * own. The renderer groups a canvas node's tiles by it, which is the reason
   * it is on the DTO rather than left inside `requestJson`.
   */
  batchId: z.string().nullable(),
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
  /**
   * The assets the runs on this page produced, oldest first. A run's tile needs
   * its picture, and the project-wide list spans containers — so there is no
   * one `assets:list` the renderer could join it against.
   */
  outputs: z.array(assetSchema).default([]),
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

/**
 * One `@`-able thing, flattened for both the picker and the resolver.
 *
 * Built by `listMentionSubjects` in one pass over the project rather than by
 * an `assets:list` per container: the picker wants every subject at once, and
 * N round trips to open a popover is N too many.
 */
export const mentionSubjectSchema = z.object({
  containerId: z.string(),
  kind: z.enum(["character", "scene"]),
  handle: z.string(),
  name: z.string(),
  /** The user's prose. What `@venkz` becomes when there is no image slot. */
  description: z.string().nullable(),
  explicitReferences: z.boolean().optional(),
  /** Reference images, best first — see `rankReferenceImages`. */
  images: z.array(
    z.object({
      assetId: z.string(),
      label: z.string().nullable(),
      /**
       * The `asset://` preview, so the picker and the tray can show the face
       * rather than only the handle. Null when there is no preview to show.
       */
      thumbnailUrl: z.string().nullable(),
    })
  ),
})
export type MentionSubjectDto = z.output<typeof mentionSubjectSchema>
