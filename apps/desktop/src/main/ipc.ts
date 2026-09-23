import { app, dialog, ipcMain } from "electron"
import log from "electron-log/main"

import {
  cancelAiRun,
  detectAiTools,
  getAiTools,
  runAiHelper,
} from "./ai/ai-service"
import { registerModelHandlers } from "./catalog"
import { getModelCatalog, invalidateModelCatalog } from "./catalog-service"
import { registerProjectHandlers } from "./handlers"
import { createIpcRegistrar } from "./ipc-registry"
import { registerMentionHandlers } from "./mentions-service"
import { rendererRefreshAccelerator } from "./menu"
import {
  getModelRegistry,
  registerModelRegistryHandlers,
} from "./model-registry/registry-service"
import { isDevelopment } from "./resolve"
import { getSettingsService } from "./settings-service"
import { describeKeys, verifyProviderKey } from "./settings"
import { getLatestUpdaterStatus, quitAndInstall } from "./updater"

const registrar = createIpcRegistrar(ipcMain)

/** Register a contract channel. Never call `ipcMain.handle` directly. */
export const handle = registrar.handle

/**
 * Wires every main-process handler. Called once before the first window is
 * created; later tasks add their channels here (and to the contract first).
 */
export function registerIpcHandlers(): void {
  handle("app:info", () => {
    const dev = isDevelopment()
    return {
      version: app.getVersion(),
      platform: process.platform,
      dev,
      // One source of truth for the chord: `menu.ts` decides it, because
      // `menu.ts` is what does or does not hand ⌘R to Chromium.
      catalogRefreshAccelerator: rendererRefreshAccelerator(dev),
    }
  })

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
  handle("settings:keys:verify", async ({ provider, key: draft }) => {
    // A key typed into the field wins over the stored one, so a user can check
    // a key before committing it. It is only read here — nothing saves it.
    const key =
      draft?.trim() ||
      getSettingsService().vault.getKeyWithEnvFallback(provider)
    if (!key) {
      return { valid: false, message: "No API key is configured yet." }
    }
    return verifyProviderKey(provider, key)
  })

  /**
   * ⛔ Listing endpoints only. The catalog never submits a generation; see
   * `catalog.ts`.
   */
  registerModelHandlers(handle, getModelCatalog, () => {
    // The registry must never be the reason the model list fails.
    try {
      getModelRegistry().refreshIfStale()
    } catch (error) {
      log.warn("Model registry refresh could not start", error)
    }
  })

  /**
   * The model registry: bundled mappings, a newer remote copy, the user's
   * own. ⛔ Free GETs of static JSON at most (`registry:reload` and a
   * once-a-day background refresh) — never a provider.
   */
  registerModelRegistryHandlers(handle)

  // Project folder, containers, assets and generations — all scoped to the
  // currently open project (`project-service.ts`).
  registerProjectHandlers(handle, getModelCatalog)

  /** The `@` picker's index — read-only, and scoped to the open project. */
  registerMentionHandlers(handle)

  /**
   * The AI helpers, backed by the user's own locally installed `claude` /
   * `codex`. `ai:tools` answering with `preferred: null` is how the renderer
   * knows to hide every AI entry point entirely.
   *
   * ⛔ Not a provider call and not a generation — see `ai/run-cli.ts`.
   */
  handle("ai:tools", () => getAiTools())
  handle("ai:detect", () => detectAiTools())
  handle("ai:run", (request) => runAiHelper(request))
  handle("ai:cancel", ({ runId }) => {
    cancelAiRun(runId)
    return { ok: true as const }
  })

  /**
   * "Restart to update", from the status bar. A no-op that says so when no
   * update is staged — the button is only ever drawn after a `ready` status,
   * but the window may have been open across a failed download.
   */
  handle("updater:install", () => ({ restarting: quitAndInstall() }))

  /**
   * The current update status for a window that missed the push — the updater
   * is app-scoped and checks on a six-hour timer, so a window opened between
   * two checks has heard nothing at all.
   */
  handle("updater:status:get", () => getLatestUpdaterStatus())
}

/** Tears every handler down — used on quit and by hot-reload in development. */
export function disposeIpcHandlers(): void {
  registrar.dispose()
}
