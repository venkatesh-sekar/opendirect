import { defineConfig } from "drizzle-kit"

/**
 * `drizzle-kit generate` only reads the schema — it never opens a database, so
 * `dbCredentials` here is a placeholder that exists purely to satisfy the CLI
 * (and to point `drizzle-kit studio` at a throwaway file). The real databases
 * live inside project folders and are migrated at runtime by
 * `src/main/db/migrate.ts`, never by the CLI.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/main/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: { url: "file:./.drizzle/scratch.db" },
})
