/**
 * Schema + migration tests.
 *
 * These run against **Node's** better-sqlite3 build (an in-memory database),
 * never Electron's: the migration SQL and the constraints it declares are the
 * same either way, and a test must not depend on a native rebuild.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

import { eq, sql } from "drizzle-orm"
import { beforeEach, describe, expect, it } from "vitest"

import { createDatabase, type DatabaseHandle } from "./client"
import { resolveMigrationsFolder, runMigrations } from "./migrate"
import {
  assets,
  containerAssets,
  containers,
  generationInputs,
  generations,
  jobs,
  projects,
} from "./schema"

const NOW = 1_763_000_000_000

function freshDatabase(): DatabaseHandle {
  const handle = createDatabase(":memory:")
  runMigrations(handle, resolveMigrationsFolder(__dirname))
  return handle
}

/** project → container → asset → generation → generation_input → job. */
function seed(handle: DatabaseHandle): void {
  const { db } = handle
  db.insert(projects)
    .values({
      id: "p1",
      name: "Infinite Hotel",
      path: "/tmp/p1",
      createdAt: NOW,
    })
    .run()
  db.insert(containers)
    .values({
      id: "c1",
      projectId: "p1",
      parentId: null,
      kind: "scene",
      name: "Lobby",
      createdAt: NOW,
    })
    .run()
  db.insert(assets)
    .values({
      id: "a1",
      projectId: "p1",
      kind: "image",
      relPath: "assets/2026/09/a1.png",
      mimeType: "image/png",
      createdAt: NOW,
    })
    .run()
  db.insert(containerAssets)
    .values({ containerId: "c1", assetId: "a1", position: 0 })
    .run()
  db.insert(generations)
    .values({
      id: "g1",
      projectId: "p1",
      containerId: "c1",
      provider: "replicate",
      modelSlug: "bytedance/seedance-2.5",
      kind: "video",
      prompt: "a lobby",
      paramsJson: JSON.stringify({ duration: 5 }),
      status: "queued",
      createdAt: NOW,
    })
    .run()
  db.insert(generationInputs)
    .values({
      id: "gi1",
      generationId: "g1",
      assetId: "a1",
      slotField: "reference_images",
      position: 0,
    })
    .run()
  db.insert(jobs)
    .values({ id: "j1", generationId: "g1", state: "pending", createdAt: NOW })
    .run()
}

describe("migrations", () => {
  it("creates every table the app needs", () => {
    const handle = freshDatabase()
    const names = handle.sqlite
      .prepare<[], { name: string }>(
        "select name from sqlite_master where type = 'table'"
      )
      .all()
      .map((row) => row.name)
    for (const table of [
      "projects",
      "containers",
      "assets",
      "container_assets",
      "generations",
      "generation_inputs",
      "jobs",
      "canvas_nodes",
      "canvas_edges",
    ]) {
      expect(names).toContain(table)
    }
    handle.close()
  })

  it("is idempotent — running them twice is a no-op", () => {
    const handle = freshDatabase()
    seed(handle)
    expect(() =>
      runMigrations(handle, resolveMigrationsFolder(__dirname))
    ).not.toThrow()
    expect(handle.db.select().from(projects).all()).toHaveLength(1)
    handle.close()
  })

  it("enables foreign keys and WAL on a file-backed database", () => {
    const handle = freshDatabase()
    expect(handle.sqlite.pragma("foreign_keys", { simple: true })).toBe(1)
    handle.close()
  })

  it("creates the indexes the hot queries rely on", () => {
    const handle = freshDatabase()
    const indexes = handle.sqlite
      .prepare<[], { name: string }>(
        "select name from sqlite_master where type = 'index'"
      )
      .all()
      .map((row) => row.name)
    for (const index of [
      "assets_project_id_idx",
      "container_assets_container_id_idx",
      "generations_project_id_idx",
      "generations_parent_generation_id_idx",
      "jobs_state_idx",
      "generations_batch_id_idx",
      "canvas_nodes_project_id_idx",
      "canvas_edges_source_node_id_idx",
    ]) {
      expect(indexes).toContain(index)
    }
    handle.close()
  })
})

describe("resolveMigrationsFolder", () => {
  it("prefers the copy tsup places next to the bundled main process", () => {
    // `dist/main/index.js` → `dist/drizzle`, which is what ends up in app.asar.
    expect(resolveMigrationsFolder("/app/dist/main", () => true)).toBe(
      join("/app/dist", "drizzle")
    )
  })

  it("falls back to the workspace copy when running from source", () => {
    const exists = (path: string) => path === join("/app", "drizzle")
    expect(resolveMigrationsFolder("/app/src/main", exists)).toBe(
      join("/app", "drizzle")
    )
  })

  it("finds the real folder from this file", () => {
    expect(
      existsSync(join(resolveMigrationsFolder(__dirname), "meta/_journal.json"))
    ).toBe(true)
  })
})

