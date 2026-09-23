/**
 * ⛔ No network at all in this file: every provider here is a stub. The real
 * adapters are exercised against `msw` fixtures in
 * `providers/{replicate,openrouter}.test.ts`; the catalog only ever sees the
 * `ModelProvider` interface.
 */
import type {
  ModelDescriptor,
  ModelKind,
  ModelSummary,
  ProviderId,
} from "@opendirect/contract"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  CATALOG_TTL_MS,
  createModelCatalog,
  registerModelHandlers,
  type CatalogStore,
  type ModelCatalog,
} from "./catalog"
import { createIpcRegistrar, type IpcMainLike } from "./ipc-registry"
import { RECOMMENDED } from "./providers/defaults"
import type { ListModelsOptions, ModelProvider } from "./providers/types"

const NOW = 1_758_000_000_000

function summary(
  provider: ProviderId,
  slug: string,
  kind: ModelKind = "video"
): ModelSummary {
  return {
    key: `${provider}:${slug}`,
    provider,
    slug,
    name: slug,
    description: null,
    kind,
    coverImageUrl: null,
    priceHint: null,
  }
}

function descriptor(provider: ProviderId, slug: string): ModelDescriptor {
  return {
    key: `${provider}:${slug}`,
    provider,
    slug,
    name: slug,
    description: null,
    kind: "video",
    versionId: null,
    coverImageUrl: null,
    inputSchema: { type: "object", properties: {} },
    outputSchema: null,
    referenceSlots: [],
    commonControls: {
      prompt: null,
      aspectRatio: null,
      duration: null,
      resolution: null,
      seed: null,
      audio: null,
    },
    pricing: {
      basis: "unknown",
      currency: "USD",
      skus: {},
      estimate: null,
      source: "none",
      note: null,
    },
    raw: null,
    fetchedAt: NOW,
    family: null,
    mappedBy: null,
  }
}

interface StubOptions {
  configured?: boolean
  models?: ModelSummary[]
  listError?: Error
  getError?: Error
}

function stubProvider(id: ProviderId, options: StubOptions = {}) {
  const calls = { list: 0, get: 0 }
  const provider: ModelProvider = {
    id,
    isConfigured: () => options.configured ?? true,
    listModels: async (opts: ListModelsOptions) => {
      calls.list += 1
      if (options.listError) throw options.listError
      return (options.models ?? []).filter((model) =>
        opts.kinds.includes(model.kind)
      )
    },
    getModel: async (slug: string) => {
      calls.get += 1
      if (options.getError) throw options.getError
      return descriptor(id, slug)
    },
    submit: async () => {
      throw new Error("never called by the catalog")
    },
    poll: async () => {
      throw new Error("never called by the catalog")
    },
    cancel: async () => {
      throw new Error("never called by the catalog")
    },
  }
  return { provider, calls }
}

/** An in-memory stand-in for the JSON file under `userData`. */
function memoryStore(initial: string | null = null) {
  let contents = initial
  const store: CatalogStore = {
    read: () => contents,
    write: (json) => {
      contents = json
    },
  }
  return {
    store,
    get contents() {
      return contents
    },
  }
}

