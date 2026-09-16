import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

import {
  assetKindFor,
  contentTypeFor,
  DEFAULT_CONTENT_TYPE,
  mediaUrl,
  parseMediaUrl,
  resolveMediaRequest,
} from "./media"

const project = { path: join(sep, "tmp", "infinite hotel") }

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
  it("resolves to an absolute path inside the project", () => {
    const request = resolveMediaRequest(
      project,
      mediaUrl("assets/2026/09/a1.png")
    )
    expect(request.path).toBe(
      join(project.path, "assets", "2026", "09", "a1.png")
    )
    expect(request.contentType).toBe("image/png")
  })

  it("never resolves outside the project folder", () => {
    // A standard URL collapses its own `..` segments, so those land harmlessly
    // inside the project; a percent-encoded one survives parsing and has to be
    // rejected by `resolveAssetPath`. Either outcome is acceptable — escaping
    // the folder is not.
    for (const url of [
      "asset://media/../../../etc/passwd",
      `asset://media/${encodeURIComponent("../secrets.txt")}`,
      `asset://media/assets/${encodeURIComponent("../../outside.png")}`,
    ]) {
      let resolved: string | undefined
      try {
        resolved = resolveMediaRequest(project, url).path
      } catch {
        continue
      }
      expect(resolved.startsWith(project.path + sep)).toBe(true)
    }
  })

  it("refuses a URL from another scheme", () => {
    expect(() => resolveMediaRequest(project, "file:///etc/passwd")).toThrow(
      /media URL/i
    )
  })
})
