/**
 * The decisions behind a scene's Shots tab (C3): which shots a scene has, how
 * they are numbered, what a shot's versions are, and which one its card wears.
 *
 * A shot is a child container of its scene. Its versions are the pictures the
 * runs filed under it made — one per output, oldest first, so `v1` is the
 * first thing ever made for the shot and numbers never shift as more arrive.
 * A run still in flight is a version too, drawn as running, and a run that
 * made nothing (failed, canceled) keeps its number so the count reads true.
 */
import type {
  AssetDto,
  ContainerNodeDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

import { isJobActive } from "@/hooks/use-jobs"

/** A scene's shots, in storyboard order (the tree is ordered by position). */
export function shotsOf(scene: ContainerNodeDto): ContainerNodeDto[] {
  return scene.children.filter((child) => child.kind === "shot")
}

/** `01`, `02` … — a shot's number is its place, not a stored field. */
export function shotNumber(index: number): string {
  return String(index + 1).padStart(2, "0")
}

/** What a shot is called where it has no card: "Shot 03". */
export function shotTitle(index: number): string {
  return `Shot ${shotNumber(index)}`
}

export interface ShotVersion {
  /** Stable across refetches: the asset, or the run while it has none. */
  key: string
  /** `v1`, `v2` … oldest first. */
  label: string
  generation: GenerationDto
  /** The picture; null while running, or when the run made nothing. */
  asset: AssetDto | null
  running: boolean
  /** 0–1 when the provider reports it; null otherwise. */
  progress: number | null
}

/**
 * Every version of one shot, oldest first.
 *
 * `jobs` should be the project's job list; only the active ones filed under
 * `shotId` count. The job list is the authority on what is running, as on
 * Home, and a run it knows about before the generations list has refetched is
 * still shown — at the end, where the newest version goes.
 */
export function shotVersions(input: {
  shotId: string
  generations: readonly GenerationDto[]
  outputs: readonly AssetDto[]
  jobs: readonly JobDto[]
}): ShotVersion[] {
  const active = new Map(
    input.jobs
      .filter(
        (job) => job.generation.containerId === input.shotId && isJobActive(job)
      )
      .map((job) => [job.generationId, job])
  )
  const byRun = new Map<string, AssetDto[]>()
  for (const asset of [...input.outputs].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )) {
    if (!asset.generationId) continue
    const list = byRun.get(asset.generationId) ?? []
    list.push(asset)
    byRun.set(asset.generationId, list)
  }

  const runs = [...input.generations]
    .filter((generation) => generation.containerId === input.shotId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const listed = new Set(runs.map((run) => run.id))
  const unlisted = [...active.values()]
    .filter((job) => !listed.has(job.generationId))
    .map((job) => job.generation)

  const versions: Omit<ShotVersion, "label">[] = []
  for (const generation of [...runs, ...unlisted]) {
    const job = active.get(generation.id)
    if (job) {
      versions.push({
        key: generation.id,
        generation,
        asset: null,
        running: true,
        progress: job.progress,
      })
      continue
    }
    const made = byRun.get(generation.id) ?? []
    if (made.length === 0) {
      versions.push({
        key: generation.id,
        generation,
        asset: null,
        running: false,
        progress: null,
      })
      continue
    }
    for (const asset of made)
      versions.push({
        key: asset.id,
        generation,
        asset,
        running: false,
        progress: null,
      })
  }
  return versions.map((version, index) => ({
    ...version,
    label: `v${index + 1}`,
  }))
}

/** The version the user picked, if it is still one of the shot's. */
export function pickedVersion(
  versions: readonly ShotVersion[],
  pickedAssetId: string | null | undefined
): ShotVersion | null {
  if (!pickedAssetId) return null
  return versions.find((version) => version.asset?.id === pickedAssetId) ?? null
}

/**
 * The picture a shot's card wears: its pick, else its newest picture. Until
 * the user picks, the newest stands in — but nothing is stored for it.
 */
export function coverVersion(
  versions: readonly ShotVersion[],
  pickedAssetId: string | null | undefined
): ShotVersion | null {
  return (
    pickedVersion(versions, pickedAssetId) ??
    [...versions].reverse().find((version) => version.asset !== null) ??
    null
  )
}

/** The versions strip's right-hand line. */
export function pickLine(
  versions: readonly ShotVersion[],
  pickedAssetId: string | null | undefined
): string {
  if (versions.length === 0) return "No versions yet"
  const picked = pickedVersion(versions, pickedAssetId)
  return picked
    ? `${picked.label} is the pick · click another to pick it`
    : "No pick yet · click a version to pick it"
}
