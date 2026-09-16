import path from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  // Next.js compiles the renderer's JSX itself and its tsconfig says
  // `jsx: "preserve"`, which the transformer cannot emit — so component tests
  // get the automatic runtime spelled out here.
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  resolve: {
    alias: {
      // The renderer's `@/…` alias, so its component tests resolve the same
      // imports Next.js does.
      "@/": `${path.resolve(__dirname, "apps/web")}/`,
    },
  },
  test: {
    environment: "node",
    include: [
      "test/**/*.test.ts",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
