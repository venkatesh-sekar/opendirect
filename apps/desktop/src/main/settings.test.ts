import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"

import { server } from "../../../../test/msw/server"
import {
  createKeyVault,
  createSettings,
  describeKeys,
  findEnvFile,
  maskKey,
  VERIFY_ENDPOINTS,
  verifyProviderKey,
  type KeyVaultDeps,
  type SettingsStore,
} from "./settings"

/** In-memory stand-in for `electron-store`. */
function fakeStore(): SettingsStore & { raw: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    raw: data,
    get: (k: string) => data.get(k),
    set: (k: string, v: unknown) => void data.set(k, v),
    delete: (k: string) => void data.delete(k),
  }
}

/** A reversible stand-in for `safeStorage`, so no keychain is touched. */
function fakeDeps(overrides: Partial<KeyVaultDeps> = {}): KeyVaultDeps {
  return {
    store: fakeStore(),
    isEncryptionAvailable: () => true,
    encrypt: (s) => Buffer.from(`enc:${s}`),
    decrypt: (b) => b.toString().replace(/^enc:/, ""),
    env: {},
    ...overrides,
  }
}

describe("key vault", () => {
  it("round-trips a key through encryption", () => {
    const vault = createKeyVault(fakeDeps())
    vault.setKey("replicate", "r8_secret")
    expect(vault.getKey("replicate")).toBe("r8_secret")
  })

  it("stores the key encrypted, never as plaintext", () => {
    const store = fakeStore()
    const vault = createKeyVault(fakeDeps({ store }))
    vault.setKey("replicate", "r8_secret")

    const record = store.raw.get("apiKeys.replicate") as {
      enc: boolean
      value: string
    }
    expect(record.enc).toBe(true)
    expect(record.value).not.toContain("r8_secret")
    expect(Buffer.from(record.value, "base64").toString()).toBe("enc:r8_secret")
  })

  it("never returns the raw key in the redacted summary", () => {
    const vault = createKeyVault(fakeDeps())
    vault.setKey("openrouter", "sk-or-v1-abcdef123456")
    const summary = vault.summary()
    expect(JSON.stringify(summary)).not.toContain("abcdef123456")
    expect(summary.openrouter).toEqual({ present: true, last4: "3456" })
    expect(summary.replicate).toEqual({ present: false, last4: null })
  })

  it("falls back to plaintext with a warning when OS encryption is unavailable", () => {
    const store = fakeStore()
    const vault = createKeyVault(
      fakeDeps({ store, isEncryptionAvailable: () => false })
    )
    vault.setKey("replicate", "r8_x")
    expect(vault.getKey("replicate")).toBe("r8_x")
    expect(vault.encryptionAvailable()).toBe(false)
    expect(store.raw.get("apiKeys.replicate")).toEqual({
      enc: false,
      value: "r8_x",
    })
  })

  it("clears a key", () => {
    const vault = createKeyVault(fakeDeps())
    vault.setKey("replicate", "r8_secret")
    vault.clearKey("replicate")
    expect(vault.getKey("replicate")).toBeNull()
    expect(vault.summary().replicate.present).toBe(false)
  })

  it("rejects a blank key and trims surrounding whitespace", () => {
    const vault = createKeyVault(fakeDeps())
    expect(() => vault.setKey("replicate", "   ")).toThrow(/empty/i)
    vault.setKey("replicate", "  r8_padded  ")
    expect(vault.getKey("replicate")).toBe("r8_padded")
  })

  it("returns null rather than throwing when a stored record is corrupt", () => {
    const store = fakeStore()
    store.set("apiKeys.replicate", { nonsense: true })
    const vault = createKeyVault(fakeDeps({ store }))
    expect(vault.getKey("replicate")).toBeNull()
  })

  it("survives a decrypt failure without leaking the ciphertext", () => {
    const vault = createKeyVault(
      fakeDeps({
        decrypt: () => {
          throw new Error("bad key")
        },
      })
    )
    vault.setKey("replicate", "r8_secret")
    expect(vault.getKey("replicate")).toBeNull()
  })
})

describe("env fallback precedence", () => {
  it("prefers the vault over the environment", () => {
    const vault = createKeyVault(
      fakeDeps({ env: { REPLICATE_API_TOKEN: "r8_from_env" } })
    )
    vault.setKey("replicate", "r8_from_vault")
    expect(vault.getKeyWithEnvFallback("replicate")).toBe("r8_from_vault")
    expect(vault.resolve("replicate").source).toBe("vault")
  })

  it("falls back to the provider's env var when the vault is empty", () => {
    const vault = createKeyVault(
      fakeDeps({
        env: {
          REPLICATE_API_TOKEN: "r8_from_env",
          OPENROUTER_API_KEY: "sk-or-v1-from-env",
        },
      })
    )
    expect(vault.getKeyWithEnvFallback("replicate")).toBe("r8_from_env")
    expect(vault.getKeyWithEnvFallback("openrouter")).toBe("sk-or-v1-from-env")
    expect(vault.resolve("openrouter").source).toBe("env")
  })

  it("reports no key at all when neither source has one", () => {
    const vault = createKeyVault(fakeDeps())
    expect(vault.getKeyWithEnvFallback("openrouter")).toBeNull()
    expect(vault.resolve("openrouter")).toEqual({ key: null, source: "none" })
  })

  it("ignores a blank env var", () => {
    const vault = createKeyVault(
      fakeDeps({ env: { REPLICATE_API_TOKEN: " " } })
    )
    expect(vault.resolve("replicate").source).toBe("none")
  })
})

