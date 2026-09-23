/**
 * ⛔ No network and no Electron: the registry's remote source is a fake, the
 * dialogs are stubs, and the handlers run through the real registrar against
 * a fake `ipcMain`.
 */
import { describe, expect, it, vi } from "vitest"

import { createIpcRegistrar, type IpcMainLike } from "../ipc-registry"
import type { SettingsStore } from "../settings"
import { registerRegistryHandlers, type RegistryFiles } from "./handlers"
import { createOverrideStore } from "./overrides"
import { createModelRegistry } from "./registry"

const NOW = 1_790_000_000_000

const family = (id: string, name = id) => ({
  id,
  name,
  kind: "image",
  endpoints: [{ provider: "replicate", model: `me/${id}` }],
})

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

function wire(files: Partial<RegistryFiles> = {}) {
  const handlers = new Map<
    string,
    (e: unknown, p: unknown) => Promise<unknown>
  >()
  const ipc: IpcMainLike = {
    handle: (channel, listener) => void handlers.set(channel, listener),
    removeHandler: (channel) => void handlers.delete(channel),
  }
  const fetch = vi.fn(async () => {
    throw new Error("HTTP 404")
  })
  const registry = createModelRegistry({
    bundled: {
      index: { format: 1, registryVersion: 1, families: ["a"] },
      families: [{ origin: "registry/models/a.json", raw: family("a", "A") }],
    },
    remote: { read: () => null, fetch, write: vi.fn() },
    overrides: createOverrideStore(memoryStore()),
    settings: () => ({ remoteRegistry: true, registryUrl: null }),
    now: () => NOW,
  })
  const io: RegistryFiles = {
    chooseImport: vi.fn(async () => null),
    chooseExport: vi.fn(async () => null),
    readText: vi.fn(() => ""),
    writeText: vi.fn(),
    ...files,
  }
  registerRegistryHandlers(createIpcRegistrar(ipc).handle, () => registry, io)
  const call = async (channel: string, payload?: unknown) => {
    const result = (await handlers.get(channel)!({}, payload)) as {
      ok: boolean
      data?: unknown
      error?: { message: string }
    }
    if (!result.ok) throw new Error(result.error?.message)
    return result.data as never
  }
  return { call, handlers, io, fetch, registry }
}

describe("registerRegistryHandlers", () => {
  it("registers every registry channel", () => {
    const { handlers } = wire()
    expect([...handlers.keys()].sort()).toEqual([
      "registry:families",
      "registry:overrides:delete",
      "registry:overrides:export",
      "registry:overrides:import",
      "registry:overrides:list",
      "registry:overrides:save",
      "registry:reload",
      "registry:status",
    ])
  })

  it("reports a remote that cannot be fetched and keeps the bundled layer", async () => {
    const { call } = wire()
    const status = await call("registry:reload")
    expect(status).toMatchObject({
      activeSource: "bundled",
      families: 1,
      remote: { error: "HTTP 404" },
    })
  })

  it("starts at most one background refresh when families are listed", async () => {
    const { call, fetch } = wire()
    const families: Array<{ family: { id: string } }> =
      await call("registry:families")
    await call("registry:families")
    expect(families.map((entry) => entry.family.id)).toEqual(["a"])
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  })

  it("saves, updates, lists and deletes a user mapping", async () => {
    const { call } = wire()

    const created = await call("registry:overrides:save", {
      family: family("mine", "Mine"),
      replaceId: null,
    })
    expect(created).toMatchObject({ ok: true, override: { id: "mine" } })
    await call("registry:overrides:save", {
      family: family("mine", "Mine v2"),
      replaceId: "mine",
    })

    const listed: Array<{ key: string; family: { name: string } }> = await call(
      "registry:overrides:list"
    )
    expect(listed.map((o) => o.family.name)).toEqual(["Mine v2"])
    expect(await call("registry:status")).toMatchObject({
      overrides: 1,
      families: 2,
    })

    expect(
      await call("registry:overrides:delete", { key: listed[0]!.key })
    ).toEqual({ ok: true })
    expect(await call("registry:overrides:list")).toEqual([])
  })

  it("answers an invalid save with per-field issues and stores nothing", async () => {
    const { call } = wire()

    const result = await call("registry:overrides:save", {
      family: { ...family("mine"), id: "Not An Id" },
      replaceId: null,
    })

    expect(result).toEqual({
      ok: false,
      issues: [{ path: "id", message: expect.stringContaining("family id") }],
    })
    expect(await call("registry:overrides:list")).toEqual([])
  })

  it("imports one family or an array, validated but not saved", async () => {
    const { call, io } = wire({
      chooseImport: vi.fn(async () => "/tmp/mine.json"),
      readText: vi.fn(() =>
        JSON.stringify([family("one"), { id: "two", name: "" }])
      ),
    })

    const result: {
      candidates: Array<{ id: string; family: unknown; issues: unknown[] }>
    } = await call("registry:overrides:import")

    expect(io.readText).toHaveBeenCalledWith("/tmp/mine.json")
    expect(result.candidates.map((c) => [c.id, c.family !== null])).toEqual([
      ["one", true],
      ["two", false],
    ])
    expect(result.candidates[1]?.issues.length).toBeGreaterThan(0)
    expect(await call("registry:overrides:list")).toEqual([])
  })

  it("imports nothing when the dialog is cancelled, and refuses a non-JSON file", async () => {
    expect(await wire().call("registry:overrides:import")).toEqual({
      candidates: [],
    })
    const { call } = wire({
      chooseImport: vi.fn(async () => "/tmp/x.json"),
      readText: vi.fn(() => "{ nope"),
    })
    await expect(call("registry:overrides:import")).rejects.toThrow(
      "x.json is not valid JSON"
    )
  })

  it("refuses an import larger than 2 MB", async () => {
    const { call } = wire({
      chooseImport: vi.fn(async () => "/tmp/huge.json"),
      readText: vi.fn(() =>
        JSON.stringify({ ...family("huge"), pad: "x".repeat(2 * 1024 * 1024) })
      ),
    })
    await expect(call("registry:overrides:import")).rejects.toThrow(
      "huge.json is larger than 2 MB."
    )
  })

  it("exports a user mapping, else the family in force, formatted", async () => {
    const { call, io } = wire({
      chooseExport: vi.fn(async (name: string) => `/tmp/${name}`),
    })
    await call("registry:overrides:save", {
      family: family("mine", "Mine"),
      replaceId: null,
    })

    expect(await call("registry:overrides:export", { id: "mine" })).toEqual({
      path: "/tmp/mine.json",
    })
    expect(await call("registry:overrides:export", { id: "a" })).toEqual({
      path: "/tmp/a.json",
    })
    expect(io.chooseExport).toHaveBeenCalledWith("mine.json")
    const written = vi.mocked(io.writeText).mock.calls[0]!
    expect(written[0]).toBe("/tmp/mine.json")
    expect(written[1].endsWith("\n")).toBe(true)
    expect(JSON.parse(written[1])).toMatchObject({ id: "mine", name: "Mine" })

    await expect(
      call("registry:overrides:export", { id: "unknown" })
    ).rejects.toThrow('No mapping with id "unknown"')
  })

  it("exports nothing when the save dialog is cancelled", async () => {
    const { call, io } = wire()
    expect(await call("registry:overrides:export", { id: "a" })).toEqual({
      path: null,
    })
    expect(io.writeText).not.toHaveBeenCalled()
  })
})
