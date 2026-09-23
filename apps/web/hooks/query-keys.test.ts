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

describe("canvas keys", () => {
  it("keeps the whole surface under one invalidatable prefix", () => {
    expect(queryKeys.canvas.graph[0]).toBe(queryKeys.canvas.all[0])
    expect(queryKeys.canvas.graph).toEqual(["canvas", "graph"])
  })

  it("does not collide with another domain's key", () => {
    expect(queryKeys.canvas.all).not.toEqual(queryKeys.generations.all)
  })
})

describe("mention keys", () => {
  it("keeps the subject index under one invalidatable prefix", () => {
    expect(queryKeys.mentions.subjects[0]).toBe(queryKeys.mentions.all[0])
    expect(queryKeys.mentions.subjects).toEqual(["mentions", "subjects"])
  })

  it("does not collide with another domain's key", () => {
    expect(queryKeys.mentions.all[0]).not.toBe(queryKeys.containers.all[0])
    expect(queryKeys.mentions.all[0]).not.toBe(queryKeys.assets.all[0])
  })
})

describe("project workspace keys", () => {
  it("files container summaries under the tree's invalidatable prefix", () => {
    // Every tree mutation invalidates `containers.all`, so the summaries are
    // swept along with it rather than needing a second call at each site.
    expect(queryKeys.containers.summaries[0]).toBe(queryKeys.containers.all[0])
    expect(queryKeys.containers.summaries).not.toEqual(
      queryKeys.containers.tree
    )
  })

  it("keeps project-wide generation pages apart from any container's", () => {
    expect(queryKeys.generations.project({ limit: 12 })[0]).toBe(
      queryKeys.generations.all[0]
    )
    expect(queryKeys.generations.project({ offset: 0 })).not.toEqual(
      queryKeys.generations.project({ offset: 40 })
    )
    expect(queryKeys.generations.project()).not.toEqual(
      queryKeys.generations.byContainer("")
    )
  })

  /**
   * An infinite list caches every page under one key, as an array of pages —
   * a different shape from a single page, so the two must never share a key.
   */
  it("keeps the paged generations list apart from any single page", () => {
    const pages = queryKeys.generations.projectPages(60)
    expect(pages[0]).toBe(queryKeys.generations.all[0])
    expect(pages).not.toEqual(queryKeys.generations.project({ limit: 60 }))
    expect(pages).not.toEqual(queryKeys.generations.projectPages(30))
  })
})
