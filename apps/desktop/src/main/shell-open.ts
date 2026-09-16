/**
 * Handing a file to the operating system.
 *
 * "Open" and "Reveal in folder" are the only two places OpenDirect lets an
 * absolute path out of the main process — and it never lets one *in*. The
 * renderer names an asset; main looks the row up, re-checks the stored path
 * against the project root with `resolveAssetPath`, and confirms the file is
 * still there before `shell.openPath` is allowed near it.
 *
 * That order matters. `relPath` is written by an import or by a provider
 * download, and a stored `../../etc/passwd` must not become an
 * `openPath` — so validation happens here rather than being assumed to have
 * happened when the row was written.
 *
 * ⛔ Nothing here calls a provider, and nothing here executes anything: the OS
 * decides which application opens the file.
 */
import { existsSync } from "node:fs"

import type { ProjectDatabase } from "./db/client"
import { resolveAssetPath, type ProjectRef } from "./project"
import { getAsset } from "./repo/assets"

export interface OpenTargetContext {
  db: ProjectDatabase
  project: Pick<ProjectRef, "path">
}

/**
 * The absolute path of an asset's file, or a message the renderer can show.
 *
 * `exists` is injected so the rule — refuse a path that is gone — is testable
 * without arranging for a missing file on every platform.
 */
export function resolveOpenPath(
  ctx: OpenTargetContext,
  assetId: string,
  exists: (path: string) => boolean = existsSync
): string {
  const asset = getAsset(ctx.db, assetId)
  if (!asset) throw new Error(`Asset ${assetId} was not found`)
  if (!asset.relPath) {
    throw new Error("That asset has no file to open.")
  }

  // Throws for anything that resolves outside the project folder.
  const absolute = resolveAssetPath(ctx.project, asset.relPath)
  if (!exists(absolute)) {
    throw new Error(
      "That file is no longer in the project folder — it may have been moved or deleted."
    )
  }
  return absolute
}
