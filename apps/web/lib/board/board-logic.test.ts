import type {
  AssetDto,
  ContainerNodeDto,
  GenerationDto,
} from "@opendirect/contract"
import { describe, expect, it } from "vitest"

import {
  dragStartedWithShift,
  isAssetDragData,
  isContainerDropData,
  resolveAssetDrop,
} from "./drop-target"
import {
  BOARD_FALLBACK_HEIGHT,
  BOARD_FALLBACK_WIDTH,
  boardMetrics,
  buildBoardItems,
  cardMediaHeight,
} from "./items"
import {
  buildSidebarSections,
  findContainer,
  firstSelectableContainer,
  flattenContainers,
} from "./sidebar-tree"

function container(
  id: string,
  kind: ContainerNodeDto["kind"],
  children: ContainerNodeDto[] = []
): ContainerNodeDto {
  return {
    id,
    projectId: "p1",
    parentId: null,
    kind,
    name: id,
    position: 0,
    createdAt: 0,
    children,
  }
}

function asset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "a1",
    projectId: "p1",
    kind: "image",
    relPath: "assets/2026/09/a1.png",
    text: null,
    mimeType: "image/png",
    width: 1024,
    height: 768,
    durationMs: null,
    bytes: 100,
    sha256: "deadbeef",
    thumbnailRelPath: null,
    label: null,
    originalName: "a1.png",
    pinned: false,
    generationId: null,
    createdAt: 1,
    url: "asset://p1/assets/2026/09/a1.png",
    thumbnailUrl: null,
    ...overrides,
  }
}

