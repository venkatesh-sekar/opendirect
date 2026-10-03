import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createPreview } from "./thumbnails"

describe("createPreview", () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), "opendirect-thumbs-"))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it("applies a phone photo's EXIF rotation to the preview and its size", async () => {
    // Stored landscape, tagged "rotate 90° to view" — how phones save portraits.
    const sourcePath = join(projectPath, "portrait.jpg")
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#808080" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toFile(sourcePath)

    const preview = await createPreview({
      sourcePath,
      kind: "image",
      assetId: "a1",
      projectPath,
    })

    expect(preview).toMatchObject({ width: 800, height: 1200 })
    const thumb = await sharp(join(projectPath, preview.relPath!)).metadata()
    expect(thumb.height).toBe(512)
    expect(thumb.width).toBeLessThan(512)
  })
})
