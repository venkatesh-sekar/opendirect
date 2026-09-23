/**
 * The remote registry layer (design §4.2): a copy of this repo's `registry/`
 * folder fetched from raw GitHub (or the URL in settings) and cached on disk,
 * so a mapping fixed upstream reaches users without an app release.
 *
 * This module only fetches and stores. Whether the copy is *used* (a format
 * this build understands, a newer `registryVersion`) is decided by
 * `registry.ts` when it merges the layers, so a cache written by a newer or
 * older app is read the same way; `registry.ts` also declines to write a
 * fetched copy in a format it cannot read over the cache it has.
 *
 * ⛔ Free `GET`s of static JSON files only. Nothing here talks to a provider,
 * and nothing here runs at startup: `registry.ts` calls `fetch` from the
 * Reload button or a once-a-day background refresh.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { REGISTRY_FORMAT, registryIndexSchema } from "@opendirect/contract"
import { z } from "zod"

/** Under `userData`, next to `model-catalog.json`. */
export const REGISTRY_CACHE_FILE = "model-registry.json"

/**
 * The most a registry JSON file (remote or imported) may be. A real one is a
 * few KB; this only stops a wrong URL or file from filling memory.
 */
export const MAX_REGISTRY_JSON_BYTES = 2 * 1024 * 1024

/** "is larger than 2 MB." — prefixed with a file name, or with "The file". */
export function tooLargeMessage(): string {
  return `is larger than ${MAX_REGISTRY_JSON_BYTES / (1024 * 1024)} MB.`
}

/** Reads a response body, giving up as soon as it passes the cap. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > MAX_REGISTRY_JSON_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`The file ${tooLargeMessage()}`)
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REGISTRY_JSON_BYTES) {
      void reader.cancel().catch(() => {})
      throw new Error(`The file ${tooLargeMessage()}`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** Per request; a registry file is a few KB, so this only catches a hang. */
const TIMEOUT_MS = 15_000
/** Family files fetched at once. */
const CONCURRENCY = 6

export interface RemoteCache {
  version: 1
  /** The base URL it came from, without a trailing slash. */
  url: string
  fetchedAt: number
  /** Unvalidated beyond what `fetch` needed: the merge validates it. */
  index: unknown
  /** Family id → the file's JSON, or `{ __error }` when that file failed. */
  files: Record<string, unknown>
}

const remoteCacheSchema = z.object({
  version: z.literal(1),
  url: z.string(),
  fetchedAt: z.number(),
  index: z.unknown(),
  files: z.record(z.string(), z.unknown()),
})

export interface RemoteRegistrySource {
  /** The disk cache; missing or unparsable reads as null. */
  read(): RemoteCache | null
  /** ⛔ Free GETs only. Rejects when the index cannot be fetched or read. */
  fetch(baseUrl: string): Promise<RemoteCache>
  /** Write-then-rename, as `catalog-service.ts` does. */
  write(cache: RemoteCache): void
}

/** `https://…/registry/` → `https://…/registry`, so two spellings are one URL. */
export function normalizeRegistryUrl(url: string): string {
  return url.trim().replace(/\/+$/, "")
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createRemoteSource(deps: {
  path: string
  fetch?: typeof fetch
  now?: () => number
}): RemoteRegistrySource {
  const now = deps.now ?? Date.now

  async function getJson(url: string): Promise<unknown> {
    // Looked up per call rather than captured, so msw's patched global is
    // the one a test sees.
    const fetchImpl = deps.fetch ?? globalThis.fetch
    const response = await fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return JSON.parse(await readCapped(response)) as unknown
  }

  return {
    read() {
      try {
        const parsed = remoteCacheSchema.safeParse(
          JSON.parse(readFileSync(deps.path, "utf8"))
        )
        return parsed.success ? (parsed.data as RemoteCache) : null
      } catch {
        return null
      }
    },

    async fetch(baseUrl) {
      const url = normalizeRegistryUrl(baseUrl)
      let index: z.output<typeof registryIndexSchema>
      let rawIndex: unknown
      try {
        rawIndex = await getJson(`${url}/index.json`)
        const parsed = registryIndexSchema.safeParse(rawIndex)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          const where = issue?.path.length ? `${issue.path.join(".")}: ` : ""
          throw new Error(
            `index.json is not a registry index (${where}${issue?.message ?? "invalid"})`
          )
        }
        index = parsed.data
      } catch (error) {
        throw new Error(
          `Could not fetch the model registry from ${url}: ${messageOf(error)}`
        )
      }

      const files: Record<string, unknown> = {}
      // A format this build cannot read is reported by the merge from the
      // index alone; fetching its files would only spend requests.
      if (index.format === REGISTRY_FORMAT) {
        // Ids passed `familyIdSchema`, so they are safe in a URL path.
        const queue = [...new Set(index.families)]
        const worker = async () => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            try {
              files[id] = await getJson(`${url}/models/${id}.json`)
            } catch (error) {
              files[id] = { __error: messageOf(error) }
            }
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
        )
      }

      return { version: 1, url, fetchedAt: now(), index: rawIndex, files }
    },

    write(cache) {
      // Write-then-rename: a crash mid-write must not leave a half-written
      // cache that reads as "no cache".
      mkdirSync(dirname(deps.path), { recursive: true })
      const temporary = `${deps.path}.tmp`
      writeFileSync(temporary, JSON.stringify(cache), "utf8")
      renameSync(temporary, deps.path)
    },
  }
}
