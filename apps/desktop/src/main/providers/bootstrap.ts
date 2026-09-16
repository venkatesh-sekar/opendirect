/**
 * Registers the two shipped adapters into the provider registry.
 *
 * Both are registered unconditionally, at startup, and each is handed a
 * *getter* for its key rather than the key itself. That is what makes the
 * registry "keyed off configured keys" without ever needing to re-register:
 * `isConfigured()` re-reads the vault (and its `.env.local` fallback) on every
 * call, so pasting a key in Settings makes that provider appear in the catalog
 * on the next refresh, and clearing one makes it disappear.
 */
import type { ProviderId } from "@opendirect/contract"

import { createOpenRouterProvider } from "./openrouter"
import { registerProvider } from "./registry"
import { createReplicateProvider } from "./replicate"
import type { ModelProvider } from "./types"

/** The slice of the key vault an adapter needs. */
export interface ProviderKeySource {
  /** Vault first, then the provider's env var. Null when neither has one. */
  getKeyWithEnvFallback(provider: ProviderId): string | null
}

/** The adapters, built but not yet registered. */
export function createModelProviders(keys: ProviderKeySource): ModelProvider[] {
  return [
    createReplicateProvider({
      getKey: () => keys.getKeyWithEnvFallback("replicate"),
    }),
    createOpenRouterProvider({
      getKey: () => keys.getKeyWithEnvFallback("openrouter"),
    }),
  ]
}

/** Builds and registers both adapters. Safe to call again; it replaces them. */
export function registerModelProviders(
  keys: ProviderKeySource
): ModelProvider[] {
  const providers = createModelProviders(keys)
  for (const provider of providers) registerProvider(provider)
  return providers
}
