/**
 * Shared fixtures for the Models tab's component tests: a registry status,
 * settings, a key summary and families, plus a renderer with the providers
 * every component here needs.
 *
 * ⛔ Test-only. Every IPC channel is stubbed by the caller's `invoke` mock;
 * nothing reaches a provider or the network.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  settingsDefaults,
  type KeysSummary,
  type ModelFamily,
  type RegistryFamilyEntry,
  type RegistryStatus,
  type Settings,
  type UserOverride,
} from "@opendirect/contract"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { render, type RenderResult } from "@testing-library/react"

export function renderWithProviders(
  ui: React.ReactElement
): RenderResult & { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    ),
  }
}

export function status(
  overrides: Partial<RegistryStatus> = {}
): RegistryStatus {
  return {
    format: 1,
    bundledVersion: 1,
    activeVersion: 1,
    activeSource: "bundled",
    remote: {
      enabled: true,
      url: "https://raw.githubusercontent.com/venkatesh-sekar/opendirect/main/registry",
      version: null,
      fetchedAt: null,
      error: null,
    },
    overrides: 0,
    families: 3,
    warnings: [],
    ...overrides,
  }
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...settingsDefaults, ...overrides }
}

export function keys(
  present: { replicate?: boolean; openrouter?: boolean } = {}
): KeysSummary {
  const one = (on: boolean | undefined) =>
    on
      ? { present: true, last4: "abcd", source: "vault" as const }
      : { present: false, last4: null, source: "none" as const }
  return {
    replicate: one(present.replicate),
    openrouter: one(present.openrouter),
    encryptionAvailable: true,
  }
}

export function family(overrides: Partial<ModelFamily> = {}): ModelFamily {
  return {
    id: "seedance-2-5",
    name: "Seedance 2.5",
    kind: "video",
    endpoints: [
      {
        provider: "replicate",
        model: "bytedance/seedance-2.5",
        inputs: {
          first_frame: { field: "image", kind: "image" },
          last_frame: { field: "last_frame_image", kind: "image" },
          reference: { field: "reference_images", kind: "image", max: 4 },
        },
        controls: { prompt: { field: "prompt" } },
      },
    ],
    ...overrides,
  }
}

export function entry(
  overrides: Partial<RegistryFamilyEntry> = {}
): RegistryFamilyEntry {
  return {
    family: family(),
    source: "bundled",
    shadows: [],
    warnings: [],
    ...overrides,
  }
}

export function override(overrides: Partial<UserOverride> = {}): UserOverride {
  const fam = overrides.family === undefined ? family() : overrides.family
  return {
    key: "k1",
    id: fam?.id ?? null,
    raw: fam ?? {},
    family: fam,
    issues: [],
    updatedAt: 0,
    ...overrides,
  }
}
