/**
 * The project folder on disk, and the handle to the database inside it.
 *
 * A project is a plain directory the user can move, zip or sync:
 *
 * ```
 * Infinite Hotel/
 *   project.json        ← id, name, createdAt (the source of truth)
 *   opendirect.db       ← SQLite, migrated on every open
 *   assets/<yyyy>/<mm>/ ← imported media
 *   generations/<id>/   ← model outputs, one folder per generation
 *   thumbnails/         ← derived previews, safe to delete
 *   tmp/                ← in-flight downloads, cleared on open
 * ```
 *
 * Electron-free by design (see `docs/DEVELOPMENT.md`): everything here is
 * exercised in plain Node against temp directories. `project-service.ts` binds
 * it to `electron-store` and the packaged migrations folder.
 */
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

import { z } from "zod"

import { createDatabase, type DatabaseHandle } from "./db/client"
import { resolveMigrationsFolder, runMigrations } from "./db/migrate"
import { projects } from "./db/schema"

/** Sub-directories every project folder has. Re-created on open if removed. */
export const PROJECT_DIRECTORIES = [
  "assets",
  "generations",
  "thumbnails",
  "tmp",
] as const

export const DB_FILE_NAME = "opendirect.db"
export const PROJECT_FILE_NAME = "project.json"

/** Bump only for a change `migrate.ts` cannot handle on its own. */
export const PROJECT_MANIFEST_VERSION = 1

export interface ProjectRef {
  id: string
  name: string
  /** Absolute path of the project folder. */
  path: string
  createdAt: number
}

const manifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
})

export interface OpenProject {
  readonly project: ProjectRef
  readonly handle: DatabaseHandle
  close(): void
}

interface ProjectOptions {
  /** Overridden by `project-service.ts` when running out of `app.asar`. */
  migrationsFolder?: string
}

export interface CreateProjectOptions extends ProjectOptions {
  /** Directory the new project folder is created *inside*. */
  root: string
  name: string
  id?: string
  now?: number
}

const defaultMigrationsFolder = (): string => resolveMigrationsFolder(__dirname)

/**
 * A lowercase, ASCII, filesystem-safe directory name. Purely cosmetic — the id
 * in `project.json`, not the folder name, identifies a project.
 */
export function projectDirectoryName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "project"
}

/** `infinite-hotel`, `infinite-hotel-2`, … — never overwrites a sibling. */
function uniqueDirectory(root: string, base: string): string {
  let candidate = join(root, base)
  for (let suffix = 2; existsSync(candidate); suffix += 1) {
    candidate = join(root, `${base}-${suffix}`)
  }
  return candidate
}

async function ensureLayout(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  for (const directory of PROJECT_DIRECTORIES) {
    await mkdir(join(path, directory), { recursive: true })
  }
}

/**
 * Opens the database, migrates it and mirrors the manifest into the `projects`
 * row. The row is a mirror, not the source of truth: the folder may have been
 * moved since it was written, so `path` is refreshed on every open.
 */
function openDatabase(
  project: ProjectRef,
  migrationsFolder: string
): DatabaseHandle {
  const handle = createDatabase(join(project.path, DB_FILE_NAME))
  try {
    runMigrations(handle, migrationsFolder)
    handle.db
      .insert(projects)
      .values({
        id: project.id,
        name: project.name,
        path: project.path,
        createdAt: project.createdAt,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: { name: project.name, path: project.path },
      })
      .run()
    return handle
  } catch (error) {
    handle.close()
    throw error
  }
}

/** Creates a brand-new project folder under `root`. */
export async function createProject(
  options: CreateProjectOptions
): Promise<ProjectRef> {
  const name = options.name.trim()
  if (!name) throw new Error("A project name is required")

  const project: ProjectRef = {
    id: options.id ?? randomUUID(),
    name,
    path: uniqueDirectory(options.root, projectDirectoryName(name)),
    createdAt: options.now ?? Date.now(),
  }

  await ensureLayout(project.path)
  await writeFile(
    join(project.path, PROJECT_FILE_NAME),
    `${JSON.stringify(
      {
        schemaVersion: PROJECT_MANIFEST_VERSION,
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
      },
      null,
      2
    )}\n`,
    "utf8"
  )

  openDatabase(
    project,
    options.migrationsFolder ?? defaultMigrationsFolder()
  ).close()

  return project
}

/**
 * Opens an existing project folder. Safe to call repeatedly: the layout is
 * restored, migrations are re-applied (a no-op once they have run) and the id
 * always comes from `project.json`.
 *
 * The caller owns the returned handle and must `close()` it.
 */
