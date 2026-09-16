import { describe, expect, it } from "vitest"

import { cspMetaIsFirst, hoistCspMeta, RENDERER_CSP } from "./csp"

const META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'"/>'
const SCRIPT = '<script src="/a.js" async=""></script>'

describe("RENDERER_CSP", () => {
  it("locks the renderer to its own bundle", () => {
    expect(RENDERER_CSP).toContain("default-src 'self'")
    expect(RENDERER_CSP).toContain("object-src 'none'")
    expect(RENDERER_CSP).not.toContain("unsafe-eval")
  })
})

describe("hoistCspMeta", () => {
  it("moves the tag ahead of scripts React emitted before it", () => {
    // A meta policy only governs what the parser sees after it, so a tag left
    // behind the async script tags would not cover them.
    const html = `<html><head>${SCRIPT}${META}</head><body></body></html>`
    expect(hoistCspMeta(html)).toBe(
      `<html><head>${META}${SCRIPT}</head><body></body></html>`
    )
  })

  it("is idempotent once the tag is already first", () => {
    const html = `<html><head>${META}${SCRIPT}</head><body></body></html>`
    expect(hoistCspMeta(html)).toBe(html)
  })

  it("handles a head element carrying attributes", () => {
    const html = `<head data-x="1">${SCRIPT}${META}</head>`
    expect(hoistCspMeta(html)).toBe(`<head data-x="1">${META}${SCRIPT}</head>`)
  })

  it("leaves a document without a CSP tag alone", () => {
    const html = `<html><head>${SCRIPT}</head></html>`
    expect(hoistCspMeta(html)).toBe(html)
  })

  it("leaves a document without a head alone", () => {
    expect(hoistCspMeta(`<body>${META}</body>`)).toBe(`<body>${META}</body>`)
  })

  /**
   * The distinction the build step turns into an exit code: `hoistCspMeta`
   * returns the input unchanged both when there is nothing to do and when
   * there is nothing it can do, and only one of those is a passing build.
   */
  it("tells an already-hoisted tag apart from one it could not move", () => {
    expect(cspMetaIsFirst(`<html><head>${META}${SCRIPT}</head></html>`)).toBe(
      true
    )
    expect(cspMetaIsFirst(`<html><head>${SCRIPT}${META}</head></html>`)).toBe(
      false
    )
    // No tag at all, and no head at all, are both "not first".
    expect(cspMetaIsFirst(`<html><head>${SCRIPT}</head></html>`)).toBe(false)
    expect(cspMetaIsFirst(`<body>${META}</body>`)).toBe(false)
  })

  it("ignores the escaped copy inside the RSC flight payload", () => {
    // The payload mentions the policy as JSON, not as a tag; rewriting it would
    // corrupt hydration data.
    const payload =
      '<script>self.__next_f.push([1,"[\\"$\\",\\"meta\\",null,{\\"httpEquiv\\":\\"Content-Security-Policy\\"}]"])</script>'
    const html = `<html><head>${META}${payload}</head></html>`
    expect(hoistCspMeta(html)).toBe(html)
  })
})
