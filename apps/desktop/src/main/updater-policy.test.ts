import { describe, expect, it } from "vitest"

import {
  pickStatusTarget,
  shouldEnableUpdater,
  toUpdaterStatus,
  UPDATE_CHECK_INTERVAL_MS,
} from "./updater-policy"

describe("shouldEnableUpdater", () => {
  it("is on for a packaged app", () => {
    expect(shouldEnableUpdater({ packaged: true, env: {} })).toBe(true)
  })

  it("is off for an unpackaged dev run, which has no update feed", () => {
    expect(shouldEnableUpdater({ packaged: false, env: {} })).toBe(false)
  })

  it("can be forced on with OPENDIRECT_ENABLE_UPDATER for feed testing", () => {
    expect(
      shouldEnableUpdater({
        packaged: false,
        env: { OPENDIRECT_ENABLE_UPDATER: "1" },
      })
    ).toBe(true)
  })

  it("treats blank and falsy override values as unset", () => {
    for (const value of ["", "   ", "0", "false", "FALSE"]) {
      expect(
        shouldEnableUpdater({
          packaged: false,
          env: { OPENDIRECT_ENABLE_UPDATER: value },
        })
      ).toBe(false)
    }
  })

  it("never disables the updater for a packaged app", () => {
    expect(
      shouldEnableUpdater({
        packaged: true,
        env: { OPENDIRECT_ENABLE_UPDATER: "0" },
      })
    ).toBe(true)
  })
})

describe("toUpdaterStatus", () => {
  it("reports an available update with its version", () => {
    expect(toUpdaterStatus({ type: "available", version: "1.2.3" })).toEqual({
      state: "available",
      version: "1.2.3",
    })
  })

  it("rounds download progress to whole percent", () => {
    expect(toUpdaterStatus({ type: "downloading", percent: 41.6666 })).toEqual({
      state: "downloading",
      percent: 42,
    })
  })

  it("clamps out-of-range progress", () => {
    expect(toUpdaterStatus({ type: "downloading", percent: -5 })).toEqual({
      state: "downloading",
      percent: 0,
    })
    expect(toUpdaterStatus({ type: "downloading", percent: 140 })).toEqual({
      state: "downloading",
      percent: 100,
    })
    expect(
      toUpdaterStatus({ type: "downloading", percent: Number.NaN })
    ).toEqual({ state: "downloading", percent: 0 })
  })

  it("reports a downloaded update as ready to install", () => {
    expect(toUpdaterStatus({ type: "ready", version: "1.2.3" })).toEqual({
      state: "ready",
      version: "1.2.3",
    })
  })

  it("reports no update without a version", () => {
    expect(toUpdaterStatus({ type: "not-available" })).toEqual({
      state: "not-available",
    })
  })

  it("stringifies an Error into a message the renderer can show", () => {
    expect(
      toUpdaterStatus({ type: "error", error: new Error("no feed") })
    ).toEqual({ state: "error", message: "no feed" })
  })

  it("survives a non-Error rejection value", () => {
    expect(toUpdaterStatus({ type: "error", error: "ENOTFOUND" })).toEqual({
      state: "error",
      message: "ENOTFOUND",
    })
    expect(toUpdaterStatus({ type: "error", error: undefined })).toEqual({
      state: "error",
      message: "Unknown updater error",
    })
  })

  it("falls back to an unknown version rather than emitting undefined", () => {
    expect(toUpdaterStatus({ type: "available" })).toEqual({
      state: "available",
      version: "unknown",
    })
  })
})

describe("pickStatusTarget", () => {
  const live = (id: string) => ({ id, isDestroyed: () => false })
  const dead = (id: string) => ({ id, isDestroyed: () => true })

  it("prefers the focused window", () => {
    const a = live("a")
    const b = live("b")
    expect(pickStatusTarget([a, b], b)).toBe(b)
  })

  it("falls back to the first live window when nothing is focused", () => {
    const a = live("a")
    expect(pickStatusTarget([a, live("b")], null)).toBe(a)
  })

  it("skips a destroyed focused window", () => {
    const b = live("b")
    expect(pickStatusTarget([dead("a"), b], dead("a"))).toBe(b)
  })

  it("skips destroyed windows entirely", () => {
    expect(pickStatusTarget([dead("a"), dead("b")], null)).toBeUndefined()
  })

  it("returns nothing when the app has no windows", () => {
    expect(pickStatusTarget([], undefined)).toBeUndefined()
  })
})

describe("constants", () => {
  it("polls for updates every six hours", () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
  })
})
