import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseHandle } from "../db/client"
import { resolveMigrationsFolder, runMigrations } from "../db/migrate"
import { assets, containerAssets, containers, projects } from "../db/schema"
import {
  createContainer,
  createContainerFromAsset,
  deleteContainer,
  existingHandles,
  getContainer,
  listContainerSummaries,
  listTree,
  renameContainer,
  reparentContainer,
  setContainerDescription,
  setContainerHandle,
} from "./containers"
import { createGeneration, updateStatus } from "./generations"

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

function make(name: string, parentId: string | null = null) {
  return createContainer(handle.db, {
    projectId: PROJECT_ID,
    parentId,
    kind: "folder",
    name,
    now: NOW,
  })
}

describe("createContainer", () => {
  it("creates a container and reads it back", () => {
    const created = make("Characters")
    expect(created.id).toMatch(/[0-9a-f-]{36}/)
    expect(getContainer(handle.db, created.id)).toEqual(created)
  })

  it("appends each sibling after the last one", () => {
    const a = make("A")
    const b = make("B")
    const c = make("C")
    expect([a.position, b.position, c.position]).toEqual([0, 1, 2])
  })

  it("numbers positions per parent, not globally", () => {
    const root = make("Root")
    const child = make("Child", root.id)
    expect(child.position).toBe(0)
  })

  it("rejects an empty name and an unknown parent", () => {
    expect(() => make("   ")).toThrow(/name/i)
    expect(() => make("Orphan", "nope")).toThrow(/parent/i)
  })
})

describe("renameContainer", () => {
  it("renames and trims", () => {
    const created = make("Old")
    expect(renameContainer(handle.db, created.id, "  New  ").name).toBe("New")
  })

  it("rejects an empty name and an unknown container", () => {
    const created = make("Old")
    expect(() => renameContainer(handle.db, created.id, " ")).toThrow(/name/i)
    expect(() => renameContainer(handle.db, "nope", "New")).toThrow(
      /not found/i
    )
  })
})

describe("reparentContainer", () => {
  it("moves a container under a new parent and appends it there", () => {
    const scenes = make("Scenes")
    const characters = make("Characters")
    make("Existing", scenes.id)
    const moved = reparentContainer(handle.db, characters.id, scenes.id)
    expect(moved.parentId).toBe(scenes.id)
    expect(moved.position).toBe(1)
  })

  it("moves a container back to the root", () => {
    const scenes = make("Scenes")
    const child = make("Child", scenes.id)
    expect(reparentContainer(handle.db, child.id, null).parentId).toBeNull()
  })

  it("refuses to make a container its own descendant", () => {
    const root = make("Root")
    const child = make("Child", root.id)
    const grandchild = make("Grandchild", child.id)
    expect(() => reparentContainer(handle.db, root.id, grandchild.id)).toThrow(
      /descendant/i
    )
    expect(() => reparentContainer(handle.db, root.id, root.id)).toThrow(
      /descendant/i
    )
  })

  it("refuses a parent from another project", () => {
    handle.db
      .insert(projects)
      .values({ id: "p2", name: "Other", path: "/tmp/p2", createdAt: NOW })
      .run()
    const mine = make("Mine")
    const theirs = createContainer(handle.db, {
      projectId: "p2",
      parentId: null,
      kind: "folder",
      name: "Theirs",
      now: NOW,
    })
    expect(() => reparentContainer(handle.db, mine.id, theirs.id)).toThrow(
      /project/i
    )
  })
})

describe("deleteContainer", () => {
  it("deletes the container and its children but never the assets", () => {
    const root = make("Root")
    const child = make("Child", root.id)
    handle.db
      .insert(assets)
      .values({
        id: "a1",
        projectId: PROJECT_ID,
        kind: "image",
        relPath: "assets/2026/09/a1.png",
        createdAt: NOW,
      })
      .run()
    handle.db
      .insert(containerAssets)
      .values({ containerId: child.id, assetId: "a1", position: 0 })
      .run()

    deleteContainer(handle.db, root.id)

    expect(handle.db.select().from(containers).all()).toEqual([])
    expect(handle.db.select().from(containerAssets).all()).toEqual([])
    expect(
      handle.db.select().from(assets).where(eq(assets.id, "a1")).all()
    ).toHaveLength(1)
  })

  it("rejects an unknown container", () => {
    expect(() => deleteContainer(handle.db, "nope")).toThrow(/not found/i)
  })
})

