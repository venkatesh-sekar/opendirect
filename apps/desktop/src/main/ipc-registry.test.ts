import { describe, expect, it, vi } from "vitest"

import {
  createIpcRegistrar,
  emitIpcEvent,
  type IpcMainLike,
} from "./ipc-registry"
import { toUpdaterStatus } from "./updater-policy"
import { ipcEvents } from "@opendirect/contract"

type Listener = (event: unknown, payload: unknown) => Promise<unknown>

/** Minimal stand-in for Electron's `ipcMain`, so this suite needs no Electron. */
function fakeIpcMain() {
  const handlers = new Map<string, Listener>()
  const ipc: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener as Listener)
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

const appInfo = { version: "1.2.3", platform: "linux" }

describe("createIpcRegistrar", () => {
  it("registers a contract channel and returns a success envelope", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle("app:info", () => appInfo)

    expect([...main.handlers.keys()]).toEqual(["app:info"])
    await expect(main.invoke("app:info")).resolves.toEqual({
      ok: true,
      data: appInfo,
    })
  })

  it("awaits async handlers", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle("app:info", async () =>
      Promise.resolve(appInfo)
    )

    await expect(main.invoke("app:info")).resolves.toEqual({
      ok: true,
      data: appInfo,
    })
  })

  it("rejects an input that fails the contract without calling the handler", async () => {
    const main = fakeIpcMain()
    const handler = vi.fn(() => appInfo)
    createIpcRegistrar(main.ipc).handle("app:info", handler)

    const result = (await main.invoke("app:info", { evil: true })) as {
      ok: boolean
      error: { message: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain("app:info")
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects a handler result that fails the contract", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle(
      "app:info",
      () => ({ version: 1 }) as never
    )

    const result = (await main.invoke("app:info")) as {
      ok: boolean
      error: { message: string }
    }
    expect(result.ok).toBe(false)
    expect(result.error.message).toContain("app:info")
  })

  it("strips unknown keys so main never leaks undeclared fields", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle(
      "app:info",
      () => ({ ...appInfo, apiKey: "secret" }) as never
    )

    await expect(main.invoke("app:info")).resolves.toEqual({
      ok: true,
      data: appInfo,
    })
  })

  it("returns thrown handler errors instead of rejecting", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle("app:info", () => {
      throw new Error("disk on fire")
    })

    await expect(main.invoke("app:info")).resolves.toEqual({
      ok: false,
      error: { message: "disk on fire" },
    })
  })

  it("returns a rejected promise from a handler as an error envelope", async () => {
    const main = fakeIpcMain()
    createIpcRegistrar(main.ipc).handle("app:info", async () => {
      throw "nope"
    })

    await expect(main.invoke("app:info")).resolves.toEqual({
      ok: false,
      error: { message: "nope" },
    })
  })

  it("refuses a channel that is not in the contract", () => {
    const main = fakeIpcMain()
    // Cast through the erased signature: the compiler already rejects an
    // undeclared channel, and this asserts the runtime guard behind it.
    const handle = createIpcRegistrar(main.ipc).handle as unknown as (
      channel: string,
      handler: () => unknown
    ) => void

    expect(() => handle("app:eval", () => appInfo)).toThrow(
      /not in the IPC contract/
    )
    expect(main.handlers.size).toBe(0)
  })

  it("refuses to register the same channel twice", () => {
    const main = fakeIpcMain()
    const registrar = createIpcRegistrar(main.ipc)
    registrar.handle("app:info", () => appInfo)
    expect(() => registrar.handle("app:info", () => appInfo)).toThrow(
      /already registered/
    )
  })

  it("removes every handler it registered on dispose", () => {
    const main = fakeIpcMain()
    const registrar = createIpcRegistrar(main.ipc)
    registrar.handle("app:info", () => appInfo)
    registrar.dispose()

    expect(main.handlers.size).toBe(0)
    expect(() => registrar.handle("app:info", () => appInfo)).not.toThrow()
  })
})

describe("emitIpcEvent", () => {
  it("validates the payload before sending it to the renderer", () => {
    const send = vi.fn()
    emitIpcEvent({ send }, "updater:status", {
      state: "downloading",
      percent: 12,
    })

    expect(send).toHaveBeenCalledWith("updater:status", {
      state: "downloading",
      percent: 12,
    })
  })

  it("throws rather than pushing a payload the contract rejects", () => {
    const send = vi.fn()
    expect(() =>
      emitIpcEvent({ send }, "updater:status", { state: "boom" } as never)
    ).toThrow(/updater:status/)
    expect(send).not.toHaveBeenCalled()
  })

  it("keeps the updater policy's statuses contract-compatible", () => {
    const { payload } = ipcEvents["updater:status"]
    for (const event of [
      { type: "available" as const, version: "1.0.0" },
      { type: "not-available" as const },
      { type: "downloading" as const, percent: 3.4 },
      { type: "ready" as const },
      { type: "error" as const, error: new Error("x") },
    ]) {
      expect(payload.safeParse(toUpdaterStatus(event)).success).toBe(true)
    }
  })
})
