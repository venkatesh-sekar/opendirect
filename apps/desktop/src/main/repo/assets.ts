/**
 * Assets: the media in a project, and which containers it is filed under.
 *
 * Three rules shape this module:
 *
 * - **Importing copies.** The project folder must stay self-contained, so an
 *   import reads the user's file and writes a copy under `assets/<yyyy>/<mm>/`;
 *   moving or deleting the original afterwards changes nothing.
 * - **Content addresses identity.** Files are deduplicated by sha256 *within a
 *   project*: re-importing the same picture into a second container links the
 *   existing asset rather than storing the bytes twice.
 * - **A link is not ownership.** `container_assets` is many-to-many, so
 *   removing an asset from a container never touches the file or the row.
 *
 * Electron-free: every function takes the Drizzle handle plus the project's
 * path, which is what makes this testable against a temp folder.
 */
import { createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, readFile, stat } from "node:fs/promises"
import { dirname, extname, join } from "node:path"

import type {
  AssetDto,
  AssetKind,
  AssetPage,
  ImportResult,
} from "@opendirect/contract"
import { and, asc, count, desc, eq } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import { assets, containerAssets, containers, type Asset } from "../db/schema"
import { assetKindFor, contentTypeFor, mediaUrl } from "../media"
import { assetRelPath, type ProjectRef } from "../project"
import { createPreview, NO_PREVIEW, type Thumbnailer } from "./thumbnails"

/** Everything the asset repository needs about the open project. */
export interface AssetContext {
  db: ProjectDatabase
  project: Pick<ProjectRef, "id" | "path">
}

export interface ImportOptions {
  /** Absolute paths of the user's files. */
  paths: string[]
  containerId?: string | null
  label?: string | null
  now?: number
  /** Injected in tests; defaults to the sharp-backed image thumbnailer. */
  thumbnailer?: Thumbnailer
}

/** The renderer's view of an asset: `asset://` URLs, never a disk path. */
export function toAssetDto(asset: Asset): AssetDto {
  return {
    ...asset,
    kind: asset.kind as AssetKind,
    url: mediaUrl(asset.relPath),
    thumbnailUrl: mediaUrl(asset.thumbnailRelPath),
  }
}

export function getAsset(db: ProjectDatabase, id: string): Asset | undefined {
  return db.select().from(assets).where(eq(assets.id, id)).get()
}

function requireAsset(db: ProjectDatabase, id: string): Asset {
  const found = getAsset(db, id)
  if (!found) throw new Error(`Asset ${id} was not found`)
  return found
}

function requireContainer(db: ProjectDatabase, id: string): void {
  const found = db
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.id, id))
    .get()
  if (!found) throw new Error(`Container ${id} was not found`)
}

export interface LinkInput {
  containerId: string
  assetId: string
  position?: number
}

/** Next free slot in a container. Links are appended, newest last. */
function nextLinkPosition(db: ProjectDatabase, containerId: string): number {
  const rows = db
    .select({ position: containerAssets.position })
    .from(containerAssets)
    .where(eq(containerAssets.containerId, containerId))
    .all()
  return rows.length === 0
    ? 0
    : Math.max(...rows.map((row) => row.position)) + 1
}

/** Idempotent: re-adding an asset keeps its existing position. */
export function addToContainer(db: ProjectDatabase, input: LinkInput): void {
  requireContainer(db, input.containerId)
  requireAsset(db, input.assetId)
  db.insert(containerAssets)
    .values({
      containerId: input.containerId,
      assetId: input.assetId,
      position: input.position ?? nextLinkPosition(db, input.containerId),
    })
    .onConflictDoNothing()
    .run()
}

/** Unlinks only — the asset and its file stay in the project. */
export function removeFromContainer(
  db: ProjectDatabase,
  input: Pick<LinkInput, "containerId" | "assetId">
): void {
  db.delete(containerAssets)
    .where(
      and(
        eq(containerAssets.containerId, input.containerId),
        eq(containerAssets.assetId, input.assetId)
      )
    )
    .run()
}

