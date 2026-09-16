import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseHandle } from "../db/client"
import { resolveMigrationsFolder, runMigrations } from "../db/migrate"
import { assets, containerAssets, containers, projects } from "../db/schema"
import {
  createContainer,
  deleteContainer,
  getContainer,
  listTree,
  renameContainer,
  reparentContainer,
} from "./containers"

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
