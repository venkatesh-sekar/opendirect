"use client"

import { useDraggable } from "@dnd-kit/core"
import type { AssetDto, GenerationDto } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  Delete02Icon,
  Loading03Icon,
  VideoReplayIcon,
} from "@hugeicons/core-free-icons"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"

import type { AssetDragData } from "@/lib/board/drop-target"
import { cardMediaHeight } from "@/lib/board/items"

export interface AssetCardProps {
  asset: AssetDto
  /** The board this card is being shown on; part of the drag payload. */
  containerId: string | null
  width: number
  selected?: boolean
  onSelect?: (asset: AssetDto) => void
  onRemove?: (asset: AssetDto) => void
}

function mediaLabel(asset: AssetDto): string {
  return asset.label ?? asset.originalName ?? asset.kind
}

/**
 * One tile on the board.
 *
 * Video has no generated poster — OpenDirect does not ship ffmpeg — so a
 * `<video preload="metadata">` paints its own first frame and doubles as the
 * hover scrub. `muted` and `playsInline` are what let a hover play without the
 * browser refusing, and nothing autoplays until the pointer is over the tile.
 */
export function AssetCard({
  asset,
  containerId,
  width,
  selected,
  onSelect,
  onRemove,
}: AssetCardProps) {
  const dragData: AssetDragData = {
    type: "asset",
    assetId: asset.id,
    containerId,
  }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `asset:${asset.id}`,
    data: dragData,
  })

  const height = cardMediaHeight(asset, width)
  const label = mediaLabel(asset)

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block w-full">
        <div
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          aria-label={label}
          data-testid="asset-card"
          data-asset-id={asset.id}
          data-dragging={isDragging || undefined}
          className={cn(
            "group relative block w-full cursor-pointer overflow-hidden rounded-md bg-muted outline-none select-none",
            "ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
            selected && "ring-2 ring-primary",
            isDragging && "opacity-40"
          )}
          onClick={() => onSelect?.(asset)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onSelect?.(asset)
            }
          }}
        >
          {asset.kind === "video" && asset.url ? (
            <video
              src={asset.url}
              poster={asset.thumbnailUrl ?? undefined}
              style={{ height }}
              className="w-full object-cover"
              preload="metadata"
              muted
              playsInline
              loop
              onMouseEnter={(event) => {
                void event.currentTarget.play?.().catch(() => {})
              }}
              onMouseLeave={(event) => event.currentTarget.pause?.()}
            />
          ) : asset.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.thumbnailUrl ?? asset.url}
              alt={label}
              style={{ height }}
              className="w-full object-cover"
              draggable={false}
              loading="lazy"
            />
          ) : (
            <div
              style={{ height }}
              className="flex w-full items-center justify-center p-4 text-xs text-muted-foreground"
            >
              {asset.text ?? label}
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="truncate text-xs text-white/90">{label}</span>
            {asset.kind === "video" ? (
              <HugeiconsIcon
                icon={VideoReplayIcon}
                className="ml-auto size-3.5 shrink-0 text-white/90"
              />
            ) : null}
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          disabled={!containerId || !onRemove}
          onClick={() => onRemove?.(asset)}
        >
          <HugeiconsIcon icon={Delete02Icon} className="size-4" />
          Remove from this board
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export interface GenerationCardProps {
  generation: GenerationDto
  width: number
}

/** A run with no output yet: the board's only non-media tile. */
export function GenerationCard({ generation, width }: GenerationCardProps) {
  const failed = generation.status === "failed"
  return (
    <div
      data-testid="generation-card"
      data-generation-id={generation.id}
      style={{ height: Math.round(width * 0.62) }}
      className={cn(
        "flex w-full flex-col justify-between rounded-md border border-dashed p-3",
        failed ? "border-destructive/50" : "border-border"
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HugeiconsIcon
          icon={failed ? Alert02Icon : Loading03Icon}
          className={cn("size-3.5", !failed && "animate-spin")}
        />
        {failed ? "Failed" : generation.status}
      </div>
      <p className="line-clamp-3 text-xs text-foreground/80">
        {generation.error ?? generation.prompt ?? generation.modelSlug}
      </p>
      <p className="truncate text-[11px] text-muted-foreground">
        {generation.modelSlug}
      </p>
    </div>
  )
}
