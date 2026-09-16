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
import { CONTENT_TYPES, extensionOf } from "./media"
import { realAssetPath, type ProjectRef } from "./project"
import { getAsset } from "./repo/assets"

/**
 * Extensions "Open" will hand to the operating system.
 *
 * Containment is not enough on its own. `shell.openPath` asks the OS to *run
 * the handler* for a file, and a project folder is not a trusted store: its
 * contents arrive by import and by provider download, so a `.desktop`, a
 * `.command`, a `.sh` or a `.exe` sitting in `generations/` would be one click
 * from executing. The answer is the same one the rest of the app uses — a file
 * OpenDirect recognises as media is a file it will open, and nothing else is —
 * so the list is derived from the MIME table rather than written twice.
 *
 * `svg` is deliberately removed: it is markup a browser will execute, and it
 * is the one entry in that table that is a document pretending to be a picture.
 */
const OPENABLE_EXTENSIONS = new Set(
  Object.keys(CONTENT_TYPES).filter((ext) => ext !== "svg")
)

export function isOpenableExtension(path: string): boolean {
  return OPENABLE_EXTENSIONS.has(extensionOf(path))
}

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
 *
 * `forOpening` adds the extension check: "Reveal in folder" only selects a file
 * in the OS file browser and is safe for anything, but "Open" launches a
 * handler and is restricted to the media types the app itself understands.
 */
export async function resolveOpenPath(
  ctx: OpenTargetContext,
  assetId: string,
  options: { forOpening?: boolean } = {}
): Promise<string> {
  const asset = getAsset(ctx.db, assetId)
  if (!asset) throw new Error(`Asset ${assetId} was not found`)
  if (!asset.relPath) {
    throw new Error("That asset has no file to open.")
  }

  if (options.forOpening && !isOpenableExtension(asset.relPath)) {
    throw new Error(
      "OpenDirect only opens the image, video and audio files it recognises. Use “Reveal in folder” and open this one yourself."
    )
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
