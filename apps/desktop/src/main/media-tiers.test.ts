import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { mediaUrl } from "./media"
import { resolveTieredMediaRequest, tierRelPath } from "./media-tiers"

/** A real, decodable image of the given size. */
async function writeImage(path: string, width: number, height: number) {
  await mkdir(join(path, ".."), { recursive: true })
  await sharp({
    create: { width, height, channels: 3, background: "#808080" },
  })
    .jpeg()
    .toFile(path)
}

describe("resolveTieredMediaRequest", () => {
  let projectPath: string

  beforeEach(async () => {
    projectPath = await realpath(
      await mkdtemp(join(tmpdir(), "opendirect-tiers-"))
    )
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  const big = "assets/2026/10/big.jpg"

  it("renders and caches a downscaled webp for a large image", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)

    const served = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(big)}?w=1024`
    )

    expect(served.path).toBe(join(projectPath, tierRelPath(big, 1024)))
    expect(served.contentType).toBe("image/webp")
    const meta = await sharp(served.path).metadata()
    expect(Math.max(meta.width, meta.height)).toBe(1024)

    // The second request reads the cache rather than resizing again.
    const again = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(big)}?w=1024`
    )
    expect(again.path).toBe(served.path)
  })

  it("serves the original when it is no larger than the tier", async () => {
    const small = "generations/2026/10/small.jpg"
    await writeImage(join(projectPath, small), 900, 600)

    const served = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(small)}?w=1024`
    )

    expect(served.path).toBe(join(projectPath, small))
    expect(served.contentType).toBe("image/jpeg")
  })

  it("serves the original for no tier, an unknown tier or a gif", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    const gif = "assets/2026/10/loop.gif"
    await writeFile(join(projectPath, gif), "GIF89a")

    for (const url of [
      mediaUrl(big),
      `${mediaUrl(big)}?w=777`,
      `${mediaUrl(gif)}?w=1024`,
    ]) {
      const served = await resolveTieredMediaRequest({ path: projectPath }, url)
      expect(served.path).not.toContain("thumbnails")
    }
  })

  it("falls back to the original when the file cannot be decoded", async () => {
    const broken = "assets/2026/10/broken.png"
    await mkdir(join(projectPath, "assets/2026/10"), { recursive: true })
    await writeFile(join(projectPath, broken), "not a png")

    const served = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(broken)}?w=2048`
    )
    expect(served.path).toBe(join(projectPath, broken))
  })

  it("re-renders a tier whose source has been replaced", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    const url = `${mediaUrl(big)}?w=1024`
    const first = await resolveTieredMediaRequest({ path: projectPath }, url)
    // Make the cached tier look older than the source.
    const past = new Date(Date.now() - 60_000)
    await utimes(first.path, past, past)
    await writeImage(join(projectPath, big), 2000, 3000)

    const second = await resolveTieredMediaRequest({ path: projectPath }, url)
    const meta = await sharp(second.path).metadata()
    expect(meta.height).toBe(1024)
    expect(meta.width).toBeLessThan(1024)
  })

  it("still refuses a path outside the media folders", async () => {
    await expect(
      resolveTieredMediaRequest(
        { path: projectPath },
        "asset://media/opendirect.db?w=1024"
      )
    ).rejects.toThrow()
  })
})

describe("tierRelPath", () => {
  it("keeps the source's place under thumbnails/w<edge>/ as webp", () => {
    expect(tierRelPath("assets/2026/10/a.b.PNG", 2048)).toBe(
      "thumbnails/w2048/assets/2026/10/a.b.webp"
    )
  })
})
