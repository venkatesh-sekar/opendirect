/**
 * ⛔ No network: the remote source is an in-memory fake here. The real one is
 * exercised against msw in `remote.test.ts`.
 */
import { DEFAULT_REGISTRY_URL } from "@opendirect/contract"
import { describe, expect, it, vi } from "vitest"

import type { SettingsStore } from "../settings"
import { OverrideValidationError, createOverrideStore } from "./overrides"
import {
  createModelRegistry,
  REFRESH_INTERVAL_MS,
  RETRY_INTERVAL_MS,
} from "./registry"
import type { RemoteCache, RemoteRegistrySource } from "./remote"

const NOW = 1_790_000_000_000

const family = (id: string, name = id, model = `me/${id}`) => ({
  id,
  name,
  kind: "image",
  endpoints: [{ provider: "replicate", model }],
})

const bundled = {
  index: { format: 1, registryVersion: 3, families: ["a", "b"] },
  families: [
    { origin: "registry/models/a.json", raw: family("a", "A bundled") },
    { origin: "registry/models/b.json", raw: family("b", "B bundled") },
  ],
}

function remoteCache(
  patch: Partial<RemoteCache> & {
    registryVersion?: number
    format?: number
  } = {}
): RemoteCache {
  const { registryVersion = 4, format = 1, ...rest } = patch
  return {
    version: 1,
    url: DEFAULT_REGISTRY_URL,
    fetchedAt: NOW,
    index: { format, registryVersion, families: ["a"] },
    files: { a: family("a", "A remote") },
    ...rest,
  }
}

function fakeRemote(
  initial: RemoteCache | null = null,
  fetched: () => Promise<RemoteCache> = async () => remoteCache()
) {
  let cache = initial
  return {
    read: vi.fn(() => cache),
    fetch: vi.fn((url: string): Promise<RemoteCache> => {
      void url
      return fetched()
    }),
    write: vi.fn((next: RemoteCache) => {
      cache = next
    }),
  } satisfies RemoteRegistrySource
}

function memoryStore(): SettingsStore {
  const data: Record<string, unknown> = {}
  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value
    },
    delete: (key) => {
      delete data[key]
    },
  }
}

function setup(
  options: {
    remote?: ReturnType<typeof fakeRemote>
    remoteRegistry?: boolean
    registryUrl?: string | null
    clock?: { now: number }
    bundled?: typeof bundled
  } = {}
) {
  const remote = options.remote ?? fakeRemote()
  const clock = options.clock ?? { now: NOW }
  const settings = {
    remoteRegistry: options.remoteRegistry ?? true,
    registryUrl: (options.registryUrl ?? null) as string | null,
  }
  const onError = vi.fn()
  const onChange = vi.fn()
  const registry = createModelRegistry({
    bundled: options.bundled ?? bundled,
    remote,
    overrides: createOverrideStore(memoryStore()),
    settings: () => settings,
    now: () => clock.now,
    onError,
    onChange,
  })
  return { registry, remote, settings, clock, onError, onChange }
}

function names(registry: ReturnType<typeof setup>["registry"]) {
  return registry.merged().families.map((entry) => entry.family.name)
}

