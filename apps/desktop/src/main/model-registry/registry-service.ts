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
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

import { app, BrowserWindow, dialog } from "electron"
import log from "electron-log/main"

import type { ModelDescriptor } from "@opendirect/contract"

import { getModelCatalog } from "../catalog-service"
import { emitIpcEvent, type IpcRegistrar } from "../ipc-registry"
import { getSettingsService } from "../settings-service"
import { BUNDLED_FAMILIES, BUNDLED_INDEX } from "./bundled"
import {
  describeModel,
  type DescribeOptions,
  type ModelSource,
} from "./family-descriptor"
import { registerRegistryHandlers, type RegistryFiles } from "./handlers"
import { createOverrideStore } from "./overrides"
import { createModelRegistry, type ModelRegistry } from "./registry"
import {
  MAX_REGISTRY_JSON_BYTES,
  REGISTRY_CACHE_FILE,
  createRemoteSource,
  tooLargeMessage,
} from "./remote"

let registry: ModelRegistry | undefined

/**
 * Every live window drops its cached descriptors and quotes: a background
 * refresh can move a family to another endpoint, and a quote shown before
 * it would no longer be what a submit runs (and costs).
 */
function broadcastChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      emitIpcEvent(window.webContents, "registry:changed", {})
    } catch (error) {
      log.warn("Could not push a registry change", error)
    }
  }
}

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
    onChange: broadcastChanged,
  })
  return registry
}

/** Test/hot-reload seam: drops the cached registry so the next call rebuilds it. */
export function resetModelRegistry(): void {
  registry = undefined
}

/**
 * The live catalog, registry and settings, each resolved per call — so a key
 * change, a reload or a new provider order applies to the very next lookup.
 */
export const modelSource: ModelSource = {
  catalog: () => getModelCatalog(),
  registry: () => getModelRegistry(),
  settings: () => getSettingsService().settings.get(),
}

/**
 * The one way main code gets a descriptor for a caller: annotated with its
 * mapping's roles, or a family descriptor for `family:<id>`. Submit,
 * preflight and the job runner all go through it, so they see the same
 * slots (and shapes) the canvas was drawn from.
 */
export function annotatedModel(
  key: string,
  options: DescribeOptions = {}
): Promise<ModelDescriptor> {
  return describeModel(modelSource, key, options)
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
  readText(path) {
    // Checked before reading, so a huge file is never loaded; the handler
    // checks the text again.
    if (statSync(path).size > MAX_REGISTRY_JSON_BYTES) {
      throw new Error(`${basename(path)} ${tooLargeMessage()}`)
    }
    return readFileSync(path, "utf8")
  },
  writeText: (path, text) => writeFileSync(path, text, "utf8"),
}

export function registerModelRegistryHandlers(
  handle: IpcRegistrar["handle"]
): void {
  registerRegistryHandlers(handle, getModelRegistry, electronFiles)
}
