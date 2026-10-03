import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createProject, openProject, type OpenProject } from "../project"
import { importFiles, listByContainer } from "./assets"
import { createContainer } from "./containers"
import { cropAsset, cropFileName, cropRegion, outputFormatFor } from "./crop"

let root: string
let opened: OpenProject
let containerId: string

const RED = { r: 255, g: 0, b: 0 }
const BLUE = { r: 0, g: 0, b: 255 }

/** A `width × height` picture: left half red, right half blue. */
async function halves(width: number, height: number) {
  const half = await sharp({
    create: { width: width / 2, height, channels: 3, background: BLUE },
  })
    .png()
    .toBuffer()
  return sharp({ create: { width, height, channels: 3, background: RED } })
    .composite([{ input: half, left: width / 2, top: 0 }])
    .png()
    .toBuffer()
}

async function importOne(name: string, bytes: Buffer) {
  const path = join(root, name)
  await writeFile(path, bytes)
  const result = await importFiles(
    { db: opened.handle.db, project: opened.project },
    { paths: [path], containerId }
  )
  return result.assets[0]!
}

async function pixel(relPath: string, x: number, y: number) {
  const { data, info } = await sharp(join(opened.project.path, relPath))
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! }
}

const ctx = () => ({ db: opened.handle.db, project: opened.project })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-crop-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  containerId = createContainer(opened.handle.db, {
    projectId: project.id,
    kind: "character",
    name: "venkz",
  }).id
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

describe("cropRegion", () => {
  it("maps fractions onto whole pixels", () => {
    expect(
      cropRegion({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 400, 200)
    ).toEqual({ left: 100, top: 100, width: 200, height: 50 })
  })

  it("rounds edges, so neighbouring crops share a pixel boundary", () => {
    const left = cropRegion({ x: 0, y: 0, width: 1 / 3, height: 1 }, 100, 10)
    const right = cropRegion(
      { x: 1 / 3, y: 0, width: 2 / 3, height: 1 },
      100,
      10
    )
    expect(left.left + left.width).toBe(right.left)
    expect(right.left + right.width).toBe(100)
  })

  it("clamps a rect that spills past the image", () => {
    expect(
      cropRegion({ x: -0.1, y: 0.9, width: 0.5, height: 0.5 }, 100, 100)
    ).toEqual({ left: 0, top: 90, width: 40, height: 10 })
  })

  it("refuses a crop under one pixel", () => {
    expect(() =>
      cropRegion({ x: 0.5, y: 0.5, width: 0.001, height: 0.5 }, 100, 100)
    ).toThrow(/empty/)
    expect(() =>
      cropRegion({ x: Number.NaN, y: 0, width: Number.NaN, height: 1 }, 10, 10)
    ).toThrow(/empty/)
  })
})

describe("cropFileName / outputFormatFor", () => {
  it("names the crop after the source", () => {
    expect(cropFileName("group selfie.JPG", "jpg")).toBe(
      "group selfie (crop).jpg"
    )
    expect(cropFileName("Character Sheet", "png")).toBe(
      "Character Sheet (crop).png"
    )
    expect(cropFileName("a/b:c.png", "png")).toBe("a-b-c (crop).png")
    expect(cropFileName(".png", "png")).toBe(".png (crop).png")
  })

  it("keeps JPEG and WebP, and turns everything else into PNG", () => {
    expect(outputFormatFor("image/jpeg").ext).toBe("jpg")
    expect(outputFormatFor("image/webp").ext).toBe("webp")
    expect(outputFormatFor("image/png").ext).toBe("png")
    expect(outputFormatFor("image/heic").ext).toBe("png")
    expect(outputFormatFor(null).ext).toBe("png")
  })
})

describe("cropAsset", () => {
  it("saves the crop as a new asset in the container and leaves the source alone", async () => {
    const source = await importOne("selfie.png", await halves(80, 40))

    const crop = await cropAsset(ctx(), {
      assetId: source.id,
      rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
      containerId,
    })

    expect(crop.id).not.toBe(source.id)
    expect(crop.kind).toBe("image")
    expect(crop.originalName).toBe("selfie (crop).png")
    expect(crop.mimeType).toBe("image/png")
    expect([crop.width, crop.height]).toEqual([40, 40])
    expect(crop.thumbnailUrl).not.toBeNull()
    expect(await pixel(crop.relPath!, 20, 20)).toEqual(BLUE)

    const page = listByContainer(opened.handle.db, { containerId })
    expect(page.items.map((asset) => asset.id)).toEqual([source.id, crop.id])
    expect(await pixel(source.relPath!, 10, 10)).toEqual(RED)

    // The staging folder is gone.
    expect(await readdir(join(opened.project.path, "tmp"))).toEqual([])
  })

  it("crops in displayed coordinates, honouring EXIF orientation", async () => {
    // Stored 80×40 (red left, blue right) but tagged "rotate 90° clockwise",
    // so it displays 40×80 with red on top.
    const jpeg = await sharp(await halves(80, 40))
      .jpeg({ quality: 100 })
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const source = await importOne("phone.jpg", jpeg)

    const crop = await cropAsset(ctx(), {
      assetId: source.id,
      rect: { x: 0, y: 0, width: 1, height: 0.5 },
      containerId,
    })

    expect(crop.originalName).toBe("phone (crop).jpg")
    expect(crop.mimeType).toBe("image/jpeg")
    expect([crop.width, crop.height]).toEqual([40, 40])
    const meta = await sharp(
      join(opened.project.path, crop.relPath!)
    ).metadata()
    // Orientation is baked into the pixels, not left in a tag.
    expect(meta.orientation ?? 1).toBe(1)
    const centre = await pixel(crop.relPath!, 20, 20)
    expect(centre.r).toBeGreaterThan(200)
    expect(centre.b).toBeLessThan(50)
  })

  it("links the earlier result when the same region is cropped twice", async () => {
    const source = await importOne("selfie.png", await halves(80, 40))
    const rect = { x: 0, y: 0, width: 0.5, height: 0.5 }

    const first = await cropAsset(ctx(), {
      assetId: source.id,
      rect,
      containerId,
    })
    const second = await cropAsset(ctx(), {
      assetId: source.id,
      rect,
      containerId,
    })

    expect(second.id).toBe(first.id)
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(2)
  })

  it("refuses an asset that is not an image", async () => {
    const source = await importOne("notes.txt", Buffer.from("hello"))
    await expect(
      cropAsset(ctx(), {
        assetId: source.id,
        rect: { x: 0, y: 0, width: 1, height: 1 },
      })
    ).rejects.toThrow(/Only images/)
    await expect(
      cropAsset(ctx(), {
        assetId: "missing",
        rect: { x: 0, y: 0, width: 1, height: 1 },
      })
    ).rejects.toThrow(/not found/)
  })
})
