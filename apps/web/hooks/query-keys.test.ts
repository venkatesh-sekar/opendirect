import { describe, expect, it } from "vitest"

import { queryKeys } from "./query-keys"

describe("queryKeys", () => {
  it("gives every page of a container its own key", () => {
    const first = queryKeys.assets.byContainer("c1", { limit: 2, offset: 0 })
    const second = queryKeys.assets.byContainer("c1", { limit: 2, offset: 2 })
    // Without `offset` in the key, page 2 would overwrite page 1's cache entry.
    expect(first).not.toEqual(second)
    expect(queryKeys.generations.byContainer("c1", { offset: 0 })).not.toEqual(
      queryKeys.generations.byContainer("c1", { offset: 40 })
    )
  })

  it("is stable for the same page", () => {
    expect(queryKeys.assets.byContainer("c1", { limit: 60 })).toEqual(
      queryKeys.assets.byContainer("c1", { limit: 60 })
    )
    expect(queryKeys.assets.byContainer("c1")).toEqual(
      queryKeys.assets.byContainer("c1", {})
    )
  })

  it("keeps every key under a prefix a mutation can invalidate", () => {
    expect(queryKeys.assets.byContainer("c1").slice(0, 2)).toEqual([
      "assets",
      "c1",
    ])
    expect(queryKeys.generations.lineage("g1")[0]).toBe("generations")
  })
})
