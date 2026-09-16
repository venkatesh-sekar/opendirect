import { describe, expect, it } from "vitest"

import {
  APP_ORIGIN,
  isAllowedExternalUrl,
  isInternalNavigation,
  PRODUCTION_CSP,
} from "./security"

describe("isAllowedExternalUrl", () => {
  it("allows plain web URLs", () => {
    expect(isAllowedExternalUrl("https://replicate.com/docs")).toBe(true)
    expect(isAllowedExternalUrl("http://localhost:3000/")).toBe(true)
  })

  it("rejects every non-http(s) scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "app://-/index.html",
      "smb://share/x",
      "vscode://file/etc/passwd",
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false)
    }
  })

  it("rejects unparseable input", () => {
    expect(isAllowedExternalUrl("not a url")).toBe(false)
    expect(isAllowedExternalUrl("")).toBe(false)
  })
})

describe("isInternalNavigation", () => {
  it("keeps same-origin dev server navigation in-window", () => {
    expect(
      isInternalNavigation(
        "http://localhost:3000/settings/",
        "http://localhost:3000"
      )
    ).toBe(true)
  })

  it("keeps app:// navigation in-window in production", () => {
    expect(
      isInternalNavigation("app://-/settings/index.html", APP_ORIGIN)
    ).toBe(true)
    expect(APP_ORIGIN).toBe("app://-")
  })

  it("blocks a different origin, port or scheme", () => {
    expect(
      isInternalNavigation("https://evil.example/", "http://localhost:3000")
    ).toBe(false)
    expect(
      isInternalNavigation("http://localhost:4000/", "http://localhost:3000")
    ).toBe(false)
    expect(isInternalNavigation("http://localhost:3000/", APP_ORIGIN)).toBe(
      false
    )
    expect(isInternalNavigation("app://evil/index.html", APP_ORIGIN)).toBe(
      false
    )
    expect(isInternalNavigation("file:///etc/passwd", APP_ORIGIN)).toBe(false)
  })

  it("blocks unparseable input", () => {
    expect(isInternalNavigation("not a url", APP_ORIGIN)).toBe(false)
  })
})

describe("PRODUCTION_CSP", () => {
  it("locks the renderer to its own bundle", () => {
    expect(PRODUCTION_CSP).toContain("default-src 'self'")
    expect(PRODUCTION_CSP).toContain("object-src 'none'")
    expect(PRODUCTION_CSP).toContain("frame-ancestors 'none'")
    expect(PRODUCTION_CSP).not.toContain("unsafe-eval")
    expect(PRODUCTION_CSP).not.toContain("*")
  })

  it("allows the inline script and style a Next.js static export emits", () => {
    expect(PRODUCTION_CSP).toContain("script-src 'self' 'unsafe-inline'")
    expect(PRODUCTION_CSP).toContain("style-src 'self' 'unsafe-inline'")
  })
})
