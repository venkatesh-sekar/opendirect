/**
 * Electron-bound wiring for `settings.ts`.
 *
 * Everything that touches `electron` or `electron-store` lives here so
 * `settings.ts` stays importable (and testable) in plain Node.
 */
import { existsSync } from "node:fs"

import { safeStorage } from "electron"
import { config as loadDotenv } from "dotenv"
import Store from "electron-store"
import log from "electron-log/main"

import { isDevelopment } from "./resolve"
import {
  createKeyVault,
  createSettings,
  findEnvFile,
  type KeyVault,
  type SettingsApi,
  type SettingsStore,
} from "./settings"

export interface SettingsService {
  vault: KeyVault
  settings: SettingsApi
  /**
   * The raw `electron-store` adapter. Shared so other services (the recent
   * projects list, for one) persist into the same file rather than opening a
   * second `Store` over it.
   */
  store: SettingsStore
}

let service: SettingsService | undefined

/**
 * Lazily built so importing this module never constructs a `Store` — which
 * would need `app.getPath('userData')` before the app is ready.
 */
export function getSettingsService(): SettingsService {
  if (service) return service

  const store = new Store<Record<string, unknown>>({ name: "opendirect" })
  const adapter: SettingsStore = {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
  }

  service = {
    store: adapter,
    vault: createKeyVault({
      store: adapter,
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (cipher) => safeStorage.decryptString(cipher),
    }),
    settings: createSettings(adapter),
  }
  return service
}

/** Test/hot-reload seam: drops the cached service so the next call rebuilds it. */
export function resetSettingsService(): void {
  service = undefined
}

/**
 * Development-only `.env.local` fallback for `REPLICATE_API_TOKEN` and
 * `OPENROUTER_API_KEY`, loaded from the nearest one at or above this bundle.
 *
 * `dotenv` does not overwrite variables already in the environment, so a real
 * shell export still wins, and a packaged build never reads a dotfile at all.
 */
export function loadDevEnv(startDir: string = __dirname): void {
  if (!isDevelopment()) return
  const path = findEnvFile(startDir, existsSync)
  if (!path) return
  const result = loadDotenv({ path, quiet: true })
  // Only the *names* are ever logged — never a value.
  if (result.error) {
    log.warn("Could not read .env.local", result.error.message)
    return
  }
  log.info(
    "Loaded dev env vars from .env.local:",
    Object.keys(result.parsed ?? {}).join(", ")
  )
}
