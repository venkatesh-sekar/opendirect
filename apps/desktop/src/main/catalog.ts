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
 * Two rules this module never breaks:
 *
 * - **A provider that fails must not empty the catalog.** One provider being
 *   down, rate-limited or missing a key leaves the others listed, and a
 *   refresh in which *everything* fails keeps the previous cache rather than
 *   replacing it with nothing.
 * - **⛔ Read-only.** Everything here goes through `listModels` / `getModel`,
 *   which are the providers' free listing endpoints. No generation is ever
 *   triggered from the catalog.
 */
import {
  modelDescriptorSchema,
  modelSummarySchema,
  parseModelKey,
  type ModelDescriptor,
  type ModelKind,
  type ModelSummary,
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
  /** Epoch ms of the last successful merge. */
  fetchedAt: z.number(),
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
   * cannot be written. Wired to the logger; never fatal.
   */
  onError?: (source: ProviderId | "cache", error: unknown) => void
}

export interface ListOptions {
  kinds?: ModelKind[]
  refresh?: boolean
}

export interface ModelCatalog {
  /** Summaries, from the cache while it is fresh. Never throws on one provider. */
  list(options?: ListOptions): Promise<ModelSummary[]>
  /** Re-fetches every configured provider and rewrites the cache. */
  refresh(kinds?: ModelKind[]): Promise<ModelSummary[]>
  /** One full descriptor, fetched and cached on demand. */
  getModel(
    key: string,
    options?: { refresh?: boolean }
  ): Promise<ModelDescriptor>
  /** Epoch ms of the last successful merge, or null when nothing is cached. */
  fetchedAt(): number | null
  isStale(): boolean
}

function emptyFile(): CatalogFile {
  return { version: 1, models: [], descriptors: {}, fetchedAt: 0 }
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

  function stale(): boolean {
    const file = load()
    return file.fetchedAt === 0 || now() - file.fetchedAt >= ttlMs
  }

  function byKinds(
    models: ModelSummary[],
    kinds?: ModelKind[]
  ): ModelSummary[] {
    if (!kinds || kinds.length === 0) return models
    const wanted = new Set(kinds)
    return models.filter((model) => wanted.has(model.kind))
  }

  async function refresh(kinds?: ModelKind[]): Promise<ModelSummary[]> {
    const file = load()
    const providers = configured()

    if (providers.length === 0) {
      // No keys at all: an empty catalog is the truth, not a failure, so the
      // previous models are dropped rather than shown as still available.
      cache = { ...file, models: [], fetchedAt: now() }
      persist()
      return []
    }

    const wanted = kinds && kinds.length > 0 ? kinds : DEFAULT_KINDS
    const merged = new Map<string, ModelSummary>()
    let succeeded = 0

    for (const provider of providers) {
      try {
        for (const model of await provider.listModels({ kinds: wanted }))
          merged.set(model.key, model)
        succeeded += 1
      } catch (error) {
        deps.onError?.(provider.id, error)
      }
    }

    if (succeeded === 0) {
      // Every provider failed. Keeping the previous (stale) cache, and its
      // older `fetchedAt` so the next `list()` retries, beats blanking the
      // picker because the network blipped.
      return byKinds(file.models, kinds)
    }

    const models = [...merged.values()].sort((a, b) =>
      a.key.localeCompare(b.key)
    )
    cache = { ...file, models, fetchedAt: now() }
    persist()
    return byKinds(models, kinds)
  }

  return {
    fetchedAt() {
      const { fetchedAt } = load()
      return fetchedAt === 0 ? null : fetchedAt
    },

    isStale: stale,

    async list(options: ListOptions = {}): Promise<ModelSummary[]> {
      if (options.refresh || stale()) return refresh(options.kinds)
      return byKinds(load().models, options.kinds)
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

      const descriptor = await provider.getModel(parsed.slug)
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
 * registered before the Electron app is ready (and before `userData` exists).
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
    const models = await catalog().list()
    return describeRecommended(models.map((model) => model.key))
  })
}