describe("createModelRegistry", () => {
  it("serves the bundled layer alone", () => {
    const { registry } = setup()

    expect(names(registry)).toEqual(["A bundled", "B bundled"])
    expect(registry.status()).toEqual({
      format: 1,
      bundledVersion: 3,
      activeVersion: 3,
      activeSource: "bundled",
      remote: {
        enabled: true,
        url: DEFAULT_REGISTRY_URL,
        version: null,
        fetchedAt: null,
        error: null,
      },
      overrides: 0,
      families: 2,
      warnings: [],
    })
  })

  it("uses a newer remote copy, whose family replaces the bundled one", () => {
    const { registry } = setup({ remote: fakeRemote(remoteCache()) })

    expect(registry.family("a")).toMatchObject({
      source: "remote",
      shadows: ["bundled"],
      family: { name: "A remote" },
    })
    expect(registry.family("b")?.source).toBe("bundled")
    expect(registry.status()).toMatchObject({
      activeSource: "remote",
      activeVersion: 4,
      remote: { version: 4, fetchedAt: NOW, error: null },
    })
  })

  it("keeps the bundled layer, with a warning, for a format it cannot read", () => {
    const { registry } = setup({
      remote: fakeRemote(remoteCache({ format: 2, registryVersion: 9 })),
    })

    expect(registry.family("a")?.source).toBe("bundled")
    const status = registry.status()
    expect(status.activeSource).toBe("bundled")
    expect(status.remote.version).toBe(9)
    expect(status.warnings).toEqual([
      {
        source: "remote",
        familyId: null,
        message:
          "The remote registry uses format 2; this version of OpenDirect understands 1. Update the app to use it.",
      },
    ])
  })

  it("ignores a remote copy that is not newer, without a warning", () => {
    const { registry } = setup({
      remote: fakeRemote(remoteCache({ registryVersion: 3 })),
    })

    expect(registry.family("a")?.source).toBe("bundled")
    expect(registry.status()).toMatchObject({
      activeSource: "bundled",
      activeVersion: 3,
      remote: { version: 3 },
      warnings: [],
    })
  })

  it("warns about a remote index it cannot read and keeps the bundled layer", () => {
    const { registry } = setup({
      remote: fakeRemote(remoteCache({ index: { format: "one" } })),
    })

    expect(registry.status().activeSource).toBe("bundled")
    expect(registry.status().warnings[0]).toMatchObject({
      source: "remote",
      message: expect.stringContaining("index.json"),
    })
  })

  it("reports a remote family file that failed, and the bundled one stays", () => {
    const { registry } = setup({
      remote: fakeRemote(
        remoteCache({
          index: { format: 1, registryVersion: 4, families: ["a", "b"] },
          files: { a: { __error: "HTTP 404" }, b: family("b", "B remote") },
        })
      ),
    })

    expect(registry.family("a")?.source).toBe("bundled")
    expect(registry.family("b")?.source).toBe("remote")
    expect(registry.status().warnings).toContainEqual({
      source: "remote",
      familyId: "a",
      message: "remote models/a.json: HTTP 404",
    })
  })

  it("ignores a cache fetched from another URL", () => {
    const { registry } = setup({
      remote: fakeRemote(
        remoteCache({ url: "https://elsewhere.test/registry" })
      ),
    })

    expect(registry.status()).toMatchObject({
      activeSource: "bundled",
      remote: { version: null, fetchedAt: null },
    })
  })

  it("lets a user mapping shadow both lower layers", () => {
    const { registry } = setup({ remote: fakeRemote(remoteCache()) })

    const saved = registry.overrides.save(family("a", "A mine"), null)

    expect(saved.updatedAt).toBe(NOW)
    expect(registry.family("a")).toMatchObject({
      source: "user",
      shadows: ["bundled", "remote"],
      family: { name: "A mine" },
    })
    expect(registry.status().overrides).toBe(1)

    registry.overrides.delete(saved.key)

    expect(registry.family("a")?.source).toBe("remote")
    expect(registry.overrides.list()).toEqual([])
  })

  it("refuses an invalid user mapping and changes nothing", () => {
    const { registry } = setup()

    expect(() => registry.overrides.save({ id: "a", name: "A" }, null)).toThrow(
      OverrideValidationError
    )
    expect(registry.family("a")?.source).toBe("bundled")
  })

  it("finds the family that maps an endpoint", () => {
    const { registry } = setup()
    registry.overrides.save(family("c", "C", "someone/else"), null)

    expect(registry.familyForEndpoint("replicate", "me/a")?.family.id).toBe("a")
    expect(
      registry.familyForEndpoint("replicate", "someone/else")?.family.id
    ).toBe("c")
    expect(registry.familyForEndpoint("openrouter", "me/a")).toBeNull()
    expect(registry.family("nope")).toBeNull()
  })

  it("reloads: fetches the remote copy, caches it and uses it", async () => {
    const { registry, remote } = setup()

    const status = await registry.reload()

    expect(remote.fetch).toHaveBeenCalledWith(DEFAULT_REGISTRY_URL)
    expect(remote.write).toHaveBeenCalledTimes(1)
    expect(status).toMatchObject({ activeSource: "remote", activeVersion: 4 })
    expect(registry.family("a")?.family.name).toBe("A remote")
  })

  it("fetches from the URL in settings", async () => {
    const { registry, remote } = setup({
      registryUrl: "https://mirror.test/registry/",
    })

    await registry.reload()

    expect(remote.fetch).toHaveBeenCalledWith("https://mirror.test/registry")
    expect(registry.status().remote.url).toBe("https://mirror.test/registry")
  })

  it("keeps the previous cache when a reload fails, and says why", async () => {
    const remote = fakeRemote(remoteCache(), async () => {
      throw new Error(
        `Could not fetch the model registry from ${DEFAULT_REGISTRY_URL}: HTTP 404`
      )
    })
    const { registry, onError } = setup({ remote })

    const status = await registry.reload()

    expect(remote.write).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(status).toMatchObject({
      activeSource: "remote",
      remote: { error: expect.stringContaining("HTTP 404") },
    })

    // The next good fetch clears it.
    remote.fetch.mockImplementation(async () => remoteCache())
    expect((await registry.reload()).remote.error).toBeNull()
  })

  it("degrades to the bundled layer when the remote has never been reachable", async () => {
    const remote = fakeRemote(null, async () => {
      throw new Error("HTTP 404")
    })
    const { registry } = setup({ remote })

    const status = await registry.reload()

    expect(status.activeSource).toBe("bundled")
    expect(status.remote.error).toBe("HTTP 404")
    expect(names(registry)).toEqual(["A bundled", "B bundled"])
  })

  it("retries a failed background refresh after an hour, not a day", async () => {
    const clock = { now: NOW }
    const remote = fakeRemote(null, async () => {
      throw new Error("HTTP 404")
    })
    const { registry } = setup({ remote, clock })

    registry.refreshIfStale()
    registry.refreshIfStale()
    await vi.waitFor(() =>
      expect(registry.status().remote.error).toBe("HTTP 404")
    )
    clock.now += RETRY_INTERVAL_MS - 1
    registry.refreshIfStale()

    expect(remote.fetch).toHaveBeenCalledTimes(1)
    expect(RETRY_INTERVAL_MS).toBeLessThan(REFRESH_INTERVAL_MS)

    clock.now += 1
    remote.fetch.mockImplementation(async () =>
      remoteCache({ fetchedAt: clock.now })
    )
    registry.refreshIfStale()
    await vi.waitFor(() =>
      expect(registry.status().activeSource).toBe("remote")
    )
    expect(remote.fetch).toHaveBeenCalledTimes(2)

    // A success waits the full day again.
    clock.now += RETRY_INTERVAL_MS
    registry.refreshIfStale()
    clock.now += REFRESH_INTERVAL_MS - RETRY_INTERVAL_MS - 1
    registry.refreshIfStale()
    expect(remote.fetch).toHaveBeenCalledTimes(2)
    clock.now += 1
    registry.refreshIfStale()
    expect(remote.fetch).toHaveBeenCalledTimes(3)
  })

  it("keeps a usable cache when the remote moves to a newer format, and says to update", async () => {
    const remote = fakeRemote(remoteCache(), async () =>
      remoteCache({ format: 2, registryVersion: 9, fetchedAt: NOW + 5 })
    )
    const { registry } = setup({ remote })

    const status = await registry.reload()

    expect(remote.write).not.toHaveBeenCalled()
    expect(status).toMatchObject({
      activeSource: "remote",
      activeVersion: 4,
      remote: {
        version: 4,
        fetchedAt: NOW,
        error: expect.stringContaining("uses format 2"),
      },
    })
    expect(status.remote.error).toContain("Update the app")
    expect(status.warnings).toContainEqual({
      source: "remote",
      familyId: null,
      message: expect.stringContaining("uses format 2"),
    })
    expect(registry.family("a")?.family.name).toBe("A remote")
  })

  it("does not cache a newer-format remote when there is no cache either", async () => {
    const remote = fakeRemote(null, async () =>
      remoteCache({ format: 2, registryVersion: 9 })
    )
    const { registry } = setup({ remote })

    const status = await registry.reload()

    expect(remote.write).not.toHaveBeenCalled()
    expect(status.activeSource).toBe("bundled")
    expect(status.remote.error).toContain("uses format 2")
  })

  it("keeps a usable cache when the remote index no longer validates, and says why", async () => {
    const remote = fakeRemote(remoteCache(), async () =>
      remoteCache({ index: { format: "one" }, fetchedAt: NOW + 5 })
    )
    const { registry } = setup({ remote })

    const status = await registry.reload()

    expect(remote.write).not.toHaveBeenCalled()
    expect(status).toMatchObject({
      activeSource: "remote",
      activeVersion: 4,
      remote: {
        version: 4,
        fetchedAt: NOW,
        error: expect.stringContaining("index.json"),
      },
    })
    expect(status.warnings).toContainEqual({
      source: "remote",
      familyId: null,
      message: expect.stringContaining("index.json"),
    })
    expect(registry.family("a")?.family.name).toBe("A remote")
  })

  it("retries a remote whose index did not validate after an hour", async () => {
    const clock = { now: NOW }
    const remote = fakeRemote(null, async () =>
      remoteCache({ index: { format: "one" } })
    )
    const { registry } = setup({ remote, clock })

    await registry.reload()
    clock.now = NOW + 30 * 60 * 1000
    registry.refreshIfStale()
    expect(remote.fetch).toHaveBeenCalledTimes(1)
    clock.now = NOW + 61 * 60 * 1000
    registry.refreshIfStale()
    expect(remote.fetch).toHaveBeenCalledTimes(2)
  })

  it("fetches the new URL when a reload follows a URL change mid-fetch", async () => {
    let release: (() => void) | undefined
    const remote = fakeRemote(null, async () => remoteCache())
    remote.fetch.mockImplementation(
      (url: string) =>
        new Promise<RemoteCache>((resolve) => {
          const cache = remoteCache({ url })
          if (url === DEFAULT_REGISTRY_URL) release = () => resolve(cache)
          else resolve(cache)
        })
    )
    const { registry, settings } = setup({ remote })

    registry.refreshIfStale()
    expect(remote.fetch).toHaveBeenCalledWith(DEFAULT_REGISTRY_URL)

    settings.registryUrl = "https://mirror.test/registry"
    const status = await registry.reload()

    expect(remote.fetch).toHaveBeenLastCalledWith(
      "https://mirror.test/registry"
    )
    expect(status).toMatchObject({
      activeSource: "remote",
      remote: { url: "https://mirror.test/registry", fetchedAt: NOW },
    })

    // The stale fetch finishing later must not replace the new URL's cache.
    release?.()
    await vi.waitFor(() => expect(release).toBeDefined())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remote.write).toHaveBeenCalledTimes(1)
    expect(registry.status().remote.url).toBe("https://mirror.test/registry")
    expect(registry.status().activeSource).toBe("remote")
  })

  it("reports a background refresh that changed the merged registry", async () => {
    const { registry, remote, onChange } = setup()
    expect(names(registry)).toEqual(["A bundled", "B bundled"])

    registry.refreshIfStale()
    await vi.waitFor(() => expect(remote.write).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(names(registry)).toContain("A remote")
  })

  it("stays quiet after a background refresh that changed nothing", async () => {
    const clock = { now: NOW }
    const { registry, remote, onChange } = setup({
      clock,
      remote: fakeRemote(remoteCache({ fetchedAt: NOW - 2 * REFRESH_INTERVAL_MS })),
    })
    expect(names(registry)).toContain("A remote")

    registry.refreshIfStale()
    await vi.waitFor(() => expect(remote.write).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("stays quiet after a failed background refresh", async () => {
    const remote = fakeRemote(null, async () => {
      throw new Error("offline")
    })
    const { registry, onChange, onError } = setup({ remote })

    registry.refreshIfStale()
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not refresh a cache that is still fresh", () => {
    const { registry, remote } = setup({
      remote: fakeRemote(remoteCache({ fetchedAt: NOW - 1000 })),
    })

    registry.refreshIfStale()

    expect(remote.fetch).not.toHaveBeenCalled()
  })

  it("never fetches, and ignores the cache, when the remote is turned off", async () => {
    const { registry, remote } = setup({
      remoteRegistry: false,
      remote: fakeRemote(remoteCache()),
    })

    registry.refreshIfStale()
    const status = await registry.reload()

    expect(remote.fetch).not.toHaveBeenCalled()
    expect(status).toMatchObject({
      activeSource: "bundled",
      remote: { enabled: false },
    })
  })

  it("follows a settings change without a reload", () => {
    const { registry, settings } = setup({ remote: fakeRemote(remoteCache()) })
    expect(registry.status().activeSource).toBe("remote")

    settings.remoteRegistry = false

    expect(registry.status().activeSource).toBe("bundled")
    expect(registry.family("a")?.source).toBe("bundled")
  })

  it("warns, rather than failing, when the bundled index is broken", () => {
    const { registry } = setup({
      bundled: { ...bundled, index: { format: 2 } as never },
    })

    expect(names(registry)).toEqual(["A bundled", "B bundled"])
    expect(registry.status().warnings[0]).toMatchObject({
      source: "bundled",
      message: expect.stringContaining("registry/index.json"),
    })
  })
})
