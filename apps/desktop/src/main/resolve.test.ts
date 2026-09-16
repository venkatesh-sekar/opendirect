import { describe, expect, it } from "vitest"

import {
  DEFAULT_DEV_SERVER_URL,
  isDevelopment,
  resolveDevServerUrl,
  resolvePreloadPath,
  resolveRendererDirectory,
} from "./resolve"

describe("isDevelopment", () => {
  it("is true only when NODE_ENV is exactly 'development'", () => {
    expect(isDevelopment({ NODE_ENV: "development" })).toBe(true)
    expect(isDevelopment({ NODE_ENV: "production" })).toBe(false)
    expect(isDevelopment({})).toBe(false)
  })
})

describe("resolveDevServerUrl", () => {
  it("falls back to the Next.js dev server on localhost:3000", () => {
    expect(resolveDevServerUrl({})).toBe(DEFAULT_DEV_SERVER_URL)
    expect(DEFAULT_DEV_SERVER_URL).toBe("http://localhost:3000")
  })

  it("honours an explicit OPENDIRECT_DEV_SERVER_URL override", () => {
    expect(
      resolveDevServerUrl({
        OPENDIRECT_DEV_SERVER_URL: "http://127.0.0.1:4000",
      })
    ).toBe("http://127.0.0.1:4000")
  })

  it("ignores a blank override rather than loading an empty URL", () => {
    expect(resolveDevServerUrl({ OPENDIRECT_DEV_SERVER_URL: "   " })).toBe(
      DEFAULT_DEV_SERVER_URL
    )
  })
})

describe("resolveRendererDirectory", () => {
  it("points at the web workspace's static export from the built main dir", () => {
    // dist/main lives at apps/desktop/dist/main; the export is apps/web/out.
    expect(resolveRendererDirectory("/repo/apps/desktop/dist/main")).toBe(
      "/repo/apps/web/out"
    )
  })

  it("normalises a trailing separator", () => {
    expect(resolveRendererDirectory("/repo/apps/desktop/dist/main/")).toBe(
      "/repo/apps/web/out"
    )
  })
})

describe("resolvePreloadPath", () => {
  it("resolves the preload bundle as a sibling of the main bundle", () => {
    expect(resolvePreloadPath("/repo/apps/desktop/dist/main")).toBe(
      "/repo/apps/desktop/dist/preload/index.js"
    )
  })
})