function generation(overrides: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: "g1",
    projectId: "p1",
    containerId: "c1",
    provider: "replicate",
    modelSlug: "bytedance/seedance-2.5",
    modelVersion: null,
    kind: "video",
    prompt: "a hallway that never ends",
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "running",
    error: null,
    providerJobId: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    costConfidence: null,
    parentGenerationId: null,
    branchNote: null,
    createdAt: 10,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

describe("buildSidebarSections", () => {
  it("always produces the four fixed headings in product order", () => {
    expect(buildSidebarSections([]).map((section) => section.label)).toEqual([
      "Characters",
      "Scenes",
      "Assets",
      "Generations",
    ])
  })

  it("files root containers under the heading their kind belongs to", () => {
    const sections = buildSidebarSections([
      container("venkatesh", "character"),
      container("elevator", "scene"),
      container("references", "folder"),
    ])

    expect(sections[0]!.nodes.map((node) => node.id)).toEqual(["venkatesh"])
    expect(sections[1]!.nodes.map((node) => node.id)).toEqual(["elevator"])
    expect(sections[2]!.nodes.map((node) => node.id)).toEqual(["references"])
  })

  it("treats a project-kind root as transparent and hoists its children", () => {
    const sections = buildSidebarSections([
      container("root", "project", [
        container("nikita", "character"),
        container("the-door", "scene"),
      ]),
    ])

    expect(sections[0]!.nodes.map((node) => node.id)).toEqual(["nikita"])
    expect(sections[1]!.nodes.map((node) => node.id)).toEqual(["the-door"])
  })

  it("marks Generations as a view rather than a set of containers", () => {
    const generations = buildSidebarSections([])[3]!
    expect(generations.virtual).toBe(true)
    expect(generations.nodes).toEqual([])
  })
})

describe("tree lookups", () => {
  const tree = [
    container("root", "project", [
      container("venkatesh", "character", [container("wardrobe", "folder")]),
    ]),
  ]

  it("finds a container nested at any depth", () => {
    expect(findContainer(tree, "wardrobe")?.id).toBe("wardrobe")
    expect(findContainer(tree, "nope")).toBeNull()
  })

  it("flattens parents before children", () => {
    expect(flattenContainers(tree).map((node) => node.id)).toEqual([
      "root",
      "venkatesh",
      "wardrobe",
    ])
  })

  it("opens on the first container in sidebar order", () => {
    expect(firstSelectableContainer(tree)?.id).toBe("venkatesh")
    expect(firstSelectableContainer([])).toBeNull()
  })
})

describe("resolveAssetDrop", () => {
  const active = { type: "asset", assetId: "a1", containerId: "c1" }
  const over = { type: "container", containerId: "c2" }

  it("adds the asset to the container it was dropped on", () => {
    expect(resolveAssetDrop(active, over)).toEqual({
      action: "add",
      assetId: "a1",
      fromContainerId: null,
      toContainerId: "c2",
    })
  })

  it("moves instead when the drag started with Shift held", () => {
    expect(resolveAssetDrop(active, over, { move: true })).toEqual({
      action: "move",
      assetId: "a1",
      fromContainerId: "c1",
      toContainerId: "c2",
    })
  })

  it("cannot move an asset that came from no container", () => {
    const loose = { ...active, containerId: null }
    expect(resolveAssetDrop(loose, over, { move: true })?.action).toBe("add")
  })

  it("does nothing when the drop misses, mistargets, or is a no-op", () => {
    expect(resolveAssetDrop(active, null)).toBeNull()
    expect(
      resolveAssetDrop(active, { type: "asset", assetId: "a2" })
    ).toBeNull()
    expect(resolveAssetDrop(null, over)).toBeNull()
    expect(
      resolveAssetDrop(active, { type: "container", containerId: "c1" })
    ).toBeNull()
  })

  it("narrows the opaque dnd-kit payloads", () => {
    expect(isAssetDragData(active)).toBe(true)
    expect(isAssetDragData({ type: "asset" })).toBe(false)
    expect(isContainerDropData(over)).toBe(true)
    expect(isContainerDropData({ type: "container", containerId: "" })).toBe(
      false
    )
  })

  it("reads the Shift modifier off the activator event", () => {
    expect(dragStartedWithShift({ shiftKey: true })).toBe(true)
    expect(dragStartedWithShift({ shiftKey: false })).toBe(false)
    expect(dragStartedWithShift(undefined)).toBe(false)
  })
})

describe("buildBoardItems", () => {
  it("shows one tile per asset, newest first", () => {
    const items = buildBoardItems([
      asset({ id: "old", createdAt: 1 }),
      asset({ id: "new", createdAt: 5 }),
    ])
    expect(items.map((item) => item.id)).toEqual(["asset:new", "asset:old"])
  })

  it("pins runs that are still in flight above the media", () => {
    const items = buildBoardItems(
      [asset({ id: "a1", createdAt: 99 })],
      [generation({ id: "g1", status: "running", createdAt: 2 })]
    )
    expect(items.map((item) => item.id)).toEqual(["generation:g1", "asset:a1"])
  })

  it("drops a run whose output is already on the board", () => {
    const items = buildBoardItems(
      [asset({ id: "a1", generationId: "g1" })],
      [generation({ id: "g1", status: "succeeded" })]
    )
    expect(items.map((item) => item.id)).toEqual(["asset:a1"])
  })

  it("keeps a failed run visible so the error is not swallowed", () => {
    const items = buildBoardItems(
      [],
      [generation({ id: "g1", status: "failed", error: "boom" })]
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.type).toBe("generation")
  })
})

describe("cardMediaHeight", () => {
  it("preserves the media's aspect ratio inside the column", () => {
    expect(cardMediaHeight({ width: 1000, height: 500 }, 240)).toBe(120)
  })

  it("falls back to 4:3 when the dimensions are unknown", () => {
    expect(cardMediaHeight({ width: null, height: null }, 240)).toBe(180)
    expect(cardMediaHeight({ width: 0, height: 0 }, 240)).toBe(180)
  })

  it("clamps extreme ratios so no tile becomes a sliver or a tower", () => {
    expect(cardMediaHeight({ width: 4000, height: 100 }, 240)).toBe(96)
    expect(cardMediaHeight({ width: 100, height: 4000 }, 240)).toBe(480)
  })
})

describe("boardMetrics", () => {
  it("passes real measurements through", () => {
    expect(boardMetrics({ width: 1200, height: 800 })).toEqual({
      width: 1200,
      height: 800,
    })
  })

  it("substitutes a desktop size before the container has been measured", () => {
    expect(boardMetrics({ width: 0, height: 0 })).toEqual({
      width: BOARD_FALLBACK_WIDTH,
      height: BOARD_FALLBACK_HEIGHT,
    })
  })
})
