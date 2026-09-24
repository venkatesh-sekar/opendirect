/**
 * Settings store and encrypted API key vault.
 *
 * Deliberately free of `electron` imports so every rule in here — encryption
 * round-tripping, redaction, env-fallback precedence, key verification — is
 * unit tested in plain Node against fakes. `settings-service.ts` is the thin
 * wiring that binds this to `electron-store` and Electron's `safeStorage`.
 *
 * ⛔ `settings:keys:verify` hits **listing endpoints only**. Nothing in this
 * file may ever call a prediction, completion or generation endpoint.
 */
import { dirname, resolve } from "node:path"

import {
  keySourceSchema,
  settingsDefaults,
  settingsSchema,
  type KeySource,
  type KeyStatus,
  type KeysSummary,
  type ProviderId,
  type Settings,
} from "@opendirect/contract"
import { z } from "zod"

/** The slice of `electron-store` this module needs. */
export interface SettingsStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

export interface KeyVaultDeps {
  store: SettingsStore
  /** `safeStorage.isEncryptionAvailable` — false on a Linux box with no keyring. */
  isEncryptionAvailable: () => boolean
  /** `safeStorage.encryptString`. */
  encrypt: (plain: string) => Buffer
  /** `safeStorage.decryptString`. */
  decrypt: (cipher: Buffer) => string
  /** Injected for tests; defaults to the real environment. */
  env?: Record<string, string | undefined>
}

/** Developer-convenience fallback, read from `.env.local` in development. */
export const PROVIDER_ENV_VARS: Record<ProviderId, string> = {
  replicate: "REPLICATE_API_TOKEN",
  openrouter: "OPENROUTER_API_KEY",
}

const PROVIDERS: readonly ProviderId[] = ["replicate", "openrouter"]

/** `apiKeys.<provider>` → `{ enc, value }`, base64 when `enc` is true. */
const storedKeySchema = z.object({ enc: z.boolean(), value: z.string() })

const keyPath = (provider: ProviderId): string => `apiKeys.${provider}`

/** Redacted label for the UI. Never returns any part of the key but its tail. */
export function maskKey(key: string): string {
  return key.length > 4 ? `•••• ${key.slice(-4)}` : "••••"
}

function last4Of(key: string): string | null {
  return key.length > 4 ? key.slice(-4) : null
}

export interface ResolvedKey {
  key: string | null
  source: KeySource
}

export interface KeyVault {
  /**
   * Persists a provider key, encrypted with the OS keychain when one is
   * available. **Never log the key, the ciphertext, or anything derived from
   * either** — the only thing that may leave this module is `maskKey`'s tail.
   */
  setKey(provider: ProviderId, key: string): void
  /** The stored key, or null when absent, corrupt or undecryptable. */
  getKey(provider: ProviderId): string | null
  clearKey(provider: ProviderId): void
  /** Vault first, then the provider's env var. */
  getKeyWithEnvFallback(provider: ProviderId): string | null
  resolve(provider: ProviderId): ResolvedKey
  /** Redacted per-provider status of the **vault** only. */
  summary(): Record<ProviderId, { present: boolean; last4: string | null }>
  encryptionAvailable(): boolean
}

export function createKeyVault(deps: KeyVaultDeps): KeyVault {
  const env = deps.env ?? process.env

  function readVault(provider: ProviderId): string | null {
    const record = storedKeySchema.safeParse(deps.store.get(keyPath(provider)))
    if (!record.success) return null
    if (!record.data.enc) return record.data.value || null
    try {
      const plain = deps.decrypt(Buffer.from(record.data.value, "base64"))
      return plain || null
    } catch {
      // A key encrypted under a keychain we can no longer reach is simply gone;
      // the message is deliberately not logged, as it can embed the payload.
      return null
    }
  }

  function readEnv(provider: ProviderId): string | null {
    const value = env[PROVIDER_ENV_VARS[provider]]?.trim()
    return value ? value : null
  }

  return {
    setKey(provider, key) {
      const trimmed = key.trim()
      if (!trimmed) throw new Error("API key must not be empty")
      if (deps.isEncryptionAvailable()) {
        deps.store.set(keyPath(provider), {
          enc: true,
          value: deps.encrypt(trimmed).toString("base64"),
        })
        return
      }
      // No OS keychain: storing plaintext is the documented fallback, and the
      // Settings screen shows an alert saying so (`encryptionAvailable`).
      deps.store.set(keyPath(provider), { enc: false, value: trimmed })
    },

    getKey: readVault,

    clearKey(provider) {
      deps.store.delete(keyPath(provider))
    },

    resolve(provider) {
      const vaulted = readVault(provider)
      if (vaulted) return { key: vaulted, source: "vault" }
      const fromEnv = readEnv(provider)
      if (fromEnv) return { key: fromEnv, source: "env" }
      return { key: null, source: "none" }
    },

    getKeyWithEnvFallback(provider) {
      return this.resolve(provider).key
    },

    summary() {
      const out = {} as Record<
        ProviderId,
        { present: boolean; last4: string | null }
      >
      for (const provider of PROVIDERS) {
        const key = readVault(provider)
        out[provider] = {
          present: key !== null,
          last4: key ? last4Of(key) : null,
        }
      }
      return out
    },

    encryptionAvailable: deps.isEncryptionAvailable,
  }
}

