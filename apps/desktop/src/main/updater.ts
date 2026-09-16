import { app } from "electron"
import type { BrowserWindow } from "electron"
import log from "electron-log/main"
import { autoUpdater } from "electron-updater"

import {
  shouldEnableUpdater,
  toUpdaterStatus,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATER_STATUS_CHANNEL,
  type UpdaterEvent,
} from "./updater-policy"

let timer: NodeJS.Timeout | undefined

/**
 * Wires electron-updater to the GitHub Releases feed baked into
 * `app-update.yml` by electron-builder's `publish` config.
 *
 * Updates download in the background and install on quit, so the renderer only
 * ever needs to surface progress — never block on it.
 */
export function initAutoUpdater(win: BrowserWindow): void {
  if (!shouldEnableUpdater({ packaged: app.isPackaged, env: process.env })) {
    log.info("auto-updater disabled (unpackaged build)")
    return
  }

  const send = (event: UpdaterEvent): void => {
    if (win.isDestroyed()) return
    win.webContents.send(UPDATER_STATUS_CHANNEL, toUpdaterStatus(event))
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-available", (info) =>
    send({ type: "available", version: info.version })
  )
  autoUpdater.on("update-not-available", () => send({ type: "not-available" }))
  autoUpdater.on("download-progress", (progress) =>
    send({ type: "downloading", percent: progress.percent })
  )
  autoUpdater.on("update-downloaded", (info) =>
    send({ type: "ready", version: info.version })
  )
  autoUpdater.on("error", (error) => send({ type: "error", error }))

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn("update check failed", error)
    })
  }

  check()
  timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  // A lingering interval keeps the event loop alive and would delay quit.
  win.on("closed", () => stopAutoUpdater())
}

/** Cancels the periodic check; safe to call when the updater never started. */
export function stopAutoUpdater(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}

/** Restarts into the downloaded update. Exposed over IPC in a later task. */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall()
}
