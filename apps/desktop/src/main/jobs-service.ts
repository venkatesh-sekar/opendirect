/**
 * Electron-bound wiring for the job runner.
 *
 * Same split as `catalog.ts` / `catalog-service.ts`: `jobs/runner.ts` knows
 * about a database, a provider and a clock, and nothing about Electron, so it
 * can be tested in plain Node. This file supplies the four things only the
 * desktop process can: the open project, the live settings, the provider
 * registry, and the windows a `jobs:update` event is pushed to.
 *
 * The runner is bound to one project. Opening another disposes the old one, so
 * a run can never write into a project the user has closed.
 */
import type { JobDto } from "@opendirect/contract"
import { BrowserWindow } from "electron"
import log from "electron-log/main"

import { getModelCatalog } from "./catalog-service"
import { emitIpcEvent } from "./ipc-registry"
import { createJobRunner, type JobRunner } from "./jobs/runner"
import { getCurrentProject } from "./project-service"
import { requireProvider } from "./providers/registry"
import { getSettingsService } from "./settings-service"

let runner: JobRunner | undefined
let boundProjectId: string | undefined

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

/** The runner for the open project, built on first use. */
export function getJobRunner(): JobRunner {
  const current = getCurrentProject()
  if (!current) throw new Error("No project is open")
  if (runner && boundProjectId === current.project.id) return runner

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
    getModel: (key) => getModelCatalog().getModel(key),
    onUpdate: broadcast,
    log: (message, error) => log.warn(message, error),
  })
  boundProjectId = current.project.id
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
  boundProjectId = undefined
}
