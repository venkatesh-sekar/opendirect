/**
 * The model registry's IPC handlers — a wiring sheet over `registry.ts`, the
 * same split as `catalog.ts`'s `registerModelHandlers`. The native dialogs
 * and file access come in as `RegistryFiles`, so this runs in plain Node
 * under test and `registry-service.ts` supplies Electron's.
 *
 * ⛔ No provider is ever called from here. `registry:reload` and the
 * background refresh behind `registry:families` make free `GET`s of static
 * JSON; everything else is local.
 */
import { basename } from "node:path"

import { formatFamilyJson } from "@opendirect/contract"

import type { IpcRegistrar } from "../ipc-registry"
import { OverrideValidationError, toUserOverride } from "./overrides"
import type { ModelRegistry } from "./registry"

/** The native pieces the import and export channels need. */
export interface RegistryFiles {
  /** An open dialog for one `.json` file; null when cancelled. */
  chooseImport(): Promise<string | null>
  /** A save dialog with `defaultName` filled in; null when cancelled. */
  chooseExport(defaultName: string): Promise<string | null>
  readText(path: string): string
  writeText(path: string, text: string): void
}

export function registerRegistryHandlers(
  handle: IpcRegistrar["handle"],
  registry: () => ModelRegistry,
  files: RegistryFiles,
  now: () => number = Date.now
): void {
  handle("registry:status", () => registry().status())

  handle("registry:reload", () => registry().reload())

  handle("registry:families", () => {
    // Fire and forget: at most one free GET round a day, never awaited.
    registry().refreshIfStale()
    return registry().merged().families
  })

  handle("registry:overrides:list", () => registry().overrides.list())

  handle("registry:overrides:save", ({ family, replaceId }) => {
    try {
      return {
        ok: true as const,
        override: registry().overrides.save(family, replaceId),
      }
    } catch (error) {
      // A refused mapping is an answer the editor shows row by row, not a
      // failure: only a validation error is turned into one.
      if (error instanceof OverrideValidationError) {
        return { ok: false as const, issues: error.issues }
      }
      throw error
    }
  })

  handle("registry:overrides:delete", ({ id }) => {
    registry().overrides.delete(id)
    return { ok: true as const }
  })

  handle("registry:overrides:import", async () => {
    const path = await files.chooseImport()
    if (path === null) return { candidates: [] }
    let parsed: unknown
    try {
      parsed = JSON.parse(files.readText(path)) as unknown
    } catch {
      throw new Error(`${basename(path)} is not valid JSON.`)
    }
    // Validated for the editor to show, and deliberately not saved: the
    // user reviews an import before it changes what runs.
    const updatedAt = now()
    return {
      candidates: (Array.isArray(parsed) ? parsed : [parsed]).map((raw) =>
        toUserOverride({ raw, updatedAt })
      ),
    }
  })

  handle("registry:overrides:export", async ({ id }) => {
    const override = registry()
      .overrides.list()
      .find((entry) => entry.id === id)
    const family = override?.family ?? registry().family(id)?.family ?? null
    // A stored mapping that no longer validates is still exported as it is,
    // so it can be fixed by hand.
    const text = family
      ? formatFamilyJson(family)
      : override
        ? `${JSON.stringify(override.raw, null, 2)}\n`
        : null
    if (text === null) throw new Error(`No mapping with id "${id}".`)

    const path = await files.chooseExport(`${id}.json`)
    if (path === null) return { path: null }
    files.writeText(path, text)
    return { path }
  })
}
