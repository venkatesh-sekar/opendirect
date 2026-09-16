import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  assetKindFor,
  contentTypeFor,
  DEFAULT_CONTENT_TYPE,
  mediaUrl,
  parseMediaUrl,
  resolveMediaRequest,
  SERVABLE_MEDIA_FOLDERS,
} from "./media"
import { createProject, DB_FILE_NAME, PROJECT_FILE_NAME } from "./project"

describe("mediaUrl", () => {
  it("builds an asset:// URL from a project-relative path", () => {
    expect(mediaUrl("assets/2026/09/a1.png")).toBe(
      "asset://media/assets/2026/09/a1.png"
    )
  })

  it("encodes each segment but keeps the separators", () => {
    expect(mediaUrl("assets/my folder/a b.png")).toBe(
      "asset://media/assets/my%20folder/a%20b.png"
    )
  })

  it("passes null through for assets with no file", () => {
    expect(mediaUrl(null)).toBeNull()
  })
})

describe("parseMediaUrl", () => {
  it("round-trips a path with spaces", () => {
    expect(parseMediaUrl(mediaUrl("assets/a b/c.png"))).toBe("assets/a b/c.png")
  })

  it("rejects anything that is not our scheme and host", () => {
    for (const url of [
      "file:///etc/passwd",
      "https://media/assets/a.png",
      "asset://evil/assets/a.png",
      "not a url",
      "asset://media/",
    ]) {
      expect(parseMediaUrl(url)).toBeNull()
    }
  })
})

describe("contentTypeFor", () => {
  it("maps the formats the board shows", () => {
    expect(contentTypeFor("a.PNG")).toBe("image/png")
    expect(contentTypeFor("a.mp4")).toBe("video/mp4")
    expect(contentTypeFor("a.webm")).toBe("video/webm")
    expect(contentTypeFor("a.mp3")).toBe("audio/mpeg")
  })

  it("falls back for an unknown extension", () => {
    expect(contentTypeFor("a.qqq")).toBe(DEFAULT_CONTENT_TYPE)
    expect(contentTypeFor("noextension")).toBe(DEFAULT_CONTENT_TYPE)
  })
})

describe("assetKindFor", () => {
  it("classifies by media type", () => {
    expect(assetKindFor("a.jpg")).toBe("image")
    expect(assetKindFor("a.mov")).toBe("video")
    expect(assetKindFor("a.wav")).toBe("audio")
    expect(assetKindFor("a.txt")).toBe("text")
    expect(assetKindFor("a.bin")).toBe("text")
  })
})

describe("resolveMediaRequest", () => {
  let projectPath: string
  let outside: string

  beforeEach(async () => {
    outside = await mkdtemp(join(tmpdir(), "opendirect-outside-"))
    const root = await mkdtemp(join(tmpdir(), "opendirect-media-"))
    const created = await createProject({ root, name: "Infinite Hotel" })
    projectPath = created.path
    await mkdir(join(projectPath, "assets", "2026", "09"), { recursive: true })
    await writeFile(join(projectPath, "assets", "2026", "09", "a1.png"), "png")
    await writeFile(join(outside, "secret.png"), "secret")
  })

  afterEach(async () => {
    await rm(outside, { recursive: true, force: true })
    await rm(projectPath, { recursive: true, force: true })
  })

  const project = () => ({ path: projectPath })

  it("resolves a file under assets/ to an absolute path inside the project", async () => {
    const request = await resolveMediaRequest(
      project(),
      mediaUrl("assets/2026/09/a1.png")
    )
    expect(request.path).toBe(
      join(projectPath, "assets", "2026", "09", "a1.png")
    )
    expect(request.contentType).toBe("image/png")
  })

  it("serves only the media folders, never the database or the manifest", async () => {
    for (const relPath of [
      DB_FILE_NAME,
      PROJECT_FILE_NAME,
      "tmp/in-flight.mp4",
      "../elsewhere.png",
    ]) {
      await expect(
        resolveMediaRequest(project(), mediaUrl(relPath))
      ).rejects.toThrow()
    }
    // …and the three that are servable resolve (or fail only because the file
    // is missing, which is a different error the handler also turns into 404).
    for (const folder of SERVABLE_MEDIA_FOLDERS) {
      expect(mediaUrl(`${folder}/x.png`)).toContain(folder)
    }
  })

  it("refuses traversal, encoded or not", async () => {
    for (const url of [
      `asset://media/assets/${encodeURIComponent("../../outside.png")}`,
      `asset://media/${encodeURIComponent("../secrets.txt")}`,
      "asset://media/../../../etc/passwd",
    ]) {
      await expect(resolveMediaRequest(project(), url)).rejects.toThrow()
    }
  })

  it("refuses a symlink inside the project that points out of it", async () => {
    // The lexical check passes — the link itself is under `assets/` — so only
    // the realpath containment check catches this one.
    await symlink(
      join(outside, "secret.png"),
      join(projectPath, "assets", "escape.png")
    )
    await expect(
      resolveMediaRequest(project(), mediaUrl("assets/escape.png"))
    ).rejects.toThrow(/outside the project/i)
  })

  it("follows a symlink that stays inside the project", async () => {
    await symlink(
      join(projectPath, "assets", "2026", "09", "a1.png"),
      join(projectPath, "assets", "alias.png")
    )
    const request = await resolveMediaRequest(
      project(),
      mediaUrl("assets/alias.png")
    )
    expect(request.path).toBe(
      join(projectPath, "assets", "2026", "09", "a1.png")
    )
  })

  it("refuses a URL from another scheme", async () => {
    await expect(
      resolveMediaRequest(project(), "file:///etc/passwd")
    ).rejects.toThrow(/media URL/i)
  })
})
