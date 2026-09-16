import { afterEach, describe, expect, it, vi } from "vitest"

import {
  invoke,
  isBridgeAvailable,
  subscribe,
  type OpenDirectBridge,
} from "./ipc"

const scope = globalThis as { opendirect?: OpenDirectBridge }

function installBridge(bridge: Partial<OpenDirectBridge>): void {
  scope.opendirect = {
    invoke: vi.fn(),
    on: vi.fn(() => () => {}),
    ...bridge,
  } as OpenDirectBridge
}

afterEach(() => {
  delete scope.opendirect
})

describe("invoke", () => {
  it("unwraps a successful envelope and parses it against the contract", async () => {
    installBridge({
      invoke: vi.fn(async () => ({
        ok: true,
        data: { version: "1.2.3", platform: "linux", extra: "dropped" },
      })),
    })

    await expect(invoke("app:info")).resolves.toEqual({
      version: "1.2.3",
      platform: "linux",
    })
  })

  it("throws the main-process message on an error envelope", async () => {
    installBridge({
      invoke: vi.fn(async () => ({
        ok: false,
        error: { message: "disk on fire" },
      })),
    })

    await expect(invoke("app:info")).rejects.toThrow("disk on fire")
  })

  it("rejects a response that is not a contract envelope", async () => {
    installBridge({ invoke: vi.fn(async () => ({ version: "1.2.3" })) })

    await expect(invoke("app:info")).rejects.toThrow(/app:info/)
  })

  it("rejects a payload that does not match the declared output", async () => {
    installBridge({
      invoke: vi.fn(async () => ({ ok: true, data: { version: 1 } })),
    })

    await expect(invoke("app:info")).rejects.toThrow(/app:info/)
  })

  it("refuses an undeclared channel before touching the bridge", async () => {
    const bridgeInvoke = vi.fn()
    installBridge({ invoke: bridgeInvoke })

    await expect(invoke("app:eval" as never)).rejects.toThrow(
      /not in the IPC contract/
    )
    expect(bridgeInvoke).not.toHaveBeenCalled()
  })

  it("explains itself when running outside Electron", async () => {
    await expect(invoke("app:info")).rejects.toThrow(/outside Electron/)
    expect(isBridgeAvailable()).toBe(false)
  })
})

describe("subscribe", () => {
  it("parses event payloads and returns the unsubscribe function", () => {
    let emit: ((payload: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    installBridge({
      on: vi.fn((_channel: string, callback: (payload: unknown) => void) => {
        emit = callback
        return unsubscribe
      }),
    })

    const received: unknown[] = []
    const off = subscribe("updater:status", (status) => received.push(status))

    emit?.({ state: "downloading", percent: 7 })
    emit?.({ state: "nonsense" })

    expect(received).toEqual([{ state: "downloading", percent: 7 }])
    off()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it("refuses an undeclared event channel", () => {
    installBridge({})
    expect(() => subscribe("app:info" as never, () => {})).toThrow(
      /not a declared IPC event/
    )
  })
})
