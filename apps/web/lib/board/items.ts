/**
 * How tall one card's media box is.
 *
 * What is left of the board's layout maths after the canvas replaced it. The
 * masonry item list and its viewport metrics went with `board.tsx`; this one
 * rule stayed, because `AssetCard` is still the tile the details panel and the
 * compare view are built out of, and a card in a fixed-width column still has
 * to decide how tall its picture is.
 */

/** 4:3 is the least surprising guess for media whose dimensions we never read. */
const DEFAULT_RATIO = 3 / 4
/** Keeps a panorama from becoming a sliver and a tall poster from filling a column. */
const MIN_RATIO = 0.4
const MAX_RATIO = 2

/** The media box height for one tile, given the column it lands in. */
export function cardMediaHeight(
  dimensions: { width: number | null; height: number | null },
  columnWidth: number
): number {
  const { width, height } = dimensions
  const ratio =
    width && height && width > 0 && height > 0 ? height / width : DEFAULT_RATIO
  const clamped = Math.min(Math.max(ratio, MIN_RATIO), MAX_RATIO)
  return Math.round(columnWidth * clamped)
}
