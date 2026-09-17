/**
 * The model catalog: one merged, persisted view of every configured provider.
 *
 * Listing a provider's models is a handful of HTTP round-trips (Replicate
 * alone walks six collections), so the merged summaries are cached to
 * `userData/model-catalog.json` and served from there for 24 hours. A
 * `refresh` re-fetches on demand — that is what the picker's "Refresh catalog"
 * item calls.
 *
 * Full `ModelDescriptor`s are fetched **lazily**, one key at a time: a
 * descriptor carries the model's entire JSON Schema, and eagerly pulling 50 of
 * them to populate a dropdown would be both slow and pointless.
 *
 * Three rules this module never breaks:
 *
 * - **A provider that fails must not empty the catalog.** One provider being
 *   down, rate-limited or missing a key leaves the others listed, and a
 *   refresh in which *everything* fails keeps the previous cache rather than
 *   replacing it with nothing.
 * - **A failure is never silent.** Every provider error is carried out in
 *   `failures` so the picker can say "Replicate: …" instead of quietly
 *   showing a shorter list.
 * - **⛔ Read-only.** Everything here goes through `listModels` / `getModel`,
 *   which are the providers' free listing endpoints. No generation is ever
 *   triggered from the catalog.
 */
import {
  modelDescriptorSchema,
  modelSummarySchema,
  parseModelKey,
  providerFailureSchema,
  type CatalogListing,
  type ModelDescriptor,
  type ModelKind,
  type ModelSummary,
  type ProviderFailure,
  type ProviderId,
} from "@opendirect/contract"
import { z } from "zod"

import type { IpcRegistrar } from "./ipc-registry"
import { describeRecommended } from "./providers/defaults"
import type { ModelProvider } from "./providers/types"

/** How long a cached catalog is served before a `list()` re-fetches it. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

/** The file name under `app.getPath("userData")`. */
export const CATALOG_FILE_NAME = "model-catalog.json"

/** The modalities OpenDirect lists when a caller names none. */
export const DEFAULT_KINDS: ModelKind[] = ["video", "image"]

/**
 * The on-disk shape. `version` is checked on read: a cache written by an older
 * build is discarded rather than migrated, because it is re-fetchable.
 */
export const catalogFileSchema = z.object({
  version: z.literal(1),
  models: z.array(modelSummarySchema),
  descriptors: z.record(z.string(), modelDescriptorSchema),
  /** Epoch ms of the last successful merge, of any modality. */
  fetchedAt: z.number(),
  /**
   * Epoch ms per modality. Staleness is tracked per kind because a refresh may
   * be kind-scoped: re-fetching images must not make the cached video models
   * look freshly verified, nor blank them.
   */
  kindFetchedAt: z.record(z.string(), z.number()).default({}),
  /** The last refresh's provider failures, so a bad key stays visible. */
  failures: z.array(providerFailureSchema).default([]),
})
export type CatalogFile = z.output<typeof catalogFileSchema>

/** The persistence seam — a JSON file in production, memory in tests. */
export interface CatalogStore {
  /** The cache file's contents, or null when it does not exist yet. */
  read(): string | null
  write(json: string): void
}

export interface ModelCatalogDeps {
  /**
   * Every *registered* adapter. The catalog filters on `isConfigured()`
   * itself, so adding a key makes its provider appear on the next refresh
   * without anything being re-registered.
   */
  providers: () => ModelProvider[]
  store: CatalogStore
  /** Injected for deterministic staleness in tests. */
  now?: () => number
  ttlMs?: number
  /**
   * Called for each provider that fails a refresh, and for a cache file that
   * cannot be written. Wired to the logger; never fatal. Provider failures are
   * *also* returned to the caller in `failures` — this is the log, not the UI.
   */
  onError?: (source: ProviderId | "cache", error: unknown) => void
}

export interface ListOptions {
  kinds?: ModelKind[]
  refresh?: boolean
}

