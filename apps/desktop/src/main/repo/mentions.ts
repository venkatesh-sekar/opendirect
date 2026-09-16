/**
 * The mention subject index: every `@`-able character and scene in a project,
 * with the reference images it could lend a run.
 *
 * One query rather than an `assets:list` per container, because the `@` picker
 * wants the whole list the moment it opens and N round trips to draw a popover
 * is N too many.
 *
 * ⛔ It ranks; it never picks, and it never generates. Which image (if any) a
 * mention actually attaches is `resolveMentions`' decision in the renderer,
 * under a limit the chosen model itself stated — a character with no sheet
 * simply comes back with an empty `images`, and the mention degrades to prose.
 */
import type { MentionSubjectDto } from "@opendirect/contract"
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm"

import type { ProjectDatabase } from "../db/client"
import { assets, containerAssets, containers } from "../db/schema"
import { mediaUrl } from "../media"

/** Everything the ranking reads. `AssetDto` and a raw row both satisfy it. */
export interface RankableAsset {
  id: string
  label: string | null
  pinned: boolean
  createdAt: number
}

/** A ranked row plus the two paths a preview can come from. */
interface MentionImageRow extends RankableAsset {
  // Both nullable: a join widens the columns, and a preview is optional by
  // design — `thumbnails/` is documented as safe to delete.
  relPath: string | null
  thumbnailRelPath: string | null
}

/**
 * The picture the picker shows beside a handle.
 *
 * The generated preview where there is one, the image itself where there is
 * not — the same fallback `AssetTile` and the reference tray already use, so a
 * mention looks like every other thumbnail in the app.
 */
function previewUrl(row: MentionImageRow): string | null {
  return mediaUrl(row.thumbnailRelPath) ?? mediaUrl(row.relPath)
}

/**
 * A label the user (or an import) gave an image that says "this is the
 * canonical view of the subject". Matched case-insensitively, anywhere in the
 * label, so `character sheet v3` counts.
 */
const SHEET_LABEL = /character sheet|turnaround|model sheet|reference/i

/**
 * Best first: pinned, then a sheet-shaped label, then oldest.
 *
 * Oldest last among the three because the first image imported into a
 * character is usually the one it was created from — later ones tend to be
 * variations. A copy is returned; the caller's array is left alone.
 */
export function rankReferenceImages<T extends RankableAsset>(
  assetRows: readonly T[]
): T[] {
  const rank = (row: T): number => {
    if (row.pinned) return 0
    if (row.label && SHEET_LABEL.test(row.label)) return 1
    return 2
  }
  return [...assetRows].sort(
    (a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt
  )
}

/**
 * Every character and scene with a handle, in sidebar order, each with its
 * image assets ranked.
 *
 * A subject with no images is still a subject: it is `@`-able and substitutes
 * as prose, which is exactly the downgrade the feature is built around.
 */
export function listMentionSubjects(
  db: ProjectDatabase,
  projectId: string
): MentionSubjectDto[] {
  const subjects = db
    .select({
      containerId: containers.id,
      kind: containers.kind,
      handle: containers.handle,
      name: containers.name,
      description: containers.description,
    })
    .from(containers)
    .where(
      and(
        eq(containers.projectId, projectId),
        isNotNull(containers.handle),
        inArray(containers.kind, ["character", "scene"])
      )
    )
    .orderBy(asc(containers.position), asc(containers.createdAt))
    .all()

  if (subjects.length === 0) return []

  const rows = db
    .select({
      containerId: containerAssets.containerId,
      id: assets.id,
      label: assets.label,
      pinned: assets.pinned,
      createdAt: assets.createdAt,
      relPath: assets.relPath,
      thumbnailRelPath: assets.thumbnailRelPath,
    })
    .from(containerAssets)
    .innerJoin(assets, eq(assets.id, containerAssets.assetId))
    .where(
      and(
        eq(assets.kind, "image"),
        inArray(
          containerAssets.containerId,
          subjects.map((subject) => subject.containerId)
        )
      )
    )
    .all()

  const byContainer = new Map<string, MentionImageRow[]>()
  for (const row of rows) {
    const list = byContainer.get(row.containerId)
    if (list) list.push(row)
    else byContainer.set(row.containerId, [row])
  }

  return subjects.map((subject) => ({
    containerId: subject.containerId,
    kind: subject.kind as "character" | "scene",
    handle: subject.handle!,
    name: subject.name,
    description: subject.description,
    images: rankReferenceImages(byContainer.get(subject.containerId) ?? []).map(
      (row) => ({
        assetId: row.id,
        label: row.label,
        thumbnailUrl: previewUrl(row),
      })
    ),
  }))
}
