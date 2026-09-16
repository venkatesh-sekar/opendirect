import { describe, expect, it } from "vitest"

import {
  ipcChannels,
  ipcContract,
  ipcEventChannels,
  ipcEvents,
  ipcResultSchema,
  isIpcChannel,
  isIpcEventChannel,
} from "./ipc"

describe("ipcContract", () => {
  it("validates app:info output", () => {
    const parsed = ipcContract["app:info"].output.parse({
      version: "1.0.0",
      platform: "linux",
    })
    expect(parsed.platform).toBe("linux")
  })

  it("rejects malformed app:info output", () => {
    expect(() => ipcContract["app:info"].output.parse({ version: 1 })).toThrow()
  })

  it("accepts no input for app:info and rejects a payload", () => {
    expect(ipcContract["app:info"].input.parse(undefined)).toBeUndefined()
    expect(() => ipcContract["app:info"].input.parse({ nope: true })).toThrow()
  })

  it("gives every channel both an input and an output schema", () => {
    expect(ipcChannels.length).toBeGreaterThan(0)
    for (const channel of ipcChannels) {
      const spec = ipcContract[channel]
      expect(typeof spec.input.safeParse).toBe("function")
      expect(typeof spec.output.safeParse).toBe("function")
    }
  })
})

describe("isIpcChannel", () => {
  it("accepts declared channels", () => {
    expect(isIpcChannel("app:info")).toBe(true)
  })

  it("rejects undeclared channels and inherited keys", () => {
    for (const value of [
      "app:eval",
      "",
      "toString",
      "constructor",
      "__proto__",
      42,
      null,
      undefined,
      { toString: () => "app:info" },
    ]) {
      expect(isIpcChannel(value)).toBe(false)
    }
  })
})

describe("ipcEvents", () => {
  it("validates an updater status payload", () => {
    expect(
      ipcEvents["updater:status"].payload.parse({
        state: "downloading",
        percent: 42,
      })
    ).toEqual({ state: "downloading", percent: 42 })
  })

  it("rejects an unknown updater state and a malformed payload", () => {
    const { payload } = ipcEvents["updater:status"]
    expect(payload.safeParse({ state: "exploded" }).success).toBe(false)
    expect(payload.safeParse({ state: "available" }).success).toBe(false)
    expect(payload.safeParse("ready").success).toBe(false)
  })

  it("guards event channels the same way", () => {
    expect(ipcEventChannels).toContain("updater:status")
    expect(isIpcEventChannel("updater:status")).toBe(true)
    expect(isIpcEventChannel("app:info")).toBe(false)
    expect(isIpcEventChannel("__proto__")).toBe(false)
  })
})

describe("ipcResultSchema", () => {
  it("parses both arms of the envelope", () => {
    expect(ipcResultSchema.parse({ ok: true, data: { a: 1 } })).toEqual({
      ok: true,
      data: { a: 1 },
    })
    const failure = ipcResultSchema.parse({
      ok: false,
      error: { message: "boom" },
    })
    expect(failure).toEqual({ ok: false, error: { message: "boom" } })
  })

  it("rejects anything that is not an envelope", () => {
    expect(ipcResultSchema.safeParse({ ok: false }).success).toBe(false)
    expect(ipcResultSchema.safeParse({ data: 1 }).success).toBe(false)
    expect(ipcResultSchema.safeParse(null).success).toBe(false)
  })
})
