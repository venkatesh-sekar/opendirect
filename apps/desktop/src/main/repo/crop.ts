/**
 * Cropping an image asset into a new one.
 *
 * Non-destructive by design: the source file and row are never touched. The
 * crop is encoded into `tmp/`, under the name the user will see
 * ("group selfie (crop).jpg"), and then handed to `importFiles` — so a crop
 * gets exactly what an import gets: a copy under `assets/`, a sha256, a
 * thumbnail, a link into the container, and deduplication (cropping the same
 * region twice links the first result instead of storing it again).
 *
 * The region arrives as fractions of the *displayed* picture, i.e. after EXIF
 * orientation. The renderer's `<img>` honours orientation, and so does the
 * pipeline here (`autoOrient()` before `extract()`), which bakes the rotation
 * into the pixels. Fractions rather than pixels mean main never has to trust
 * the renderer's idea of the image's size.
 *
 * Electron-free, like the rest of `repo/`.
 */
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import { extname, join } from "node:path"

import type { AssetDto } from "@opendirect/contract"
import sharp, { type Sharp } from "sharp"

import { realAssetPath } from "../project"
import { getAsset, importFiles, type AssetContext } from "./assets"
import type { Thumbnailer } from "./thumbnails"

/** A crop region as fractions (0–1) of the oriented image. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** A crop region in whole pixels — the shape `sharp().extract()` takes. */
export interface PixelRegion {
  left: number
  top: number
  width: number
  height: number
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/**
 * Maps a fractional rect onto a `width × height` image.
 *
 * Both edges are rounded (rather than rounding the size), so two crops that
 * share an edge in the UI share it in pixels too. The rect is clamped to the
 * image first; one that ends up under a pixel wide or high is refused.
 */
export function cropRegion(
  rect: CropRect,
  width: number,
  height: number
): PixelRegion {
  const x0 = clamp01(rect.x)
  const y0 = clamp01(rect.y)
  const x1 = clamp01(rect.x + rect.width)
  const y1 = clamp01(rect.y + rect.height)
  const left = Math.round(x0 * width)
  const top = Math.round(y0 * height)
  const right = Math.round(x1 * width)
  const bottom = Math.round(y1 * height)
  if (right - left < 1 || bottom - top < 1) {
    throw new Error("The crop is empty — select a larger area")
  }
  return { left, top, width: right - left, height: bottom - top }
}

interface OutputFormat {
  ext: string
  encode: (pipeline: Sharp) => Sharp
}

/**
 * Keeps the source's format where re-encoding is harmless and quality can be
 * held high; anything else (GIF, HEIC, TIFF, …) becomes a lossless PNG.
 */
export function outputFormatFor(mimeType: string | null): OutputFormat {
  switch (mimeType) {
    case "image/jpeg":
      return {
        ext: "jpg",
        // 4:4:4 keeps full colour resolution; a crop is often a face, where
        // chroma subsampling is the first thing to show.
        encode: (pipeline) =>
          pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }),
      }
    case "image/webp":
      return {
        ext: "webp",
        encode: (pipeline) => pipeline.webp({ quality: 95 }),
      }
    default:
      return { ext: "png", encode: (pipeline) => pipeline.png() }
  }
}

/** Characters no file system is happy to see in a name. */
const UNSAFE_NAME = /[\\/:*?"<>|]/g

/** "group selfie.JPG" + "jpg" → "group selfie (crop).jpg". */
export function cropFileName(base: string, ext: string): string {
  const stem = base.slice(0, base.length - extname(base).length) || base
  const safe =
    stem
      .replace(UNSAFE_NAME, "-")
      // Tabs, newlines and other whitespace a label may carry.
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "image"
  return `${safe} (crop).${ext}`
}

export interface CropAssetOptions {
  assetId: string
  rect: CropRect
  /** The container the crop is filed into; null files it nowhere. */
  containerId?: string | null
  now?: number
  /** Injected in tests; defaults to the sharp-backed image thumbnailer. */
  thumbnailer?: Thumbnailer
}

/** Crops `assetId` into a new asset and returns it. */
export async function cropAsset(
  ctx: AssetContext,
  options: CropAssetOptions
): Promise<AssetDto> {
  const { db, project } = ctx
  const source = getAsset(db, options.assetId)
  if (!source) throw new Error(`Asset ${options.assetId} was not found`)
  if (source.kind !== "image" || !source.relPath) {
    throw new Error("Only images can be cropped")
  }

  const sourcePath = await realAssetPath(project, source.relPath)
  const metadata = await sharp(sourcePath, { failOn: "none" }).metadata()
  const region = cropRegion(
    options.rect,
    metadata.autoOrient.width,
    metadata.autoOrient.height
  )

  const format = outputFormatFor(source.mimeType)
  const name = cropFileName(
    source.label ?? source.originalName ?? "image",
    format.ext
  )
  // A folder per crop, so the file can carry the user-facing name without
  // colliding with another crop in flight. `tmp/` is cleared on open anyway.
  const staging = join(project.path, "tmp", `crop-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    const staged = join(staging, name)
    await format
      .encode(
        sharp(sourcePath, { failOn: "none" })
          // Orientation first, so `extract` works in displayed coordinates and
          // the output needs no EXIF tag to be the right way up.
          .autoOrient()
          .extract(region)
          .keepIccProfile()
      )
      .toFile(staged)

    const result = await importFiles(ctx, {
      paths: [staged],
      containerId: options.containerId ?? null,
      now: options.now,
      thumbnailer: options.thumbnailer,
    })
    const [failure] = result.failures
    if (failure) throw new Error(failure.message)
    const [asset] = result.assets
    if (!asset) throw new Error("The crop could not be saved")
    return asset
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