describe("listTree", () => {
  it("nests children under their parent, ordered by position", () => {
    const scenes = make("Scenes")
    const lobby = make("Lobby", scenes.id)
    const corridor = make("Corridor", scenes.id)
    const characters = make("Characters")

    const tree = listTree(handle.db, PROJECT_ID)
    expect(tree.map((node) => node.id)).toEqual([scenes.id, characters.id])
    expect(tree[0]!.children.map((node) => node.id)).toEqual([
      lobby.id,
      corridor.id,
    ])
    expect(tree[1]!.children).toEqual([])
  })

  it("only lists containers from the given project", () => {
    make("Mine")
    handle.db
      .insert(projects)
      .values({ id: "p2", name: "Other", path: "/tmp/p2", createdAt: NOW })
      .run()
    createContainer(handle.db, {
      projectId: "p2",
      parentId: null,
      kind: "folder",
      name: "Theirs",
      now: NOW,
    })
    expect(listTree(handle.db, PROJECT_ID).map((n) => n.name)).toEqual(["Mine"])
  })
})

/** A mentionable container — the handle is only derived for these two kinds. */
function makeCharacter(
  name: string,
  kind: "character" | "scene" = "character"
) {
  return createContainer(handle.db, {
    projectId: PROJECT_ID,
    parentId: null,
    kind,
    name,
    now: NOW,
  })
}

describe("handles", () => {
  it("derives one from the name of a character and of a scene", () => {
    expect(makeCharacter("Venkz Sekar").handle).toBe("venkz-sekar")
    expect(makeCharacter("The Hotel Lobby", "scene").handle).toBe(
      "the-hotel-lobby"
    )
  })

  it("leaves folders and the project board without one", () => {
    expect(make("Characters").handle).toBeNull()
    expect(
      createContainer(handle.db, {
        projectId: PROJECT_ID,
        kind: "project",
        name: "Board",
        now: NOW,
      }).handle
    ).toBeNull()
  })

  it("leaves it null when the name slugifies to nothing", () => {
    expect(makeCharacter("北京").handle).toBeNull()
    expect(makeCharacter("!!!").handle).toBeNull()
  })

  it("makes a colliding handle unique within the project", () => {
    expect(makeCharacter("Venkz").handle).toBe("venkz")
    expect(makeCharacter("venkz").handle).toBe("venkz-2")
    expect(makeCharacter("Venkz!").handle).toBe("venkz-3")
  })

  it("does not collide across projects", () => {
    handle.db
      .insert(projects)
      .values({ id: "p2", name: "Other", path: "/tmp/p2", createdAt: NOW })
      .run()
    expect(makeCharacter("Venkz").handle).toBe("venkz")
    const theirs = createContainer(handle.db, {
      projectId: "p2",
      kind: "character",
      name: "Venkz",
      now: NOW,
    })
    expect(theirs.handle).toBe("venkz")
  })

  it("starts with an empty description", () => {
    expect(makeCharacter("Venkz").description).toBeNull()
  })

  it("lists the handles a project has taken", () => {
    makeCharacter("Venkz")
    makeCharacter("Lobby", "scene")
    make("A folder")
    expect(existingHandles(handle.db, PROJECT_ID)).toEqual(
      new Set(["venkz", "lobby"])
    )
  })
})

describe("renameContainer and the handle", () => {
  it("re-derives a handle the old name would still produce", () => {
    const venkz = makeCharacter("Venkz")
    expect(renameContainer(handle.db, venkz.id, "Venkatesh").handle).toBe(
      "venkatesh"
    )
  })

  it("keeps a hand-edited handle across a rename", () => {
    const venkz = makeCharacter("Venkatesh Sekar")
    setContainerHandle(handle.db, venkz.id, "venkz")
    expect(renameContainer(handle.db, venkz.id, "Venkatesh S").handle).toBe(
      "venkz"
    )
  })

  it("re-derives around a collision rather than failing", () => {
    makeCharacter("Venkz")
    const other = makeCharacter("Someone")
    expect(renameContainer(handle.db, other.id, "Venkz").handle).toBe("venkz-2")
  })

  it("leaves a folder alone", () => {
    const folder = make("Characters")
    expect(renameContainer(handle.db, folder.id, "People").handle).toBeNull()
  })

  it("gives a nameless character a handle once it has a usable name", () => {
    const blank = makeCharacter("北京")
    expect(renameContainer(handle.db, blank.id, "Venkz").handle).toBe("venkz")
  })

  it("keeps the handle it has when the new name slugifies to nothing", () => {
    const venkz = makeCharacter("Venkz")
    expect(renameContainer(handle.db, venkz.id, "!!!").handle).toBe("venkz")
  })
})