describe("createModelCatalog", () => {
  let clock: number

  beforeEach(() => {
    clock = NOW
  })

  const now = () => clock

  function build(
    providers: ModelProvider[],
    store: CatalogStore = memoryStore().store
  ): ModelCatalog {
    return createModelCatalog({ providers: () => providers, store, now })
  }

  describe("refresh", () => {
    it("merges the summaries of every configured provider", async () => {
      const replicate = stubProvider("replicate", {
        models: [summary("replicate", "bytedance/seedance-2.5")],
      })
      const openrouter = stubProvider("openrouter", {
        models: [summary("openrouter", "bytedance/seedance-2.5")],
      })

      const { models, failures } = await build([
        replicate.provider,
        openrouter.provider,
      ]).refresh()

      expect(models.map((m) => m.key)).toEqual([
        "openrouter:bytedance/seedance-2.5",
        "replicate:bytedance/seedance-2.5",
      ])
      expect(failures).toEqual([])
    })

    it("skips a provider whose key is missing without calling it", async () => {
      const replicate = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const openrouter = stubProvider("openrouter", {
        configured: false,
        models: [summary("openrouter", "c/d")],
      })

      const { models } = await build([
        replicate.provider,
        openrouter.provider,
      ]).refresh()

      expect(models.map((m) => m.key)).toEqual(["replicate:a/b"])
      expect(openrouter.calls.list).toBe(0)
    })

    it("keeps the models of the providers that worked when one fails", async () => {
      const onError = vi.fn()
      const replicate = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const openrouter = stubProvider("openrouter", {
        listError: new Error("OpenRouter is down"),
      })

      const catalog = createModelCatalog({
        providers: () => [replicate.provider, openrouter.provider],
        store: memoryStore().store,
        now,
        onError,
      })

      const { models, failures } = await catalog.refresh()

      expect(models).toHaveLength(1)
      expect(onError).toHaveBeenCalledWith("openrouter", expect.any(Error))
      // The failure is carried out to the UI, not just logged.
      expect(failures).toEqual([
        { provider: "openrouter", message: "OpenRouter is down" },
      ])
    })

    it("never throws when every provider fails", async () => {
      const catalog = build([
        stubProvider("replicate", { listError: new Error("boom") }).provider,
        stubProvider("openrouter", { listError: new Error("boom") }).provider,
      ])

      const { models, failures } = await catalog.refresh()

      expect(models).toEqual([])
      expect(failures.map((f) => f.provider)).toEqual([
        "replicate",
        "openrouter",
      ])
    })

    it("clears a provider's failure once it works again", async () => {
      const store = memoryStore()
      await build(
        [stubProvider("replicate", { listError: new Error("401") }).provider],
        store.store
      ).refresh()

      const fixed = build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
        ],
        store.store
      )

      await expect(fixed.refresh()).resolves.toMatchObject({ failures: [] })
    })

    it("reports the cached failures alongside a cached list", async () => {
      const store = memoryStore()
      const catalog = build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
          stubProvider("openrouter", { listError: new Error("401") }).provider,
        ],
        store.store
      )
      await catalog.refresh()

      await expect(catalog.list()).resolves.toMatchObject({
        failures: [{ provider: "openrouter", message: "401" }],
      })
    })

    it("keeps the previous catalog when every provider fails", async () => {
      const replicate = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const store = memoryStore()
      const catalog = build([replicate.provider], store.store)
      await catalog.refresh()

      const failing = build(
        [stubProvider("replicate", { listError: new Error("boom") }).provider],
        store.store
      )
      await failing.refresh()

      expect((await failing.list()).models.map((m) => m.key)).toEqual([
        "replicate:a/b",
      ])
    })

    it("keeps the other modality when a refresh is kind-scoped", async () => {
      const store = memoryStore()
      const both = stubProvider("replicate", {
        models: [
          summary("replicate", "a/video", "video"),
          summary("replicate", "a/image", "image"),
        ],
      })
      const catalog = build([both.provider], store.store)
      await catalog.refresh()

      // Re-listing images must not blank the cached video models…
      await catalog.refresh(["image"])

      expect((await catalog.list()).models.map((m) => m.key)).toEqual([
        "replicate:a/image",
        "replicate:a/video",
      ])
    })

    it("does not mark an unrefreshed modality as freshly fetched", async () => {
      const store = memoryStore()
      const first = stubProvider("replicate", {
        models: [
          summary("replicate", "a/video", "video"),
          summary("replicate", "a/image", "image"),
        ],
      })
      const catalog = build([first.provider], store.store)
      await catalog.refresh(["image"])

      // …and must not make them look verified either.
      expect(catalog.isStale(["image"])).toBe(false)
      expect(catalog.isStale(["video"])).toBe(true)
      expect(catalog.isStale()).toBe(true)
    })

    it("keeps a failed provider's last-known models of the refreshed kind", async () => {
      const store = memoryStore()
      await build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
          stubProvider("openrouter", { models: [summary("openrouter", "c/d")] })
            .provider,
        ],
        store.store
      ).refresh()

      const partial = build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
          stubProvider("openrouter", { listError: new Error("401") }).provider,
        ],
        store.store
      )
      const { models, failures } = await partial.refresh()

      expect(models.map((m) => m.key)).toEqual([
        "openrouter:c/d",
        "replicate:a/b",
      ])
      expect(failures).toHaveLength(1)
    })

    it("drops the models of a provider whose key was removed", async () => {
      const store = memoryStore()
      await build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
          stubProvider("openrouter", {
            models: [summary("openrouter", "c/d")],
          }).provider,
        ],
        store.store
      ).refresh()

      // The OpenRouter key is cleared: it is no longer attempted, so its
      // cached models must not linger as models the user can still run.
      const afterClear = build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
          stubProvider("openrouter", {
            configured: false,
            models: [summary("openrouter", "c/d")],
          }).provider,
        ],
        store.store
      )
      const { models, failures } = await afterClear.refresh()

      expect(models.map((m) => m.key)).toEqual(["replicate:a/b"])
      expect(failures).toEqual([])
      expect((await afterClear.list()).models.map((m) => m.key)).toEqual([
        "replicate:a/b",
      ])
    })

    it("empties the catalog when no provider is configured at all", async () => {
      const catalog = build([
        stubProvider("replicate", { configured: false }).provider,
      ])

      await expect(catalog.refresh()).resolves.toEqual({
        models: [],
        failures: [],
      })
      await expect(catalog.list()).resolves.toEqual({
        models: [],
        failures: [],
      })
    })
  })

  describe("persistence and staleness", () => {
    it("writes the cache to the store with a fetch timestamp", async () => {
      const store = memoryStore()
      await build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
        ],
        store.store
      ).refresh()

      expect(JSON.parse(store.contents!)).toMatchObject({
        version: 1,
        fetchedAt: NOW,
        models: [expect.objectContaining({ key: "replicate:a/b" })],
        descriptors: {},
      })
    })

    it("serves a fresh cache without touching the providers", async () => {
      const store = memoryStore()
      const first = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      await build([first.provider], store.store).refresh()

      const second = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const reopened = build([second.provider], store.store)

      clock = NOW + CATALOG_TTL_MS - 1
      await expect(reopened.list()).resolves.toMatchObject({
        models: [expect.objectContaining({ key: "replicate:a/b" })],
      })
      expect(second.calls.list).toBe(0)
      expect(reopened.isStale()).toBe(false)
    })

    it("re-fetches once the cache is older than 24 hours", async () => {
      const store = memoryStore()
      await build(
        [
          stubProvider("replicate", { models: [summary("replicate", "a/b")] })
            .provider,
        ],
        store.store
      ).refresh()

      const second = stubProvider("replicate", {
        models: [summary("replicate", "c/d")],
      })
      const reopened = build([second.provider], store.store)

      clock = NOW + CATALOG_TTL_MS
      expect(reopened.isStale()).toBe(true)
      await expect(reopened.list()).resolves.toMatchObject({
        models: [expect.objectContaining({ key: "replicate:c/d" })],
      })
      expect(second.calls.list).toBe(1)
    })

    it("re-fetches on demand even while the cache is fresh", async () => {
      const store = memoryStore()
      const first = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const catalog = build([first.provider], store.store)
      await catalog.list()
      await catalog.list({ refresh: true })

      expect(first.calls.list).toBe(2)
    })

    it("filters the cached catalog by kind without re-fetching", async () => {
      const provider = stubProvider("replicate", {
        models: [
          summary("replicate", "a/video", "video"),
          summary("replicate", "a/image", "image"),
        ],
      })
      const catalog = build([provider.provider])
      await catalog.refresh()

      await expect(catalog.list({ kinds: ["image"] })).resolves.toMatchObject({
        models: [expect.objectContaining({ key: "replicate:a/image" })],
      })
      expect(provider.calls.list).toBe(1)
    })

    it("ignores a cache file that is corrupt or from another version", async () => {
      const provider = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const catalog = build([provider.provider], memoryStore("not json").store)

      await expect(catalog.list()).resolves.toMatchObject({
        models: [expect.objectContaining({ key: "replicate:a/b" })],
      })
      expect(provider.calls.list).toBe(1)
    })

    it("marks every modality overdue when invalidated", async () => {
      const store = memoryStore()
      const first = stubProvider("replicate", {
        models: [summary("replicate", "a/b")],
      })
      const catalog = build([first.provider], store.store)
      await catalog.refresh()
      expect(catalog.isStale()).toBe(false)

      catalog.invalidate()

      expect(catalog.isStale()).toBe(true)
      // The invalidation survives a restart — it is written, not just held.
      expect(build([first.provider], store.store).isStale()).toBe(true)
      await catalog.list()
      expect(first.calls.list).toBe(2)
    })

    it("drops a stale failure when the catalog is invalidated", async () => {
      const store = memoryStore()
      const catalog = build(
        [stubProvider("replicate", { listError: new Error("401") }).provider],
        store.store
      )
      await catalog.refresh()

      catalog.invalidate()

      expect(JSON.parse(store.contents!)).toMatchObject({ failures: [] })
    })

    it("treats an empty cache as stale", () => {
      expect(build([]).isStale()).toBe(true)
    })
  })

  describe("getModel", () => {
    it("fetches a full descriptor on demand and caches it", async () => {
      const store = memoryStore()
      const provider = stubProvider("replicate")
      const catalog = build([provider.provider], store.store)

      const first = await catalog.getModel("replicate:bytedance/seedance-2.5")
      const second = await catalog.getModel("replicate:bytedance/seedance-2.5")

      expect(first.slug).toBe("bytedance/seedance-2.5")
      expect(second).toEqual(first)
      expect(provider.calls.get).toBe(1)
      expect(
        Object.keys(
          (JSON.parse(store.contents!) as { descriptors: object }).descriptors
        )
      ).toEqual(["replicate:bytedance/seedance-2.5"])
    })

    it("does not fetch every descriptor when the catalog is listed", async () => {
      const provider = stubProvider("replicate", {
        models: [summary("replicate", "a/b"), summary("replicate", "c/d")],
      })
      const catalog = build([provider.provider])

      await catalog.list()

      expect(provider.calls.get).toBe(0)
    })

    it("re-fetches a descriptor older than 24 hours", async () => {
      const store = memoryStore()
      const provider = stubProvider("replicate")
      await build([provider.provider], store.store).getModel("replicate:a/b")

      const second = stubProvider("replicate")
      clock = NOW + CATALOG_TTL_MS
      await build([second.provider], store.store).getModel("replicate:a/b")

      expect(second.calls.get).toBe(1)
    })

    it("rejects a key that is not `provider:slug`", async () => {
      await expect(build([]).getModel("nonsense")).rejects.toThrow(
        /not a model key/i
      )
    })

    it("reports a provider that is not configured rather than fetching", async () => {
      const provider = stubProvider("replicate", { configured: false })

      await expect(
        build([provider.provider]).getModel("replicate:a/b")
      ).rejects.toThrow(/replicate/i)
      expect(provider.calls.get).toBe(0)
    })

    it("propagates a provider error instead of inventing a descriptor", async () => {
      const provider = stubProvider("replicate", {
        getError: new Error("model is unavailable"),
      })

      await expect(
        build([provider.provider]).getModel("replicate:a/b")
      ).rejects.toThrow(/unavailable/)
    })
  })
})

