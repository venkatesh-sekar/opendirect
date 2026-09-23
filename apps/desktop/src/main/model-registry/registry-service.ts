/**
 * Electron-bound wiring for `registry.ts`: the cache under `userData`, the
 * shared settings store for user overrides, native dialogs and logging.
 * Everything with logic lives in the plain-Node modules beside it, the same
 * split as `catalog.ts` / `catalog-service.ts`.
 *
 * ⛔ Building the registry makes no request. The remote copy is fetched only
 * by `reload()` or the once-a-day `refreshIfStale()` — free `GET`s of static
 * JSON, never a provider and never at startup.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { app, dialog } from "electron"
import log from "electron-log/main"

import type { IpcRegistrar } from "../ipc-registry"
import { getSettingsService } from "../settings-service"
import { BUNDLED_FAMILIES, BUNDLED_INDEX } from "./bundled"
import { registerRegistryHandlers, type RegistryFiles } from "./handlers"
import { createOverrideStore } from "./overrides"
import { createModelRegistry, type ModelRegistry } from "./registry"
import { REGISTRY_CACHE_FILE, createRemoteSource } from "./remote"

let registry: ModelRegistry | undefined

/**
 * Built on first use: `app.getPath("userData")` is only meaningful once
 * Electron has resolved it, and the settings store opens lazily too.
 */
export function getModelRegistry(): ModelRegistry {
  if (registry) return registry

  const settings = getSettingsService()
  registry = createModelRegistry({
    bundled: { index: BUNDLED_INDEX, families: BUNDLED_FAMILIES },
    remote: createRemoteSource({
      path: join(app.getPath("userData"), REGISTRY_CACHE_FILE),
    }),
    overrides: createOverrideStore(settings.store),
    settings: () => settings.settings.get(),
    onError: (error) => {
      // Never fatal: the bundled mappings stay in force, and the reason is
      // in `registry:status` for the Models tab to show.
      log.warn("Model registry:", error)
    },
  })
  return registry
}

/** Test/hot-reload seam: drops the cached registry so the next call rebuilds it. */
export function resetModelRegistry(): void {
  registry = undefined
}

const JSON_FILTERS = [{ name: "Model mapping", extensions: ["json"] }]

const electronFiles: RegistryFiles = {
  async chooseImport() {
    const result = await dialog.showOpenDialog({
      title: "Import a model mapping",
      filters: JSON_FILTERS,
      properties: ["openFile"],
    })
    if (result.canceled) return null
    return result.filePaths[0] ?? null
  },
  async chooseExport(defaultName) {
    const result = await dialog.showSaveDialog({
      title: "Export the model mapping",
      defaultPath: defaultName,
      filters: JSON_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    return result.filePath
  },
  readText: (path) => readFileSync(path, "utf8"),
  writeText: (path, text) => writeFileSync(path, text, "utf8"),
}

export function registerModelRegistryHandlers(
  handle: IpcRegistrar["handle"]
): void {
  registerRegistryHandlers(handle, getModelRegistry, electronFiles)
}
