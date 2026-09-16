import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseHandle } from "../db/client"
import { resolveMigrationsFolder, runMigrations } from "../db/migrate"
import { assets, containerAssets, projects } from "../db/schema"
import { createContainer, setContainerDescription } from "./containers"
import { listMentionSubjects, rankReferenceImages } from "./mentions"

const NOW = 1_763_000_000_000
const PROJECT_ID = "p1"

let handle: DatabaseHandle

beforeEach(() => {
  handle = createDatabase(":memory:")
  runMigrations(handle, resolveMigrationsFolder(__dirname))
  handle.db
    .insert(projects)
    .values({
      id: PROJECT_ID,
      name: "Infinite Hotel",
      path: "/tmp/p1",
      createdAt: NOW,
    })
    .run()
})

afterEach(() => handle.close())

function container(
  kind: "character" | "scene" | "folder" | "project",
  name: string
) {
  return createContainer(handle.db, {
    projectId: PROJECT_ID,
    kind,
    name,
    now: NOW,
  })
}

interface AssetSeed {
  id: string
  kind?: "image" | "video"
  label?: string | null
  pinned?: boolean
  createdAt?: number
  /** Omitted on purpose by the test that checks the fallback to the file. */
  thumbnailRelPath?: string | null
}

function asset(containerId: string | null, seed: AssetSeed) {
  handle.db
    .insert(assets)
    .values({
      id: seed.id,
      projectId: PROJECT_ID,
      kind: seed.kind ?? "image",
      relPath: `assets/2026/09/${seed.id}.png`,
      label: seed.label ?? null,
      thumbnailRelPath:
        seed.thumbnailRelPath === undefined
          ? `thumbnails/${seed.id}.webp`
          : seed.thumbnailRelPath,
      pinned: seed.pinned ?? false,
      createdAt: seed.createdAt ?? NOW,
    })
    .run()
  if (containerId) {
    handle.db
      .insert(containerAssets)
      .values({ containerId, assetId: seed.id, position: 0 })
      .run()
  }
}

describe("rankReferenceImages", () => {
  const base = { label: null, pinned: false, createdAt: NOW }

  it("puts a pinned asset first, whatever its label or age", () => {
    const ranked = rankReferenceImages([
      { ...base, id: "a", label: "Character Sheet", createdAt: NOW - 100 },
      { ...base, id: "b", pinned: true, createdAt: NOW + 500 },
    ])
    expect(ranked.map((row) => row.id)).toEqual(["b", "a"])
  })

  it("then prefers a sheet-shaped label", () => {
    const ranked = rankReferenceImages([
      { ...base, id: "plain", createdAt: NOW - 500 },
      { ...base, id: "turnaround", label: "Turnaround" },
      { ...base, id: "sheet", label: "character sheet v3" },
      { ...base, id: "model", label: "Model Sheet" },
      { ...base, id: "ref", label: "Reference" },
    ])
    expect(ranked[0]!.id).toBe("turnaround")
    expect(ranked.at(-1)!.id).toBe("plain")
  })

  it("then the oldest first — the first import is usually the canonical one", () => {
    const ranked = rankReferenceImages([
      { ...base, id: "new", createdAt: NOW + 10 },
      { ...base, id: "old", createdAt: NOW - 10 },
    ])
    expect(ranked.map((row) => row.id)).toEqual(["old", "new"])
  })

  it("is stable for two assets of the same age", () => {
    const ranked = rankReferenceImages([
      { ...base, id: "b" },
      { ...base, id: "a" },
    ])
    expect(ranked.map((row) => row.id)).toEqual(["b", "a"])
  })

  it("never mutates its argument", () => {
    const input = [
      { ...base, id: "a", createdAt: NOW + 10 },
      { ...base, id: "b", pinned: true },
    ]
    rankReferenceImages(input)
    expect(input.map((row) => row.id)).toEqual(["a", "b"])
  })
})

describe("listMentionSubjects", () => {
  it("returns a character with its ranked images", () => {
    const venkz = container("character", "Venkz")
    setContainerDescription(handle.db, venkz.id, "a tall man in a grey suit")
    asset(venkz.id, { id: "a1", createdAt: NOW + 10 })
    asset(venkz.id, { id: "a2", label: "Character Sheet" })

    expect(listMentionSubjects(handle.db, PROJECT_ID)).toEqual([
      {
        containerId: venkz.id,
        kind: "character",
        handle: "venkz",
        name: "Venkz",
        description: "a tall man in a grey suit",
        images: [
          {
            assetId: "a2",
            label: "Character Sheet",
            thumbnailUrl: "asset://media/thumbnails/a2.webp",
          },
          {
            assetId: "a1",
            label: null,
            thumbnailUrl: "asset://media/thumbnails/a1.webp",
          },
        ],
      },
    ])
  })

  it("excludes folders and the project board", () => {
    container("folder", "Characters")
    container("project", "Board")
    container("scene", "Hotel Lobby")
    expect(
      listMentionSubjects(handle.db, PROJECT_ID).map((s) => s.handle)
    ).toEqual(["hotel-lobby"])
  })

  it("excludes a character whose name left it without a handle", () => {
    expect(container("character", "北京").handle).toBeNull()
    expect(listMentionSubjects(handle.db, PROJECT_ID)).toEqual([])
  })

  it("includes a character with no images at all", () => {
    container("character", "Venkz")
    expect(listMentionSubjects(handle.db, PROJECT_ID)[0]!.images).toEqual([])
  })

  it("excludes assets that are not images", () => {
    const venkz = container("character", "Venkz")
    asset(venkz.id, { id: "v1", kind: "video" })
    asset(venkz.id, { id: "i1" })
    expect(listMentionSubjects(handle.db, PROJECT_ID)[0]!.images).toEqual([
      {
        assetId: "i1",
        label: null,
        thumbnailUrl: "asset://media/thumbnails/i1.webp",
      },
    ])
  })

  it("falls back to the image itself when it has no generated preview", () => {
    const venkz = container("character", "Venkz")
    asset(venkz.id, { id: "i1", thumbnailRelPath: null })
    expect(listMentionSubjects(handle.db, PROJECT_ID)[0]!.images).toEqual([
      {
        assetId: "i1",
        label: null,
        thumbnailUrl: "asset://media/assets/2026/09/i1.png",
      },
    ])
  })

  it("only sees this project's containers", () => {
    handle.db
      .insert(projects)
      .values({ id: "p2", name: "Other", path: "/tmp/p2", createdAt: NOW })
      .run()
    createContainer(handle.db, {
      projectId: "p2",
      kind: "character",
      name: "Theirs",
      now: NOW,
    })
    container("character", "Mine")
    expect(
      listMentionSubjects(handle.db, PROJECT_ID).map((s) => s.name)
    ).toEqual(["Mine"])
  })

  it("does not lend one character another's images", () => {
    const venkz = container("character", "Venkz")
    const lobby = container("scene", "Lobby")
    asset(venkz.id, { id: "a1" })
    asset(lobby.id, { id: "a2" })
    asset(null, { id: "loose" })

    const subjects = listMentionSubjects(handle.db, PROJECT_ID)
    expect(subjects.map((s) => s.images.map((i) => i.assetId))).toEqual([
      ["a1"],
      ["a2"],
    ])
  })
})
