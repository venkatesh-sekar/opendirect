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
  listRelated,
  listTree,
  moveContainer,
  renameContainer,
  reparentContainer,
  setContainerDescription,
  setContainerHandle,
  setContainerPick,
  setContainerReferences,
} from "./containers"
import { addToContainer, removeFromContainer } from "./assets"
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
      castIds: [],
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

  it("skips a reference that has been unlinked from the container", () => {
    const character = make("Venkz")
    seedAsset("first", character.id, { createdAt: NOW })
    seedAsset("second", character.id, { createdAt: NOW + 1 })
    seedAsset("newest", character.id, { createdAt: NOW + 10 })
    handle.db
      .update(containers)
      .set({ referenceAssetIds: ["first", "second"] })
      .where(eq(containers.id, character.id))
      .run()

    // Unlinking leaves `referenceAssetIds` alone, so the summary must check.
    removeFromContainer(handle.db, {
      containerId: character.id,
      assetId: "first",
    })
    expect(summaryOf(character.id)?.coverAsset?.id).toBe("second")

    removeFromContainer(handle.db, {
      containerId: character.id,
      assetId: "second",
    })
    expect(summaryOf(character.id)?.coverAsset?.id).toBe("newest")
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

describe("listRelated", () => {
  function kind(name: string, value: "character" | "scene" | "folder") {
    return createContainer(handle.db, {
      projectId: PROJECT_ID,
      kind: value,
      name,
      now: NOW,
    })
  }

  function run(
    containerId: string | null,
    options: { mentioned?: string[] | null; inputs?: string[] } = {}
  ) {
    return createGeneration(handle.db, {
      projectId: PROJECT_ID,
      containerId,
      provider: "replicate",
      modelSlug: "bytedance/seedance-2.5",
      kind: "video",
      params: {},
      mentionedContainerIds: options.mentioned ?? null,
      inputs: (options.inputs ?? []).map((assetId) => ({
        assetId,
        slotField: "reference_images",
      })),
      now: NOW,
    })
  }

  function linkedAsset(id: string, containerId: string) {
    handle.db
      .insert(assets)
      .values({ id, projectId: PROJECT_ID, kind: "image", createdAt: NOW })
      .run()
    handle.db.insert(containerAssets).values({ containerId, assetId: id }).run()
    return id
  }

  function names(list: { name: string }[]) {
    return list.map((one) => one.name)
  }

  function cast(sceneId: string) {
    const related = listRelated(handle.db, sceneId)
    if (related.kind !== "scene") throw new Error("expected a scene's cast")
    return names(related.characters)
  }

  function scenes(characterId: string) {
    const related = listRelated(handle.db, characterId)
    if (related.kind !== "character") throw new Error("expected scenes")
    return names(related.scenes)
  }

  it("puts a character in a scene when a run filed there mentioned it", () => {
    const mira = kind("Mira", "character")
    const ruiz = kind("Ruiz", "character")
    const hall = kind("Hotel hallway", "scene")
    const roof = kind("Rooftop", "scene")
    run(hall.id, { mentioned: [ruiz.id, mira.id, hall.id] })
    run(roof.id, { mentioned: [mira.id] })

    // Tree order, not mention order — and the scene itself is not its cast.
    expect(cast(hall.id)).toEqual(["Mira", "Ruiz"])
    expect(cast(roof.id)).toEqual(["Mira"])
    expect(scenes(mira.id)).toEqual(["Hotel hallway", "Rooftop"])
    expect(scenes(ruiz.id)).toEqual(["Hotel hallway"])
  })

  it("does not count a mention in a run filed anywhere but the scene", () => {
    const mira = kind("Mira", "character")
    const hall = kind("Hotel hallway", "scene")
    run(mira.id, { mentioned: [mira.id, hall.id] })
    run(null, { mentioned: [mira.id] })
    expect(cast(hall.id)).toEqual([])
    expect(scenes(mira.id)).toEqual([])
  })

  it("reads a run from before mentions were recorded by its input assets", () => {
    const mira = kind("Mira", "character")
    const ruiz = kind("Ruiz", "character")
    const hall = kind("Hotel hallway", "scene")
    const sheet = linkedAsset("sheet", mira.id)
    const plate = linkedAsset("plate", hall.id)
    run(hall.id, { inputs: [sheet, plate] })

    expect(cast(hall.id)).toEqual(["Mira"])
    expect(scenes(mira.id)).toEqual(["Hotel hallway"])
    expect(scenes(ruiz.id)).toEqual([])
  })

  it("casts only the character when a legacy input is linked to a scene too", () => {
    const mira = kind("Mira", "character")
    const hall = kind("Hotel hallway", "scene")
    const roof = kind("Rooftop", "scene")
    const sheet = linkedAsset("sheet", mira.id)
    // The same picture filed under a scene and a folder as well as Mira.
    handle.db
      .insert(containerAssets)
      .values([
        { containerId: roof.id, assetId: sheet },
        { containerId: hall.id, assetId: sheet },
      ])
      .run()
    run(hall.id, { inputs: [sheet] })
    run(hall.id, { inputs: [sheet] })

    expect(cast(hall.id)).toEqual(["Mira"])
    expect(scenes(mira.id)).toEqual(["Hotel hallway"])
    expect(scenes(mira.id)).not.toContain("Rooftop")
  })

  it("counts the runs filed under a scene's shots toward its cast", () => {
    const mira = kind("Mira", "character")
    const ruiz = kind("Ruiz", "character")
    const hall = kind("Hotel hallway", "scene")
    const shot = createContainer(handle.db, {
      projectId: PROJECT_ID,
      parentId: hall.id,
      kind: "shot",
      name: "Shot 1",
      now: NOW,
    })
    const sheet = linkedAsset("sheet", ruiz.id)
    run(shot.id, { mentioned: [mira.id] })
    run(shot.id, { inputs: [sheet] })

    expect(cast(hall.id)).toEqual(["Mira", "Ruiz"])
    expect(scenes(mira.id)).toEqual(["Hotel hallway"])
    const summaries = listContainerSummaries(handle.db, PROJECT_ID)
    expect(summaries.find((one) => one.id === hall.id)?.castIds).toEqual([
      mira.id,
      ruiz.id,
    ])
    // A shot is not a scene: it has no cast of its own.
    expect(summaries.find((one) => one.id === shot.id)?.castIds).toEqual([])
  })

  it("trusts a recorded list over the inputs, even an empty one", () => {
    const mira = kind("Mira", "character")
    const hall = kind("Hotel hallway", "scene")
    const sheet = linkedAsset("sheet", mira.id)
    // Mira's sheet was wired in by hand, but the prompt mentioned nobody.
    run(hall.id, { mentioned: [], inputs: [sheet] })
    expect(cast(hall.id)).toEqual([])
  })

  it("ignores a mention of a container that has since been deleted", () => {
    const mira = kind("Mira", "character")
    const hall = kind("Hotel hallway", "scene")
    run(hall.id, { mentioned: ["gone", mira.id] })
    expect(cast(hall.id)).toEqual(["Mira"])
  })

  it("refuses a container that is neither a character nor a scene", () => {
    const folder = kind("Uploads", "folder")
    expect(() => listRelated(handle.db, folder.id)).toThrow(
      /characters and scenes/i
    )
    expect(() => listRelated(handle.db, "missing")).toThrow(/not found/i)
  })

  it("gives each scene card its cast in the summaries", () => {
    const mira = kind("Mira", "character")
    const hall = kind("Hotel hallway", "scene")
    run(hall.id, { mentioned: [mira.id] })
    const summaries = listContainerSummaries(handle.db, PROJECT_ID)
    expect(summaries.find((one) => one.id === hall.id)?.castIds).toEqual([
      mira.id,
    ])
    expect(summaries.find((one) => one.id === mira.id)?.castIds).toEqual([])
  })
})

describe("shots", () => {
  function scene(name = "Hotel hallway") {
    return createContainer(handle.db, {
      projectId: PROJECT_ID,
      kind: "scene",
      name,
      now: NOW,
    })
  }

  function shot(parentId: string | null, name = "Shot") {
    return createContainer(handle.db, {
      projectId: PROJECT_ID,
      parentId,
      kind: "shot",
      name,
      now: NOW,
    })
  }

  function output(id: string, containerId: string) {
    handle.db
      .insert(assets)
      .values({ id, projectId: PROJECT_ID, kind: "image", createdAt: NOW })
      .run()
    addToContainer(handle.db, { containerId, assetId: id })
    return id
  }

  function order(parentId: string) {
    return listTree(handle.db, PROJECT_ID)
      .find((node) => node.id === parentId)!
      .children.map((child) => child.name)
  }

  it("lives under a scene, in order, with no handle and no pick yet", () => {
    const hall = scene()
    const one = shot(hall.id, "One")
    const two = shot(hall.id, "Two")
    expect([one.position, two.position]).toEqual([0, 1])
    expect(one.handle).toBeNull()
    expect(getContainer(handle.db, one.id)?.pickedAssetId).toBeNull()
    expect(order(hall.id)).toEqual(["One", "Two"])
  })

  it("refuses to live anywhere but under a scene", () => {
    const character = createContainer(handle.db, {
      projectId: PROJECT_ID,
      kind: "character",
      name: "Mira",
      now: NOW,
    })
    expect(() => shot(null)).toThrow(/scene/i)
    expect(() => shot(character.id)).toThrow(/scene/i)
    expect(() => shot(make("Folder").id)).toThrow(/scene/i)
  })

  it("holds nothing under itself", () => {
    const one = shot(scene().id)
    expect(() => make("Inside", one.id)).toThrow(/shot/i)
    const loose = make("Loose")
    expect(() => reparentContainer(handle.db, loose.id, one.id)).toThrow(
      /shot/i
    )
  })

  it("moves only from one scene to another", () => {
    const hall = scene()
    const roof = scene("Rooftop")
    const one = shot(hall.id)
    expect(reparentContainer(handle.db, one.id, roof.id).parentId).toBe(roof.id)
    expect(() => reparentContainer(handle.db, one.id, null)).toThrow(/scene/i)
    expect(() =>
      reparentContainer(handle.db, one.id, make("Folder").id)
    ).toThrow(/scene/i)
  })

  it("cannot be given a handle or references", () => {
    const one = shot(scene().id)
    expect(() => setContainerHandle(handle.db, one.id, "shot-1")).toThrow()
    expect(() => setContainerReferences(handle.db, one.id, [])).toThrow()
  })

  it("keeps its label as its description", () => {
    const one = shot(scene().id)
    expect(
      setContainerDescription(handle.db, one.id, "Wide — Mira steps out")
        .description
    ).toBe("Wide — Mira steps out")
  })

  it("picks one of its own versions, and clears the pick", () => {
    const one = shot(scene().id)
    const v1 = output("v1", one.id)
    expect(setContainerPick(handle.db, one.id, v1).pickedAssetId).toBe(v1)
    expect(setContainerPick(handle.db, one.id, null).pickedAssetId).toBeNull()
  })

  it("refuses a pick that is not one of the shot's own", () => {
    const hall = scene()
    const one = shot(hall.id)
    const elsewhere = output("elsewhere", hall.id)
    expect(() => setContainerPick(handle.db, one.id, elsewhere)).toThrow(
      /shot/i
    )
    expect(() => setContainerPick(handle.db, one.id, "missing")).toThrow()
    output("mine", hall.id)
    expect(() => setContainerPick(handle.db, hall.id, "mine")).toThrow(/shot/i)
  })

  it("forgets the pick when the asset leaves the shot or the project", () => {
    const one = shot(scene().id)
    const v1 = output("v1", one.id)
    const v2 = output("v2", one.id)
    setContainerPick(handle.db, one.id, v1)
    removeFromContainer(handle.db, { containerId: one.id, assetId: v1 })
    expect(getContainer(handle.db, one.id)?.pickedAssetId).toBeNull()

    setContainerPick(handle.db, one.id, v2)
    handle.db.delete(assets).where(eq(assets.id, v2)).run()
    expect(getContainer(handle.db, one.id)?.pickedAssetId).toBeNull()
  })

  it("covers its card with the pick", () => {
    const one = shot(scene().id)
    const v1 = output("v1", one.id)
    output("v2", one.id)
    setContainerPick(handle.db, one.id, v1)
    expect(
      listContainerSummaries(handle.db, PROJECT_ID).find(
        (entry) => entry.id === one.id
      )?.coverAsset?.id
    ).toBe(v1)
  })

  it("goes with its scene", () => {
    const hall = scene()
    shot(hall.id)
    deleteContainer(handle.db, hall.id)
    expect(handle.db.select().from(containers).all()).toEqual([])
  })
})

describe("moveContainer", () => {
  it("puts a container at an index among its siblings", () => {
    const root = make("Root")
    const a = make("A", root.id)
    make("B", root.id)
    const c = make("C", root.id)
    const names = () =>
      listTree(handle.db, PROJECT_ID)[0]!.children.map((child) => child.name)

    moveContainer(handle.db, c.id, 0)
    expect(names()).toEqual(["C", "A", "B"])
    moveContainer(handle.db, a.id, 2)
    expect(names()).toEqual(["C", "B", "A"])
    // Past the end is the end.
    moveContainer(handle.db, c.id, 99)
    expect(names()).toEqual(["B", "A", "C"])
    expect(
      listTree(handle.db, PROJECT_ID)[0]!.children.map(
        (child) => child.position
      )
    ).toEqual([0, 1, 2])
  })

  it("rejects an unknown container and a negative index", () => {
    expect(() => moveContainer(handle.db, "nope", 0)).toThrow(/not found/i)
    const a = make("A")
    expect(() => moveContainer(handle.db, a.id, -1)).toThrow()
  })
})
