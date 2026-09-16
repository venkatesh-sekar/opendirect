import { cpSync } from "node:fs"
import { join } from "node:path"

import { defineConfig } from "tsup"

// Main and preload share one config: tsup runs multiple configs in parallel, so
// a second config with `clean: true` can race and wipe the other's output.
export default defineConfig({
  entry: {
    "main/index": "src/main/index.ts",
    "preload/index": "src/preload/index.ts",
  },
  outDir: "dist",
  format: ["cjs"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // `electron` is provided by the runtime; `better-sqlite3` and `sharp` are
  // native modules with their own platform binaries (and, for sharp, sibling
  // `@img/*` packages resolved at runtime), so all three stay external.
  external: ["electron", "better-sqlite3", "sharp"],
  // `electron-serve` v3 is ESM-only; a CommonJS main process cannot `require`
  // it, so it is bundled into the output instead of left as a bare import.
  // `electron-store` v11 and `p-queue` v9 are likewise ESM-only.
  // `@opendirect/contract` is a workspace package published as TypeScript source,
  // so it must be bundled rather than required at runtime.
  //
  // `zod` is bundled for a different reason: it is the contract's dependency and
  // the preload validates channel names with it, but the preload runs with
  // `sandbox: true`, where `require` resolves only `electron` and a handful of
  // builtins. Left external, `require("zod")` would throw before the bridge was
  // ever exposed and the window would come up with no IPC at all.
  noExternal: [
    "electron-serve",
    "electron-store",
    "p-queue",
    "@opendirect/contract",
    "zod",
  ],
  // The generated migration SQL is data, not code: tsup cannot bundle it, and
  // `resolveMigrationsFolder()` looks for it one level above the main bundle.
  // Copying it into `dist` puts it inside app.asar with everything else.
  onSuccess: async () => {
    cpSync(join(__dirname, "drizzle"), join(__dirname, "dist", "drizzle"), {
      recursive: true,
    })
  },
})