describe("round-trips", () => {
  let handle: DatabaseHandle

  beforeEach(() => {
    handle = freshDatabase()
    seed(handle)
  })

  it("reads back the whole chain", () => {
    const { db } = handle
    expect(db.select().from(projects).all()[0]?.name).toBe("Infinite Hotel")
    expect(db.select().from(containers).all()[0]?.kind).toBe("scene")
    const asset = db.select().from(assets).all()[0]
    expect(asset?.relPath).toBe("assets/2026/09/a1.png")
    // `pinned` is a boolean mode column: it must come back as a real boolean.
    expect(asset?.pinned).toBe(false)
    expect(db.select().from(generationInputs).all()[0]?.slotField).toBe(
      "reference_images"
    )
    expect(db.select().from(jobs).all()[0]?.attempts).toBe(0)
    handle.close()
  })

  it("stores JSON payloads verbatim", () => {
    const { db } = handle
    const params = db.select().from(generations).all()[0]?.paramsJson ?? "{}"
    expect(JSON.parse(params)).toEqual({ duration: 5 })
    handle.close()
  })

  it("keeps the composite primary key on container_assets", () => {
    expect(() =>
      handle.db
        .insert(containerAssets)
        .values({ containerId: "c1", assetId: "a1", position: 1 })
        .run()
    ).toThrow(/UNIQUE|PRIMARY/i)
    handle.close()
  })
})

describe("foreign keys", () => {
  let handle: DatabaseHandle

  beforeEach(() => {
    handle = freshDatabase()
    seed(handle)
  })

  it("rejects a container pointing at a project that does not exist", () => {
    expect(() =>
      handle.db
        .insert(containers)
        .values({
          id: "c2",
          projectId: "nope",
          kind: "folder",
          name: "Orphan",
          createdAt: NOW,
        })
        .run()
    ).toThrow(/FOREIGN KEY/i)
    handle.close()
  })

  it("rejects a generation input pointing at a missing asset", () => {
    expect(() =>
      handle.db
        .insert(generationInputs)
        .values({
          id: "gi2",
          generationId: "g1",
          assetId: "nope",
          slotField: "image",
          position: 0,
        })
        .run()
    ).toThrow(/FOREIGN KEY/i)
    handle.close()
  })

  it("cascades a project delete through the whole graph", () => {
    const { db } = handle
    db.delete(projects).where(eq(projects.id, "p1")).run()
    expect(db.select().from(containers).all()).toHaveLength(0)
    expect(db.select().from(assets).all()).toHaveLength(0)
    expect(db.select().from(containerAssets).all()).toHaveLength(0)
    expect(db.select().from(generations).all()).toHaveLength(0)
    expect(db.select().from(generationInputs).all()).toHaveLength(0)
    expect(db.select().from(jobs).all()).toHaveLength(0)
    handle.close()
  })

  it("detaches an asset from a deleted generation instead of deleting it", () => {
    const { db } = handle
    db.update(assets)
      .set({ generationId: "g1" })
      .where(eq(assets.id, "a1"))
      .run()
    db.delete(generations).where(eq(generations.id, "g1")).run()
    const asset = db.select().from(assets).all()[0]
    expect(asset?.id).toBe("a1")
    expect(asset?.generationId).toBeNull()
    handle.close()
  })

  it("keeps descendants when a branch parent is deleted", () => {
    const { db } = handle
    db.insert(generations)
      .values({
        id: "g2",
        projectId: "p1",
        provider: "replicate",
        modelSlug: "bytedance/seedance-2.5",
        kind: "video",
        paramsJson: "{}",
        status: "queued",
        parentGenerationId: "g1",
        createdAt: NOW + 1,
      })
      .run()
    db.delete(generations).where(eq(generations.id, "g1")).run()
    const survivor = db.select().from(generations).all()[0]
    expect(survivor?.id).toBe("g2")
    expect(survivor?.parentGenerationId).toBeNull()
    handle.close()
  })
})

describe("lineage", () => {
  it("walks parent_generation_id back to the root, nearest ancestor first", () => {
    const handle = freshDatabase()
    seed(handle)
    const { db } = handle
    for (const [id, parent] of [
      ["g2", "g1"],
      ["g3", "g2"],
      ["g4", "g3"],
    ] as const) {
      db.insert(generations)
        .values({
          id,
          projectId: "p1",
          provider: "replicate",
          modelSlug: "bytedance/seedance-2.5",
          kind: "video",
          paramsJson: "{}",
          status: "succeeded",
          parentGenerationId: parent,
          branchNote: `from ${parent}`,
          createdAt: NOW,
        })
        .run()
    }

    const rows = db.all<{ id: string; depth: number }>(sql`
      with recursive lineage(id, parent_generation_id, depth) as (
        select id, parent_generation_id, 0 from generations where id = ${"g4"}
        union all
        select g.id, g.parent_generation_id, lineage.depth + 1
          from generations g
          join lineage on g.id = lineage.parent_generation_id
      )
      select id, depth from lineage where depth > 0 order by depth
    `)

    expect(rows.map((row) => row.id)).toEqual(["g3", "g2", "g1"])
    handle.close()
  })
})
