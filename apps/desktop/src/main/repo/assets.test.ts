import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { ASSET_TIER_EDGES } from "@opendirect/contract"

import { eq } from "drizzle-orm"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { canvasNodes, generationInputs, generations } from "../db/schema"
import { tierRelPath } from "../media-tier-paths"
import { createProject, openProject, type OpenProject } from "../project"
import {
  addToContainer,
  deleteAsset,
  getAsset,
  importFiles,
  listByContainer,
  moveToContainer,
  removeFromContainer,
  withoutReference,
} from "./assets"
import { createNode, getCanvas } from "./canvas"
import {
  createContainer,
  getContainer,
  setContainerPick,
  setContainerReferences,
} from "./containers"

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
    // The stored copy is named after the asset id, so the user's file name is
    // only recoverable if the import kept it.
    expect(asset!.originalName).toBe("lobby.png")
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

  it("leaves no partial file behind when a copy is interrupted", async () => {
    // Imports land in tmp/ and are renamed into place, so `assets/` never
    // contains a half-written file even if the app dies mid-copy.
    const source = await writePng(join(root, "atomic.png"))
    const { assets } = await importFiles(
      { db: opened.handle.db, project: opened.project },
      { paths: [source], containerId }
    )
    expect((await readdir(join(opened.project.path, "tmp"))).length).toBe(0)
    expect(assets[0]!.relPath).toMatch(/^assets\//)
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

describe("withoutReference", () => {
  it("takes one id out and falls back to automatic when none are left", () => {
    expect(withoutReference(["a", "b"], "a")).toEqual(["b"])
    expect(withoutReference(["a"], "a")).toBeNull()
    expect(withoutReference(["a"], "z")).toEqual(["a"])
    expect(withoutReference(null, "a")).toBeNull()
  })
})

/** A character with two images in its library, both chosen as references. */
async function characterWithReferences() {
  const db = opened.handle.db
  const character = createContainer(db, {
    projectId: opened.project.id,
    kind: "character",
    name: "Venkz",
  }).id
  const { assets } = await importFiles(
    { db, project: opened.project },
    {
      paths: [
        await writePng(join(root, "sheet.png"), 64),
        await writePng(join(root, "face.png"), 48),
      ],
      containerId: character,
    }
  )
  const [sheet, face] = assets.map((asset) => asset.id) as [string, string]
  setContainerReferences(db, character, [sheet, face])
  return { db, character, sheet, face, assets }
}

function seedRun(id: string, status: string, inputAssetId: string) {
  const db = opened.handle.db
  db.insert(generations)
    .values({
      id,
      projectId: opened.project.id,
      provider: "replicate",
      modelSlug: "google/nano-banana-pro",
      kind: "image",
      paramsJson: "{}",
      status,
      createdAt: 1,
    })
    .run()
  db.insert(generationInputs)
    .values({
      id: `${id}-input`,
      generationId: id,
      assetId: inputAssetId,
      slotField: "image_input",
    })
    .run()
}

describe("moveToContainer", () => {
  it("files the asset in the target and takes it out of the source", async () => {
    const { db, character, sheet, face } = await characterWithReferences()

    moveToContainer(db, {
      assetId: sheet,
      fromContainerId: character,
      toContainerId: containerId,
    })

    expect(
      listByContainer(db, { containerId: character }).items.map((a) => a.id)
    ).toEqual([face])
    expect(listByContainer(db, { containerId }).items.map((a) => a.id)).toEqual(
      [sheet]
    )
    // No longer in the character's library, so no longer one of its
    // references; the rest keep their order.
    expect(getContainer(db, character)!.referenceAssetIds).toEqual([face])
    // The target gets a library item, not a reference it did not ask for.
    expect(getContainer(db, containerId)!.referenceAssetIds).toBeNull()
    expect(getAsset(db, sheet)).toBeDefined()
  })

  it("keeps canvas nodes that show the asset working", async () => {
    const { db, character, sheet } = await characterWithReferences()
    const node = createNode(db, {
      projectId: opened.project.id,
      type: "media",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      assetId: sheet,
    })

    moveToContainer(db, {
      assetId: sheet,
      fromContainerId: character,
      toContainerId: containerId,
    })

    const kept = getCanvas(db, opened.project.id).nodes.find(
      (n) => n.id === node.id
    )
    expect(kept?.assetId).toBe(sheet)
  })

  it("un-picks a shot it leaves", async () => {
    const db = opened.handle.db
    const shot = createContainer(db, {
      projectId: opened.project.id,
      kind: "shot",
      name: "Shot 1",
      parentId: containerId,
    }).id
    const { assets } = await importFiles(
      { db, project: opened.project },
      { paths: [await writePng(join(root, "take.png"))], containerId: shot }
    )
    setContainerPick(db, shot, assets[0]!.id)

    moveToContainer(db, {
      assetId: assets[0]!.id,
      fromContainerId: shot,
      toContainerId: containerId,
    })

    expect(getContainer(db, shot)!.pickedAssetId).toBeNull()
  })

  it("is idempotent when the asset is already in the target", async () => {
    const { db, character, sheet } = await characterWithReferences()
    addToContainer(db, { containerId, assetId: sheet })

    moveToContainer(db, {
      assetId: sheet,
      fromContainerId: character,
      toContainerId: containerId,
    })

    expect(listByContainer(db, { containerId }).total).toBe(1)
    expect(listByContainer(db, { containerId: character }).total).toBe(1)
  })

  it("rolls back, leaving the asset where it was, when the target is unknown", async () => {
    const { db, character, sheet, face } = await characterWithReferences()

    expect(() =>
      moveToContainer(db, {
        assetId: sheet,
        fromContainerId: character,
        toContainerId: "nope",
      })
    ).toThrow(/not found/i)

    expect(listByContainer(db, { containerId: character }).total).toBe(2)
    expect(getContainer(db, character)!.referenceAssetIds).toEqual([
      sheet,
      face,
    ])
  })
})

describe("deleteAsset", () => {
  const exists = (relPath: string) =>
    readFile(join(opened.project.path, relPath)).then(
      () => true,
      () => false
    )

  it("removes the row, every link, its references and its files", async () => {
    const { db, character, sheet, face, assets } =
      await characterWithReferences()
    addToContainer(db, { containerId, assetId: sheet })
    const stored = assets.find((asset) => asset.id === sheet)!
    const kept = assets.find((asset) => asset.id === face)!

    await deleteAsset({ db, project: opened.project }, sheet)

    expect(getAsset(db, sheet)).toBeUndefined()
    // Gone from every container it was filed under, not just one.
    expect(listByContainer(db, { containerId }).total).toBe(0)
    expect(
      listByContainer(db, { containerId: character }).items.map((a) => a.id)
    ).toEqual([face])
    // No dangling id left to shift "Ref 2" into "Ref 1"'s place.
    expect(getContainer(db, character)!.referenceAssetIds).toEqual([face])

    expect(await exists(stored.relPath!)).toBe(false)
    expect(await exists(stored.thumbnailRelPath!)).toBe(false)
    expect(await exists(kept.relPath!)).toBe(true)
  })

  it("removes the cached 1024/2048 tiers too, and leaves another asset's", async () => {
    const { db, sheet, face, assets } = await characterWithReferences()
    const stored = assets.find((asset) => asset.id === sheet)!
    const kept = assets.find((asset) => asset.id === face)!
    const tiers = (relPath: string) =>
      ASSET_TIER_EDGES.map((edge) => tierRelPath(relPath, edge))
    // What the `asset://` protocol leaves behind once the canvas has zoomed.
    for (const relPath of [
      ...tiers(stored.relPath!),
      ...tiers(kept.relPath!),
    ]) {
      await mkdir(dirname(join(opened.project.path, relPath)), {
        recursive: true,
      })
      await writeFile(join(opened.project.path, relPath), "tier")
    }

    await deleteAsset({ db, project: opened.project }, sheet)

    for (const relPath of tiers(stored.relPath!))
      expect(await exists(relPath)).toBe(false)
    for (const relPath of tiers(kept.relPath!))
      expect(await exists(relPath)).toBe(true)
  })

  it("returns a character to automatic references when its last one goes", async () => {
    const { db, character, sheet, face } = await characterWithReferences()
    setContainerReferences(db, character, [sheet])

    await deleteAsset({ db, project: opened.project }, sheet)

    expect(getContainer(db, character)!.referenceAssetIds).toBeNull()
    expect(getAsset(db, face)).toBeDefined()
  })

  it("takes a media node with it and un-picks a generate node", async () => {
    const { db, sheet } = await characterWithReferences()
    const media = createNode(db, {
      projectId: opened.project.id,
      type: "media",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      assetId: sheet,
    })
    const gen = createNode(db, {
      projectId: opened.project.id,
      type: "image_gen",
      x: 200,
      y: 0,
      width: 100,
      height: 100,
      pickAssetId: sheet,
    })

    await deleteAsset({ db, project: opened.project }, sheet)

    const nodes = db.select().from(canvasNodes).all()
    expect(nodes.find((n) => n.id === media.id)).toBeUndefined()
    expect(nodes.find((n) => n.id === gen.id)?.pickAssetId).toBeNull()
  })

  it("keeps a finished run it was fed into, minus the input row", async () => {
    const { db, sheet } = await characterWithReferences()
    seedRun("g1", "succeeded", sheet)

    await deleteAsset({ db, project: opened.project }, sheet)

    expect(
      db.select().from(generations).where(eq(generations.id, "g1")).get()
    ).toBeDefined()
    expect(db.select().from(generationInputs).all()).toEqual([])
  })

  it("refuses while a run that takes it as an input has not finished", async () => {
    const { db, sheet, assets } = await characterWithReferences()
    seedRun("g2", "queued", sheet)

    await expect(
      deleteAsset({ db, project: opened.project }, sheet)
    ).rejects.toThrow(/not finished/)

    expect(getAsset(db, sheet)).toBeDefined()
    expect(
      await exists(assets.find((asset) => asset.id === sheet)!.relPath!)
    ).toBe(true)
  })

  it("rejects an unknown asset", async () => {
    await expect(
      deleteAsset({ db: opened.handle.db, project: opened.project }, "nope")
    ).rejects.toThrow(/not found/i)
  })
})
