/**
 * Image tiers for the `asset://` protocol: the same picture at 1024 or 2048px.
 *
 * The canvas asks for `asset://media/assets/…/<id>.jpg?w=2048` when a node is
 * shown large enough that the 512px thumbnail would be magnified, but not so
 * large that it needs every pixel of a 12-megapixel phone photo. Main answers
 * with a downscaled webp, rendered by `sharp` on first request and kept under
 * `thumbnails/w<edge>/` — derived, like every other file in `thumbnails/`, so
 * deleting the folder only costs a re-render.
 *
 * The original is served instead, unchanged, whenever a tier would not help:
 * the file is already no larger than the tier, it is a format a resize would
 * damage (an animated gif, an svg), it is not in `assets/` or `generations/`,
 * or `sharp` cannot read it. A tier request therefore never fails where the
 * original would have worked.
 *
 * Electron-free, so it is tested against a temp folder like `media.ts`.
 */
import { randomUUID } from "node:crypto"
import { mkdir, rename, rm, stat } from "node:fs/promises"
import { dirname, join } from "node:path"

import { parseAssetTier, type AssetTierEdge } from "@opendirect/contract"
import sharp from "sharp"

import {
  contentTypeFor,
  extensionOf,
  parseMediaUrl,
  resolveMediaRequest,
  type MediaRequest,
} from "./media"
import { tierRelPath } from "./media-tier-paths"
import { realAssetPath, type ProjectRef } from "./project"

/** Formats a resize keeps intact. Not gif (animation) or svg (vector). */
const RESIZABLE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "avif",
  "tif",
  "tiff",
])

/** Only original media is tiered; a thumbnail is already small. */
const TIERED_FOLDERS = new Set(["assets", "generations"])

/** Renders in progress, so a burst of requests for one tier resizes once. */
const inFlight = new Map<string, Promise<boolean>>()

async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

/**
 * Writes the tier, or reports that the original should be served instead.
 *
 * Written to a temp name and renamed into place, so a concurrent request never
 * reads half a file.
 */
async function renderTier(
  sourcePath: string,
  target: string,
  edge: AssetTierEdge
): Promise<boolean> {
  const temp = `${target}.${randomUUID()}.tmp`
  try {
    const image = sharp(sourcePath, { failOn: "none", autoOrient: true })
    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width
    const height = metadata.autoOrient?.height ?? metadata.height
    if (!width || !height || Math.max(width, height) <= edge) return false

    await mkdir(dirname(target), { recursive: true })
    await image
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86 })
      .toFile(temp)
    await rename(temp, target)
    return true
  } catch {
    await rm(temp, { force: true })
    return false
  }
}

/**
 * Resolves an `asset://` URL, honouring a `?w=` tier when one helps.
 *
 * Every path still goes through `resolveMediaRequest` first, and the cached
 * tier is served through `realAssetPath`, so a tier cannot reach anything the
 * original request could not.
 */
export async function resolveTieredMediaRequest(
  project: Pick<ProjectRef, "path">,
  url: string
): Promise<MediaRequest> {
  const original = await resolveMediaRequest(project, url)
  const edge = parseAssetTier(url)
  const relPath = parseMediaUrl(url)
  if (edge === null || relPath === null) return original

  const [folder] = relPath.split("/")
  if (!folder || !TIERED_FOLDERS.has(folder)) return original
  if (!RESIZABLE_EXTENSIONS.has(extensionOf(relPath))) return original

  const rel = tierRelPath(relPath, edge)
  const target = join(project.path, rel)

  // A cached tier older than its source is stale — the file was replaced.
  const [sourceTime, tierTime] = await Promise.all([
    mtimeOf(original.path),
    mtimeOf(target),
  ])
  let ready = tierTime !== null && sourceTime !== null && tierTime >= sourceTime
  if (!ready) {
    let job = inFlight.get(target)
    if (!job) {
      job = renderTier(original.path, target, edge).finally(() =>
        inFlight.delete(target)
      )
      inFlight.set(target, job)
    }
    ready = await job
  }
  if (!ready) return original

  try {
    return {
      path: await realAssetPath(project, rel),
      contentType: contentTypeFor(rel),
    }
  } catch {
    return original
  }
}
