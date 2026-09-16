/**
 * Handing a file to the operating system.
 *
 * "Open" and "Reveal in folder" are the only two places OpenDirect lets an
 * absolute path out of the main process — and it never lets one *in*. The
 * renderer names an asset; main looks the row up and re-checks the stored path
 * against the project root before `shell.openPath` is allowed near it.
 *
 * That order matters. `relPath` is written by an import or by a provider
 * download, and a stored `../../etc/passwd` — or a symlink under `assets/`
 * pointing at `~/.ssh/id_rsa` — must not become an `openPath`. `realAssetPath`
 * is the same containment check the `asset://` protocol uses: lexical first,
 * then the real path, so a link cannot smuggle a target out of the project.
 *
 * ⛔ Nothing here calls a provider, and nothing here executes anything: the OS
 * decides which application opens the file.
 */
import type { ProjectDatabase } from "./db/client"
import { realAssetPath, type ProjectRef } from "./project"
import { getAsset } from "./repo/assets"

export interface OpenTargetContext {
  db: ProjectDatabase
  project: Pick<ProjectRef, "path">
}

/** Node's code for "that path does not exist", however it was reached. */
function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ENOENT"
  )
}

/**
 * The real absolute path of an asset's file, or a message the renderer can
 * show as-is.
 */
export async function resolveOpenPath(
  ctx: OpenTargetContext,
  assetId: string
): Promise<string> {
  const asset = getAsset(ctx.db, assetId)
  if (!asset) throw new Error(`Asset ${assetId} was not found`)
  if (!asset.relPath) {
    throw new Error("That asset has no file to open.")
  }

  try {
    return await realAssetPath(ctx.project, asset.relPath)
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(
        "That file is no longer in the project folder — it may have been moved or deleted."
      )
    }
    throw error
  }
}
