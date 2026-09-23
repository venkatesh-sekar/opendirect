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
})

describe("duplicateAsCustom", () => {
  it("is a valid family with a new id and a name that tells it apart", () => {
    const copy = duplicateAsCustom(family)
    expect(copy.id).toBe("seedance-2-5-custom")
    expect(copy.name).toBe("Seedance 2.5 (custom)")
    expect(modelFamilySchema.safeParse(copy).success).toBe(true)
  })

  it("never shares nested objects with the original", () => {
    const copy = duplicateAsCustom(family)
    copy.endpoints[0]!.model = "changed"
    expect(family.endpoints[0]!.model).toBe("bytedance/seedance-2.5")
  })
})
