import { describe, expect, it } from "vitest"

import {
  ipcChannels,
  ipcContract,
  ipcEventChannels,
  ipcEvents,
  ipcResultSchema,
  isIpcChannel,
  isIpcEventChannel,
  keysSummarySchema,
  settingsDefaults,
  settingsSchema,
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

describe("settings channels", () => {
  it("declares every settings channel", () => {
    for (const channel of [
      "settings:get",
      "settings:set",
      "settings:projectRoot:choose",
      "settings:keys:summary",
      "settings:keys:set",
      "settings:keys:clear",
      "settings:keys:verify",
    ] as const) {
      expect(ipcChannels).toContain(channel)
    }
  })

  it("matches the documented settings defaults", () => {
    expect(settingsSchema.parse(settingsDefaults)).toEqual(settingsDefaults)
    expect(settingsDefaults.maxConcurrentJobs).toBe(2)
    expect(settingsDefaults.pollIntervalMs).toBe(3000)
  })

  it("rejects out-of-range settings", () => {
    expect(
      settingsSchema.safeParse({ ...settingsDefaults, maxConcurrentJobs: 0 })
        .success
    ).toBe(false)
    expect(
      settingsSchema.safeParse({ ...settingsDefaults, pollIntervalMs: 10 })
        .success
    ).toBe(false)
  })

  it("accepts a partial patch for settings:set", () => {
    const parsed = ipcContract["settings:set"].input.parse({ theme: "dark" })
    expect(parsed).toEqual({ theme: "dark" })
  })

  it("only allows the two known providers on a key channel", () => {
    const { input } = ipcContract["settings:keys:set"]
    expect(
      input.safeParse({ provider: "replicate", key: "r8_x" }).success
    ).toBe(true)
    expect(input.safeParse({ provider: "midjourney", key: "x" }).success).toBe(
      false
    )
    expect(input.safeParse({ provider: "replicate", key: "" }).success).toBe(
      false
    )
  })

  it("keeps the key summary redacted — presence, tail and source only", () => {
    const status = { present: true, last4: "3456", source: "vault" }
    const parsed = keysSummarySchema.parse({
      encryptionAvailable: true,
      replicate: status,
      openrouter: { present: false, last4: null, source: "none" },
      secret: "should be stripped",
    })
    expect(JSON.stringify(parsed)).not.toContain("should be stripped")
    expect(Object.keys(parsed.replicate).sort()).toEqual([
      "last4",
      "present",
      "source",
    ])
  })
})
