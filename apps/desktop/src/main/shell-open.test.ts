/**
 * ⛔ No provider, no `shell` — `resolveOpenPath` only decides which absolute
 * path Electron would be allowed to open.
 */
import { randomUUID } from "node:crypto"
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { assets } from "./db/schema"
import { createProject, openProject, type OpenProject } from "./project"
import { isOpenableExtension, resolveOpenPath } from "./shell-open"

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

    await expect(resolveOpenPath(ctx(), id)).resolves.toBe(
      await realpath(join(opened.project.path, "assets", "lobby.png"))
    )
  })

  it("refuses a stored path that walks out of the project folder", async () => {
    const id = insertAsset("../../etc/passwd")
    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(
      /outside the project/i
    )
  })

  it("refuses an absolute stored path", async () => {
    const id = insertAsset("/etc/passwd")
    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(
      /outside the project/i
    )
  })

  it("refuses a symlink inside the project that points out of it", async () => {
    // The lexical check passes — the link itself is under `assets/` — so only
    // the realpath containment catches this one, and it must catch it *before*
    // the path is handed to the operating system.
    const outside = await mkdtemp(join(tmpdir(), "opendirect-outside-"))
    await writeFile(join(outside, "secret.png"), "secret")
    await symlink(
      join(outside, "secret.png"),
      join(opened.project.path, "assets", "escape.png")
    )
    const id = insertAsset("assets/escape.png")

    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(
      /outside the project/i
    )
    await rm(outside, { recursive: true, force: true })
  })

  it("follows a symlink that stays inside the project", async () => {
    await writeFile(join(opened.project.path, "assets", "lobby.png"), "png")
    await symlink(
      join(opened.project.path, "assets", "lobby.png"),
      join(opened.project.path, "assets", "alias.png")
    )
    const id = insertAsset("assets/alias.png")

    await expect(resolveOpenPath(ctx(), id)).resolves.toBe(
      await realpath(join(opened.project.path, "assets", "lobby.png"))
    )
  })

  it("says so when the file is gone rather than opening nothing", async () => {
    const id = insertAsset("assets/missing.png")
    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(/no longer/i)
  })

  it("refuses an asset that has no file at all", async () => {
    const id = insertAsset(null)
    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(/no file/i)
  })

  it("refuses an asset that does not exist", async () => {
    await expect(resolveOpenPath(ctx(), "nope")).rejects.toThrow(/not found/i)
  })

  /**
   * ⛔ Containment says the file is inside the project. It does not say the
   * file is safe to hand to the operating system's handler — a project folder
   * is filled by imports and provider downloads, not by us.
   */
  it("refuses to open anything that is not media the app recognises", async () => {
    for (const relPath of [
      "assets/payload.sh",
      "assets/payload.exe",
      "assets/payload.desktop",
      "assets/payload.command",
      "assets/payload",
      // Markup a browser will execute, dressed as a picture.
      "assets/payload.svg",
    ]) {
      const id = insertAsset(relPath)
      await expect(
        resolveOpenPath(ctx(), id, { forOpening: true })
      ).rejects.toThrow(/recognis|reveal/i)
    }
  })

  it("still reveals anything, because revealing executes nothing", async () => {
    const id = insertAsset("assets/payload.sh")
    // No `forOpening`: this is the path "Reveal in folder" takes, and it only
    // ever selects the file in the OS file browser.
    await expect(resolveOpenPath(ctx(), id)).rejects.toThrow(/no longer/i)
  })

  it("opens the media types the board itself displays", () => {
    for (const name of ["a.png", "b.JPG", "c.mp4", "d.mov", "e.wav"]) {
      expect(isOpenableExtension(name)).toBe(true)
    }
    for (const name of ["a.sh", "b.exe", "c.svg", "d"]) {
      expect(isOpenableExtension(name)).toBe(false)
    }
  })
})

function ctx() {
  return { db: opened.handle.db, project: opened.project }
}
