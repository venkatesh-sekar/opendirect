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
import { useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { SearchAreaIcon } from "@hugeicons/core-free-icons"
import {
  AI_IMAGE_HELPERS,
  isImageHelper,
  type AssetDto,
  type CanvasNodeDto,
} from "@opendirect/contract"
import type { NodeProps } from "@xyflow/react"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import { useAiHelper, useAiTools } from "@/hooks/use-ai"
import { HelperMenu } from "@/components/ai/helper-menu"
import { HelperResultDialog } from "@/components/ai/helper-result-dialog"
import { AssetPreview } from "@/components/board/asset-preview"
import { MediaViewer } from "@/components/media/media-viewer"

import { useCanvasSurface } from "../canvas-context"
import { AssetTile, assetLabel } from "./asset-tile"
import { NodeFrame } from "./node-frame"
import type { CanvasFlowNode } from "./types"

export function MediaNodeBody({ node }: { node: CanvasNodeDto }) {
  const asset = node.asset
  const [viewing, setViewing] = useState(false)
  const assets = useMemo(() => (asset ? [asset] : []), [asset])

  if (!asset) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
        This node&rsquo;s asset is no longer in the project.
      </div>
    )
  }

  /*
    Right-click turns this picture into a character or a scene — with a
    handle, with the asset linked and with that asset as the reference image.
    ⛔ It links what is already in the project; it generates nothing.
  */
  /*
    Double-click opens the picture at full size. A single click is still
    React Flow's — it selects, and a drag still moves the node.
  */
  return (
    <div
      className="h-full w-full"
      title="Double-click to view full size"
      onDoubleClick={() => setViewing(true)}
    >
      <AssetTile asset={asset} saveAs className="h-full w-full" />
      <MediaViewer
        assets={assets}
        index={0}
        open={viewing}
        onClose={() => setViewing(false)}
      />
    </div>
  )
}

/**
 * ✨ on a selected picture: Explain or Rethink it with the local `claude` or
 * `codex`, the same menu and the same answer dialog as Improve prompt.
 *
 * The run and its dialog stay mounted for as long as the node is; only the ✨
 * trigger waits for the node to be selected — select the image, then ask. So
 * clicking away mid-run does not lose the answer of a CLI that is still
 * working. Absent altogether without a CLI, as `<HelperMenu/>` always is.
 *
 * Every answer can be copied. A rethink is a prompt, so it can also become
 * the prompt of a new image node wired to this one; an explanation cannot.
 * ⛔ That seeds a composition; Run is still the user's to press.
 */
export function MediaNodeAssist({
  node,
  asset,
  selected,
}: {
  node: CanvasNodeDto
  asset: AssetDto
  selected: boolean
}) {
  const surface = useCanvasSurface()
  const tools = useAiTools()
  const ai = useAiHelper()
  const images = useMemo(() => [asset], [asset])

  return (
    <>
      {selected ? (
        <HelperMenu
          tools={tools.data}
          helpers={AI_IMAGE_HELPERS}
          images={images}
          disabled={ai.state === "running"}
          className="nodrag nopan size-6"
          onRun={(helper, tool, options, image) => {
            if (isImageHelper(helper) && image) {
              ai.run({ helper, assetId: image.id }, tool, options)
            }
          }}
        />
      ) : null}
      <HelperResultDialog
        controller={ai}
        onApply={
          surface && ai.helper === "rethink-image"
            ? (text) =>
                surface.spawn(node, "right", "image_gen", { prompt: text })
            : undefined
        }
        applyLabel="New image node with this prompt"
      />
    </>
  )
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
      actions={
        <>
          {node.asset?.kind === "image" ? (
            <MediaNodeAssist
              node={node}
              asset={node.asset}
              selected={selected === true}
            />
          ) : null}
          <MediaNodeDetails node={node} />
        </>
      }
    >
      <MediaNodeBody node={node} />
    </NodeFrame>
  )
}
