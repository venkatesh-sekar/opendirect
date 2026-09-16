import { app, BrowserWindow } from "electron"
import log from "electron-log/main"

import { initAutoUpdater, stopAutoUpdater } from "./updater"
import { createMainWindow, prepareProductionRenderer } from "./window"

log.initialize()

// Registers the `app://` scheme; electron-serve requires this before ready.
prepareProductionRenderer()

void app.whenReady().then(async () => {
  const win = await createMainWindow()
  initAutoUpdater(win)

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on("window-all-closed", () => {
  stopAutoUpdater()
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
