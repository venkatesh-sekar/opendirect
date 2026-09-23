/**
 * Wire rows for the workspace component tests: one of each, with the fields a
 * test does not care about filled in once.
 */
import type {
  AssetDto,
  ContainerNodeDto,
  ContainerSummaryDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

export const MINUTE = 60_000

export function generation(over: Partial<GenerationDto> = {}): GenerationDto {
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
    createdAt: Date.now() - 2 * MINUTE,
    startedAt: null,
    completedAt: null,
    ...over,
  }
}

export function asset(over: Partial<AssetDto> = {}): AssetDto {
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
    createdAt: Date.now(),
    url: "asset://media/a.png",
    thumbnailUrl: null,
    ...over,
  }
}

export function job(over: Partial<JobDto> = {}): JobDto {
  return {
    id: "j1",
    generationId: "g-run",
    state: "running",
    attempts: 1,
    error: null,
    createdAt: Date.now(),
    lastPolledAt: null,
    nextPollAt: null,
    awaitingResume: false,
    progress: 0.62,
    generation: generation({
      id: "g-run",
      status: "running",
      prompt: "@venkz on the rooftop, wind",
    }),
    ...over,
  }
}

export function container(over: Partial<ContainerNodeDto>): ContainerNodeDto {
  return {
    id: "c",
    projectId: "p",
    parentId: null,
    kind: "character",
    name: "C",
    position: 0,
    handle: null,
    description: null,
    createdAt: Date.now(),
    children: [],
    ...over,
  }
}

export function summary(
  over: Partial<ContainerSummaryDto> & { id: string }
): ContainerSummaryDto {
  return {
    assetCount: 0,
    generationCount: 0,
    coverAsset: null,
    lastActivityAt: Date.now(),
    ...over,
  }
}
