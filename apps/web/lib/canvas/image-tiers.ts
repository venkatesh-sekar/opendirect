/**
 * Which file an image on the canvas should show, given how big it is on screen.
 *
 * A node's picture is drawn inside React Flow's `scale(zoom)` viewport, so the
 * pixels it needs are its layout size × the zoom × the display's device pixel
 * ratio. Showing the 512px thumbnail at every zoom is what made a zoomed-in
 * canvas blurry; showing the original everywhere would decode a dozen 12 MP
 * photos for a zoomed-out overview. So each image has a ladder of sources —
 * thumbnail, the 1024/2048 tiers main resizes on request, and the original —
 * and the smallest one that covers the need is chosen.
 *
 * Pure, so the choice is unit-tested; `CanvasImage` does the measuring.
 */
import {
  ASSET_THUMBNAIL_EDGE,
  ASSET_TIER_EDGES,
  assetTierUrl,
  type AssetDto,
} from "@opendirect/contract"

export interface ImageSource {
  url: string
  /** Longest edge of this file in pixels; `Infinity` when unknown. */
  edge: number
}

/** Formats main can resize without damage (no gif animation, no svg). */
const RESIZABLE = /\.(png|jpe?g|webp|avif|tiff?)$/i

/** Quarter-octave zoom steps: at most a 19% overestimate, never an under. */
const ZOOM_STEPS_PER_OCTAVE = 4

/**
 * How far above the need the current source may be before it is swapped for
 * a smaller one. The gap between this and 1 is the hysteresis that stops a
 * zoom hovering at a boundary from flipping files back and forth.
 */
export const DOWNGRADE_RATIO = 3

type SourceFields = Pick<AssetDto, "url" | "thumbnailUrl" | "width" | "height">

/** Longest edge of the original, when the asset row knows its size. */
function longestEdge(asset: SourceFields): number | null {
  return asset.width && asset.height
    ? Math.max(asset.width, asset.height)
    : null
}

/**
 * Every file this image can be shown from, smallest first; the original last.
 *
 * A tier is offered only when it is smaller than the original, because main
 * would serve the original for it anyway and the extra rung would just be a
 * second download of the same bytes.
 */
export function imageSources(asset: SourceFields): ImageSource[] {
  if (!asset.url) return []
  const longest = longestEdge(asset)
  const smaller = (edge: number) => longest === null || longest > edge
  const sources: ImageSource[] = []

  if (asset.thumbnailUrl && smaller(ASSET_THUMBNAIL_EDGE)) {
    sources.push({ url: asset.thumbnailUrl, edge: ASSET_THUMBNAIL_EDGE })
  }
  const path = asset.url.split(/[?#]/)[0] ?? ""
  if (RESIZABLE.test(path)) {
    for (const edge of ASSET_TIER_EDGES) {
      if (smaller(edge))
        sources.push({ url: assetTierUrl(asset.url, edge), edge })
    }
  }
  sources.push({ url: asset.url, edge: longest ?? Infinity })
  return sources
}

export interface Size {
  width: number
  height: number
}

/**
 * The longest edge, in device pixels, the picture is drawn at.
 *
 * `object-cover` scales the image until it fills the box on both axes, so a
 * tall photo in a wide node is drawn wider than the node is tall; with the
 * intrinsic size known that is accounted for, otherwise the box stands in.
 */
export function requiredEdge({
  box,
  intrinsic,
  scale,
}: {
  /** The element's layout size in CSS pixels (untransformed). */
  box: Size
  /** The original's size, when known. */
  intrinsic: Size | null
  /** Viewport zoom × devicePixelRatio. */
  scale: number
}): number {
  if (box.width <= 0 || box.height <= 0 || scale <= 0) return 0
  let drawn = Math.max(box.width, box.height)
  if (intrinsic && intrinsic.width > 0 && intrinsic.height > 0) {
    const cover = Math.max(
      box.width / intrinsic.width,
      box.height / intrinsic.height
    )
    drawn = Math.max(intrinsic.width, intrinsic.height) * cover
  }
  return Math.ceil(drawn * scale)
}

/**
 * The source to show: the smallest that covers `required`, else the largest.
 *
 * `currentUrl` is what is on screen now. It is kept, rather than swapped for
 * something smaller, while it still covers the need and is no more than
 * `DOWNGRADE_RATIO` times too big — zooming out a little does not reload, but
 * zooming far out does release the big bitmap.
 */
export function chooseSource(
  sources: readonly ImageSource[],
  required: number,
  currentUrl: string | null = null
): ImageSource | null {
  if (sources.length === 0) return null
  const fit =
    sources.find((source) => source.edge >= required) ??
    sources[sources.length - 1]!
  const current = sources.find((source) => source.url === currentUrl)
  if (
    current &&
    current.edge > fit.edge &&
    current.edge <= Math.max(required, 1) * DOWNGRADE_RATIO
  ) {
    return current
  }
  return fit
}

/**
 * The viewport zoom, rounded *up* to a quarter octave.
 *
 * Images subscribe to this rather than to the raw zoom, so a wheel gesture
 * re-renders each one a handful of times instead of on every frame.
 */
export function quantizeZoom(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) return 1
  const steps = Math.ceil(Math.log2(zoom) * ZOOM_STEPS_PER_OCTAVE - 1e-9)
  return 2 ** (steps / ZOOM_STEPS_PER_OCTAVE)
}