export async function openProject(
  path: string,
  options: ProjectOptions = {}
): Promise<OpenProject> {
  const projectPath = resolve(path)
  const manifestPath = join(projectPath, PROJECT_FILE_NAME)

  let raw: string
  try {
    raw = await readFile(manifestPath, "utf8")
  } catch {
    throw new Error(`${projectPath} is not an OpenDirect project folder`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${PROJECT_FILE_NAME} in ${projectPath} is not valid JSON`)
  }

  const manifest = manifestSchema.safeParse(parsed)
  if (!manifest.success) {
    throw new Error(`${PROJECT_FILE_NAME} in ${projectPath} is malformed`)
  }

  const project: ProjectRef = {
    id: manifest.data.id,
    name: manifest.data.name,
    path: projectPath,
    createdAt: manifest.data.createdAt,
  }

  await ensureLayout(projectPath)
  // Half-finished downloads from a previous run are worthless and can be large.
  await rm(join(projectPath, "tmp"), { recursive: true, force: true })
  await mkdir(join(projectPath, "tmp"), { recursive: true })

  const handle = openDatabase(
    project,
    options.migrationsFolder ?? defaultMigrationsFolder()
  )

  return {
    project,
    handle,
    close: () => handle.close(),
  }
}

/**
 * Where a file belongs inside the project, as a POSIX relative path (the value
 * stored in `assets.rel_path`).
 *
 * The plan names one helper for both layouts; it is a discriminated union
 * rather than positional arguments because a generation output is addressed by
 * `(generationId, index)` and an upload by `(id, date)`.
 */
export type AssetPathSpec =
  | { source: "upload"; id: string; ext: string; now?: Date }
  | { source: "generation"; generationId: string; index: number; ext: string }

function normalizeExtension(ext: string): string {
  return ext.replace(/^\.+/, "").toLowerCase()
}

export function assetRelPath(spec: AssetPathSpec): string {
  const ext = normalizeExtension(spec.ext)
  if (spec.source === "generation") {
    return `generations/${spec.generationId}/${spec.index}.${ext}`
  }
  // Uploads are bucketed by month so no single directory grows unbounded —
  // some filesystems get slow well before a busy project runs out of ids.
  const now = spec.now ?? new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, "0")
  return `assets/${year}/${month}/${spec.id}.${ext}`
}

/**
 * Absolute path of a stored asset.
 *
 * Throws rather than returning a path outside the project: `rel_path` reaches
 * the renderer and comes back, so it is untrusted input on the way in.
 */
export function resolveAssetPath(
  project: Pick<ProjectRef, "path">,
  relPath: string
): string {
  const root = resolve(project.path)
  const target = resolve(root, relPath)
  const rel = relative(root, target)
  // `startsWith("..")` alone would also reject a legitimate `..hidden` name;
  // only the traversal segment itself and anything under it escapes the root.
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Refusing a path outside the project: ${relPath}`)
  }
  return target
}

/**
 * The same check, after the filesystem has had its say.
 *
 * `resolveAssetPath` is lexical, which is the right first test — it costs
 * nothing and refuses an obvious `../` before any attacker-chosen path is
 * touched. It cannot see a *symlink*, though: a link planted under `assets/`
 * is lexically inside the project and really points at `~/.ssh/id_rsa`. So
 * anything about to be handed to the operating system — the media protocol,
 * `shell.openPath`, `shell.showItemInFolder` — resolves the real path and
 * checks containment again.
 *
 * Rejects a file that does not exist, because `realpath` cannot answer for one
 * and "it is not there" is the honest answer to every caller here.
 */
export async function realAssetPath(
  project: Pick<ProjectRef, "path">,
  relPath: string
): Promise<string> {
  const lexical = resolveAssetPath(project, relPath)
  const root = await realpath(project.path)
  const target = await realpath(lexical)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Refusing a path outside the project: ${relPath}`)
  }
  return target
}

/** The slice of `electron-store` the recent-projects list needs. */
export interface RecentProjectsStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

export const RECENT_PROJECTS_KEY = "recentProjects"
const DEFAULT_RECENT_LIMIT = 10

export interface RecentProject extends ProjectRef {
  lastOpenedAt: number
}

const recentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  lastOpenedAt: z.number().int().nonnegative(),
})

export interface RecentProjects {
  list(): RecentProject[]
  remember(project: ProjectRef, now?: number): RecentProject[]
  forget(path: string): RecentProject[]
}

/**
 * Most-recent-first, de-duplicated by path and capped.
 *
 * A malformed entry is dropped instead of throwing: a hand-edited settings
 * file must not stop the app from starting.
 */
export function createRecentProjects(
  store: RecentProjectsStore,
  options: { limit?: number } = {}
): RecentProjects {
  const limit = options.limit ?? DEFAULT_RECENT_LIMIT

  function read(): RecentProject[] {
    const raw = store.get(RECENT_PROJECTS_KEY)
    if (!Array.isArray(raw)) return []
    return raw.flatMap((entry) => {
      const parsed = recentSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
  }

  function write(entries: RecentProject[]): RecentProject[] {
    const capped = entries.slice(0, limit)
    store.set(RECENT_PROJECTS_KEY, capped)
    return capped
  }

  return {
    list: read,
    remember(project, now = Date.now()) {
      const rest = read().filter((entry) => entry.path !== project.path)
      return write([{ ...project, lastOpenedAt: now }, ...rest])
    },
    forget(path) {
      return write(read().filter((entry) => entry.path !== path))
    },
  }
}
