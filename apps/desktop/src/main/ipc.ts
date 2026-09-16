import { app, dialog, ipcMain } from "electron"

import { registerModelHandlers } from "./catalog"
import { getModelCatalog, invalidateModelCatalog } from "./catalog-service"
import { registerProjectHandlers } from "./handlers"
import { createIpcRegistrar } from "./ipc-registry"
import { getSettingsService } from "./settings-service"
import { describeKeys, verifyProviderKey } from "./settings"

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

  handle("settings:get", () => getSettingsService().settings.get())
  handle("settings:set", (patch) => getSettingsService().settings.set(patch))

  handle("settings:projectRoot:choose", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose the OpenDirect project folder",
      properties: ["openDirectory", "createDirectory"],
    })
    if (result.canceled || result.filePaths.length === 0) return { path: null }
    return { path: result.filePaths[0] ?? null }
  })

  // Only ever returns `{ present, last4, source }` — the key stays in main.
  handle("settings:keys:summary", () =>
    describeKeys(getSettingsService().vault)
  )

  handle("settings:keys:set", ({ provider, key }) => {
    getSettingsService().vault.setKey(provider, key)
    // The catalog is keyed off which providers are configured, so a key change
    // invalidates it: the next `models:list` rebuilds and re-fetches.
    invalidateModelCatalog()
    return { ok: true as const }
  })

  handle("settings:keys:clear", ({ provider }) => {
    getSettingsService().vault.clearKey(provider)
    invalidateModelCatalog()
    return { ok: true as const }
  })

  /**
   * ⛔ Listing endpoints only — see `VERIFY_ENDPOINTS` in `settings.ts`.
   * A generation call must never be made to check a key.
   */
  handle("settings:keys:verify", async ({ provider }) => {
    const key = getSettingsService().vault.getKeyWithEnvFallback(provider)
    if (!key) {
      return { valid: false, message: "No API key is configured yet." }
    }
    return verifyProviderKey(provider, key)
  })

  /**
   * ⛔ Listing endpoints only. The catalog never submits a generation; see
   * `catalog.ts`.
   */
  registerModelHandlers(handle, getModelCatalog)

  // Project folder, containers, assets and generations — all scoped to the
  // currently open project (`project-service.ts`).
  registerProjectHandlers(handle)
}

/** Tears every handler down — used on quit and by hot-reload in development. */
export function disposeIpcHandlers(): void {
  registrar.dispose()
}
