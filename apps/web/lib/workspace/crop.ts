/**
 * The arithmetic behind the crop dialog, kept out of the component so it can
 * be asserted directly.
 *
 * The dialog works in `react-image-crop`'s percent crops (0–100 of the image
 * as displayed), which survive zooming for free: zoom only changes how large
 * the picture is drawn, never which part of it is selected. Main is sent the
 * same rect as fractions (0–1) and does the pixel work itself.
 */
import type { PercentCrop } from "react-image-crop"

export interface CropAspect {
  value: string
  label: string
  /** Width over height; null is free-form. */
  ratio: number | null
}

export const CROP_ASPECTS: readonly CropAspect[] = [
  { value: "free", label: "Free", ratio: null },
  { value: "1:1", label: "1:1", ratio: 1 },
  { value: "4:5", label: "4:5", ratio: 4 / 5 },
  { value: "3:4", label: "3:4", ratio: 3 / 4 },
  { value: "16:9", label: "16:9", ratio: 16 / 9 },
  { value: "9:16", label: "9:16", ratio: 9 / 16 },
]

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/**
 * The largest crop of `ratio` that fits in `fill` of the image, centred. A
 * free-form crop is simply `fill` of each side.
 */
export function centeredCrop(
  ratio: number | null,
  imageWidth: number,
  imageHeight: number,
  fill = 0.9
): PercentCrop {
  let width = fill * 100
  let height = fill * 100
  if (ratio !== null && imageWidth > 0 && imageHeight > 0) {
    const maxWidth = fill * imageWidth
    const maxHeight = fill * imageHeight
    const pixelWidth = Math.min(maxWidth, maxHeight * ratio)
    width = (pixelWidth / imageWidth) * 100
    height = (pixelWidth / ratio / imageHeight) * 100
  }
  return {
    unit: "%",
    x: (100 - width) / 2,
    y: (100 - height) / 2,
    width,
    height,
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/** A percent crop as the fractions `assets:crop` takes, clamped to 0–1. */
export function toCropRect(crop: PercentCrop) {
  const x = clamp(crop.x / 100, 0, 1)
  const y = clamp(crop.y / 100, 0, 1)
  return {
    x,
    y,
    width: clamp(crop.width / 100, 0, 1 - x),
    height: clamp(crop.height / 100, 0, 1 - y),
  }
}

/**
 * The size, in source pixels, the crop will be saved at — rounded edge by
 * edge, the way main rounds it.
 */
export function croppedSize(
  crop: PercentCrop,
  imageWidth: number,
  imageHeight: number
): { width: number; height: number } {
  const rect = toCropRect(crop)
  const edge = (fraction: number, size: number) => Math.round(fraction * size)
  return {
    width: edge(rect.x + rect.width, imageWidth) - edge(rect.x, imageWidth),
    height: edge(rect.y + rect.height, imageHeight) - edge(rect.y, imageHeight),
  }
}

/**
 * How wide the picture is drawn at zoom 1: as large as fits the viewport,
 * keeping its proportions.
 */
export function fitWidth(
  viewportWidth: number,
  viewportHeight: number,
  imageWidth: number,
  imageHeight: number
): number {
  if (imageWidth <= 0 || imageHeight <= 0) return viewportWidth
  return Math.max(
    1,
    Math.min(viewportWidth, viewportHeight * (imageWidth / imageHeight))
  )
}
