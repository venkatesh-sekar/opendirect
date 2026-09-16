import { app, BrowserWindow, Menu } from "electron"
import log from "electron-log/main"

import { initAiTools, stopAiRuns } from "./ai/ai-service"
import { disposeIpcHandlers, registerIpcHandlers } from "./ipc"
import { recoverJobs, stopJobRunner } from "./jobs-service"
import { prepareMediaProtocol, registerMediaProtocol } from "./media-service"
import { buildMenuTemplate } from "./menu"
import { closeCurrentProject, restoreLastProject } from "./project-service"
import { isDevelopment } from "./resolve"
import { loadDevEnv } from "./settings-service"
import { initAutoUpdater, stopAutoUpdater } from "./updater"
import { createMainWindow, prepareProductionRenderer } from "./window"

log.initialize()

/**
 * One instance, and one only.
 *
 * Two copies of OpenDirect would open the same SQLite file and run two job
 * runners over the same `jobs` table — which is how a run gets submitted, and
 * paid for, twice. The second launch therefore hands its argv to the first and
 * quits immediately, before any handler, protocol or database is touched.
 */
const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) {
  app.quit()
}

app.on("second-instance", () => {
  // The user tried to launch the app that is already running: what they
  // actually want is the window they already have, in front of them.
  const [existing] = BrowserWindow.getAllWindows()
  if (!existing || existing.isDestroyed()) return
  if (existing.isMinimized()) existing.restore()
  existing.show()
  existing.focus()
})

// Development-only `.env.local` fallback for the provider keys. Runs before any
// handler so the first `settings:keys:summary` already sees the env source.
loadDevEnv()

// Registers the `app://` scheme; electron-serve requires this before ready.
prepareProductionRenderer()

// Same rule for the `asset://` media scheme the board displays local files
// through: privileged schemes must be declared before the app is ready.
prepareMediaProtocol()

// Handlers exist before any renderer loads, so an early `invoke` cannot race them.
registerIpcHandlers()

void app.whenReady().then(async () => {
  if (!isPrimaryInstance) return

  // Chromium's default menu gives the window ⌘R for Reload, which is a chord
  // this app wants for its own catalog refresh in production. Development keeps
  // reload — see `menu.ts` and `rendererRefreshAccelerator`.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        dev: isDevelopment(),
        platform: process.platform,
        appName: app.getName(),
      })
    )
  )

  // Re-opens the most recent project, which is what runs the SQLite migrations
  // for it. Before the window, so the first renderer query sees a current schema.
  await restoreLastProject()

  // After `ready` (it needs a session) and before the first window, so the
  // board never paints an `asset://` image at a handler that is not there yet.
  registerMediaProtocol()

  await createMainWindow()

  // Crash recovery, after the window exists so its job list sees the updates:
  // re-attach to provider jobs that outlived the last session, and fail the
  // ones that were interrupted mid-submit rather than paying for them twice.
  // ⛔ It never submits: a run still queued is left queued for an explicit
  // Resume, because starting the app is not consent to spend money.
  void recoverJobs()
  // App-scoped, not window-scoped: it must survive the macOS
  // close-all-windows-then-reactivate cycle.
  initAutoUpdater()

  // Which of the user's AI CLIs are installed, probed once. Never fatal: with
  // neither on PATH the app simply has no AI menus.
  initAiTools()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on("before-quit", () => {
  stopAutoUpdater()
  // Any helper still talking to a CLI is killed rather than orphaned.
  stopAiRuns()
  stopJobRunner()
  disposeIpcHandlers()
  // Checkpoints the WAL so the project folder is consistent if it is synced.
  closeCurrentProject()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
