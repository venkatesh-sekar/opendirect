import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createProject, openProject, type OpenProject } from "../project"
import {
  addToContainer,
  importFiles,
  listByContainer,
  removeFromContainer,
} from "./assets"
import { createContainer } from "./containers"

let root: string
let opened: OpenProject
let containerId: string

async function writePng(path: string, size = 64): Promise<string> {
  const png = await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 200, g: 40, b: 90 },
    },
  })
    .png()
    .toBuffer()
  await writeFile(path, png)
  return path
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-assets-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
  containerId = createContainer(opened.handle.db, {
    projectId: project.id,
    kind: "scene",
    name: "Lobby",
  }).id
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

describe("importFiles", () => {
  it("copies a file into the project, hashes it and links it to the container", async () => {
    const source = await writePng(join(root, "lobby.png"))

    const result = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )

    expect(result.imported).toBe(1)
    expect(result.deduped).toBe(0)
    expect(result.failures).toEqual([])

    const [asset] = result.assets
    expect(asset!.kind).toBe("image")
    expect(asset!.mimeType).toBe("image/png")
    expect(asset!.relPath).toMatch(/^assets\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/)
    expect(asset!.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(asset!.bytes).toBeGreaterThan(0)
    expect(asset!.width).toBe(64)
    expect(asset!.height).toBe(64)

    // The bytes really are in the project folder, byte-for-byte.
    const copied = await readFile(join(opened.project.path, asset!.relPath!))
    expect(copied.equals(await readFile(source))).toBe(true)

    const page = listByContainer(opened.handle.db, { containerId })
    expect(page.items.map((item) => item.id)).toEqual([asset!.id])
  })

  it("generates an image thumbnail inside the project", async () => {
    const source = await writePng(join(root, "big.png"), 1200)
    const { assets } = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )

    const relPath = assets[0]!.thumbnailRelPath
    expect(relPath).toMatch(/^thumbnails\/[0-9a-f-]+\.webp$/)
    const meta = await sharp(join(opened.project.path, relPath!)).metadata()
    expect(meta.format).toBe("webp")
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(512)
  })

  it("dedupes identical content by sha256 within the project", async () => {
    const a = await writePng(join(root, "a.png"))
    const b = join(root, "copy-of-a.png")
    await writeFile(b, await readFile(a))

    const first = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [a], containerId }
    )
    const second = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [b], containerId }
    )

    expect(second.imported).toBe(0)
    expect(second.deduped).toBe(1)
    expect(second.assets[0]!.id).toBe(first.assets[0]!.id)
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(1)
  })

  it("links a deduplicated asset into a second container instead of copying it", async () => {
    const source = await writePng(join(root, "shared.png"))
    const other = createContainer(opened.handle.db, {
      projectId: opened.project.id,
      kind: "character",
      name: "Bellhop",
    }).id

    const first = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )
    await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId: other }
    )

    expect(
      listByContainer(opened.handle.db, { containerId: other }).total
    ).toBe(1)
    expect(
      listByContainer(opened.handle.db, { containerId: other }).items[0]!.id
    ).toBe(first.assets[0]!.id)
  })

  it("records a video with no thumbnail rather than failing", async () => {
    const source = join(root, "clip.mp4")
    await writeFile(source, Buffer.from("not really an mp4"))

    const { assets, imported } = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )

    expect(imported).toBe(1)
    expect(assets[0]!.kind).toBe("video")
    expect(assets[0]!.mimeType).toBe("video/mp4")
    // No ffmpeg ships with the app; the renderer uses a <video> poster instead.
    expect(assets[0]!.thumbnailRelPath).toBeNull()
  })

  it("reports an unreadable file without failing the rest of the import", async () => {
    const good = await writePng(join(root, "good.png"))
    const missing = join(root, "missing.png")

    const result = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [missing, good], containerId }
    )

    expect(result.imported).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.path).toBe(missing)
  })

  it("imports without a container when none is given", async () => {
    const source = await writePng(join(root, "loose.png"))
    const { assets } = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source] }
    )
    expect(assets).toHaveLength(1)
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(0)
  })
})

describe("addToContainer / removeFromContainer", () => {
  it("lets one asset live in several containers and unlinks without deleting", async () => {
    const source = await writePng(join(root, "one.png"))
    const { assets } = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )
    const assetId = assets[0]!.id
    const other = createContainer(opened.handle.db, {
      projectId: opened.project.id,
      kind: "folder",
      name: "Favourites",
    }).id

    addToContainer(opened.handle.db, { containerId: other, assetId })
    // Adding twice is a no-op, not a primary-key error.
    addToContainer(opened.handle.db, { containerId: other, assetId })
    expect(
      listByContainer(opened.handle.db, { containerId: other }).total
    ).toBe(1)

    removeFromContainer(opened.handle.db, { containerId: other, assetId })
    expect(
      listByContainer(opened.handle.db, { containerId: other }).total
    ).toBe(0)
    // Unlinking is not deleting: the asset is still in its first container.
    expect(listByContainer(opened.handle.db, { containerId }).total).toBe(1)
  })

  it("rejects an unknown container or asset", async () => {
    expect(() =>
      addToContainer(opened.handle.db, {
        containerId: "nope",
        assetId: "nope",
      })
    ).toThrow(/not found/i)
  })
})

describe("listByContainer", () => {
  it("paginates, newest link first, and reports the total", async () => {
    const paths: string[] = []
    for (let index = 0; index < 5; index += 1) {
      paths.push(await writePng(join(root, `p${index}.png`), 8 + index))
    }
    await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths, containerId }
    )

    const first = listByContainer(opened.handle.db, {
      containerId,
      limit: 2,
    })
    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.nextOffset).toBe(2)

    const last = listByContainer(opened.handle.db, {
      containerId,
      limit: 2,
      offset: 4,
    })
    expect(last.items).toHaveLength(1)
    expect(last.nextOffset).toBeNull()
  })
})
