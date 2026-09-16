import { app, BrowserWindow } from "electron"
import log from "electron-log/main"

import { createMainWindow } from "./window"

log.initialize()

void app.whenReady().then(async () => {
  await createMainWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtException", (err) => log.error("uncaughtException", err))
