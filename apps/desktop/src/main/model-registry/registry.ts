/**
 * The model registry in main (design §4): the bundled mappings, a newer
 * remote copy when one is cached, then the user's own — merged by the
 * contract's pure `mergeRegistry`, so main and the renderer agree on what
 * wins.
 *
 * Plain Node with injected deps, like `catalog.ts`; `registry-service.ts` is
 * the Electron wiring. Nothing fails silently: a remote copy that cannot be
 * used, a family file that failed, a bad entry — each is a warning in
 * `status()`, and the lower layer stays in force.
 *
 * ⛔ The only network access is `remote.fetch` (free `GET`s of static JSON),
 * reached from `reload()` — the Reload button — and `refreshIfStale()`, at
 * most once a day. Never at startup, never a provider.
 */
import {
  DEFAULT_REGISTRY_URL,
  REGISTRY_FORMAT,
  mergeRegistry,
  modelKey,
  registryIndexSchema,
  type MergedRegistry,
  type ProviderId,
  type RegistryFamilyEntry,
  type RegistryIndex,
  type RegistryLayerInput,
  type RegistryStatus,
  type RegistryWarning,
  type Settings,
  type UserOverride,
} from "@opendirect/contract"

import type { OverrideStore } from "./overrides"
import {
  normalizeRegistryUrl,
  type RemoteCache,
  type RemoteRegistrySource,
} from "./remote"

/** How old the remote copy (or the last good try) may get before a background refresh. */
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** After a failed background fetch, the next try comes this much sooner. */
export const RETRY_INTERVAL_MS = 60 * 60 * 1000

export interface ModelRegistryDeps {
  bundled: {
    index: unknown
    families: ReadonlyArray<{ origin: string; raw: unknown }>
  }
  remote: RemoteRegistrySource
  overrides: OverrideStore
  settings: () => Pick<Settings, "remoteRegistry" | "registryUrl">
  now?: () => number
  onError?: (error: unknown) => void
  /**
   * A background refresh (`refreshIfStale`) changed the merged registry.
   * Nobody asked for it, so nobody is waiting on an answer that would
   * re-read descriptors and prices; this is how main tells the renderer.
   * `reload()` and override edits do not call it — their caller already
   * knows.
   */
  onChange?: () => void
}

export interface ModelRegistry {
  /** Cached; rebuilt after a reload, a save or a delete, or a settings change. */
  merged(): MergedRegistry
  status(): RegistryStatus
  /** Re-fetches the remote copy when enabled, then rebuilds. Never rejects. */
  reload(): Promise<RegistryStatus>
  /**
   * Background refresh at most every 24h (1h after a failed try); never
   * throws; never blocks.
   */
  refreshIfStale(): void
  family(id: string): RegistryFamilyEntry | null
  familyForEndpoint(
    provider: ProviderId,
    model: string
  ): RegistryFamilyEntry | null
  overrides: {
    list(): UserOverride[]
    /** Throws `OverrideValidationError` when `raw` does not validate. */
    save(raw: unknown, replaceId: string | null): UserOverride
    /** By the entry's storage key (`UserOverride.key`). */
    delete(key: string): void
  }
}

interface Built {
  /** What the merge depends on besides the stored data. */
  key: string
  merged: MergedRegistry
  status: RegistryStatus
  byId: Map<string, RegistryFamilyEntry>
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function firstIssue(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>
}): string {
  const issue = error.issues[0]
  const path = issue?.path.length ? `${issue.path.map(String).join(".")}: ` : ""
  return `${path}${issue?.message ?? "invalid"}`
}

function formatWarning(source: "bundled" | "remote", format: number): string {
  const which =
    source === "remote" ? "The remote registry" : "The bundled registry"
  return `${which} uses format ${format}; this version of OpenDirect understands ${REGISTRY_FORMAT}. Update the app to use it.`
}