describe("maskKey", () => {
  it("shows only the last four characters", () => {
    expect(maskKey("sk-or-v1-abcdef123456")).toBe("•••• 3456")
  })

  it("does not reveal a short key", () => {
    expect(maskKey("abc")).toBe("••••")
  })
})

describe("describeKeys", () => {
  it("reports source and encryption availability without exposing keys", () => {
    const vault = createKeyVault(
      fakeDeps({
        isEncryptionAvailable: () => false,
        env: { OPENROUTER_API_KEY: "sk-or-v1-abcdef123456" },
      })
    )
    vault.setKey("replicate", "r8_vaulted_9876")

    const described = describeKeys(vault)
    expect(described).toEqual({
      encryptionAvailable: false,
      replicate: { present: true, last4: "9876", source: "vault" },
      openrouter: { present: true, last4: "3456", source: "env" },
    })
    expect(JSON.stringify(described)).not.toContain("abcdef")
  })
})

describe("settings store", () => {
  it("returns the documented defaults when nothing is persisted", () => {
    const settings = createSettings(fakeStore())
    expect(settings.get()).toEqual({
      projectRoot: null,
      theme: "system",
      defaultVideoModel: null,
      defaultImageModel: null,
      maxConcurrentJobs: 2,
      pollIntervalMs: 3000,
      preferredAiTool: null,
    })
  })

  it("merges a partial patch and persists it", () => {
    const store = fakeStore()
    const settings = createSettings(store)
    const next = settings.set({ maxConcurrentJobs: 4 })
    expect(next.maxConcurrentJobs).toBe(4)
    expect(next.pollIntervalMs).toBe(3000)
    expect(createSettings(store).get().maxConcurrentJobs).toBe(4)
  })

  it("ignores undefined patch fields rather than blanking them", () => {
    const settings = createSettings(fakeStore())
    settings.set({ projectRoot: "/tmp/projects" })
    expect(settings.set({ theme: undefined }).projectRoot).toBe("/tmp/projects")
  })

  it("rejects an out-of-range value", () => {
    const settings = createSettings(fakeStore())
    expect(() => settings.set({ maxConcurrentJobs: 99 })).toThrow()
  })

  it("repairs a corrupt persisted blob by falling back to defaults", () => {
    const store = fakeStore()
    store.set("settings", { maxConcurrentJobs: "lots" })
    expect(createSettings(store).get().maxConcurrentJobs).toBe(2)
  })
})

describe("findEnvFile", () => {
  it("walks up from the start directory to the repo root", () => {
    const exists = (p: string) => p === "/repo/.env.local"
    expect(findEnvFile("/repo/apps/desktop", exists)).toBe("/repo/.env.local")
  })

  it("returns null when no .env.local exists above the start directory", () => {
    expect(findEnvFile("/repo/apps/desktop", () => false)).toBeNull()
  })
})

describe("verifyProviderKey", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("only ever targets listing endpoints, never a generation endpoint", () => {
    expect(VERIFY_ENDPOINTS.replicate).toBe(
      "https://api.replicate.com/v1/models"
    )
    expect(VERIFY_ENDPOINTS.openrouter).toBe("https://openrouter.ai/api/v1/key")
    for (const url of Object.values(VERIFY_ENDPOINTS)) {
      expect(url).not.toMatch(
        /prediction|completion|generation|\/videos|\/images/
      )
    }
  })

  it("accepts a key the Replicate listing endpoint answers", async () => {
    let seen: string | null = null
    server.use(
      http.get(VERIFY_ENDPOINTS.replicate, ({ request }) => {
        seen = request.headers.get("authorization")
        return HttpResponse.json({ results: [] })
      })
    )
    await expect(verifyProviderKey("replicate", "r8_good")).resolves.toEqual({
      valid: true,
    })
    expect(seen).toBe("Bearer r8_good")
  })

  it("accepts a key the OpenRouter key endpoint answers", async () => {
    server.use(
      http.get(VERIFY_ENDPOINTS.openrouter, () =>
        HttpResponse.json({ data: { label: "test" } })
      )
    )
    await expect(
      verifyProviderKey("openrouter", "sk-or-v1-good")
    ).resolves.toEqual({ valid: true })
  })

  it("rejects an unauthorised key without echoing it", async () => {
    server.use(
      http.get(VERIFY_ENDPOINTS.replicate, () =>
        HttpResponse.json({ detail: "no" }, { status: 401 })
      )
    )
    const result = await verifyProviderKey("replicate", "r8_bad_secret")
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/rejected/i)
    expect(JSON.stringify(result)).not.toContain("r8_bad_secret")
  })

  it("reports an unexpected status without claiming the key is bad", async () => {
    server.use(
      http.get(VERIFY_ENDPOINTS.openrouter, () =>
        HttpResponse.json({}, { status: 500 })
      )
    )
    const result = await verifyProviderKey("openrouter", "sk-or-v1-x")
    expect(result.valid).toBe(false)
    expect(result.message).toMatch(/500/)
  })

  it("reports a network failure without leaking the key", async () => {
    server.use(http.get(VERIFY_ENDPOINTS.replicate, () => HttpResponse.error()))
    const result = await verifyProviderKey("replicate", "r8_offline_secret")
    expect(result.valid).toBe(false)
    expect(JSON.stringify(result)).not.toContain("r8_offline_secret")
  })
})
