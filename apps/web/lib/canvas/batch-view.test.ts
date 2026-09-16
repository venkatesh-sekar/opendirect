/**
 * ⛔ Nothing here submits anything: `heroAndRest` and `stepPick` are pure
 * functions over tiles that already exist, and choosing which one is shown
 * large costs nothing and re-runs nothing.
 */
import type { AssetDto } from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  heroAndRest,
  pickableAssets,
  stepPick,
  type BatchTile,
} from "./batch-view"

function asset(id: string): AssetDto {
  return {
    id,
    projectId: "proj-1",
    kind: "image",
    relPath: `media/${id}.png`,
    text: null,
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    durationMs: null,
    bytes: 1024,
    sha256: "abc",
    thumbnailRelPath: null,
    label: null,
    originalName: null,
    pinned: false,
    generationId: "gen-1",
    createdAt: 1,
    url: `asset://media/${id}.png`,
    thumbnailUrl: null,
  }
}

function done(id: string): BatchTile {
  return {
    id,
    generationId: "gen-1",
    asset: asset(id),
    state: "succeeded",
    progress: null,
    error: null,
    jobId: "job-1",
  }
}

function unfinished(
  id: string,
  state: BatchTile["state"] = "running"
): BatchTile {
  return {
    id,
    generationId: id,
    asset: null,
    state,
    progress: null,
    error: state === "failed" ? "NSFW content detected" : null,
    jobId: "job-2",
  }
}

describe("heroAndRest", () => {
  it("shows the pick large and keeps the order of everything else", () => {
    const tiles = [done("a"), done("b"), done("c")]

    const view = heroAndRest(tiles, "b")

    expect(view.hero?.id).toBe("b")
    expect(view.index).toBe(1)
    expect(view.rest.map((tile) => tile.id)).toEqual(["a", "c"])
  })

  it("falls back to the first finished output when nothing is picked", () => {
    const tiles = [unfinished("gen-2"), done("a"), done("b")]

    const view = heroAndRest(tiles, null)

    expect(view.hero?.id).toBe("a")
    expect(view.index).toBe(1)
    // The sibling that is still running keeps its place in the strip.
    expect(view.rest.map((tile) => tile.id)).toEqual(["gen-2", "b"])
  })

  it("ignores a pick whose asset is no longer one of the tiles", () => {
    const view = heroAndRest([done("a"), done("b")], "asset-gone")

    expect(view.hero?.id).toBe("a")
    expect(view.index).toBe(0)
  })

  it("shows a lone failure rather than an empty box", () => {
    const tiles = [unfinished("gen-2", "failed")]

    const view = heroAndRest(tiles, null)

    expect(view.hero?.id).toBe("gen-2")
    expect(view.rest).toEqual([])
  })

  it("has no hero when there are no tiles", () => {
    expect(heroAndRest([], null)).toEqual({ hero: null, rest: [], index: -1 })
  })
})

describe("stepPick", () => {
  const tiles = [done("a"), unfinished("gen-2"), done("b"), done("c")]

  it("walks the finished outputs, skipping the ones that are not", () => {
    expect(stepPick(tiles, "a", 1)).toBe("b")
    expect(stepPick(tiles, "b", 1)).toBe("c")
    expect(stepPick(tiles, "b", -1)).toBe("a")
    expect(pickableAssets(tiles).map((one) => one.id)).toEqual(["a", "b", "c"])
  })

  it("wraps at both ends, because a batch is a ring of alternatives", () => {
    expect(stepPick(tiles, "c", 1)).toBe("a")
    expect(stepPick(tiles, "a", -1)).toBe("c")
  })

  it("starts at the first output when nothing is picked yet", () => {
    expect(stepPick(tiles, null, 1)).toBe("a")
    expect(stepPick(tiles, "asset-gone", -1)).toBe("a")
  })

  it("has nothing to move to while no run has finished", () => {
    expect(stepPick([unfinished("gen-2")], null, 1)).toBeNull()
  })
})
