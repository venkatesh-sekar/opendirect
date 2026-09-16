/**
 * Opens a project's SQLite file.
 *
 * Electron-free on purpose: the tests drive this against Node's better-sqlite3
 * build with `:memory:` or a temp file, exactly as `settings.ts` is driven
 * against fakes. The only Electron-specific part of the data layer is *where*
 * the file lives, and that is `project-service.ts`'s problem.
 *
 * ⚠️ `better-sqlite3` is a native module: the copy Node loads here is compiled
 * against Node's ABI, and the copy the packaged app loads is compiled against
 * Electron's. See `docs/DEVELOPMENT.md` → "Native modules".
 */
import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"

import * as schema from "./schema"

export type ProjectDatabase = BetterSQLite3Database<typeof schema>

export interface DatabaseHandle {
  /** The raw driver — needed for pragmas, recursive CTEs and `close()`. */
  readonly sqlite: Database.Database
  readonly db: ProjectDatabase
  close(): void
}

/** In-memory databases have no journal to switch and no file to fsync. */
const IN_MEMORY = new Set([":memory:", ""])

export function createDatabase(path: string): DatabaseHandle {
  const sqlite = new Database(path)

  if (!IN_MEMORY.has(path)) {
    // Readers never block the writer, which matters because the job runner
    // writes poll results while the board is querying.
    sqlite.pragma("journal_mode = WAL")
    // WAL already guarantees integrity across a process crash; NORMAL trades a
    // power-loss window for not fsyncing on every commit.
    sqlite.pragma("synchronous = NORMAL")
  }
  // Off by default in SQLite — without this the schema's cascades are decoration.
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")

  const db = drizzle(sqlite, { schema })

  return {
    sqlite,
    db,
    close() {
      if (sqlite.open) sqlite.close()
    },
  }
}
