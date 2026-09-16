/**
 * The provider registry: one `ModelProvider` per `ProviderId`.
 *
 * Adapters register themselves at main-process startup; everything else asks
 * the registry rather than importing an adapter directly, so adding a third
 * provider never touches a call site.
 */
import type { ProviderId } from "@opendirect/contract"

import type { ModelProvider } from "./types"

const providers = new Map<ProviderId, ModelProvider>()

/** Registers (or replaces) the adapter for a provider id. */
export function registerProvider(provider: ModelProvider): void {
  providers.set(provider.id, provider)
}

/** The adapter for `id`, or undefined when none has been registered yet. */
export function getProvider(id: ProviderId): ModelProvider | undefined {
  return providers.get(id)
}

/** Like `getProvider`, but throws — for call sites where absence is a bug. */
export function requireProvider(id: ProviderId): ModelProvider {
  const provider = providers.get(id)
  if (!provider) throw new Error(`No provider registered for "${id}"`)
  return provider
}

/** Every registered adapter, in registration order. */
export function listProviders(): ModelProvider[] {
  return [...providers.values()]
}

/** Only the adapters that currently hold an API key. */
export function listConfigured(): ModelProvider[] {
  return listProviders().filter((provider) => provider.isConfigured())
}

/** Test-only: drops every registration. */
export function resetProviders(): void {
  providers.clear()
}
