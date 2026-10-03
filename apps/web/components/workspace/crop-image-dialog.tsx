"use client"

/**
 * Crop an image into a new asset — e.g. one face out of a group selfie, to use
 * as a character reference.
 *
 * The selection is `react-image-crop` (free-form or a fixed aspect, with drag
 * handles and keyboard nudging). Zoom is ours and deliberately dumb: the
 * picture is drawn larger inside a scrolling viewport. The crop is kept in
 * percent, so zooming never moves the selection.
 *
 * Nothing is cut here. The dialog sends the rect to `assets:crop`, and main
 * does the pixel work with sharp from the original file — full resolution,
 * EXIF orientation applied — and files the result as a new asset. The source
 * is never modified.
 */
import { useRef, useState, type SyntheticEvent } from "react"
import ReactCrop, { type PercentCrop } from "react-image-crop"
import "react-image-crop/dist/ReactCrop.css"
import { toast } from "sonner"
import type { AssetDto } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"

import { useCropAsset } from "@/hooks/use-assets"
import {
  CROP_ASPECTS,
  MAX_ZOOM,
  MIN_ZOOM,
  centeredCrop,
  croppedSize,
  fitWidth,
  toCropRect,
} from "@/lib/workspace/crop"

import { assetLabel } from "@/components/canvas/nodes/asset-tile"

export interface CropImageDialogProps {
  /** The image being cropped; null keeps the dialog closed. */
  asset: AssetDto | null
  /** Where the crop is filed. */
  containerId: string | null
  /** Said in the description and the toast, e.g. "venkz". */
  containerName?: string
  onClose: () => void
  /** Called with the new asset once it is saved. */
  onCropped?: (asset: AssetDto) => void
}

export function CropImageDialog({
  asset,
  containerId,
  containerName,
  onClose,
  onCropped,
}: CropImageDialogProps) {
  return (
    <Dialog open={!!asset} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        {asset ? (
          // Keyed, so opening another image starts from a fresh selection.
          <CropEditor
            key={asset.id}
            asset={asset}
            containerId={containerId}
            containerName={containerName}
            onClose={onClose}
            onCropped={onCropped}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

interface Size {
  width: number
  height: number
}

function CropEditor({
  asset,
  containerId,
  containerName,
  onClose,
  onCropped,
}: CropImageDialogProps & { asset: AssetDto }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<Size | null>(null)
  const [fit, setFit] = useState<number | null>(null)
  const [aspect, setAspect] = useState(CROP_ASPECTS[0]!.value)
  const [crop, setCrop] = useState<PercentCrop>()
  const [zoom, setZoom] = useState(MIN_ZOOM)
  const save = useCropAsset()

  const ratio = CROP_ASPECTS.find((a) => a.value === aspect)?.ratio ?? null
  const label = assetLabel(asset)
  const size =
    crop && natural ? croppedSize(crop, natural.width, natural.height) : null

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    // Chromium reports the *oriented* size, matching how the image is drawn
    // and how main reads it.
    const { naturalWidth: width, naturalHeight: height } = event.currentTarget
    setNatural({ width, height })
    const box = viewport.current
    if (box) {
      setFit(fitWidth(box.clientWidth, box.clientHeight, width, height))
    }
    setCrop(centeredCrop(ratio, width, height))
  }

  const chooseAspect = (value: string) => {
    setAspect(value)
    if (!natural) return
    const next = CROP_ASPECTS.find((a) => a.value === value)?.ratio ?? null
    setCrop(centeredCrop(next, natural.width, natural.height))
  }

  const changeZoom = (value: number) => {
    setZoom(value)
    // Keep the selection in the middle of the viewport as the picture grows.
    const box = viewport.current
    if (!box || !crop || !fit || !natural) return
    const width = fit * value
    const height = width * (natural.height / natural.width)
    requestAnimationFrame(() => {
      box.scrollLeft =
        ((crop.x + crop.width / 2) / 100) * width - box.clientWidth / 2
      box.scrollTop =
        ((crop.y + crop.height / 2) / 100) * height - box.clientHeight / 2
    })
  }

  const submit = () => {
    if (!crop) return
    save.mutate(
      { assetId: asset.id, containerId, rect: toCropRect(crop) },
      {
        onSuccess: (created) => {
          toast.success(
            containerName
              ? `Saved ${assetLabel(created)} to ${containerName}`
              : `Saved ${assetLabel(created)}`
          )
          onCropped?.(created)
          onClose()
        },
        onError: (error) => toast.error(error.message),
      }
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Crop {label}</DialogTitle>
        <DialogDescription>
          Saved as a new image
          {containerName ? ` in ${containerName}` : ""} — the original is kept.
        </DialogDescription>
      </DialogHeader>

      <div
        role="radiogroup"
        aria-label="Aspect ratio"
        className="flex flex-wrap gap-2"
      >
        {CROP_ASPECTS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            role="radio"
            aria-checked={aspect === option.value}
            className={cn(
              "h-7 rounded-full px-3 text-xs",
              aspect === option.value
                ? "border-foreground/30 text-foreground"
                : "text-muted-foreground"
            )}
            onClick={() => chooseAspect(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div
        ref={viewport}
        className="flex h-[60svh] overflow-auto rounded-lg bg-muted/50"
      >
        {asset.url ? (
          <ReactCrop
            crop={crop}
            aspect={ratio ?? undefined}
            keepSelection
            ruleOfThirds
            minWidth={8}
            minHeight={8}
            className="m-auto shrink-0"
            style={{ maxWidth: "none" }}
            onChange={(_pixels, percent) => setCrop(percent)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local asset:// file; next/image cannot load it */}
            <img
              src={asset.url}
              alt={label}
              draggable={false}
              onLoad={onLoad}
              style={
                fit
                  ? { width: fit * zoom, maxWidth: "none", maxHeight: "none" }
                  : { maxHeight: "60svh" }
              }
            />
          </ReactCrop>
        ) : null}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <Slider
            aria-label="Zoom"
            className="w-36"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.1}
            value={[zoom]}
            onValueChange={(value) =>
              changeZoom(Array.isArray(value) ? value[0]! : (value as number))
            }
          />
          {size ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {size.width} × {size.height} px
            </span>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              !size || size.width < 1 || size.height < 1 || save.isPending
            }
            onClick={submit}
          >
            {save.isPending ? "Saving…" : "Save as new image"}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
