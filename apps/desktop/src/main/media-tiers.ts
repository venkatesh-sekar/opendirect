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
import { mkdir, realpath, rename, rm, stat } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"

import { parseAssetTier, type AssetTierEdge } from "@opendirect/contract"
import sharp from "sharp"

import {
  contentTypeFor,
  extensionOf,
  parseMediaUrl,
  resolveMediaRequest,
  type MediaRequest,
} from "./media"
import { isPlainRelPath, TIER_ROOT, tierRelPath } from "./media-tier-paths"
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

function isWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep)
}

/**
 * Makes the tier's folder, but only if it really is under `thumbnails/`.
 *
 * The lexical path is already plain, but a symlink planted at `thumbnails/`
 * or `thumbnails/w1024/` would carry `mkdir` and the write somewhere else
 * entirely. So the nearest folder that already exists is resolved first and
 * must be inside the real `thumbnails/` (or be the project root, when
 * `thumbnails/` is not there yet), and the folder `mkdir` leaves is checked
 * again before anything is written into it.
 */
async function prepareTierFolder(root: string, target: string) {
  const thumbnails = join(root, TIER_ROOT)
  const folder = dirname(target)
  let existing = folder
  let real: string | null = null
  while (real === null) {
    try {
      real = await realpath(existing)
    } catch {
      const parent = dirname(existing)
      if (parent === existing) return false
      existing = parent
    }
  }
  const allowed = existing === root ? real === root : isWithin(real, thumbnails)
  if (!allowed) return false

  await mkdir(folder, { recursive: true })
  return isWithin(await realpath(folder), thumbnails)
}

/**
 * Writes the tier, or reports that the original should be served instead.
 *
 * Written to a temp name and renamed into place, so a concurrent request never
 * reads half a file.
 */
async function renderTier(
  sourcePath: string,
  root: string,
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

    if (!(await prepareTierFolder(root, target))) return false
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
 * Every path still goes through `resolveMediaRequest` first. The tier is then
 * named from where the original *really* is, relative to the real project
 * folder — never from the URL's own spelling, which may climb with `..%2F` —
 * and is written and served only from inside `thumbnails/`, so a tier cannot
 * reach anything the original request could not.
 */
export async function resolveTieredMediaRequest(
  project: Pick<ProjectRef, "path">,
  url: string
): Promise<MediaRequest> {
  const original = await resolveMediaRequest(project, url)
  const edge = parseAssetTier(url)
  const asked = parseMediaUrl(url)
  if (edge === null || asked === null || !isPlainRelPath(asked)) return original

  try {
    const root = await realpath(project.path)
    // `original.path` is already real and inside `root`.
    const relPath = relative(root, original.path).split(sep).join("/")
    if (!isPlainRelPath(relPath)) return original

    const [folder] = relPath.split("/")
    if (!folder || !TIERED_FOLDERS.has(folder)) return original
    if (!RESIZABLE_EXTENSIONS.has(extensionOf(relPath))) return original

    const rel = tierRelPath(relPath, edge)
    const target = join(root, rel)

    // A cached tier older than its source is stale — the file was replaced.
    const [sourceTime, tierTime] = await Promise.all([
      mtimeOf(original.path),
      mtimeOf(target),
    ])
    let ready =
      tierTime !== null && sourceTime !== null && tierTime >= sourceTime
    if (!ready) {
      let job = inFlight.get(target)
      if (!job) {
        job = renderTier(original.path, root, target, edge).finally(() =>
          inFlight.delete(target)
        )
        inFlight.set(target, job)
      }
      ready = await job
    }
    if (!ready) return original

    const served = await realAssetPath(project, rel)
    if (!isWithin(served, join(root, TIER_ROOT))) return original
    return { path: served, contentType: contentTypeFor(rel) }
  } catch {
    return original
  }
}
