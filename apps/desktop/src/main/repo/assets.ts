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
 *   Only `deleteAsset` does that, and it is the one way an asset leaves the
 *   project.
 *
 * Electron-free: every function takes the Drizzle handle plus the project's
 * path, which is what makes this testable against a temp folder.
 */
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"

import type {
  AssetDto,
  AssetKind,
  AssetPage,
  ImportResult,
} from "@opendirect/contract"
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  type SQL,
} from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import {
  assets,
  containerAssets,
  containers,
  generationInputs,
  generations,
  type Asset,
} from "../db/schema"
import { assetKindFor, contentTypeFor, mediaUrl } from "../media"
import { assetRelPath, resolveAssetPath, type ProjectRef } from "../project"
import { hashFile } from "./hash"
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

/** The link, and the shot pick that rode on it. The caller owns the transaction. */
function unlink(
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
  db.update(containers)
    .set({ pickedAssetId: null })
    .where(
      and(
        eq(containers.id, input.containerId),
        eq(containers.pickedAssetId, input.assetId)
      )
    )
    .run()
}

/**
 * Unlinks only — the asset and its file stay in the project. A shot whose pick
 * this was is left with no pick, since it can only wear its own versions.
 */
export function removeFromContainer(
  db: ProjectDatabase,
  input: Pick<LinkInput, "containerId" | "assetId">
): void {
  db.transaction((tx) => unlink(tx, input))
}

/**
 * A reference list with one asset taken out. Emptying it returns `null` —
 * "automatic", the state a container starts in — never `[]`, which would mean
 * "send nothing". The same rule as `toggleReference` in the renderer.
 */
export function withoutReference(
  references: readonly string[] | null,
  assetId: string
): string[] | null {
  if (references === null) return null
  const next = references.filter((id) => id !== assetId)
  return next.length > 0 ? next : null
}

/**
 * Takes `assetId` out of the explicit references of the containers `where`
 * matches. `referenceAssetIds` is JSON, so no foreign key can do it for us.
 */
function dropReferences(
  db: ProjectDatabase,
  assetId: string,
  where: SQL
): void {
  const rows = db
    .select({ id: containers.id, refs: containers.referenceAssetIds })
    .from(containers)
    .where(and(where, isNotNull(containers.referenceAssetIds)))
    .all()
  for (const row of rows) {
    if (!row.refs?.includes(assetId)) continue
    db.update(containers)
      .set({ referenceAssetIds: withoutReference(row.refs, assetId) })
      .where(eq(containers.id, row.id))
      .run()
  }
}

export interface MoveInput {
  assetId: string
  fromContainerId: string
  toContainerId: string
}

/**
 * Re-files an asset: linked into `toContainerId` and unlinked from
 * `fromContainerId` in one transaction, so a failure can never leave it on no
 * board at all (which is what a renderer-side add-then-remove risked).
 *
 * Only the *filing* changes. The asset row, its file, its generation and every
 * canvas node that shows it are untouched, so references to it elsewhere keep
 * working. What the source container said *about* the asset goes with the
 * link: it stops being one of the source's references (a reference has to be
 * in the library — `setContainerReferences`) and stops being a shot's pick.
 * The target gets it as a plain library item, never as a reference it did not
 * ask for.
 */
export function moveToContainer(db: ProjectDatabase, input: MoveInput): void {
  if (input.fromContainerId === input.toContainerId) return
  db.transaction((tx) => {
    requireContainer(tx, input.fromContainerId)
    addToContainer(tx, {
      containerId: input.toContainerId,
      assetId: input.assetId,
    })
    unlink(tx, { containerId: input.fromContainerId, assetId: input.assetId })
    dropReferences(tx, input.assetId, eq(containers.id, input.fromContainerId))
  })
}

/** A run in one of these may still read its inputs from disk. */
const UNFINISHED_STATUSES = ["queued", "submitted", "running"]

/**
 * Removes an asset from the project: the row, then its file and its preview.
 *
 * The schema decides what happens to everything that pointed at it, by the
 * rule the rest of the app follows — a placement goes, a record stays:
 *
 * - its container links cascade away, and a shot it was the pick of is
 *   un-picked (`set null`);
 * - a canvas media node showing it cascades away (a media node with no asset
 *   is nothing); a generate node whose pick it was stays, with no pick;
 * - the generation that made it stays — only this output is gone — and a run
 *   it was fed into loses that input row (`generation_inputs` cascades), while
 *   the run's request JSON keeps the verbatim record of what was sent.
 *
 * Explicit reference lists are JSON, so they are cleaned here, in the same
 * transaction as the delete: a dangling id there would shift every "Ref n"
 * after it.
 *
 * The files go after the commit, best effort: the row is what the app reads,
 * and a stray file in the project folder is harmless where a row naming a
 * missing file is not. A file another row still names is left alone.
 */
export async function deleteAsset(
  ctx: AssetContext,
  assetId: string
): Promise<void> {
  const { db, project } = ctx
  const asset = requireAsset(db, assetId)

  // ⛔ A run that has not reached the provider yet reads its inputs when it is
  // submitted. Deleting one now would not fail that run — it would quietly
  // send a paid request without the reference the user chose.
  const pending = db
    .select({ id: generations.id })
    .from(generationInputs)
    .innerJoin(generations, eq(generations.id, generationInputs.generationId))
    .where(
      and(
        eq(generationInputs.assetId, assetId),
        inArray(generations.status, UNFINISHED_STATUSES)
      )
    )
    .get()
  if (pending)
    throw new Error(
      "This asset is an input to a run that has not finished. Wait for it or cancel it, then delete."
    )

  db.transaction((tx) => {
    dropReferences(tx, assetId, eq(containers.projectId, asset.projectId))
    tx.delete(assets).where(eq(assets.id, assetId)).run()
  })

  const namedElsewhere = (
    column: typeof assets.relPath | typeof assets.thumbnailRelPath,
    relPath: string
  ) =>
    db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(column, relPath), ne(assets.id, assetId)))
      .get() !== undefined

  const files: string[] = []
  if (asset.relPath && !namedElsewhere(assets.relPath, asset.relPath))
    files.push(asset.relPath)
  if (
    asset.thumbnailRelPath &&
    !namedElsewhere(assets.thumbnailRelPath, asset.thumbnailRelPath)
  )
    files.push(asset.thumbnailRelPath)

  await Promise.all(
    files.map(async (relPath) => {
      try {
        // `resolveAssetPath` refuses anything outside the project folder, so
        // a tampered row can never aim this at the user's own files.
        await rm(resolveAssetPath(project, relPath), { force: true })
      } catch {
        // Best effort — see above.
      }
    })
  )
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

      const sha256 = await hashFile(sourcePath)
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
      // Copy into `tmp/` and rename into place: a rename within the project
      // folder is atomic, so `assets/` can never hold a half-written file if
      // the app dies mid-copy. `tmp/` is cleared on every open anyway.
      const staged = join(project.path, "tmp", `${id}${extname(sourcePath)}`)
      await mkdir(dirname(staged), { recursive: true })
      try {
        await copyFile(sourcePath, staged)
        await rename(staged, target)
      } catch (error) {
        await rm(staged, { force: true })
        throw error
      }

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
        originalName: basename(sourcePath),
        pinned: false,
        generationId: null,
        createdAt: now,
      }
      // One transaction: an asset that exists but is filed nowhere would be
      // invisible on every board.
      db.transaction((tx) => {
        tx.insert(assets).values(row).run()
        if (containerId) addToContainer(tx, { containerId, assetId: id })
      })

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
