import { describe, expect, it } from "vitest"

import {
  HANDLE_MAX,
  HANDLE_PATTERN,
  isValidHandle,
  slugifyHandle,
  uniqueHandle,
} from "./handle"

describe("slugifyHandle", () => {
  it("lowercases and hyphenates a plain name", () => {
    expect(slugifyHandle("Venkz Sekar")).toBe("venkz-sekar")
    expect(slugifyHandle("The Hotel Lobby")).toBe("the-hotel-lobby")
  })

  it("strips diacritics rather than dropping the letter", () => {
    expect(slugifyHandle("Zoë Saldaña")).toBe("zoe-saldana")
    expect(slugifyHandle("Café")).toBe("cafe")
  })

  it("collapses punctuation runs to a single hyphen and trims the ends", () => {
    expect(slugifyHandle("Venkz Sekar!")).toBe("venkz-sekar")
    expect(slugifyHandle("  --Venkz___the  Great-- ")).toBe("venkz-the-great")
    expect(slugifyHandle("shot #4 / take 2")).toBe("shot-4-take-2")
  })

  it("keeps digits", () => {
    expect(slugifyHandle("Scene 03")).toBe("scene-03")
  })

  it("truncates to HANDLE_MAX without leaving a trailing hyphen", () => {
    const slug = slugifyHandle("a".repeat(40))
    expect(slug).toBe("a".repeat(HANDLE_MAX))
    // The 32nd character of this one is a hyphen, which must not survive.
    const trimmed = slugifyHandle(`${"a".repeat(31)} bcd`)
    expect(trimmed).toBe("a".repeat(31))
    expect(HANDLE_PATTERN.test(trimmed!)).toBe(true)
  })

  it("returns null when nothing survives", () => {
    // ⛔ Never a generated id like `c-4f2a`: a handle nobody would type is
    // worse than no handle at all.
    expect(slugifyHandle("!!!")).toBeNull()
    expect(slugifyHandle("   ")).toBeNull()
    expect(slugifyHandle("")).toBeNull()
    expect(slugifyHandle("北京")).toBeNull()
    expect(slugifyHandle("😀")).toBeNull()
  })
})

describe("HANDLE_PATTERN", () => {
  it("accepts what slugifyHandle produces", () => {
    for (const name of ["Venkz", "Hotel Lobby 2", "a-b-c"]) {
      expect(HANDLE_PATTERN.test(slugifyHandle(name)!)).toBe(true)
    }
  })

  it("rejects capitals, spaces, doubled and edge hyphens", () => {
    for (const bad of [
      "Venkz",
      "venkz!",
      "ven kz",
      "venkz--2",
      "-venkz",
      "venkz-",
    ]) {
      expect(HANDLE_PATTERN.test(bad)).toBe(false)
    }
  })
})

describe("isValidHandle", () => {
  it("is the pattern plus the length bound", () => {
    expect(isValidHandle("venkz")).toBe(true)
    expect(isValidHandle("Venkz!")).toBe(false)
    expect(isValidHandle("")).toBe(false)
    expect(isValidHandle("a".repeat(HANDLE_MAX))).toBe(true)
    expect(isValidHandle("a".repeat(HANDLE_MAX + 1))).toBe(false)
  })
})

describe("uniqueHandle", () => {
  it("returns the base when it is free", () => {
    expect(uniqueHandle("venkz", new Set())).toBe("venkz")
  })

  it("counts from 2 and skips everything taken", () => {
    expect(uniqueHandle("venkz", new Set(["venkz"]))).toBe("venkz-2")
    expect(uniqueHandle("venkz", new Set(["venkz", "venkz-2"]))).toBe("venkz-3")
    expect(uniqueHandle("venkz", new Set(["venkz", "venkz-3"]))).toBe("venkz-2")
  })

  it("keeps the suffixed handle within HANDLE_MAX", () => {
    const base = "a".repeat(HANDLE_MAX)
    const result = uniqueHandle(base, new Set([base]))!
    expect(result.length).toBeLessThanOrEqual(HANDLE_MAX)
    expect(result.endsWith("-2")).toBe(true)
    expect(HANDLE_PATTERN.test(result)).toBe(true)
  })

  it("returns null for a base nothing survived", () => {
    expect(uniqueHandle("", new Set())).toBeNull()
    expect(uniqueHandle(null, new Set(["venkz"]))).toBeNull()
  })
})
