/**
 * Derived previews for the board.
 *
 * **Images** are resized with `sharp` into `thumbnails/<assetId>.webp` — one
 * decode at import time instead of decoding a 4000px PNG in every masonry cell.
 * The same pass reports the source's intrinsic dimensions, which is what fills
 * `assets.width` / `assets.height`.
 *
 * **Video gets no thumbnail file.** The plan's alternative was `ffmpeg-static` +
 * `fluent-ffmpeg` for a first-frame grab; that adds a ~70 MB per-platform
 * binary with its own licensing story to every installer, to reproduce what
 * Chromium already does for free — a `<video preload="metadata">` in the
 * renderer paints its own first frame. So video assets record
 * `thumbnailRelPath: null` (see `docs/DEVELOPMENT.md` → "Thumbnails").
 *
 * A thumbnail is *derived*: `thumbnails/` is documented as safe to delete, so a
 * failure here is logged into the asset (as a null path) and never fails an
 * import.
 */
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { AssetKind } from "@opendirect/contract"
import sharp from "sharp"

/** Longest edge of a generated preview, in pixels. */
export const THUMBNAIL_MAX_EDGE = 512

export interface PreviewRequest {
  /** Absolute path of the file already copied into the project. */
  sourcePath: string
  kind: AssetKind
  assetId: string
  /** Absolute path of the project folder. */
  projectPath: string
}

export interface Preview {
  /** Project-relative POSIX path, or null when there is no preview file. */
  relPath: string | null
  width: number | null
  height: number | null
}

export const NO_PREVIEW: Preview = { relPath: null, width: null, height: null }

/** Where a preview for `assetId` lives, relative to the project folder. */
export function thumbnailRelPath(assetId: string): string {
  return `thumbnails/${assetId}.webp`
}

export type Thumbnailer = (request: PreviewRequest) => Promise<Preview>

export const createPreview: Thumbnailer = async (request) => {
  if (request.kind !== "image") return NO_PREVIEW

  const relPath = thumbnailRelPath(request.assetId)
  const target = join(request.projectPath, relPath)
  try {
    const image = sharp(request.sourcePath, { failOn: "none" })
    const { width, height } = await image.metadata()
    await mkdir(dirname(target), { recursive: true })
    await image
      // `inside` never upscales a small source and keeps the aspect ratio.
      .resize({
        width: THUMBNAIL_MAX_EDGE,
        height: THUMBNAIL_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toFile(target)
    return {
      relPath,
      width: width ?? null,
      height: height ?? null,
    }
  } catch {
    // An unreadable or exotic image still imports — it just has no preview.
    return NO_PREVIEW
  }
}
