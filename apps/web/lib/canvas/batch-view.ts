/**
 * What a generate node is showing, worked out from rows.
 *
 * A node is one run or one batch of them, and what it paints depends on three
 * separate queries — the sibling generations, the assets they produced, and
 * the live job rows. Joining them is rules, not rendering, so it lives here
 * and `generate-node.tsx` stays markup.
 *
 * The join, in one sentence: **every sibling generation contributes one tile
 * per output asset, and a sibling with no output yet contributes one tile that
 * is its own progress or its own failure.** That is what makes a partial batch
 * usable — three tiles that worked and one that did not, each with its own
 * state and its own Retry, rather than one all-or-nothing node.
 *
 * ⛔ Nothing here submits anything. It reads rows and returns what to draw.
 */
import type {
  AssetDto,
  CanvasNodeDto,
  GenerationDto,
  JobDto,
} from "@opendirect/contract"

export type TileState =
  "pending" | "running" | "succeeded" | "failed" | "canceled"

export interface BatchTile {
  /** Stable across re-renders: an asset id, or the generation's own id. */
  id: string
  generationId: string
  /** The output, once there is one. */
  asset: AssetDto | null
  state: TileState
  /** 0–1 when the provider reports a number; null when it reports none. */
  progress: number | null
  /** The provider's own message, verbatim. */
  error: string | null
  /** The job to hand to `jobs:retry`; null when the run has no job row. */
  jobId: string | null
}

/**
 * The runs this node is showing.
 *
 * A batch is found by its id, which is exactly why `generations.batch_id` is a
 * column rather than a field inside `request_json` — a node cannot scan JSON
 * to find its own siblings. A node that was submitted on its own has one run
 * and no batch id.
 */
export function batchGenerations(
  node: CanvasNodeDto,
  generations: readonly GenerationDto[]
): GenerationDto[] {
  const found = node.batchId
    ? generations.filter((one) => one.batchId === node.batchId)
    : generations.filter((one) => one.id === node.generationId)

  // The node carries its own resolved generation, which may not be in the page
  // the board fetched. Oldest first, so tiles do not reshuffle as they land.
  if (
    node.generation &&
    !found.some((one) => one.id === node.generation!.id) &&
    (node.batchId === null || node.generation.batchId === node.batchId)
  ) {
    found.push(node.generation)
  }
  return found.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  )
}

function stateOf(
  generation: GenerationDto,
  job: JobDto | undefined
): TileState {
  if (job) {
    if (job.state === "succeeded") return "succeeded"
    if (job.state === "failed") return "failed"
    if (job.state === "canceled") return "canceled"
    if (job.state === "queued") return "pending"
    return "running"
  }
  if (generation.status === "succeeded") return "succeeded"
  if (generation.status === "failed") return "failed"
  if (generation.status === "canceled") return "canceled"
  if (generation.status === "queued") return "pending"
  return "running"
}

export interface BatchViewInput {
  node: CanvasNodeDto
  /** Every generation the container query returned. */
  generations: readonly GenerationDto[]
  /** Every asset the container query returned. */
  assets: readonly AssetDto[]
  jobs: readonly JobDto[]
}

export function batchTiles(input: BatchViewInput): BatchTile[] {
  const runs = batchGenerations(input.node, input.generations)
  const jobs = new Map(input.jobs.map((job) => [job.generationId, job]))

  const tiles: BatchTile[] = []
  for (const generation of runs) {
    const job = jobs.get(generation.id)
    const outputs = input.assets
      .filter((asset) => asset.generationId === generation.id)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    const state = stateOf(generation, job)
    const error = job?.error ?? generation.error ?? null

    if (outputs.length === 0) {
      tiles.push({
        id: generation.id,
        generationId: generation.id,
        asset: null,
        state,
        progress: job?.progress ?? null,
        error,
        jobId: job?.id ?? null,
      })
      continue
    }

    for (const asset of outputs) {
      tiles.push({
        id: asset.id,
        generationId: generation.id,
        asset,
        state: "succeeded",
        progress: null,
        error: null,
        jobId: job?.id ?? null,
      })
    }
  }
  return tiles
}

export interface BatchProgress {
  /** Tiles the runner still owes an answer for. */
  active: number
  total: number
  /**
   * 0–1 for the node as a whole, or null when nothing can be said — which is
   * the honest answer while no provider reports a percentage. A finished tile
   * counts as one whole, so four runs where two are done reads as 50%.
   */
  fraction: number | null
}

export function batchProgress(tiles: readonly BatchTile[]): BatchProgress {
  const active = tiles.filter(
    (tile) => tile.state === "pending" || tile.state === "running"
  ).length
  if (tiles.length === 0) return { active: 0, total: 0, fraction: null }

  let done = 0
  let reported = false
  for (const tile of tiles) {
    if (tile.state === "pending" || tile.state === "running") {
      if (tile.progress !== null) {
        done += tile.progress
        reported = true
      }
      continue
    }
    done += 1
  }
  // With no provider percentage and nothing finished, a ring at 0% would be a
  // number we invented; an indeterminate spinner is what the job list shows.
  if (!reported && done === 0)
    return { active, total: tiles.length, fraction: null }
  return { active, total: tiles.length, fraction: done / tiles.length }
}

/** The finished tiles, which are the only ones a pick can be chosen from. */
export function pickableAssets(tiles: readonly BatchTile[]): AssetDto[] {
  return tiles
    .filter((tile) => tile.state === "succeeded" && tile.asset !== null)
    .map((tile) => tile.asset!)
}