describe("setContainerHandle", () => {
  it("sets and clears a handle", () => {
    const venkz = makeCharacter("Venkatesh")
    expect(setContainerHandle(handle.db, venkz.id, "venkz").handle).toBe(
      "venkz"
    )
    expect(setContainerHandle(handle.db, venkz.id, null).handle).toBeNull()
  })

  it("trims what the user typed", () => {
    const venkz = makeCharacter("Venkatesh")
    expect(setContainerHandle(handle.db, venkz.id, "  venkz  ").handle).toBe(
      "venkz"
    )
    expect(setContainerHandle(handle.db, venkz.id, "   ").handle).toBeNull()
  })

  it("rejects a handle that is not typeable", () => {
    const venkz = makeCharacter("Venkatesh")
    expect(() => setContainerHandle(handle.db, venkz.id, "Venkz!")).toThrow(
      /lowercase/i
    )
    expect(() =>
      setContainerHandle(handle.db, venkz.id, "a".repeat(33))
    ).toThrow(/lowercase/i)
  })

  it("rejects one another container in the project already answers to", () => {
    makeCharacter("Venkz")
    const other = makeCharacter("Someone")
    expect(() => setContainerHandle(handle.db, other.id, "venkz")).toThrow(
      /already/i
    )
  })

  it("lets a container keep its own handle", () => {
    const venkz = makeCharacter("Venkz")
    expect(setContainerHandle(handle.db, venkz.id, "venkz").handle).toBe(
      "venkz"
    )
  })

  it("refuses a kind that is not mentionable", () => {
    const folder = make("Characters")
    expect(() => setContainerHandle(handle.db, folder.id, "people")).toThrow(
      /characters and scenes/i
    )
  })
})

describe("setContainerDescription", () => {
  it("sets, trims and clears the prose", () => {
    const venkz = makeCharacter("Venkz")
    expect(
      setContainerDescription(handle.db, venkz.id, "  a tall man  ").description
    ).toBe("a tall man")
    expect(
      setContainerDescription(handle.db, venkz.id, "").description
    ).toBeNull()
    expect(
      setContainerDescription(handle.db, venkz.id, null).description
    ).toBeNull()
  })

  it("rejects an unknown container", () => {
    expect(() => setContainerDescription(handle.db, "nope", "x")).toThrow(
      /not found/i
    )
  })
})

describe("createContainerFromAsset", () => {
  function seedAsset(id = "a1") {
    handle.db
      .insert(assets)
      .values({
        id,
        projectId: PROJECT_ID,
        kind: "image",
        relPath: `assets/2026/09/${id}.png`,
        createdAt: NOW,
      })
      .run()
    return id
  }

  it("creates the character, links the asset and pins it as the reference", () => {
    const assetId = seedAsset()
    const created = createContainerFromAsset(handle.db, {
      projectId: PROJECT_ID,
      assetId,
      kind: "character",
      name: "Venkz Sekar",
      now: NOW,
    })

    expect(created.kind).toBe("character")
    expect(created.handle).toBe("venkz-sekar")
    expect(
      handle.db
        .select()
        .from(containerAssets)
        .where(eq(containerAssets.containerId, created.id))
        .all()
        .map((row) => row.assetId)
    ).toEqual([assetId])
    expect(
      handle.db.select().from(assets).where(eq(assets.id, assetId)).get()
        ?.pinned
    ).toBe(true)
  })

  it("makes a scene the same way", () => {
    const created = createContainerFromAsset(handle.db, {
      projectId: PROJECT_ID,
      assetId: seedAsset("a2"),
      kind: "scene",
      name: "The Hotel Lobby",
      now: NOW,
    })
    expect(created.kind).toBe("scene")
    expect(created.handle).toBe("the-hotel-lobby")
  })

  it("leaves no empty container behind when the link fails", () => {
    expect(() =>
      createContainerFromAsset(handle.db, {
        projectId: PROJECT_ID,
        assetId: "missing",
        kind: "character",
        name: "Venkz",
        now: NOW,
      })
    ).toThrow()
    expect(handle.db.select().from(containers).all()).toEqual([])
  })

  it("refuses a kind that is not mentionable", () => {
    expect(() =>
      createContainerFromAsset(handle.db, {
        projectId: PROJECT_ID,
        assetId: seedAsset("a3"),
        // A folder has no handle, so it would not be `@`-able.
        kind: "folder" as "character",
        name: "Assets",
        now: NOW,
      })
    ).toThrow(/characters and scenes/i)
  })
})

