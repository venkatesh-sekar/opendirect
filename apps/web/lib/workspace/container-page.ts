/**
 * The decisions behind a container's own page — which tab is open, what a
 * filter chip keeps, how the reference list is edited — kept out of the
 * components so they can be checked without a DOM.
 */
import type { AssetDto, GenerationDto, JobDto } from "@opendirect/contract"

import { continueTiles, type RunTile } from "./home"

/**
 * The tabs that have content on a page. Canvas is not one of them: it is a
 * link to `/canvas/?focus=`, never an embedded canvas.
 */
export const PAGE_TABS = [
  "shots",
  "assets",
  "generations",
  "appears-in",
] as const
export type PageTab = (typeof PAGE_TABS)[number]

/** A character's tabs, in order: what it is made of, then what it made. */
export const CHARACTER_TABS: readonly PageTab[] = [
  "assets",
  "generations",
  "appears-in",
]

/**
 * A scene's tabs: its storyboard of shots first (§5), then the runs filed
 * straight under the scene, then its assets.
 */
export const SCENE_TABS: readonly PageTab[] = ["shots", "generations", "assets"]

/** `&tab=` as the page reads it; anything the page lacks is its first tab. */
export function parseTab(
  raw: string | null,
  tabs: readonly PageTab[] = CHARACTER_TABS
): PageTab {
  return (tabs as readonly string[]).includes(raw ?? "")
    ? (raw as PageTab)
    : tabs[0]!
}

export type AssetFilter = "all" | "references" | "generated" | "uploaded"

export const ASSET_FILTERS: { value: AssetFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "references", label: "References" },
  { value: "generated", label: "Generated" },
  { value: "uploaded", label: "Uploaded" },
]

/**
 * What a chip keeps. References come out in the order they are sent, because
 * that order is the point of them; the rest keep the library's own order.
 * Generated means a run made it; everything else was brought in.
 */
export function filterAssets(
  assets: readonly AssetDto[],
  filter: AssetFilter,
  references: readonly string[] | null | undefined
): AssetDto[] {
  switch (filter) {
    case "all":
      return [...assets]
    case "references": {
      const byId = new Map(assets.map((asset) => [asset.id, asset]))
      return (references ?? [])
        .map((id) => byId.get(id))
        .filter((asset): asset is AssetDto => asset !== undefined)
    }
    case "generated":
      return assets.filter((asset) => asset.generationId !== null)
    case "uploaded":
      return assets.filter((asset) => asset.generationId === null)
  }
}

/** Each reference's 1-based place in what the model is sent. */
export function referenceNumbers(
  references: readonly string[] | null | undefined
): Map<string, number> {
  return new Map((references ?? []).map((id, index) => [id, index + 1]))
}

/**
 * Adds an asset to the end of the references, or takes it out.
 *
 * Taking out the last one returns `null` — "automatic", the state a container
 * starts in — rather than an empty list, which would mean "send nothing".
 */
export function toggleReference(
  references: readonly string[] | null | undefined,
  assetId: string
): string[] | null {
  const current = references ?? []
  if (!current.includes(assetId)) return [...current, assetId]
  const next = current.filter((id) => id !== assetId)
  return next.length > 0 ? next : null
}

/** Moves `from` into `to`'s place — what dropping one thumbnail on another does. */
export function moveReference(
  references: readonly string[],
  from: string,
  to: string
): string[] {
  const start = references.indexOf(from)
  const end = references.indexOf(to)
  if (start < 0 || end < 0 || start === end) return [...references]
  const next = [...references]
  next.splice(start, 1)
  next.splice(end, 0, from)
  return next
}

/**
 * A container's own runs, with its running jobs first — the Continue rule,
 * narrowed to the jobs filed under this container.
 */
export function containerRunTiles(input: {
  containerId: string
  jobs: readonly JobDto[]
  generations: readonly GenerationDto[]
  outputs: readonly AssetDto[]
}): RunTile[] {
  return continueTiles({
    jobs: input.jobs.filter(
      (job) => job.generation.containerId === input.containerId
    ),
    generations: input.generations,
    outputs: input.outputs,
  })
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** How many scene names the stats line spells out before "and N more". */
const SCENES_NAMED = 3

/**
 * "12 assets · 38 generations", and for a character in scenes
 * "· in Hotel hallway, Rooftop at dusk".
 */
export function statsLine(
  summary: { assetCount: number; generationCount: number },
  scenes: readonly string[] = []
): string {
  const counts = `${plural(summary.assetCount, "asset")} · ${plural(summary.generationCount, "generation")}`
  if (scenes.length === 0) return counts
  const named = scenes.slice(0, SCENES_NAMED).join(", ")
  const rest = scenes.length - SCENES_NAMED
  return `${counts} · in ${named}${rest > 0 ? ` and ${rest} more` : ""}`
}

/** The Appears in tab's count: "3 scenes". */
export function appearsInCount(count: number): string {
  return plural(count, "scene")
}
