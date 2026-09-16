import { app, BrowserWindow } from "electron"
import log from "electron-log/main"

import { disposeIpcHandlers, registerIpcHandlers } from "./ipc"
import { initAutoUpdater, stopAutoUpdater } from "./updater"
import { createMainWindow, prepareProductionRenderer } from "./window"

log.initialize()

// Registers the `app://` scheme; electron-serve requires this before ready.
prepareProductionRenderer()

// Handlers exist before any renderer loads, so an early `invoke` cannot race them.
registerIpcHandlers()

void app.whenReady().then(async () => {
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
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
