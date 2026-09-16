/**
 * Applies the generated migrations in `apps/desktop/drizzle` to a project
 * database. Runs on every open, not just on create: a project folder created
 * by an older build must catch up before a single query touches it.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"

import { migrate } from "drizzle-orm/better-sqlite3/migrator"

import type { DatabaseHandle } from "./client"

/** Directory name holding the generated SQL, both in source and in `dist`. */
export const MIGRATIONS_DIR = "drizzle"

/**
 * Idempotent: drizzle records what it has applied in `__drizzle_migrations`
 * and skips those on the next run.
 */
export function runMigrations(
  handle: DatabaseHandle,
  migrationsFolder: string
): void {
  migrate(handle.db, { migrationsFolder })
}

/**
 * Nearest `drizzle/` directory above `fromDir` (which is always a `__dirname`).
 *
 * tsup copies `drizzle/` to `dist/drizzle` (see `tsup.config.ts`), so the
 * bundled `dist/main/index.js` finds it one level up and ships it inside
 * `app.asar`; the deeper candidates cover importing the TypeScript straight
 * from `src/main` or `src/main/db` in tests. `exists` is injected so the lookup
 * order is testable without a packaged app.
 */
export function resolveMigrationsFolder(
  fromDir: string,
  exists: (path: string) => boolean = existsSync
): string {
  const candidates = [
    join(fromDir, "..", MIGRATIONS_DIR),
    join(fromDir, "..", "..", MIGRATIONS_DIR),
    join(fromDir, "..", "..", "..", MIGRATIONS_DIR),
  ]
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0]!
}
