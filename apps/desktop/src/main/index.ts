import { app, BrowserWindow } from "electron"
import log from "electron-log/main"

import { disposeIpcHandlers, registerIpcHandlers } from "./ipc"
import { prepareMediaProtocol, registerMediaProtocol } from "./media-service"
import { closeCurrentProject, restoreLastProject } from "./project-service"
import { loadDevEnv } from "./settings-service"
import { initAutoUpdater, stopAutoUpdater } from "./updater"
import { createMainWindow, prepareProductionRenderer } from "./window"

log.initialize()

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
  // Re-opens the most recent project, which is what runs the SQLite migrations
  // for it. Before the window, so the first renderer query sees a current schema.
  await restoreLastProject()

  // After `ready` (it needs a session) and before the first window, so the
  // board never paints an `asset://` image at a handler that is not there yet.
  registerMediaProtocol()

  await createMainWindow()
  // App-scoped, not window-scoped: it must survive the macOS
  // close-all-windows-then-reactivate cycle.
  initAutoUpdater()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on("before-quit", () => {
  stopAutoUpdater()
  disposeIpcHandlers()
  // Checkpoints the WAL so the project folder is consistent if it is synced.
  closeCurrentProject()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
