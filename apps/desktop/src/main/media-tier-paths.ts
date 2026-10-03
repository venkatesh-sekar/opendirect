/**
 * Where the `asset://` image tiers live on disk — the naming half of
 * `media-tiers.ts`, without `sharp`.
 *
 * Split out so code that only needs to *find* a tier (deleting an asset
 * removes its cached copies) does not load the image library to do it.
 */
import type { AssetTierEdge } from "@opendirect/contract"

/** Where the `edge` tier of `relPath` is cached, relative to the project. */
export function tierRelPath(relPath: string, edge: AssetTierEdge): string {
  return `thumbnails/w${edge}/${relPath.replace(/\.[^./]+$/, "")}.webp`
}