export interface ModelCatalog {
  /** Summaries, from the cache while it is fresh. Never throws on one provider. */
  list(options?: ListOptions): Promise<CatalogListing>
  /** Re-fetches the given modalities from every configured provider. */
  refresh(kinds?: ModelKind[]): Promise<CatalogListing>
  /** One full descriptor, fetched and cached on demand. */
  getModel(
    key: string,
    options?: { refresh?: boolean }
  ): Promise<ModelDescriptor>
  /** Epoch ms of the last successful merge, or null when nothing is cached. */
  fetchedAt(): number | null
  /** True when any of the given modalities (default: video+image) is overdue. */
  isStale(kinds?: ModelKind[]): boolean
  /**
   * Marks every modality overdue, so the next `list()` re-fetches. Called when
   * an API key changes: which providers are configured is exactly what the
   * cached catalog is a function of.
   */
  invalidate(): void
}

function emptyFile(): CatalogFile {
  return {
    version: 1,
    models: [],
    descriptors: {},
    fetchedAt: 0,
    kindFetchedAt: {},
    failures: [],
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "The provider could not be reached."
}

export function createModelCatalog(deps: ModelCatalogDeps): ModelCatalog {
  const now = deps.now ?? Date.now
  const ttlMs = deps.ttlMs ?? CATALOG_TTL_MS
  let cache: CatalogFile | null = null

  /**
   * The cache, read from the store on first use. Anything unreadable — absent,
   * truncated, written by an older `version` — is treated as "no cache" rather
   * than as an error: the catalog is always re-fetchable.
   */
  function load(): CatalogFile {
    if (cache) return cache
    const raw = deps.store.read()
    if (!raw) return (cache = emptyFile())
    try {
      const parsed = catalogFileSchema.safeParse(JSON.parse(raw))
      cache = parsed.success ? parsed.data : emptyFile()
    } catch {
      cache = emptyFile()
    }
    // A file written before per-kind timestamps existed: treat its one
    // timestamp as covering the modalities it would have been fetched with,
    // rather than re-fetching everything on the first launch after an upgrade.
    if (Object.keys(cache.kindFetchedAt).length === 0 && cache.fetchedAt > 0) {
      cache.kindFetchedAt = Object.fromEntries(
        DEFAULT_KINDS.map((kind) => [kind, cache!.fetchedAt])
      )
    }
    return cache
  }

  function persist(): void {
    try {
      deps.store.write(JSON.stringify(load()))
    } catch (error) {
      // A cache that cannot be written is a performance problem, not a
      // correctness one — the catalog still works, it just re-fetches.
      deps.onError?.("cache", error)
    }
  }

  function configured(): ModelProvider[] {
    return deps.providers().filter((provider) => provider.isConfigured())
  }

  function scope(kinds?: ModelKind[]): ModelKind[] {
    return kinds && kinds.length > 0 ? kinds : DEFAULT_KINDS
  }

  function stale(kinds?: ModelKind[]): boolean {
    const file = load()
    return scope(kinds).some((kind) => {
      const at = file.kindFetchedAt[kind] ?? 0
      return at === 0 || now() - at >= ttlMs
    })
  }

  function byKinds(
    models: ModelSummary[],
    kinds?: ModelKind[]
  ): ModelSummary[] {
    if (!kinds || kinds.length === 0) return models
    const wanted = new Set(kinds)
    return models.filter((model) => wanted.has(model.kind))
  }

  async function refresh(kinds?: ModelKind[]): Promise<CatalogListing> {
    const file = load()
    const providers = configured()
    const wanted = scope(kinds)

    if (providers.length === 0) {
      // No keys at all: an empty catalog is the truth, not a failure, so the
      // previous models are dropped rather than shown as still available.
      cache = {
        ...file,
        models: [],
        fetchedAt: now(),
        kindFetchedAt: Object.fromEntries(wanted.map((kind) => [kind, now()])),
        failures: [],
      }
      persist()
      return { models: [], failures: [] }
    }

    const fetched = new Map<string, ModelSummary>()
    const succeeded = new Set<ProviderId>()
    const failures: ProviderFailure[] = []

    for (const provider of providers) {
      try {
        for (const model of await provider.listModels({ kinds: wanted }))
          fetched.set(model.key, model)
        succeeded.add(provider.id)
      } catch (error) {
        deps.onError?.(provider.id, error)
        failures.push({ provider: provider.id, message: messageOf(error) })
      }
    }

    // A provider not attempted this round (no key) keeps whatever it last
    // reported; one that was attempted has its verdict replaced, so a fixed
    // key clears its own error.
    const attempted = new Set(providers.map((provider) => provider.id))
    const nextFailures = [
      ...file.failures.filter((failure) => !attempted.has(failure.provider)),
      ...failures,
    ]

    if (succeeded.size === 0) {
      // Every provider failed. Keeping the previous cache, and its older
      // timestamps so the next `list()` retries, beats blanking the picker
      // because the network blipped.
      cache = { ...file, failures: nextFailures }
      persist()
      return { models: byKinds(file.models, kinds), failures: nextFailures }
    }

    // Only the models this refresh actually re-listed are replaced: another
    // modality, and a *configured* provider's last-known models when its list
    // failed, both survive. A provider whose key was removed is not attempted
    // at all, so its cached models are dropped here rather than lingering as
    // models the user can no longer run.
    const refreshed = new Set(wanted)
    const merged = new Map<string, ModelSummary>()
    for (const model of file.models) {
      if (
        refreshed.has(model.kind) &&
        (succeeded.has(model.provider) || !attempted.has(model.provider))
      )
        continue
      merged.set(model.key, model)
    }
    for (const model of fetched.values()) merged.set(model.key, model)

    const models = [...merged.values()].sort((a, b) =>
      a.key.localeCompare(b.key)
    )
    cache = {
      ...file,
      models,
      fetchedAt: now(),
      kindFetchedAt: {
        ...file.kindFetchedAt,
        ...Object.fromEntries(wanted.map((kind) => [kind, now()])),
      },
      failures: nextFailures,
    }
    persist()
    return { models: byKinds(models, kinds), failures: nextFailures }
  }

  return {
    fetchedAt() {
      const { fetchedAt } = load()
      return fetchedAt === 0 ? null : fetchedAt
    },

    isStale: stale,

    invalidate() {
      const file = load()
      // The models are kept — they are still the best guess until the refresh
      // lands — but nothing is considered verified any more, and a stale
      // failure from the old key must not outlive it.
      cache = { ...file, kindFetchedAt: {}, fetchedAt: 0, failures: [] }
      persist()
    },

    async list(options: ListOptions = {}): Promise<CatalogListing> {
      if (options.refresh || stale(options.kinds)) return refresh(options.kinds)
      const file = load()
      return {
        models: byKinds(file.models, options.kinds),
        failures: file.failures,
      }
    },

    async getModel(
      key: string,
      options: { refresh?: boolean } = {}
    ): Promise<ModelDescriptor> {
      const parsed = parseModelKey(key)
      if (!parsed) {
        throw new Error(
          `"${key}" is not a model key; expected "provider:slug".`
        )
      }

      const file = load()
      const cached = file.descriptors[key]
      if (!options.refresh && cached && now() - cached.fetchedAt < ttlMs) {
        return cached
      }

      const provider = deps
        .providers()
        .find((candidate) => candidate.id === parsed.provider)
      if (!provider?.isConfigured()) {
        throw new Error(
          `No API key is configured for ${parsed.provider}. Add one in Settings to use "${key}".`
        )
      }

      const descriptor = await provider.getModel(parsed.slug, options)
      cache = {
        ...file,
        descriptors: { ...file.descriptors, [key]: descriptor },
      }
      persist()
      return descriptor
    },

    refresh,
  }
}

/**
 * Wires the three `models:*` channels onto a registrar.
 *
 * The catalog is resolved per call rather than captured, so handlers can be
 * registered before the Electron app is ready (and before `userData` exists),
 * and so a catalog invalidated by a key change is picked up on the next call.
 *
 * ⛔ Read-only: `list` and `get` reach only the providers' free listing
 * endpoints, and `recommended` touches no network beyond what `list` already
 * cached.
 */
export function registerModelHandlers(
  handle: IpcRegistrar["handle"],
  catalog: () => ModelCatalog
): void {
  handle("models:list", ({ kinds, refresh }) =>
    catalog().list({ kinds, refresh })
  )

  handle("models:get", ({ key }) => catalog().getModel(key))

  handle("models:recommended", async () => {
    // Whatever the catalog can serve without forcing a refresh: a shortlist
    // is a hint, and must never be the thing that triggers a network round.
    const { models } = await catalog().list()
    return describeRecommended(models.map((model) => model.key))
  })
}