export function createModelRegistry(deps: ModelRegistryDeps): ModelRegistry {
  const now = deps.now ?? Date.now
  const onError = deps.onError ?? (() => {})
  const onChange = deps.onChange ?? (() => {})

  // The bundled layer never changes while the app runs: read it once.
  const bundledWarnings: RegistryWarning[] = []
  const bundledIndex = registryIndexSchema.safeParse(deps.bundled.index)
  let bundledVersion = 0
  if (!bundledIndex.success) {
    // A bug in the build, and `bundled.test.ts` guards against it; in a
    // running app the files are still better than nothing.
    bundledWarnings.push({
      source: "bundled",
      familyId: null,
      message: `registry/index.json: ${firstIssue(bundledIndex.error)}`,
    })
  } else {
    bundledVersion = bundledIndex.data.registryVersion
    if (bundledIndex.data.format !== REGISTRY_FORMAT) {
      bundledWarnings.push({
        source: "bundled",
        familyId: null,
        message: formatWarning("bundled", bundledIndex.data.format),
      })
    }
  }
  for (const warning of bundledWarnings) onError(new Error(warning.message))

  let cache: RemoteCache | null | undefined
  let remoteError: string | null = null
  /**
   * True when `remoteError` is about the fetched copy itself (a newer format,
   * an index that does not validate), not about reaching it: such a copy was
   * refused, and the Models tab lists why among the warnings.
   */
  let remoteRefused = false
  let lastAttempt: { at: number; ok: boolean } | null = null
  /** Keyed by URL: a reload after a URL change must not wait on the old one. */
  const inflight = new Map<string, Promise<void>>()
  let built: Built | null = null

  function readCache(): RemoteCache | null {
    if (cache === undefined) cache = deps.remote.read()
    return cache
  }

  function remoteSettings() {
    const settings = deps.settings()
    return {
      enabled: settings.remoteRegistry,
      url: normalizeRegistryUrl(settings.registryUrl ?? DEFAULT_REGISTRY_URL),
    }
  }

  /** The cached copy, when it is for the URL in force. */
  function usableCache(): RemoteCache | null {
    const { enabled, url } = remoteSettings()
    const current = readCache()
    if (!enabled || !current || current.url !== url) return null
    return current
  }

  function build(): Built {
    const { enabled, url } = remoteSettings()
    const remote = usableCache()
    const key = JSON.stringify([enabled, url, remote?.fetchedAt ?? null])
    if (built && built.key === key) return built

    const layers: RegistryLayerInput[] = [
      { source: "bundled", entries: deps.bundled.families },
    ]
    const layerWarnings: RegistryWarning[] = [...bundledWarnings]
    let remoteIndex: RegistryIndex | null = null
    let activeSource: "bundled" | "remote" = "bundled"

    if (remote) {
      const parsed = registryIndexSchema.safeParse(remote.index)
      if (!parsed.success) {
        layerWarnings.push({
          source: "remote",
          familyId: null,
          message: `The remote registry's index.json cannot be read (${firstIssue(parsed.error)}); the bundled mappings stay in force.`,
        })
      } else {
        remoteIndex = parsed.data
        if (remoteIndex.format !== REGISTRY_FORMAT) {
          layerWarnings.push({
            source: "remote",
            familyId: null,
            message: formatWarning("remote", remoteIndex.format),
          })
        } else if (remoteIndex.registryVersion > bundledVersion) {
          // Older or equal is not a problem, only not news: no warning.
          activeSource = "remote"
          const entries: Array<{ origin: string; raw: unknown }> = []
          for (const id of remoteIndex.families) {
            const origin = `remote models/${id}.json`
            const raw = remote.files[id]
            const failed =
              raw === undefined
                ? "not fetched"
                : typeof raw === "object" && raw !== null && "__error" in raw
                  ? String((raw as { __error: unknown }).__error)
                  : null
            if (failed !== null) {
              layerWarnings.push({
                source: "remote",
                familyId: id,
                message: `${origin}: ${failed}`,
              })
              continue
            }
            entries.push({ origin, raw })
          }
          layers.push({ source: "remote", entries })
        }
      }
    }

    const overrides = deps.overrides.list()
    layers.push({
      source: "user",
      // Every stored entry goes through the merge, so one that no longer
      // validates is a warning rather than quietly missing.
      entries: overrides.map((override) => ({
        origin: `your mapping ${override.id ?? "(no id)"}`,
        raw: override.raw,
      })),
    })

    const merged = mergeRegistry(layers)
    // File-level problems belong to a family's row too.
    const families = merged.families.map((entry) => ({
      ...entry,
      warnings: [
        ...layerWarnings
          .filter((warning) => warning.familyId === entry.family.id)
          .map((warning) => warning.message),
        ...entry.warnings,
      ],
    }))
    const result: MergedRegistry = {
      families,
      warnings: [...layerWarnings, ...merged.warnings],
      endpointIndex: merged.endpointIndex,
    }

    built = {
      key,
      merged: result,
      byId: new Map(families.map((entry) => [entry.family.id, entry])),
      status: {
        format: REGISTRY_FORMAT,
        bundledVersion,
        activeVersion:
          activeSource === "remote" && remoteIndex
            ? remoteIndex.registryVersion
            : bundledVersion,
        activeSource,
        remote: {
          enabled,
          url,
          version: remoteIndex?.registryVersion ?? null,
          fetchedAt: remote?.fetchedAt ?? null,
          error: remoteError,
        },
        overrides: overrides.length,
        families: families.length,
        warnings: result.warnings,
      },
    }
    return built
  }

  function invalidate(): void {
    built = null
  }

  /**
   * Why a fetched copy cannot be used at all, or null. Such a copy is not
   * written: it would replace a cache that still works with one that never
   * will. A newer format stays so until the app updates; an index that does
   * not validate is likely a publishing mistake, so it is tried again soon.
   */
  function unusable(
    next: RemoteCache
  ): { message: string; retrySoon: boolean } | null {
    const parsed = registryIndexSchema.safeParse(next.index)
    if (!parsed.success) {
      return {
        message: `The remote registry's index.json cannot be read (${firstIssue(parsed.error)}); it was not used.`,
        retrySoon: true,
      }
    }
    if (parsed.data.format !== REGISTRY_FORMAT) {
      return {
        message: formatWarning("remote", parsed.data.format),
        retrySoon: false,
      }
    }
    return null
  }

  async function fetchRemote(url: string): Promise<void> {
    const at = now()
    try {
      const next = await deps.remote.fetch(url)
      // The URL changed while this was in flight: its answer is for a
      // registry no longer in force, and must not replace the new one's.
      if (remoteSettings().url !== url) return
      const reason = unusable(next)
      if (reason !== null) {
        remoteError = reason.message
        remoteRefused = true
        lastAttempt = { at, ok: !reason.retrySoon }
        onError(new Error(reason.message))
        return
      }
      deps.remote.write(next)
      cache = next
      remoteError = null
      remoteRefused = false
      lastAttempt = { at, ok: true }
    } catch (error) {
      // The previous cache (if any) stays exactly as it was.
      if (remoteSettings().url === url) {
        remoteError = messageOf(error)
        remoteRefused = false
        lastAttempt = { at, ok: false }
      }
      onError(error)
    } finally {
      invalidate()
    }
  }

  /** What a descriptor or a price can depend on in the merge. */
  function fingerprint(): string {
    const { merged } = build()
    return JSON.stringify([
      merged.families.map((entry) => entry.family),
      [...merged.endpointIndex],
    ])
  }

  function startFetch(url: string): Promise<void> {
    let pending = inflight.get(url)
    if (!pending) {
      pending = fetchRemote(url).finally(() => {
        inflight.delete(url)
      })
      inflight.set(url, pending)
    }
    return pending
  }

  function status(): RegistryStatus {
    const current = build().status
    // The error can change without the merge changing. A refused copy (a
    // newer format, an index that does not validate) is also a warning, so
    // the Models tab shows it with the rest.
    const refusalNotice =
      remoteRefused &&
      remoteError !== null &&
      !current.warnings.some((warning) => warning.message === remoteError)
    return {
      ...current,
      remote: { ...current.remote, error: remoteError },
      warnings: refusalNotice
        ? [
            { source: "remote", familyId: null, message: remoteError! },
            ...current.warnings,
          ]
        : current.warnings,
    }
  }

  return {
    merged: () => build().merged,
    status,

    async reload() {
      const { enabled, url } = remoteSettings()
      // Overrides and the cache are re-read too, so a hand-edit shows up.
      cache = undefined
      invalidate()
      if (enabled) await startFetch(url)
      return status()
    },

    refreshIfStale() {
      try {
        const { enabled, url } = remoteSettings()
        if (!enabled || inflight.size > 0) return
        const current = readCache()
        const fetchedAt =
          current && current.url === url ? current.fetchedAt : null
        if (lastAttempt && !lastAttempt.ok) {
          // A failed try is retried sooner; the copy on disk, if any, is
          // still the one in force meanwhile.
          if (now() - lastAttempt.at < RETRY_INTERVAL_MS) return
        } else {
          const last = Math.max(
            fetchedAt ?? -Infinity,
            lastAttempt?.at ?? -Infinity
          )
          if (now() - last < REFRESH_INTERVAL_MS) return
        }
        const before = fingerprint()
        void startFetch(url).then(() => {
          try {
            if (fingerprint() !== before) onChange()
          } catch (error) {
            onError(error)
          }
        })
      } catch (error) {
        onError(error)
      }
    },

    family: (id) => build().byId.get(id) ?? null,

    familyForEndpoint(provider, model) {
      const { merged, byId } = build()
      const id = merged.endpointIndex.get(modelKey(provider, model))
      return id === undefined ? null : (byId.get(id) ?? null)
    },

    overrides: {
      list: () => deps.overrides.list(),
      save(raw, replaceId) {
        const saved = deps.overrides.save(raw, replaceId, now())
        invalidate()
        return saved
      },
      delete(id) {
        deps.overrides.delete(id)
        invalidate()
      },
    },
  }
}
