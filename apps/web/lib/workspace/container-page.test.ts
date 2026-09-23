import { describe, expect, it } from "vitest"

import { asset, generation, job } from "@/components/workspace/fixtures"

import {
  containerRunTiles,
  filterAssets,
  moveReference,
  parseTab,
  referenceNumbers,
  statsLine,
  toggleReference,
} from "./container-page"

describe("the tab in the query string", () => {
  it("is the one asked for when the page has it", () => {
    expect(parseTab("generations")).toBe("generations")
    expect(parseTab("assets")).toBe("assets")
  })

  it("falls back to Assets for anything else, or nothing", () => {
    expect(parseTab(null)).toBe("assets")
    expect(parseTab("")).toBe("assets")
    expect(parseTab("canvas")).toBe("assets")
    expect(parseTab("nonsense")).toBe("assets")
  })
})

describe("the asset filter chips", () => {
  const sheet = asset({ id: "sheet" })
  const made = asset({ id: "made", generationId: "g1" })
  const upload = asset({ id: "upload" })
  const all = [sheet, made, upload]

  it("shows everything under All", () => {
    expect(filterAssets(all, "all", ["sheet"])).toEqual(all)
  })

  it("shows the references in the order they are sent", () => {
    expect(
      filterAssets(all, "references", ["upload", "sheet"]).map((a) => a.id)
    ).toEqual(["upload", "sheet"])
  })

  it("tells generated from uploaded by the run that made it", () => {
    expect(filterAssets(all, "generated", null).map((a) => a.id)).toEqual([
      "made",
    ])
    expect(filterAssets(all, "uploaded", null).map((a) => a.id)).toEqual([
      "sheet",
      "upload",
    ])
  })

  it("has no references while the selection is automatic", () => {
    expect(filterAssets(all, "references", null)).toEqual([])
  })
})

describe("editing the references sent to the model", () => {
  it("numbers them from 1, in order", () => {
    expect(referenceNumbers(["b", "a"])).toEqual(
      new Map([
        ["b", 1],
        ["a", 2],
      ])
    )
    expect(referenceNumbers(null).size).toBe(0)
  })

  it("adds a new one at the end and removes one already there", () => {
    expect(toggleReference(null, "a")).toEqual(["a"])
    expect(toggleReference(["a"], "b")).toEqual(["a", "b"])
    expect(toggleReference(["a", "b"], "a")).toEqual(["b"])
  })

  it("goes back to automatic when the last one is removed", () => {
    expect(toggleReference(["a"], "a")).toBeNull()
  })

  it("reorders by moving one to another's place", () => {
    expect(moveReference(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"])
    expect(moveReference(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"])
    expect(moveReference(["a", "b"], "a", "a")).toEqual(["a", "b"])
    expect(moveReference(["a", "b"], "x", "a")).toEqual(["a", "b"])
  })
})

describe("a container's runs", () => {
  it("puts its own running jobs first, and leaves other containers' out", () => {
    const mine = job({
      id: "j-mine",
      generationId: "g-run",
      generation: generation({
        id: "g-run",
        status: "running",
        containerId: "mira",
      }),
    })
    const theirs = job({
      id: "j-theirs",
      generationId: "g-other",
      generation: generation({
        id: "g-other",
        status: "running",
        containerId: "venkz",
      }),
    })
    const done = generation({ id: "g-done", containerId: "mira" })
    const tiles = containerRunTiles({
      containerId: "mira",
      jobs: [theirs, mine],
      generations: [done],
      outputs: [],
    })
    expect(tiles.map((tile) => [tile.generation.id, tile.running])).toEqual([
      ["g-run", true],
      ["g-done", false],
    ])
  })
})

describe("the stats line", () => {
  it("counts assets and generations", () => {
    expect(statsLine({ assetCount: 12, generationCount: 38 })).toBe(
      "12 assets · 38 generations"
    )
    expect(statsLine({ assetCount: 1, generationCount: 1 })).toBe(
      "1 asset · 1 generation"
    )
  })
})
