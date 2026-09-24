import { modelFamilySchema, type ModelFamily } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import { customCopyId, duplicateAsCustom } from "./editor-request"

const family: ModelFamily = {
  id: "seedance-2-5",
  name: "Seedance 2.5",
  kind: "video",
  endpoints: [
    {
      provider: "replicate",
      model: "bytedance/seedance-2.5",
      inputs: { first_frame: { field: "image", kind: "image" } },
      controls: {},
    },
  ],
}

describe("customCopyId", () => {
  it("appends -custom", () => {
    expect(customCopyId("seedance-2-5")).toBe("seedance-2-5-custom")
  })

  it("stays a valid family id even for the longest id", () => {
    const id = customCopyId("a".repeat(64))
    expect(id).toHaveLength(64)
    expect(id.endsWith("-custom")).toBe(true)
  })

  it("picks a free id when <id>-custom is taken", () => {
    expect(customCopyId("seedance-2-5", ["seedance-2-5-custom"])).toBe(
      "seedance-2-5-custom-2"
    )
    expect(
      customCopyId("seedance-2-5", [
        "seedance-2-5-custom",
        "seedance-2-5-custom-2",
      ])
    ).toBe("seedance-2-5-custom-3")
    const long = customCopyId("a".repeat(64), [customCopyId("a".repeat(64))])
    expect(long).toHaveLength(64)
    expect(long.endsWith("-custom-2")).toBe(true)
  })
})

describe("duplicateAsCustom", () => {
  it("is a valid family with a new id and a name that tells it apart", () => {
    const copy = duplicateAsCustom(family)
    expect(copy.id).toBe("seedance-2-5-custom")
    expect(copy.name).toBe("Seedance 2.5 (custom)")
    expect(modelFamilySchema.safeParse(copy).success).toBe(true)
  })

  it("skips taken ids", () => {
    expect(duplicateAsCustom(family, ["seedance-2-5-custom"]).id).toBe(
      "seedance-2-5-custom-2"
    )
  })

  it("never shares nested objects with the original", () => {
    const copy = duplicateAsCustom(family)
    copy.endpoints[0]!.model = "changed"
    expect(family.endpoints[0]!.model).toBe("bytedance/seedance-2.5")
  })
})
