import { describe, expect, it } from "vitest"

import {
  familyKey,
  isRunnableModelKey,
  parseFamilyKey,
  REFERENCE_ROLES,
  referenceSlotSchema,
} from "./model"

describe("reference roles", () => {
  it("is exactly the ten roles of the registry design, in order", () => {
    expect(REFERENCE_ROLES).toEqual([
      "source",
      "mask",
      "first_frame",
      "last_frame",
      "character",
      "style",
      "structure",
      "motion",
      "soundtrack",
      "reference",
    ])
  })

  it("reads a pre-registry cached slot's unknown role as unverified reference", () => {
    const slot = referenceSlotSchema.parse({
      field: "weird_ref_thing",
      label: "Weird Ref Thing",
      kind: "any",
      multiple: false,
      max: null,
      role: "unknown",
    })
    expect(slot).toMatchObject({
      role: "reference",
      verified: false,
      required: false,
      shape: null,
    })
  })

  it("rejects a role outside the closed list", () => {
    expect(
      referenceSlotSchema.safeParse({
        field: "face",
        label: "Face",
        kind: "image",
        multiple: false,
        max: null,
        role: "face",
      }).success
    ).toBe(false)
  })
})

describe("family keys", () => {
  it("round trips a family id", () => {
    expect(familyKey("seedance-2-5")).toBe("family:seedance-2-5")
    expect(parseFamilyKey(familyKey("seedance-2-5"))).toBe("seedance-2-5")
  })

  it("returns null for an empty id or a provider key", () => {
    expect(parseFamilyKey("family:")).toBeNull()
    expect(parseFamilyKey("replicate:a/b")).toBeNull()
  })

  it("treats both provider and family keys as runnable", () => {
    expect(isRunnableModelKey("replicate:a/b")).toBe(true)
    expect(isRunnableModelKey("family:seedance-2-5")).toBe(true)
    expect(isRunnableModelKey("foo")).toBe(false)
    expect(isRunnableModelKey("family:")).toBe(false)
  })
})
