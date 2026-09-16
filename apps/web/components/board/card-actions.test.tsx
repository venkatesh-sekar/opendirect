// @vitest-environment jsdom
import type { AssetDto } from "@opendirect/contract"
import { describe, expect, it, vi } from "vitest"

import { outputActions } from "./card-actions"

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "a1",
    projectId: "p1",
    kind: "video",
    relPath: "generations/gen-1/0.mp4",
    text: null,
    mimeType: "video/mp4",
    width: 1280,
    height: 720,
    durationMs: 5000,
    bytes: 1024,
    sha256: "abc",
    thumbnailRelPath: null,
    label: "take 1",
    originalName: null,
    pinned: false,
    generationId: "gen-1",
    createdAt: 1,
    url: "asset://p1/generations/gen-1/0.mp4",
    thumbnailUrl: null,
    ...overrides,
  }
}

const noop = () => {}

function build(overrides: Partial<Parameters<typeof outputActions>[0]> = {}) {
  return outputActions({
    asset: asset(),
    onUseAsReference: noop,
    onAddTo: noop,
    onBranch: noop,
    onCompare: noop,
    onOpen: noop,
    onReveal: noop,
    onDetails: noop,
    canCompare: true,
    ...overrides,
  })
}

function find(id: string, actions = build()) {
  const found = actions.find((action) => action.id === id)
  if (!found) throw new Error(`No action ${id}`)
  return found
}

describe("outputActions", () => {
  it("offers every action the card promises, in one order", () => {
    expect(build().map((action) => action.id)).toEqual([
      "reference",
      "add-to",
      "branch",
      "compare",
      "open",
      "reveal",
      "details",
    ])
  })

  it("runs the branch callback with the run behind the tile", () => {
    const onBranch = vi.fn()
    find("branch", build({ onBranch })).run()
    expect(onBranch).toHaveBeenCalledWith("gen-1")
  })

  it("explains why an imported file cannot be branched or inspected", () => {
    const actions = build({ asset: asset({ generationId: null }) })
    expect(find("branch", actions).disabledReason).toMatch(/imported/i)
    expect(find("details", actions).disabledReason).toMatch(/imported/i)
    // Filing it and using it as a reference are still perfectly sensible.
    expect(find("add-to", actions).disabledReason).toBeFalsy()
    expect(find("reference", actions).disabledReason).toBeFalsy()
  })

  it("refuses to open an asset that has no file", () => {
    const actions = build({
      asset: asset({ relPath: null, kind: "text", url: null }),
    })
    expect(find("open", actions).disabledReason).toMatch(/no file/i)
    expect(find("reveal", actions).disabledReason).toMatch(/no file/i)
    expect(find("reference", actions).disabledReason).toMatch(/only media/i)
  })

  it("says when there is nothing to compare against", () => {
    expect(find("compare", build({ canCompare: false })).disabledReason).toMatch(
      /nothing else/i
    )
  })
})
