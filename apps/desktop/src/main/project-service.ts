/**
 * Electron-bound wiring for `project.ts`.
 *
 * `project.ts` knows the folder layout and the database; this knows where the
 * user keeps their projects, where the migrations ended up inside `app.asar`,
 * and how to remember what was open last — the same split as
 * `settings.ts` / `settings-service.ts`.
 */
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { app } from "electron"
import log from "electron-log/main"

import { resolveMigrationsFolder } from "./db/migrate"
import {
  createProject,
  createRecentProjects,
  openProject,
  PROJECT_FILE_NAME,
  type OpenProject,
  type ProjectRef,
  type RecentProjects,
} from "./project"
import { getSettingsService } from "./settings-service"

/** Folder created under the user's documents when no `projectRoot` is set. */
export const DEFAULT_PROJECT_FOLDER = "OpenDirect"

let recent: RecentProjects | undefined
let current: OpenProject | undefined

/** Run just before the open project's database handle is closed. */
export type ProjectCloseListener = (project: OpenProject) => void

const closeListeners = new Set<ProjectCloseListener>()

/**
 * Subscribes to "the open project is about to close".
 *
 * This exists so `jobs-service.ts` can drop its runner the moment the project
 * goes rather than at whatever later point someone next asks for one — its poll
 * timers would otherwise keep querying a closed connection. It is a callback
 * rather than a direct call because the dependency only runs one way: the job
 * runner needs the project, and this module must not need the job runner.
 *
 * `index.ts` does the wiring, as it does for every other cross-service edge.
 */
export function onProjectClose(listener: ProjectCloseListener): () => void {
  closeListeners.add(listener)
  return () => {
    closeListeners.delete(listener)
  }
}

/**
 * Where the generated SQL lives once tsup has bundled the main process.
 *
 * Resolved from this module's `__dirname`, which is `dist/main` in a packaged
 * app, so it finds `dist/drizzle` inside `app.asar`.
 */
export function migrationsFolder(): string {
  return resolveMigrationsFolder(__dirname)
}

export function getRecentProjects(): RecentProjects {
  recent ??= createRecentProjects(getSettingsService().store)
  return recent
}

/** The configured project root, or `~/Documents/OpenDirect`. */
export function projectRoot(): string {
  const configured = getSettingsService().settings.get().projectRoot
  return configured ?? join(app.getPath("documents"), DEFAULT_PROJECT_FOLDER)
}

export async function createProjectInRoot(name: string): Promise<ProjectRef> {
  const project = await createProject({
    root: projectRoot(),
    name,
    migrationsFolder: migrationsFolder(),
  })
  getRecentProjects().remember(project)
  return project
}

/**
 * Opens a project folder, migrating it, and makes it the current one. Closing
 * the previous handle here is what keeps the WAL files from piling up.
 *
 * Opening the project that is *already* open is a no-op beyond the recency
 * bump. Re-opening it would hand back a second handle and close the first, and
 * everything holding that first one — the job runner above all — would be left
 * with a connection someone else had closed. The launcher does exactly this:
 * startup restores the last project, and then the user clicks it in the list.
 */
export async function openProjectAt(path: string): Promise<OpenProject> {
  const open = current
  if (open && resolve(path) === open.project.path) {
    getRecentProjects().remember(open.project)
    return open
  }

  const opened = await openProject(path, {
    migrationsFolder: migrationsFolder(),
  })
  closeCurrentProject()
  current = opened
  getRecentProjects().remember(opened.project)
  return opened
}

export function getCurrentProject(): OpenProject | undefined {
  return current
}

/**
 * Listeners run before the handle closes, and with `current` already cleared —
 * so a listener that asks what is open gets the honest answer ("nothing")
 * rather than a project that is halfway through going away.
 */
export function closeCurrentProject(): void {
  const closing = current
  current = undefined
  if (!closing) return

  for (const listener of closeListeners) {
    try {
      listener(closing)
    } catch (error) {
      // A listener that throws must not leave the database handle open.
      log.warn("A project-close listener failed", error)
    }
  }

  closing.close()
}

/**
 * Startup migration runner: re-opens the most recently used project so its
 * database is migrated before any window can query it.
 *
 * Never fatal — a project folder the user deleted, moved or put on an
 * unmounted drive is dropped from the list and the app starts with none open.
 */
export async function restoreLastProject(): Promise<OpenProject | undefined> {
  const entries = getRecentProjects().list()
  for (const entry of entries) {
    if (!existsSync(join(entry.path, PROJECT_FILE_NAME))) {
      getRecentProjects().forget(entry.path)
      continue
    }
    try {
      return await openProjectAt(entry.path)
    } catch (error) {
      log.warn(`Could not open the last project at ${entry.path}`, error)
      getRecentProjects().forget(entry.path)
    }
  }
  return undefined
}

/** Test/hot-reload seam. Leaves the close listeners in place: they are wired
 *  once at startup and are not part of what a reset is resetting. */
export function resetProjectService(): void {
  closeCurrentProject()
  recent = undefined
}