/** Minimal stand-in for Electron's `ipcMain`, so this suite needs no Electron. */
function fakeIpcMain() {
  const handlers = new Map<
    string,
    (event: unknown, payload: unknown) => Promise<unknown>
  >()
  const ipc: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    },
    removeHandler: (channel) => {
      handlers.delete(channel)
    },
  }
  return {
    ipc,
    handlers,
    invoke: (channel: string, payload?: unknown) => {
      const listener = handlers.get(channel)
      if (!listener) throw new Error(`no handler for ${channel}`)
      return listener({}, payload)
    },
  }
}

describe("registerModelHandlers", () => {
  function wire(provider: ModelProvider) {
    const main = fakeIpcMain()
    const catalog = createModelCatalog({
      providers: () => [provider],
      store: memoryStore().store,
      now: () => NOW,
    })
    registerModelHandlers(createIpcRegistrar(main.ipc).handle, () => catalog)
    return { main, catalog }
  }

  it("registers exactly the three model channels", () => {
    const { main } = wire(stubProvider("replicate").provider)

    expect([...main.handlers.keys()]).toEqual([
      "models:list",
      "models:get",
      "models:recommended",
    ])
  })

  it("serves the catalog through models:list", async () => {
    const { main } = wire(
      stubProvider("replicate", {
        models: [
          summary("replicate", "a/video", "video"),
          summary("replicate", "a/image", "image"),
        ],
      }).provider
    )

    await expect(
      main.invoke("models:list", { kinds: ["image"] })
    ).resolves.toEqual({
      ok: true,
      data: {
        models: [expect.objectContaining({ key: "replicate:a/image" })],
        failures: [],
      },
    })
  })

  it("passes refresh through to the catalog", async () => {
    const provider = stubProvider("replicate", {
      models: [summary("replicate", "a/b")],
    })
    const { main } = wire(provider.provider)

    await main.invoke("models:list", {})
    await main.invoke("models:list", { refresh: true })

    expect(provider.calls.list).toBe(2)
  })

  it("reports provider failures through models:list", async () => {
    const main = fakeIpcMain()
    const catalog = createModelCatalog({
      providers: () => [
        stubProvider("replicate", { models: [summary("replicate", "a/b")] })
          .provider,
        stubProvider("openrouter", {
          listError: new Error("OpenRouter rejected the API key (HTTP 401)."),
        }).provider,
      ],
      store: memoryStore().store,
      now: () => NOW,
    })
    registerModelHandlers(createIpcRegistrar(main.ipc).handle, () => catalog)

    const result = (await main.invoke("models:list", {})) as {
      ok: true
      data: {
        models: unknown[]
        failures: Array<{ provider: string; message: string }>
      }
    }

    expect(result.data.models).toHaveLength(1)
    expect(result.data.failures).toEqual([
      { provider: "openrouter", message: expect.stringContaining("401") },
    ])
  })

  it("returns one descriptor through models:get", async () => {
    const { main } = wire(stubProvider("replicate").provider)

    const result = (await main.invoke("models:get", {
      key: "replicate:bytedance/seedance-2.5",
    })) as { ok: true; data: ModelDescriptor }

    expect(result.ok).toBe(true)
    expect(result.data.slug).toBe("bytedance/seedance-2.5")
  })

  it("reports a bad key as a failed envelope rather than rejecting", async () => {
    const { main } = wire(stubProvider("replicate").provider)

    await expect(main.invoke("models:get", { key: "nope" })).resolves.toEqual({
      ok: false,
      error: { message: expect.stringMatching(/not a model key/i) },
    })
  })

  it("annotates the recommended shortlist with availability", async () => {
    const { main } = wire(
      stubProvider("replicate", {
        models: [summary("replicate", "bytedance/seedance-2.5", "video")],
      }).provider
    )

    const result = (await main.invoke("models:recommended")) as {
      ok: true
      data: { video: Array<{ key: string; available: boolean }> }
    }

    expect(result.data.video).toHaveLength(RECOMMENDED.video.length)
    expect(
      result.data.video.find(
        (m) => m.key === "replicate:bytedance/seedance-2.5"
      )!.available
    ).toBe(true)
    expect(result.data.video.filter((m) => m.available)).toHaveLength(1)
  })

  it("never refreshes the catalog just to list the recommendations", async () => {
    const provider = stubProvider("replicate", {
      models: [summary("replicate", "a/b")],
    })
    const { main } = wire(provider.provider)

    await main.invoke("models:list", {})
    await main.invoke("models:recommended")

    expect(provider.calls.list).toBe(1)
  })
})
