"use client"

/**
 * Outputs at full size: one picture or clip filling the window, with zoom,
 * pan and the arrow keys walking whatever set it was opened from.
 *
 * It exists because a node or a card is a thumbnail, and judging a take means
 * seeing it at the size it was made. The viewer itself is
 * `yet-another-react-lightbox` — zoom, pan, swipe, keyboard and focus handling
 * are its job, not ours — and this file only turns assets into slides and adds
 * the two file actions the app already has: Open and Reveal in folder — plus
 * Crop, on an image, when the surface that opened it passes `onCrop`.
 *
 * Deliberately surface-agnostic: it takes assets, not nodes, so the canvas and
 * the Assets tab open the same viewer.
 *
 * ⛔ Read-only. Viewing an output changes nothing about it — not a canvas pick,
 * not a reference, and never a run. Crop only hands the asset back to the
 * caller, which opens its own dialog; a crop is a new asset, never an edit.
 */
import {
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import Lightbox, { IconButton, type Slide } from "yet-another-react-lightbox"
import Captions from "yet-another-react-lightbox/plugins/captions"
import Counter from "yet-another-react-lightbox/plugins/counter"
import Video from "yet-another-react-lightbox/plugins/video"
import Zoom from "yet-another-react-lightbox/plugins/zoom"
import "yet-another-react-lightbox/styles.css"
import "yet-another-react-lightbox/plugins/captions.css"
import "yet-another-react-lightbox/plugins/counter.css"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  CropIcon,
  Folder02Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons"
import type { AssetDto } from "@opendirect/contract"
import { toast } from "sonner"

import { useOpenAsset, useRevealAsset } from "@/hooks/use-assets"

// The lightbox types a button's label as one of its own label keys; these
// are the toolbar buttons this file adds.
declare module "yet-another-react-lightbox" {
  interface Labels {
    Open?: string
    "Reveal in folder"?: string
    Crop?: string
  }
}

/** What a surface knows about an output that the asset row does not. */
export interface MediaCaption {
  /** Top of the screen — usually the model, or the asset's own label. */
  title?: ReactNode
  /** The prompt the output was made from, when there is one. */
  prompt?: string | null
}

export interface MediaViewerProps {
  /** The set to walk. Assets with no file (text, prompts) are skipped. */
  assets: readonly AssetDto[]
  /** Which asset is shown first, as an index into `assets`. */
  index: number
  open: boolean
  onClose: () => void
  /** Extra caption per asset; the size and length are added either way. */
  caption?: (asset: AssetDto) => MediaCaption
  /**
   * Adds a Crop button while an image is on screen. The viewer does not crop;
   * it closes and hands the image back, so the caller opens its crop dialog
   * on top of the surface rather than under the lightbox.
   */
  onCrop?: (asset: AssetDto) => void
}

/** Images and clips with a file — the only things there is a full size of. */
export function isViewable(asset: AssetDto): boolean {
  return (asset.kind === "image" || asset.kind === "video") && !!asset.url
}

/** "1024 × 1024 · 5.0s", or null when the row records neither. */
export function mediaFacts(asset: AssetDto): string | null {
  const parts: string[] = []
  if (asset.width && asset.height)
    parts.push(`${asset.width} × ${asset.height}`)
  if (asset.durationMs) parts.push(`${(asset.durationMs / 1000).toFixed(1)}s`)
  return parts.length > 0 ? parts.join(" · ") : null
}

function fallbackTitle(asset: AssetDto): string {
  return asset.label ?? asset.originalName ?? asset.kind
}

/** One asset as a lightbox slide. Callers filter with `isViewable` first. */
export function assetSlide(asset: AssetDto, caption: MediaCaption = {}): Slide {
  const facts = mediaFacts(asset)
  const description =
    caption.prompt || facts ? (
      <>
        {caption.prompt ? <span>{caption.prompt}</span> : null}
        {caption.prompt && facts ? <br /> : null}
        {facts ? <span className="opacity-70">{facts}</span> : null}
      </>
    ) : undefined
  const common = {
    title: caption.title ?? fallbackTitle(asset),
    description,
    width: asset.width ?? undefined,
    height: asset.height ?? undefined,
  }

  if (asset.kind === "video") {
    return {
      ...common,
      type: "video",
      poster: asset.thumbnailUrl ?? undefined,
      sources: [{ src: asset.url!, type: asset.mimeType ?? "video/mp4" }],
    }
  }
  return { ...common, src: asset.url!, alt: fallbackTitle(asset) }
}

/** Hugeicons in the lightbox's own icon slot, so they size like its icons. */
function OpenIcon(props: { className?: string; style?: CSSProperties }) {
  return <HugeiconsIcon icon={LinkSquare02Icon} {...props} />
}

function RevealIcon(props: { className?: string; style?: CSSProperties }) {
  return <HugeiconsIcon icon={Folder02Icon} {...props} />
}

function CropButtonIcon(props: { className?: string; style?: CSSProperties }) {
  return <HugeiconsIcon icon={CropIcon} {...props} />
}

/**
 * Events from inside the lightbox stop here.
 *
 * The lightbox renders into a portal on `document.body`, but React still
 * bubbles its events through the component tree — so without this, an arrow
 * key that walks the viewer would also walk a canvas node's pick, and a click
 * on the backdrop would select the node the viewer was opened from.
 */
function stop(event: SyntheticEvent) {
  event.stopPropagation()
}

export function MediaViewer({
  assets,
  index,
  open,
  onClose,
  caption,
  onCrop,
}: MediaViewerProps) {
  const viewable = useMemo(() => assets.filter(isViewable), [assets])
  const slides = useMemo(
    () => viewable.map((asset) => assetSlide(asset, caption?.(asset))),
    [viewable, caption]
  )

  // `index` points into `assets`; the slides are the viewable subset of it.
  const requested = assets[index]
  const startId =
    (requested && isViewable(requested) ? requested.id : viewable[0]?.id) ??
    null
  /**
   * The output on screen, owned here rather than by the lightbox — by *id*.
   *
   * The lightbox jumps back to its `index` prop whenever its slides change,
   * and on a canvas they change on every job push. Feeding it the slide the
   * user is actually on keeps a refetch from yanking them back to the start;
   * remembering which asset that is, not which position, keeps a batch
   * sibling that lands *ahead* of it from swapping the picture under them.
   * Reset on each open, during render, so the first frame is the right one.
   */
  const [currentId, setCurrentId] = useState(startId)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setCurrentId(startId)
  }
  const found = viewable.findIndex((asset) => asset.id === currentId)
  // Gone from the set (deleted while open): back to the first.
  const shownIndex = found >= 0 ? found : 0
  const shown = viewable[shownIndex] ?? null

  const openFile = useOpenAsset()
  const reveal = useRevealAsset()
  const hasFile = Boolean(shown?.relPath)
  const onError = (error: Error) => toast.error(error.message)

  const fileButtons = hasFile
    ? [
        <IconButton
          key="open"
          label="Open"
          icon={OpenIcon}
          onClick={() => shown && openFile.mutate(shown.id, { onError })}
        />,
        <IconButton
          key="reveal"
          label="Reveal in folder"
          icon={RevealIcon}
          onClick={() => shown && reveal.mutate(shown.id, { onError })}
        />,
      ]
    : []

  const cropButtons =
    onCrop && shown?.kind === "image"
      ? [
          <IconButton
            key="crop"
            label="Crop"
            icon={CropButtonIcon}
            onClick={() => {
              onClose()
              onCrop(shown)
            }}
          />,
        ]
      : []

  const single = slides.length <= 1

  return (
    <div
      className="contents"
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onKeyDown={stop}
      onContextMenu={stop}
      onWheel={stop}
    >
      <Lightbox
        open={open && slides.length > 0}
        close={onClose}
        index={shownIndex}
        slides={slides}
        plugins={[Captions, Counter, Video, Zoom]}
        // `nokey`: React Flow listens for Backspace and the arrows on the
        // whole document, and must not delete or nudge a node behind this.
        className="nokey"
        labels={{ Lightbox: "Full-size viewer" }}
        carousel={{ finite: true, padding: "24px" }}
        controller={{ closeOnBackdropClick: true }}
        zoom={{ scrollToZoom: true, maxZoomPixelRatio: 2 }}
        video={{ controls: true, playsInline: true }}
        captions={{ descriptionTextAlign: "center", descriptionMaxLines: 4 }}
        counter={{ separator: "of" }}
        toolbar={{ buttons: [...cropButtons, ...fileButtons, "zoom", "close"] }}
        on={{
          view: ({ index: next }) => {
            const asset = viewable[next]
            if (asset) setCurrentId(asset.id)
          },
        }}
        render={
          single ? { buttonPrev: () => null, buttonNext: () => null } : {}
        }
      />
    </div>
  )
}