export interface ListByContainerInput {
  containerId: string
  limit?: number
  offset?: number
}

export const DEFAULT_PAGE_SIZE = 60

/**
 * One page of a container's assets, ordered by link position.
 *
 * `total` is a separate `count(*)`: the board shows "1–60 of 412" and the
 * masonry needs to know whether to ask for more, neither of which a page of
 * rows can answer on its own.
 */
export function listByContainer(
  db: ProjectDatabase,
  input: ListByContainerInput
): AssetPage {
  const limit = Math.max(1, input.limit ?? DEFAULT_PAGE_SIZE)
  const offset = Math.max(0, input.offset ?? 0)

  const total =
    db
      .select({ value: count() })
      .from(containerAssets)
      .where(eq(containerAssets.containerId, input.containerId))
      .get()?.value ?? 0

  const rows = db
    .select({ asset: assets })
    .from(containerAssets)
    .innerJoin(assets, eq(assets.id, containerAssets.assetId))
    .where(eq(containerAssets.containerId, input.containerId))
    .orderBy(asc(containerAssets.position), desc(assets.createdAt))
    .limit(limit)
    .offset(offset)
    .all()

  const nextOffset = offset + rows.length
  return {
    items: rows.map((row) => toAssetDto(row.asset)),
    total,
    nextOffset: nextOffset < total ? nextOffset : null,
  }
}

async function sha256Of(path: string): Promise<string> {
  // Projects hold images and short clips, not disk images: reading the file
  // whole is simpler than a stream pipeline and fast enough at this size.
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
}

function findByHash(
  db: ProjectDatabase,
  projectId: string,
  sha256: string
): Asset | undefined {
  return db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.sha256, sha256)))
    .get()
}

/**
 * Copies the user's files into the project, deduplicating by content hash and
 * linking each result into `containerId`.
 *
 * Per-file failures are collected rather than thrown: dropping twenty files on
 * the board where one is unreadable must import the other nineteen.
 */
export async function importFiles(
  ctx: AssetContext,
  options: ImportOptions
): Promise<ImportResult> {
  const { db, project } = ctx
  const containerId = options.containerId ?? null
  if (containerId) requireContainer(db, containerId)

  const thumbnailer = options.thumbnailer ?? createPreview
  const now = options.now ?? Date.now()

  const imported: AssetDto[] = []
  const failures: ImportResult["failures"] = []
  let added = 0
  let deduped = 0

  for (const sourcePath of options.paths) {
    try {
      const stats = await stat(sourcePath)
      if (!stats.isFile()) throw new Error("Not a file")

      const sha256 = await sha256Of(sourcePath)
      const existing = findByHash(db, project.id, sha256)
      if (existing) {
        if (containerId) {
          addToContainer(db, { containerId, assetId: existing.id })
        }
        deduped += 1
        imported.push(toAssetDto(existing))
        continue
      }

      const id = randomUUID()
      const kind: AssetKind = assetKindFor(sourcePath)
      const relPath = assetRelPath({
        source: "upload",
        id,
        ext: extname(sourcePath) || "bin",
        now: new Date(now),
      })
      const target = join(project.path, relPath)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(sourcePath, target)

      const preview = await thumbnailer({
        sourcePath: target,
        kind,
        assetId: id,
        projectPath: project.path,
      }).catch(() => NO_PREVIEW)

      const row = {
        id,
        projectId: project.id,
        kind,
        relPath,
        text: null,
        mimeType: contentTypeFor(sourcePath),
        width: preview.width,
        height: preview.height,
        durationMs: null,
        bytes: stats.size,
        sha256,
        thumbnailRelPath: preview.relPath,
        label: options.label ?? null,
        pinned: false,
        generationId: null,
        createdAt: now,
      }
      db.insert(assets).values(row).run()
      if (containerId) addToContainer(db, { containerId, assetId: id })

      added += 1
      imported.push(toAssetDto(row))
    } catch (error) {
      failures.push({
        path: sourcePath,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { assets: imported, imported: added, deduped, failures }
}
