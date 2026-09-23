/**
 * The decisions behind a scene's Shots tab (C3): which shots a scene has, how
 * they are numbered, what a shot's versions are, and which one its card wears.
 *
 * A shot is a child container of its scene. Its versions are the pictures the
 * runs filed under it made, oldest first. A version is numbered by its run —
 * `v1` is the shot's first run — and a run's second and later pictures are
 * `v3.2`, `v3.3`. The number is the run's place among all of the shot's runs
 * (from the list's `total`), so it never shifts as more arrive or when only
 * the newest runs were read. A run still in flight is a version too, drawn
 * as running, and a run that made nothing (failed, canceled) keeps its number.
 */
import type {
  AssetDto,
  ContainerNodeDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

import { isJobActive } from "@/hooks/use-jobs"
import { shotHref } from "@/lib/shell/routes"

import type { PanelAim } from "./container-page"

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

/** `&shot=`'s shot — anything that is not one of the scene's is the first. */
export function selectedShot(
  scene: ContainerNodeDto,
  id: string | null
): { shot: ContainerNodeDto; index: number } | null {
  const shots = shotsOf(scene)
  const index = Math.max(
    0,
    shots.findIndex((shot) => shot.id === id)
  )
  const shot = shots[index]
  return shot ? { shot, index } : null
}

/**
 * The generate panel aimed at the selected shot. Worked out from the scene as
 * it is now, every render, so selecting another shot, reordering or deleting
 * re-aims the panel rather than leaving it filing into a stale shot under a
 * stale name. Null — the panel closes — when the scene has no shots.
 */
export function shotAim(
  scene: ContainerNodeDto,
  id: string | null
): PanelAim | null {
  const selected = selectedShot(scene, id)
  if (!selected) return null
  const { shot, index } = selected
  const title = shotTitle(index)
  const label = shot.description ?? ""
  return {
    target: {
      containerId: shot.id,
      label: `Generate a version of ${title}`,
      destination: `${scene.name} · ${title}`,
      // The scene's handle brings its location references; the label is
      // what the shot is.
      initialPrompt: scene.handle ? `@${scene.handle} ${label}` : label,
    },
    whenQueued: shotHref(scene.id, shot.id),
  }
}

export interface ShotVersion {
  /** Stable across refetches: the asset, or the run while it has none. */
  key: string
  /** `v1`, `v2`, `v2.2` … by run, oldest first. */
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
 * `generations` may be only the newest page of the shot's runs; `total` (the
 * list's own count, all of them) is what keeps the numbers right then.
 * `jobs` should be the project's job list; only the active ones filed under
 * `shotId` count. The job list is the authority on what is running, as on
 * Home, and a run it knows about before the generations list has refetched is
 * still shown — at the end, where the newest version goes.
 */
export function shotVersions(input: {
  shotId: string
  generations: readonly GenerationDto[]
  /** How many runs the shot has in all; the listed ones by default. */
  total?: number
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

  // The oldest listed run's place among all of them.
  const first = Math.max(0, (input.total ?? runs.length) - runs.length) + 1
  const versions: ShotVersion[] = []
  ;[...runs, ...unlisted].forEach((generation, at) => {
    const number = `v${first + at}`
    const job = active.get(generation.id)
    const made = job ? [] : (byRun.get(generation.id) ?? [])
    if (made.length === 0) {
      versions.push({
        key: generation.id,
        label: number,
        generation,
        asset: null,
        running: job !== undefined,
        progress: job?.progress ?? null,
      })
      return
    }
    made.forEach((asset, picture) =>
      versions.push({
        key: asset.id,
        label: picture === 0 ? number : `${number}.${picture + 1}`,
        generation,
        asset,
        running: false,
        progress: null,
      })
    )
  })
  return versions
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
