import { afterEach, describe, expect, it, vi } from "vitest"

/** The production config, read the way `next build` sees it. */
async function productionConfig() {
  vi.stubEnv("NODE_ENV", "production")
  vi.resetModules()
  return (await import("./next.config")).default
}

/**
 * The URL a chunk request resolves to from a given page. Next.js strips the
 * prefix's trailing slash and appends `/_next/…`, so `"./"` becomes
 * `./_next/…` — relative to whatever page happens to be loaded.
 */
function chunkUrlFrom(page: string, assetPrefix: string | undefined): string {
  const prefix = (assetPrefix ?? "").replace(/\/$/, "")
  return new URL(`${prefix}/_next/static/chunks/app.js`, page).href
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("next.config assetPrefix", () => {
  it.each([
    "app://-/",
    "app://-/characters/",
    "app://-/container/?id=abc",
    "app://-/canvas/",
  ])(
    "resolves chunks from the export root when the page is %s",
    async (page) => {
      // electron-serve registers `app://` as a standard scheme and serves the
      // export from `app://-/`, so `/_next/…` always lands in `out/_next/`.
      // A page-relative prefix sends chunks for nested routes to
      // `app://-/characters/_next/…`, which 404s as a ChunkLoadError after a
      // client-side navigation or a reload.
      const { assetPrefix } = await productionConfig()
      expect(chunkUrlFrom(page, assetPrefix)).toBe(
        "app://-/_next/static/chunks/app.js"
      )
    }
  )
})
