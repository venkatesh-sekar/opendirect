/**
 * The joins and the wording behind Home and the project grids.
 *
 * Kept out of the components so they can be tested without a DOM: which run
 * comes first in Continue, which picture a card wears, and how a timestamp
 * reads are all decisions, and a decision spread across JSX is one nobody can
 * check.
 */
import type {
  AssetDto,
  ContainerKind,
  ContainerNodeDto,
  ContainerSummaryDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

import { flattenContainers } from "@/lib/board/sidebar-tree"
import { isJobActive } from "@/hooks/use-jobs"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "2m ago", "3h ago", "2d ago" — the tiles' second line. */
export function relativeTime(at: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - at)
  if (elapsed < MINUTE) return "now"
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  return `${Math.floor(elapsed / DAY)}d ago`
}

/** A clip's length as `m:ss`, for the badge on a video tile. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * `google/nano-banana-2` → `nano-banana-2`. The owner is noise on a 134px
 * tile; the full slug is one click away in the details panel.
 */
export function modelName(slug: string): string {
  return slug.split("/").pop() || slug
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export interface DayGroup<T> {
  label: string
  items: T[]
}

/**
 * Runs, newest first, under "Today", "Yesterday" and then the weekday and
 * date. Calendar days in the viewer's own time zone, not 24-hour windows: a
 * run from 23:50 is yesterday's at 00:10.
 */
export function groupByDay<T extends { createdAt: number }>(
  items: readonly T[],
  now = Date.now()
): DayGroup<T>[] {
  const today = startOfDay(now)
  const yesterday = startOfDay(today - 1)
  const groups: DayGroup<T>[] = []
  for (const item of items) {
    const day = startOfDay(item.createdAt)
    const label =
      day === today
        ? "Today"
        : day === yesterday
          ? "Yesterday"
          : new Date(item.createdAt).toLocaleDateString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            })
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}

export interface RunTile {
  generation: GenerationDto
  /** The run's first output, or null while it has none. */
  asset: AssetDto | null
  running: boolean
  /** 0–1 when the provider reports it; null otherwise. */
  progress: number | null
}

/** Each run's first output, oldest first — the one its tile shows. */
function firstOutputs(outputs: readonly AssetDto[]): Map<string, AssetDto> {
  const first = new Map<string, AssetDto>()
  const sorted = [...outputs].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
  for (const asset of sorted) {
    if (asset.generationId && !first.has(asset.generationId))
      first.set(asset.generationId, asset)
  }
  return first
}

/**
 * The Continue strip: runs still in flight first, from the job list, then the
 * project's latest runs with their pictures.
 *
 * The job list is the authority on what is running — a run's own status lags
 * the push by a refetch — so a run with an active job is shown once, as
 * running, whatever the generations page says about it.
 */
export function continueTiles(input: {
  jobs: readonly JobDto[]
  generations: readonly GenerationDto[]
  outputs: readonly AssetDto[]
}): RunTile[] {
  const active = input.jobs.filter(isJobActive)
  const running = new Set(active.map((job) => job.generationId))
  const pictures = firstOutputs(input.outputs)

  return [
    ...active.map((job) => ({
      generation: job.generation,
      asset: null,
      running: true,
      progress: job.progress,
    })),
    ...input.generations
      .filter((generation) => !running.has(generation.id))
      .map((generation) => ({
        generation,
        asset: pictures.get(generation.id) ?? null,
        running: false,
        progress: null,
      })),
  ]
}

/** Every container of one kind, wherever it is filed, in tree order. */
export function containersOfKind(
  tree: readonly ContainerNodeDto[],
  kind: ContainerKind
): ContainerNodeDto[] {
  return flattenContainers([...tree]).filter((node) => node.kind === kind)
}

export interface ContainerCard {
  node: ContainerNodeDto
  /** Null until `containers:summaries` has answered. */
  summary: ContainerSummaryDto | null
  /**
   * The cover is the character sheet the user chose — the first reference —
   * rather than whichever image happens to be newest. Worth a ★ on the card.
   */
  sheet: boolean
  /**
   * A scene's cast, from its summary's `castIds`, each with the face its own
   * card wears. Empty for a character, and until the summaries answer.
   */
  cast: CastMember[]
}

export interface CastMember {
  node: ContainerNodeDto
  cover: AssetDto | null
}

export function containerCards(
  tree: readonly ContainerNodeDto[],
  summaries: readonly ContainerSummaryDto[] | undefined,
  kind: "character" | "scene"
): ContainerCard[] {
  const byId = new Map((summaries ?? []).map((entry) => [entry.id, entry]))
  const characters = new Map(
    containersOfKind(tree, "character").map((node) => [node.id, node])
  )
  return containersOfKind(tree, kind).map((node) => {
    const summary = byId.get(node.id) ?? null
    const first = node.referenceAssetIds?.[0]
    return {
      node,
      summary,
      sheet: Boolean(first && summary?.coverAsset?.id === first),
      // A character deleted since the summary was read is left out.
      cast: (summary?.castIds ?? []).flatMap((id) => {
        const member = characters.get(id)
        return member
          ? [{ node: member, cover: byId.get(id)?.coverAsset ?? null }]
          : []
      }),
    }
  })
}
