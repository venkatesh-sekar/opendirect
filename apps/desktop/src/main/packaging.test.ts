import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { PACKAGED_RENDERER_DIR } from "./resolve"

const configPath = join(__dirname, "..", "..", "electron-builder.yml")
const config = readFileSync(configPath, "utf8")

describe("electron-builder.yml", () => {
  it("copies the Next.js static export to the directory the main process reads", () => {
    // resolveRendererDirectory() serves `<resources>/<PACKAGED_RENDERER_DIR>`;
    // if this `to:` ever changes, a packaged build shows a blank window.
    expect(config).toContain("- from: ../web/out")
    expect(config).toContain(`to: ${PACKAGED_RENDERER_DIR}`)
  })

  it("unpacks native modules from the asar so better-sqlite3 can dlopen", () => {
    expect(config).toContain('- "**/*.node"')
  })

  it("rebuilds native modules against Electron's ABI", () => {
    // better-sqlite3 ships Node-API prebuilds, so this is a safety net rather
    // than a requirement today — but a native dependency that is *not*
    // Node-API would silently fail to load in the packaged app without it.
    expect(config).toContain("npmRebuild: true")
  })

  it("publishes to GitHub Releases, which is the electron-updater feed", () => {
    expect(config).toContain("provider: github")
  })

  it("builds installers for all three desktop platforms", () => {
    for (const key of ["mac:", "win:", "linux:"]) {
      expect(config).toContain(key)
    }
  })

  it("hardens and signs macOS builds with entitlements that exist", () => {
    expect(config).toContain("hardenedRuntime: true")
    const entitlements = readFileSync(
      join(__dirname, "..", "..", "build", "entitlements.mac.plist"),
      "utf8"
    )
    // disable-library-validation is what lets the unsigned better-sqlite3
    // prebuild load inside a hardened runtime.
    expect(entitlements).toContain(
      "com.apple.security.cs.disable-library-validation"
    )
    expect(entitlements).toContain("com.apple.security.cs.allow-jit")
    expect(entitlements).toContain("com.apple.security.inherit")
  })
})

describe("tsup.config.ts", () => {
  const tsupConfig = readFileSync(
    join(__dirname, "..", "..", "tsup.config.ts"),
    "utf8"
  )

  it("copies the generated migrations next to the bundled main process", () => {
    // `resolveMigrationsFolder()` looks for `dist/drizzle`; without this copy a
    // packaged app throws "Can't find meta/_journal.json" on first open.
    expect(tsupConfig).toContain('"drizzle"')
    expect(tsupConfig).toContain("cpSync")
  })
})
