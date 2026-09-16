import { app, BrowserWindow } from "electron"
import log from "electron-log/main"
import { autoUpdater } from "electron-updater"

import { emitIpcEvent } from "./ipc-registry"
import {
  pickStatusTarget,
  shouldEnableUpdater,
  toUpdaterStatus,
  UPDATE_CHECK_INTERVAL_MS,
  type UpdaterEvent,
} from "./updater-policy"

let timer: NodeJS.Timeout | undefined
let started = false
/** The last status pushed, so `quitAndInstall` knows whether one is staged. */
let latestStatus: ReturnType<typeof toUpdaterStatus> | undefined

/** Whichever live window should show the status; on macOS windows come and go. */
function sendStatus(event: UpdaterEvent): void {
  const status = toUpdaterStatus(event)
  latestStatus = status
  const target = pickStatusTarget(
    BrowserWindow.getAllWindows(),
    BrowserWindow.getFocusedWindow()
  )
  if (!target) return
  // Goes through the contract, not a raw `send`: the channel and the payload
  // shape are validated here exactly as the renderer validates them on arrival.
  emitIpcEvent(target.webContents, "updater:status", status)
}

/**
 * Wires electron-updater to the GitHub Releases feed baked into
 * `app-update.yml` by electron-builder's `publish` config.
 *
 * App-scoped on purpose: the updater outlives any individual window (on macOS
 * the app keeps running with none open), so it is started once after `ready`,
 * resolves its delivery window per event, and is stopped on `before-quit`.
 *
 * Updates download in the background and install on quit, so the renderer only
 * ever needs to surface progress — never block on it.
 */
export function initAutoUpdater(): void {
  if (started) return
  if (!shouldEnableUpdater({ packaged: app.isPackaged, env: process.env })) {
    log.info("auto-updater disabled (unpackaged build)")
    return
  }
  started = true

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("update-available", (info) =>
    sendStatus({ type: "available", version: info.version })
  )
  autoUpdater.on("update-not-available", () =>
    sendStatus({ type: "not-available" })
  )
  autoUpdater.on("download-progress", (progress) =>
    sendStatus({ type: "downloading", percent: progress.percent })
  )
  autoUpdater.on("update-downloaded", (info) =>
    sendStatus({ type: "ready", version: info.version })
  )
  autoUpdater.on("error", (error) => sendStatus({ type: "error", error }))

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      log.warn("update check failed", error)
    })
  }

  check()
  // A lingering interval keeps the event loop alive and would delay quit.
  timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  app.once("before-quit", stopAutoUpdater)
}

/** Cancels the periodic check; safe to call when the updater never started. */
export function stopAutoUpdater(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}

/**
 * The last status pushed, for a window that was not there to hear it.
 *
 * Returning null is the honest answer for an unpackaged build and for the
 * moments before the first check completes; the status bar shows nothing for
 * both, which is what it should.
 */
export function getLatestUpdaterStatus(): ReturnType<
  typeof toUpdaterStatus
> | null {
  return latestStatus ?? null
}

/**
 * Restarts into the downloaded update, if one is actually staged.
 *
 * `latestStatus` is tracked rather than asked of electron-updater because
 * `quitAndInstall()` with nothing downloaded either throws or quits without
 * reinstalling, depending on platform — neither of which is what the status
 * bar's button promised. The renderer therefore learns whether a restart is
 * really about to happen.
 */
export function quitAndInstall(): boolean {
  if (latestStatus?.state !== "ready") return false
  stopAutoUpdater()
  autoUpdater.quitAndInstall()
  return true
}
