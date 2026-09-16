"use client"

/**
 * One asset, filling whatever box it is given.
 *
 * The board's `AssetCard` cannot be used here: it is a fixed-width masonry
 * cell that owns a dnd-kit drag, and a canvas node is a resizable frame whose
 * drag belongs to React Flow. What is shared is the rule about video — there
 * is no generated poster because OpenDirect does not ship ffmpeg, so a
 * `<video preload="metadata">` paints its own first frame.
 *
 * `AssetPreview` is still the place an asset is *read*; this is only how it
 * looks inside a node.
 */
import type { ReactElement } from "react"
import type { AssetDto } from "@opendirect/contract"
import { cn } from "@workspace/ui/lib/utils"

import { SaveAsContainerMenu } from "@/components/board/save-as-container"

export interface AssetTileProps {
  asset: AssetDto
  className?: string
  /**
   * Adds the right-click "Save as character" / "Save as scene" menu.
   *
   * Opt-in, because a tile that already sits inside somebody else's context
   * menu — a result tile, a filmstrip thumb — must not grow a second one.
   */
  saveAs?: boolean
}

export function assetLabel(asset: AssetDto): string {
  return asset.label ?? asset.originalName ?? asset.kind
}

export function AssetTile({ asset, className, saveAs }: AssetTileProps) {
  const tile = renderTile(asset, className)
  return saveAs ? (
    <SaveAsContainerMenu asset={asset}>{tile}</SaveAsContainerMenu>
  ) : (
    tile
  )
}

/** The picture itself — one element, so it can be a context menu's trigger. */
function renderTile(asset: AssetDto, className?: string): ReactElement {
  const label = assetLabel(asset)

  if (asset.kind === "video" && asset.url) {
    return (
      <video
        src={asset.url}
        poster={asset.thumbnailUrl ?? undefined}
        aria-label={label}
        className={cn("bg-muted object-cover", className)}
        preload="metadata"
        muted
        playsInline
        loop
      />
    )
  }

  if (asset.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.url}
        alt={label}
        className={cn("bg-muted object-cover", className)}
      />
    )
  }

  return (
    <p
      className={cn(
        "overflow-auto bg-muted p-2 text-xs text-muted-foreground",
        className
      )}
    >
      {asset.text ?? label}
    </p>
  )
}
