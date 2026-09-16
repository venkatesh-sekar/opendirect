import { app, ipcMain } from "electron"

import { createIpcRegistrar } from "./ipc-registry"

const registrar = createIpcRegistrar(ipcMain)

/** Register a contract channel. Never call `ipcMain.handle` directly. */
export const handle = registrar.handle

/**
 * Wires every main-process handler. Called once before the first window is
 * created; later tasks add their channels here (and to the contract first).
 */
export function registerIpcHandlers(): void {
  handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
  }))
}

/** Tears every handler down — used on quit and by hot-reload in development. */
export function disposeIpcHandlers(): void {
  registrar.dispose()
}
