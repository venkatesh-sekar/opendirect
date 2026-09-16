/**
 * What a board actually shows, and how tall each tile is.
 *
 * A container's board mixes two record types: assets (imported files and
 * downloaded outputs) and generations (the runs themselves). A finished run is
 * already on the board as its output assets, so showing its record too would
 * double every result — but a run that is still queued, running or failed has
 * no asset yet, and dropping it would make the board look like nothing is
 * happening. Hence one rule, in one place, with a test.
 */
import type { AssetDto, GenerationDto } from "@opendirect/contract"

/** Matches the plan's `columnWidth={240} columnGutter={12}`. */
export const BOARD_COLUMN_WIDTH = 240
export const BOARD_COLUMN_GUTTER = 12

/** Used before the board has been measured — jsdom and the first paint. */
export const BOARD_FALLBACK_WIDTH = 960
export const BOARD_FALLBACK_HEIGHT = 720

export type BoardItem =
  | { id: string; type: "asset"; asset: AssetDto; createdAt: number }
  | {
      id: string
      type: "generation"
      generation: GenerationDto
      createdAt: number
    }

/**
 * Newest first, runs-in-flight pinned to the top so a fresh submission is
 * visible without scrolling.
 */
export function buildBoardItems(
  assets: readonly AssetDto[],
  generations: readonly GenerationDto[] = []
): BoardItem[] {
  const represented = new Set(
    assets.map((asset) => asset.generationId).filter((id): id is string => !!id)
  )

  const pending: BoardItem[] = generations
    .filter((generation) => !represented.has(generation.id))
    .map((generation) => ({
      id: `generation:${generation.id}`,
      type: "generation" as const,
      generation,
      createdAt: generation.createdAt,
    }))

  const media: BoardItem[] = assets.map((asset) => ({
    id: `asset:${asset.id}`,
    type: "asset" as const,
    asset,
    createdAt: asset.createdAt,
  }))

  const newestFirst = (a: BoardItem, b: BoardItem) => b.createdAt - a.createdAt
  const inFlight = pending.filter(
    (item) =>
      item.type === "generation" &&
      item.generation.status !== "succeeded" &&
      item.generation.status !== "canceled"
  )
  const settled = pending.filter((item) => !inFlight.includes(item))

  return [
    ...inFlight.sort(newestFirst),
    ...[...settled, ...media].sort(newestFirst),
  ]
}

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

/**
 * The viewport numbers `useMasonry` needs. An unmeasured container reports 0,
 * which would lay out zero columns and render an empty grid — so a 0 falls back
 * to a sane desktop size rather than to nothing.
 */
export function boardMetrics(measured: { width: number; height: number }): {
  width: number
  height: number
} {
  return {
    width: measured.width > 0 ? measured.width : BOARD_FALLBACK_WIDTH,
    height: measured.height > 0 ? measured.height : BOARD_FALLBACK_HEIGHT,
  }
}