describe("listContainerSummaries", () => {
  function seedAsset(
    id: string,
    containerId: string,
    overrides: { kind?: string; createdAt?: number } = {}
  ) {
    handle.db
      .insert(assets)
      .values({
        id,
        projectId: PROJECT_ID,
        kind: overrides.kind ?? "image",
        relPath: `assets/2026/09/${id}.png`,
        createdAt: overrides.createdAt ?? NOW,
      })
      .run()
    handle.db.insert(containerAssets).values({ containerId, assetId: id }).run()
    return id
  }

  function seedGeneration(containerId: string | null, now: number) {
    return createGeneration(handle.db, {
      projectId: PROJECT_ID,
      containerId,
      provider: "replicate",
      modelSlug: "bytedance/seedance-2.5",
      kind: "image",
      params: {},
      now,
    })
  }

  function summaryOf(id: string) {
    return listContainerSummaries(handle.db, PROJECT_ID).find(
      (summary) => summary.id === id
    )
  }

  it("summarises an empty container by its creation time alone", () => {
    const empty = make("Empty")
    expect(summaryOf(empty.id)).toEqual({
      id: empty.id,
      assetCount: 0,
      generationCount: 0,
      coverAsset: null,
      lastActivityAt: NOW,
    })
  })

  it("counts each container's own assets and generations", () => {
    const a = make("A")
    const b = make("B")
    seedAsset("a1", a.id)
    seedAsset("a2", a.id)
    seedAsset("b1", b.id)
    seedGeneration(a.id, NOW + 1)
    seedGeneration(null, NOW + 2)

    const summaries = listContainerSummaries(handle.db, PROJECT_ID)
    expect(summaries.map((summary) => summary.id)).toEqual([a.id, b.id])
    expect(summaryOf(a.id)).toMatchObject({ assetCount: 2, generationCount: 1 })
    expect(summaryOf(b.id)).toMatchObject({ assetCount: 1, generationCount: 0 })
  })

  it("covers a container with its first reference image", () => {
    const character = make("Venkz")
    seedAsset("old", character.id, { createdAt: NOW })
    seedAsset("new", character.id, { createdAt: NOW + 10 })
    handle.db
      .update(containers)
      .set({ referenceAssetIds: ["old", "new"] })
      .where(eq(containers.id, character.id))
      .run()

    const cover = summaryOf(character.id)?.coverAsset
    expect(cover?.id).toBe("old")
    // A DTO, so the renderer gets a URL rather than a path on disk.
    expect(cover?.url).toMatch(/^asset:\/\//)
  })

  it("falls back to the newest image, skipping other kinds", () => {
    const scene = make("Lobby")
    seedAsset("older", scene.id, { createdAt: NOW })
    seedAsset("newest", scene.id, { createdAt: NOW + 10 })
    seedAsset("clip", scene.id, { kind: "video", createdAt: NOW + 20 })
    expect(summaryOf(scene.id)?.coverAsset?.id).toBe("newest")
  })

  it("falls back when the reference image no longer exists", () => {
    const character = make("Venkz")
    seedAsset("kept", character.id)
    handle.db
      .update(containers)
      .set({ referenceAssetIds: ["gone"] })
      .where(eq(containers.id, character.id))
      .run()
    expect(summaryOf(character.id)?.coverAsset?.id).toBe("kept")
  })

  it("dates activity by the latest asset, run or completion", () => {
    const scene = make("Lobby")
    seedAsset("a1", scene.id, { createdAt: NOW + 5 })
    expect(summaryOf(scene.id)?.lastActivityAt).toBe(NOW + 5)

    const run = seedGeneration(scene.id, NOW + 7)
    expect(summaryOf(scene.id)?.lastActivityAt).toBe(NOW + 7)

    updateStatus(handle.db, run.id, { status: "succeeded", now: NOW + 30 })
    expect(summaryOf(scene.id)?.lastActivityAt).toBe(NOW + 30)
  })
})
