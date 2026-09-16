/**
 * Electron-bound wiring for `catalog.ts`.
 *
 * Everything that touches `electron` or the filesystem lives here so
 * `catalog.ts` stays importable (and testable) in plain Node — the same split
 * as `settings.ts` / `settings-service.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { app } from "electron"
import log from "electron-log/main"

import {
  CATALOG_FILE_NAME,
  createModelCatalog,
  type CatalogStore,
  type ModelCatalog,
} from "./catalog"
import { registerModelProviders } from "./providers/bootstrap"
import { listProviders } from "./providers/registry"
import { getSettingsService } from "./settings-service"

let catalog: ModelCatalog | undefined

/** A plain JSON file under `userData`. A missing file reads as "no cache". */
function fileStore(path: string): CatalogStore {
  return {
    read() {
      try {
        return readFileSync(path, "utf8")
      } catch {
        return null
      }
    },
    write(json) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, json, "utf8")
    },
  }
}

/**
 * The catalog, built on first use.
 *
 * Lazily, because `app.getPath("userData")` is only meaningful once Electron
 * has resolved it, and because registering the adapters reads the key vault.
 */
export function getModelCatalog(): ModelCatalog {
  if (catalog) return catalog

  registerModelProviders(getSettingsService().vault)

  catalog = createModelCatalog({
    providers: listProviders,
    store: fileStore(join(app.getPath("userData"), CATALOG_FILE_NAME)),
    onError: (source, error) => {
      // Never fatal: one provider being down leaves the rest of the catalog
      // usable, and a cache that cannot be written only costs a re-fetch.
      log.warn(`Model catalog: ${source} failed`, error)
    },
  })
  return catalog
}

/** Test/hot-reload seam: drops the cached catalog so the next call rebuilds it. */
export function resetModelCatalog(): void {
  catalog = undefined
}
