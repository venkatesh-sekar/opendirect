"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { PlayIcon } from "@hugeicons/core-free-icons"
import { cn } from "@workspace/ui/lib/utils"

import {
  formatDuration,
  modelName,
  relativeTime,
  type RunTile,
} from "@/lib/workspace/home"

import { AssetTile } from "@/components/canvas/nodes/asset-tile"

/** Every tile in a strip is this tall; the width follows the picture. */
const TILE_HEIGHT = 168
const MIN_WIDTH = 112
const MAX_WIDTH = 298

/**
 * A portrait still is a narrow tile and a clip a wide one, the way the
 * mockup lays them out. Before a run has a picture its model's kind decides.
 */
export function tileWidth(tile: RunTile): number {
  const { asset, generation } = tile
  const ratio =
    asset?.width && asset.height
      ? asset.width / asset.height
      : generation.kind === "video"
        ? 16 / 9
        : 0.8
  return Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, Math.round(TILE_HEIGHT * ratio))
  )
}

/** A dark chip over the picture, for the clip length. */
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur-sm">
      {children}
    </span>
  )
}

export interface RunTileViewProps {
  tile: RunTile
  /** Opens the run's details and lineage. Never submits anything. */
  onOpen: (generationId: string) => void
  /** Fill the grid cell instead of the strip's fixed height. */
  fluid?: boolean
}

/**
 * One run: its picture, its prompt on one line, and `model · 2m ago`.
 *
 * A run still in flight is drawn with a dashed amber outline and its progress
 * instead of a picture, so "is it done yet" reads from across the room.
 */
export function RunTileView({ tile, onOpen, fluid }: RunTileViewProps) {
  const { generation, asset, running, progress } = tile
  const width = tileWidth(tile)

  return (
    <button
      type="button"
      onClick={() => onOpen(generation.id)}
      className="group flex shrink-0 flex-col gap-2 text-left"
      style={fluid ? undefined : { width }}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-lg bg-muted transition-opacity group-hover:opacity-90",
          running &&
            "outline-1 -outline-offset-1 outline-status-running outline-dashed"
        )}
        style={fluid ? { aspectRatio: "4 / 5" } : { height: TILE_HEIGHT }}
      >
        {asset ? (
          <div aria-hidden className="size-full">
            <AssetTile asset={asset} className="size-full" />
          </div>
        ) : null}

        {!running && asset?.kind === "video" && asset.durationMs ? (
          <Badge>
            <HugeiconsIcon icon={PlayIcon} className="size-3" />
            {formatDuration(asset.durationMs)}
          </Badge>
        ) : null}

        {running ? (
          <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1.5">
            <div className="flex justify-between text-[11px]">
              <span className="font-medium text-status-running">
                Generating
              </span>
              {progress !== null ? (
                <span className="font-mono text-muted-foreground">
                  {Math.round(progress * 100)}%
                </span>
              ) : null}
            </div>
            <ProgressBar progress={progress} />
          </div>
        ) : !asset ? (
          <span className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">
            {generation.status === "failed"
              ? "Failed"
              : generation.status === "canceled"
                ? "Canceled"
                : "No output"}
          </span>
        ) : null}
      </div>
      <span className="truncate text-xs">
        {generation.prompt || "No prompt"}
      </span>
      <span className="-mt-1 truncate text-[11px] text-muted-foreground">
        {modelName(generation.modelSlug)} ·{" "}
        {running ? "now" : relativeTime(generation.createdAt)}
      </span>
    </button>
  )
}

/**
 * The amber bar. Indeterminate — a pulse, not a number — when the provider
 * reports no progress, which is most of them today.
 */
export function ProgressBar({ progress }: { progress: number | null }) {
  return (
    <div className="h-0.75 overflow-hidden rounded-full bg-foreground/10">
      <div
        className={cn(
          "h-full rounded-full bg-status-running",
          progress === null && "w-full animate-pulse opacity-40"
        )}
        style={
          progress === null
            ? undefined
            : { width: `${Math.round(progress * 100)}%` }
        }
      />
    </div>
  )
}
