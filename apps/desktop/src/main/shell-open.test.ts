/**
 * ⛔ No provider, no `shell` — `resolveOpenPath` only decides which absolute
 * path Electron would be allowed to open.
 */
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { assets } from "./db/schema"
import { createProject, openProject, type OpenProject } from "./project"
import { resolveOpenPath } from "./shell-open"

let root: string
let opened: OpenProject

function insertAsset(relPath: string | null): string {
  const id = randomUUID()
  opened.handle.db
    .insert(assets)
    .values({
      id,
      projectId: opened.project.id,
      kind: relPath === null ? "text" : "image",
      relPath,
      text: null,
      mimeType: relPath === null ? null : "image/png",
      width: null,
      height: null,
      durationMs: null,
      bytes: null,
      sha256: null,
      thumbnailRelPath: null,
      label: null,
      originalName: null,
      pinned: false,
      generationId: null,
      createdAt: 1,
    })
    .run()
  return id
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "opendirect-open-"))
  const project = await createProject({ root, name: "Infinite Hotel" })
  opened = await openProject(project.path)
})

afterEach(async () => {
  opened.close()
  await rm(root, { recursive: true, force: true })
})

describe("resolveOpenPath", () => {
  it("resolves an asset inside the project to its absolute path", async () => {
    await writeFile(join(opened.project.path, "assets", "lobby.png"), "png")
    const id = insertAsset("assets/lobby.png")

    expect(resolveOpenPath(ctx(), id)).toBe(
      join(opened.project.path, "assets", "lobby.png")
    )
  })

  it("refuses a stored path that walks out of the project folder", () => {
    const id = insertAsset("../../etc/passwd")
    expect(() => resolveOpenPath(ctx(), id)).toThrow(/outside the project/i)
  })

  it("refuses an absolute stored path", () => {
    const id = insertAsset("/etc/passwd")
    expect(() => resolveOpenPath(ctx(), id)).toThrow(/outside the project/i)
  })

  it("says so when the file is gone rather than opening nothing", () => {
    const id = insertAsset("assets/missing.png")
    expect(() => resolveOpenPath(ctx(), id)).toThrow(/no longer/i)
  })

  it("refuses an asset that has no file at all", () => {
    const id = insertAsset(null)
    expect(() => resolveOpenPath(ctx(), id)).toThrow(/no file/i)
  })

  it("refuses an asset that does not exist", () => {
    expect(() => resolveOpenPath(ctx(), "nope")).toThrow(/not found/i)
  })
})

function ctx() {
  return { db: opened.handle.db, project: opened.project }
}
