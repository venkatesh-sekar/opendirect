/**
 * Electron-bound wiring for the job runner.
 *
 * Same split as `catalog.ts` / `catalog-service.ts`: `jobs/runner.ts` knows
 * about a database, a provider and a clock, and nothing about Electron, so it
 * can be tested in plain Node. This file supplies the four things only the
 * desktop process can: the open project, the live settings, the provider
 * registry, and the windows a `jobs:update` event is pushed to.
 *
 * The runner is bound to one *open database handle*, not to a project id.
 * `openProjectAt` opens a second handle and closes the first even when the path
 * is the same one — re-opening the project already open is exactly what the
 * launcher does after startup has restored it — so a runner kept on an id match
 * would go on holding a connection that has been closed under it.
 */
import type { JobDto } from "@opendirect/contract"
import { BrowserWindow } from "electron"
import log from "electron-log/main"

import type { ProjectDatabase } from "./db/client"
import { emitIpcEvent } from "./ipc-registry"
import { createJobRunner, type JobRunner } from "./jobs/runner"
import { annotatedModel } from "./model-registry/registry-service"
import { getCurrentProject } from "./project-service"
import { requireProvider } from "./providers/registry"
import { getSettingsService } from "./settings-service"

let runner: JobRunner | undefined
/** The exact database the live runner holds — identity, not equality. */
let boundDb: ProjectDatabase | undefined

/** Every live window sees every job update; the job list may be open in any. */
function broadcast(job: JobDto): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      emitIpcEvent(window.webContents, "jobs:update", job)
    } catch (error) {
      log.warn("Could not push a job update", error)
    }
  }
}

/** The runner for the open project, built on first use and after a re-open. */
export function getJobRunner(): JobRunner {
  const current = getCurrentProject()
  if (!current) throw new Error("No project is open")
  if (runner && boundDb === current.handle.db) return runner

  runner?.dispose()
  runner = createJobRunner({
    db: current.handle.db,
    project: current.project,
    getProvider: requireProvider,
    // Read on every enqueue and every poll, so changing either setting takes
    // effect on the next tick rather than at the next restart.
    settings: () => {
      const settings = getSettingsService().settings.get()
      return {
        maxConcurrentJobs: settings.maxConcurrentJobs,
        pollIntervalMs: settings.pollIntervalMs,
      }
    },
    // Annotated, so a mapped slot's shape reaches the runner.
    getModel: (key) => annotatedModel(key),
    onUpdate: broadcast,
    log: (message, error) => log.warn(message, error),
  })
  boundDb = current.handle.db
  return runner
}

/**
 * Crash recovery, run once at startup: jobs whose provider job is still alive
 * are re-attached, and jobs interrupted mid-submit are failed rather than
 * silently re-submitted. Never fatal — a project that cannot be recovered still
 * opens.
 */
export async function recoverJobs(): Promise<void> {
  try {
    const recovered = await getJobRunner().recover()
    if (recovered.length > 0) {
      log.info(`Recovered ${recovered.length} job(s) from the last session`)
    }
  } catch (error) {
    log.warn("Could not recover jobs from the last session", error)
  }
}

/** Stops the runner on quit or when the project closes. */
export function stopJobRunner(): void {
  runner?.dispose()
  runner = undefined
  boundDb = undefined
}
