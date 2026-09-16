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
  // `electron` is provided by the runtime and `better-sqlite3` is a native
  // module electron-builder rebuilds per platform, so both stay external.
  external: ["electron", "better-sqlite3"],
  // `electron-serve` v3 is ESM-only; a CommonJS main process cannot `require`
  // it, so it is bundled into the output instead of left as a bare import.
  noExternal: ["electron-serve"],
})
