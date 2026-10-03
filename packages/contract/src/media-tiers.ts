/**
 * The sizes an image can be fetched at over `asset://`.
 *
 * The canvas zooms, so one picture is needed at very different sizes: a stamp
 * when the whole graph is in view, every pixel when it is zoomed in on. The
 * renderer picks the smallest of these that still covers the node's on-screen
 * size in device pixels, and main produces each one:
 *
 * - **512** is the stored thumbnail, `thumbnails/<assetId>.webp`, written once
 *   at import (`asset.thumbnailUrl`).
 * - **1024 / 2048** are asked for as `<asset.url>?w=1024`. Main resizes the
 *   original with `sharp` the first time, caches the result under
 *   `thumbnails/w<edge>/`, and serves the original unchanged when it is no
 *   larger than the tier or cannot be resized.
 * - **the original** is `asset.url` itself.
 *
 * Shared here because both processes must agree on the exact list: main serves
 * only these edges, so a URL cannot make it write arbitrarily many files.
 */

/** Longest edge of the thumbnail written at import, in pixels. */
export const ASSET_THUMBNAIL_EDGE = 512

/** The intermediate sizes main resizes to on request, smallest first. */
export const ASSET_TIER_EDGES = [1024, 2048] as const
export type AssetTierEdge = (typeof ASSET_TIER_EDGES)[number]

/** The query parameter that carries the tier. */
export const ASSET_TIER_PARAM = "w"

/** `asset.url` at a tier: the same file, asked for at most `edge` pixels. */
export function assetTierUrl(url: string, edge: AssetTierEdge): string {
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}${ASSET_TIER_PARAM}=${edge}`
}

/** The tier a URL asks for, or null for the original or an unknown size. */
export function parseAssetTier(url: string): AssetTierEdge | null {
  // A pattern rather than `URL`: the contract compiles without DOM or Node
  // typings, and the query is only ever the one this module wrote.
  const query = url.split("#")[0]?.split("?")[1] ?? ""
  const match = new RegExp(`(?:^|&)${ASSET_TIER_PARAM}=(\\d+)(?:&|$)`).exec(
    query
  )
  const raw = match ? Number(match[1]) : NaN
  return (ASSET_TIER_EDGES as readonly number[]).includes(raw)
    ? (raw as AssetTierEdge)
    : null
}
