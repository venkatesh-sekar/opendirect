/**
 * Where the `asset://` image tiers live on disk — the naming half of
 * `media-tiers.ts`, without `sharp`.
 *
 * Split out so code that only needs to *find* a tier (deleting an asset
 * removes its cached copies) does not load the image library to do it.
 */
import { posix } from "node:path"

import type { AssetTierEdge } from "@opendirect/contract"

/** The folder every tier is cached under, relative to the project. */
export const TIER_ROOT = "thumbnails"

/**
 * A project-relative path that is already in its one canonical spelling:
 * forward slashes, no leading slash, and no `.`, `..` or empty segment.
 *
 * A tier's path is the source's path with a prefix, so anything that could
 * walk back out of that prefix — `assets/../../x.jpg`, which `asset://`
 * delivers intact as `assets/..%2F..%2Fx.jpg` — must never become one.
 */
export function isPlainRelPath(relPath: string): boolean {
  if (!relPath || relPath.includes("\\") || relPath.includes("\0")) return false
  if (posix.isAbsolute(relPath) || posix.normalize(relPath) !== relPath)
    return false
  return relPath
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/**
 * Where the `edge` tier of `relPath` is cached, relative to the project.
 *
 * Throws for a path that is not plain (`isPlainRelPath`): prefixing one could
 * name a file outside `thumbnails/`.
 */
export function tierRelPath(relPath: string, edge: AssetTierEdge): string {
  if (!isPlainRelPath(relPath))
    throw new Error(`Refusing to name a tier for ${relPath}`)
  return `${TIER_ROOT}/w${edge}/${relPath.replace(/\.[^./]+$/, "")}.webp`
}
