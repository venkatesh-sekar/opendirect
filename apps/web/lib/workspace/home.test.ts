import { describe, expect, it } from "vitest"

import type {
  AssetDto,
  ContainerNodeDto,
  ContainerSummaryDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

import {
  containerCards,
  continueTiles,
  formatDuration,
  groupByDay,
  modelName,
  relativeTime,
} from "./home"

const NOW = new Date(2026, 8, 23, 15, 0, 0).getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function generation(over: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: "g1",
    projectId: "p",
    containerId: null,
    provider: "replicate",
    modelSlug: "google/nano-banana-2",
    modelVersion: null,
    kind: "image",
    prompt: "@mira in the hotel hallway",
    paramsJson: "{}",
    requestJson: null,
    responseJson: null,
    status: "succeeded",
    error: null,
    providerJobId: null,
    estimatedCostUsd: null,
    actualCostUsd: null,
    predictTimeSeconds: null,
    costConfidence: null,
    parentGenerationId: null,
    batchId: null,
    branchNote: null,
    createdAt: NOW - 2 * MINUTE,
    startedAt: null,
    completedAt: null,
    ...over,
  }
}

function asset(over: Partial<AssetDto> = {}): AssetDto {
  return {
    id: "a1",
    projectId: "p",
    kind: "image",
    relPath: "a.png",
    text: null,
    mimeType: "image/png",
    width: 10,
    height: 10,
    durationMs: null,
    bytes: 1,
    sha256: null,
    thumbnailRelPath: null,
    label: null,
    originalName: null,
    pinned: false,
    generationId: null,
    createdAt: NOW,
    url: "asset://media/a.png",
    thumbnailUrl: null,
    ...over,
  }
}

function job(over: Partial<JobDto> = {}): JobDto {
  return {
    id: "j1",
    generationId: "g-run",
    state: "running",
    attempts: 1,
    error: null,
    createdAt: NOW,
    lastPolledAt: null,
    nextPollAt: null,
    awaitingResume: false,
    progress: 0.62,
    generation: generation({ id: "g-run", status: "running" }),
    ...over,
  }
}

function node(over: Partial<ContainerNodeDto>): ContainerNodeDto {
  return {
    id: "c",
    projectId: "p",
    parentId: null,
    kind: "character",
    name: "C",
    position: 0,
    handle: null,
    description: null,
    createdAt: NOW,
    children: [],
    ...over,
  }
}

describe("formatting", () => {
  it("says how long ago, the way the mockups do", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("now")
    expect(relativeTime(NOW - 2 * MINUTE, NOW)).toBe("2m ago")
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe("3h ago")
    expect(relativeTime(NOW - 50 * HOUR, NOW)).toBe("2d ago")
  })

  it("prints a clip's length as m:ss", () => {
    expect(formatDuration(5_000)).toBe("0:05")
    expect(formatDuration(64_400)).toBe("1:04")
  })

  it("names a model by the last part of its slug", () => {
    expect(modelName("google/nano-banana-2")).toBe("nano-banana-2")
    expect(modelName("flux")).toBe("flux")
  })
})

describe("groupByDay", () => {
  it("groups newest-first runs under Today, Yesterday and then a date", () => {
    const groups = groupByDay(
      [
        generation({ id: "today", createdAt: NOW - HOUR }),
        generation({ id: "yesterday", createdAt: NOW - 20 * HOUR }),
        generation({ id: "older", createdAt: NOW - 72 * HOUR }),
      ],
      NOW
    )
    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      new Date(NOW - 72 * HOUR).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      }),
    ])
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["today"],
      ["yesterday"],
      ["older"],
    ])
  })
})

describe("continueTiles", () => {
  it("puts running jobs first, then finished runs with their first output", () => {
    const tiles = continueTiles({
      jobs: [
        job(),
        job({ id: "done", state: "succeeded", generationId: "g-old" }),
      ],
      generations: [
        generation({ id: "g-run", status: "running" }),
        generation({ id: "g-old" }),
      ],
      outputs: [
        asset({ id: "second", generationId: "g-old", createdAt: NOW + 1 }),
        asset({ id: "first", generationId: "g-old" }),
      ],
    })

    expect(tiles.map((tile) => [tile.generation.id, tile.running])).toEqual([
      ["g-run", true],
      ["g-old", false],
    ])
    expect(tiles[0]!.progress).toBe(0.62)
    expect(tiles[1]!.asset?.id).toBe("first")
  })
})

describe("containerCards", () => {
  it("pairs each character with its summary and marks a character sheet cover", () => {
    const cover = asset({ id: "sheet" })
    const summaries: ContainerSummaryDto[] = [
      {
        id: "mira",
        assetCount: 12,
        generationCount: 3,
        coverAsset: cover,
        lastActivityAt: NOW,
        castIds: [],
      },
      {
        id: "ruiz",
        assetCount: 4,
        generationCount: 0,
        coverAsset: asset({ id: "newest" }),
        lastActivityAt: NOW,
        castIds: [],
      },
    ]
    const tree = [
      node({ id: "mira", referenceAssetIds: ["sheet"] }),
      node({ id: "ruiz", referenceAssetIds: null }),
      node({ id: "hall", kind: "scene" }),
    ]

    const cards = containerCards(tree, summaries, "character")
    expect(cards.map((card) => card.node.id)).toEqual(["mira", "ruiz"])
    expect(cards[0]!.sheet).toBe(true)
    expect(cards[0]!.summary?.assetCount).toBe(12)
    expect(cards[1]!.sheet).toBe(false)
    expect(containerCards(tree, undefined, "scene")[0]!.summary).toBeNull()
  })
})
