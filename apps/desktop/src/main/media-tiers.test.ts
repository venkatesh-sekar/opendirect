import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { mediaUrl } from "./media"
import { tierRelPath } from "./media-tier-paths"
import { resolveTieredMediaRequest } from "./media-tiers"

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

describe("resolveTieredMediaRequest containment", () => {
  let base: string
  let projectPath: string

  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "opendirect-tiers-")))
    // Nested, so a path that climbs out of the project still lands in `base`
    // and is cleaned up with it.
    projectPath = join(base, "a", "b", "proj")
    await mkdir(projectPath, { recursive: true })
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  const big = "assets/2026/10/big.jpg"

  /** Every file under `dir`, as absolute paths. */
  async function filesUnder(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
  }

  it("never writes a tier outside thumbnails/ for a ..%2F path", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    // Each climbs out of `assets/` and back down to the same file, so the
    // original resolves inside the project. The tier is three folders deeper,
    // so the same climb would land it outside `thumbnails/` (3) or outside
    // the project altogether (4) — both still inside `base`.
    const climbs = {
      3: ["b", "proj"],
      4: ["a", "b", "proj"],
    }
    for (const [count, down] of Object.entries(climbs)) {
      const climb = Array.from({ length: Number(count) }, () => "..")
      const sneaky = ["assets", ...climb, ...down, ...big.split("/")].join(
        "%2F"
      )
      const served = await resolveTieredMediaRequest(
        { path: projectPath },
        `asset://media/${sneaky}?w=1024`
      )
      expect(served.path).toBe(join(projectPath, big))
    }

    expect(
      (await filesUnder(base)).filter((path) => path.endsWith(".webp"))
    ).toEqual([])
  })

  it("serves the original for any path that is not already normal", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    for (const url of [
      "asset://media/assets/2026/10/.%2Fbig.jpg?w=1024",
      "asset://media/assets/2026/10/x%2F..%2Fbig.jpg?w=1024",
      "asset://media/assets/2026%2F%2F10/big.jpg?w=1024",
    ]) {
      const served = await resolveTieredMediaRequest({ path: projectPath }, url)
      expect(served.path).toBe(join(projectPath, big))
    }
    expect(
      (await filesUnder(base)).filter((path) => path.endsWith(".webp"))
    ).toEqual([])
  })

  it("writes nothing through a symlinked thumbnails/w1024 folder", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    const outside = join(base, "outside")
    await mkdir(outside)
    await mkdir(join(projectPath, "thumbnails"))
    await symlink(outside, join(projectPath, "thumbnails", "w1024"), "dir")

    const served = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(big)}?w=1024`
    )

    expect(served.path).toBe(join(projectPath, big))
    expect(await filesUnder(outside)).toEqual([])
  })

  it("writes nothing through a symlinked thumbnails folder", async () => {
    await writeImage(join(projectPath, big), 3000, 2000)
    const outside = join(base, "outside")
    await mkdir(outside)
    await symlink(outside, join(projectPath, "thumbnails"), "dir")

    const served = await resolveTieredMediaRequest(
      { path: projectPath },
      `${mediaUrl(big)}?w=2048`
    )

    expect(served.path).toBe(join(projectPath, big))
    expect(await filesUnder(outside)).toEqual([])
  })
})

describe("tierRelPath", () => {
  it("keeps the source's place under thumbnails/w<edge>/ as webp", () => {
    expect(tierRelPath("assets/2026/10/a.b.PNG", 2048)).toBe(
      "thumbnails/w2048/assets/2026/10/a.b.webp"
    )
  })

  it("refuses to name a tier for a path that could climb out of thumbnails/", () => {
    for (const relPath of [
      "assets/../../x.jpg",
      "/etc/x.jpg",
      "assets/./x.jpg",
      "assets//x.jpg",
      "assets\\..\\x.jpg",
    ])
      expect(() => tierRelPath(relPath, 1024)).toThrow()
  })
})
