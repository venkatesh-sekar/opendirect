import { app, BrowserWindow } from "electron"
import log from "electron-log/main"

import { initAutoUpdater, stopAutoUpdater } from "./updater"
import { createMainWindow, prepareProductionRenderer } from "./window"

log.initialize()

// Registers the `app://` scheme; electron-serve requires this before ready.
prepareProductionRenderer()

void app.whenReady().then(async () => {
  await createMainWindow()
  // App-scoped, not window-scoped: it must survive the macOS
  // close-all-windows-then-reactivate cycle.
  initAutoUpdater()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on("before-quit", () => stopAutoUpdater())

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
