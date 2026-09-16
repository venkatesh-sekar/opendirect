"use client"

/**
 * One imported asset, sitting on the canvas.
 *
 * It exists so a picture or a clip can be wired into a run by dragging an
 * edge rather than by opening a picker. It has an output handle and no input
 * handle, because there is nothing to feed a file.
 *
 * The body is a tile; reading the asset — its size, its duration, where it
 * came from — is still `AssetPreview`'s job, opened from the header rather
 * than reimplemented here.
 *
 * The missing-asset state is not defensive padding. A media node whose asset
 * row is deleted is cascaded away with it in SQLite, so the only way to see
 * this is the moment between the delete and the surface being re-read — and
 * saying so is better than a blank rectangle.
 */
import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SearchAreaIcon } from "@hugeicons/core-free-icons"
import type { CanvasNodeDto } from "@opendirect/contract"
import type { NodeProps } from "@xyflow/react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import { AssetPreview } from "@/components/board/asset-preview"

import { AssetTile, assetLabel } from "./asset-tile"
import { NodeFrame } from "./node-frame"
import type { CanvasFlowNode } from "./types"

export function MediaNodeBody({ node }: { node: CanvasNodeDto }) {
  const asset = node.asset

  if (!asset) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
        This node&rsquo;s asset is no longer in the project.
      </div>
    )
  }

  return <AssetTile asset={asset} className="h-full w-full" />
}

/** The header button that opens the existing preview panel over the node. */
function MediaNodeDetails({ node }: { node: CanvasNodeDto }) {
  const [open, setOpen] = useState(false)
  if (!node.asset) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-6"
            aria-label="Preview this asset"
          />
        }
      >
        <HugeiconsIcon icon={SearchAreaIcon} className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="h-96 w-80 p-0">
        <AssetPreview asset={node.asset} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

export function MediaNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.node
  return (
    <NodeFrame
      node={node}
      selected={selected === true}
      title={node.asset ? assetLabel(node.asset) : "Media"}
      actions={<MediaNodeDetails node={node} />}
    >
      <MediaNodeBody node={node} />
    </NodeFrame>
  )
}