/**
 * The redacted payload for `settings:keys:summary`: presence, a four-character
 * tail and the source, for both providers. The keys themselves stay in main.
 */
export function describeKeys(vault: KeyVault): KeysSummary {
  const status = (provider: ProviderId): KeyStatus => {
    const { key, source } = vault.resolve(provider)
    return {
      present: key !== null,
      last4: key ? last4Of(key) : null,
      source: keySourceSchema.parse(source),
    }
  }
  return {
    encryptionAvailable: vault.encryptionAvailable(),
    replicate: status("replicate"),
    openrouter: status("openrouter"),
  }
}

export interface SettingsApi {
  get(): Settings
  set(patch: Partial<Settings>): Settings
}

const SETTINGS_KEY = "settings"

/** Non-secret preferences, validated on both read and write. */
export function createSettings(store: SettingsStore): SettingsApi {
  function read(): Settings {
    const raw = store.get(SETTINGS_KEY)
    const stored: Record<string, unknown> =
      typeof raw === "object" && raw !== null && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {}
    // A hand-edited or half-migrated file must not brick the app, and one bad
    // field must not cost the user every other preference: each field is
    // checked on its own, and only the ones that fail fall back to defaults.
    const fields = settingsSchema.shape
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(fields) as (keyof Settings)[]) {
      const parsed =
        key in stored
          ? fields[key].safeParse(stored[key])
          : { success: false as const }
      out[key] = parsed.success ? parsed.data : settingsDefaults[key]
    }
    return out as Settings
  }

  return {
    get: read,
    set(patch) {
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      )
      const next = settingsSchema.parse({ ...read(), ...defined })
      store.set(SETTINGS_KEY, next)
      return next
    },
  }
}

/**
 * Nearest `.env.local` at or above `startDir`.
 *
 * The dev fallback lives at the repo root while the main process runs out of
 * `apps/desktop/dist/main`, and the depth differs between `pnpm start` and a
 * `--dir` build, so the file is searched for rather than hard-coded.
 */
export function findEnvFile(
  startDir: string,
  exists: (path: string) => boolean
): string | null {
  let dir = resolve(startDir)
  for (;;) {
    const candidate = resolve(dir, ".env.local")
    if (exists(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Endpoints used by `settings:keys:verify`.
 *
 * ⛔ Both are **read-only listing/metadata endpoints** and are free to call.
 * Replicate's `GET /v1/models` and OpenRouter's `GET /api/v1/key` both require
 * authentication, so a bad key comes back as 401 — which is the whole point.
 * OpenRouter's public `GET /api/v1/models` is unauthenticated and answers 200
 * for any key, so it cannot verify anything and is not used here.
 */
export const VERIFY_ENDPOINTS: Record<ProviderId, string> = {
  replicate: "https://api.replicate.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/key",
}

export interface VerifyResult {
  valid: boolean
  message?: string
}

/**
 * Checks a key against its provider's listing endpoint.
 *
 * Never throws and never puts the key (or a response body, which can echo it)
 * into the returned message.
 */
export async function verifyProviderKey(
  provider: ProviderId,
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<VerifyResult> {
  try {
    const response = await fetchImpl(VERIFY_ENDPOINTS[provider], {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    })
    if (response.ok) return { valid: true }
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        message: `The provider rejected this key (HTTP ${response.status}).`,
      }
    }
    return {
      valid: false,
      message: `Could not verify the key — the provider answered HTTP ${response.status}.`,
    }
  } catch {
    // The thrown error can embed the request, and the request carries the key.
    return {
      valid: false,
      message:
        "Could not reach the provider. Check your network and try again.",
    }
  }
}
