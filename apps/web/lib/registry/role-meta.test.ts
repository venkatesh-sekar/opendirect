import { REFERENCE_ROLES, ROLE_LABELS } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { KIND_META, ROLE_META, roleMeta } from "./role-meta"

describe("ROLE_META", () => {
  it("covers exactly the ten roles, so a new role cannot ship without a look", () => {
    expect(Object.keys(ROLE_META).sort()).toEqual([...REFERENCE_ROLES].sort())
  })

  it.each(REFERENCE_ROLES)(
    "gives %s a label, a short name, a sentence and an icon",
    (role) => {
      const meta = ROLE_META[role]
      expect(meta.label).toBe(ROLE_LABELS[role])
      expect(meta.short.length).toBeGreaterThan(0)
      expect(meta.short.length).toBeLessThanOrEqual(8)
      expect(meta.description).toMatch(/\.$/)
      // A Hugeicons icon is an array of [tag, attrs] pairs; an import that
      // does not resolve is `undefined`.
      expect(Array.isArray(meta.icon)).toBe(true)
    }
  )

  it("never names a media kind in the soundtrack label (design §2 rule 1)", () => {
    expect(ROLE_META.soundtrack.short.toLowerCase()).not.toContain("audio")
  })

  it("gives every icon its own glyph, so roles stay tellable apart", () => {
    const icons = new Set(REFERENCE_ROLES.map((role) => ROLE_META[role].icon))
    expect(icons.size).toBe(REFERENCE_ROLES.length)
  })
})

describe("roleMeta", () => {
  it("reads a slot key's role, so reference:2 looks like reference", () => {
    expect(roleMeta("reference:2")).toBe(ROLE_META.reference)
    expect(roleMeta("character")).toBe(ROLE_META.character)
  })

  it("falls back to reference for anything it does not know", () => {
    expect(roleMeta("unknown")).toBe(ROLE_META.reference)
  })
})

describe("KIND_META", () => {
  it("has a glyph and a label for every slot kind", () => {
    for (const kind of ["image", "video", "audio", "any"] as const) {
      expect(Array.isArray(KIND_META[kind].icon)).toBe(true)
      expect(KIND_META[kind].label.length).toBeGreaterThan(0)
    }
  })
})
