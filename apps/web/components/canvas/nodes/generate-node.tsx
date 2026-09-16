"use client"

/**
 * A run, or a batch of them, as one node.
 *
 * Four states, in the order a node moves through them:
 *
 * 1. **Empty.** Nothing has been submitted. The prompt bar under the node is
 *    where that happens, and it is not this component's business.
 * 2. **Running.** A ring and a percentage, both read off the job rows pushed
 *    by `jobs:update`. When no provider reports a number the ring is
 *    indeterminate rather than showing an invented one.
 * 3. **Landed.** A grid of every output across every sibling of the batch, one
 *    tile each, with the pick ringed. Any tile becomes the pick in one click
 *    and nothing downstream re-runs because of it.
 * 4. **Failed, wholly or partly.** Each tile carries its own provider message
 *    and its own Retry, because each sibling is a separately paid job. Three
 *    of four succeeding is a usable node, not a failed one.
 *
 * ⛔ The only thing here that can spend money is Retry, which goes through the
 * existing `jobs:retry` — a generation that already has a `providerJobId`
 * polls rather than resubmits, which is what makes offering it safe. Choosing
 * a pick costs nothing and re-runs nothing.
 */
import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  InformationCircleIcon,
  RefreshIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import type {
  AssetDto,
  CanvasNodeDto,
  GenerationDto,
} from "@opendirect/contract"
import type { NodeProps } from "@xyflow/react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import {
  useAssets,
  useOpenAsset,
  useRemoveAssetFromContainer,
  useRevealAsset,
} from "@/hooks/use-assets"
import { usePickCanvasNode } from "@/hooks/use-canvas"
import { useGeneration, useGenerations } from "@/hooks/use-generations"
import { useJobs, useRetryJob } from "@/hooks/use-jobs"
import { useModel } from "@/hooks/use-models"
import {
  batchProgress,
  batchTiles,
  type BatchTile,
} from "@/lib/canvas/batch-view"
import { modelKeyOf } from "@/lib/model-key"

import {
  AddToContainerDialog,
  OutputActionMenuItems,
  outputActions,
} from "@/components/board/card-actions"
import { CompareView } from "@/components/board/compare-view"
import { DetailsPanel } from "@/components/board/details-panel"

import { useCanvasSurface } from "../canvas-context"
import { AssetTile } from "./asset-tile"
import { NodeFrame } from "./node-frame"
import type { CanvasFlowNode } from "./types"

/** How many rows of the container the node reads to find its own siblings. */
const PAGE_SIZE = 200

const RING_SIZE = 44
const RING_RADIUS = 18
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * The progress ring.
 *
 * An SVG rather than a spinner because a run is minutes long and a fraction is
 * worth showing when the provider gives one. `fraction === null` means nobody
 * reported anything, and the ring says so by turning rather than filling.
 */
export function ProgressRing({
  fraction,
  label,
}: {
  fraction: number | null
  label: string
}) {
  const percent = fraction === null ? null : Math.round(fraction * 100)

  return (
    <div
      className="flex flex-col items-center gap-2"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        className={cn(fraction === null && "animate-spin")}
      >
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={3}
          className="stroke-muted"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - (fraction ?? 0.25))}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <span className="text-xs text-muted-foreground tabular-nums">
        {percent === null ? "Working…" : `${percent}%`}
      </span>
    </div>
  )
}

/** One failed sibling: the provider's message, and its own Retry. */
function FailedTile({ tile }: { tile: BatchTile }) {
  const retry = useRetryJob()

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-1 overflow-hidden rounded-md border border-destructive/50 bg-destructive/10 p-2"
      data-testid={`canvas-tile-failed-${tile.generationId}`}
    >
      <span className="flex items-center gap-1 text-xs font-medium text-destructive">
        <HugeiconsIcon icon={Alert02Icon} className="size-3.5" />
        Failed
      </span>
      <p className="min-h-0 flex-1 overflow-auto text-[11px] leading-snug text-muted-foreground">
        {tile.error ?? "The provider gave no reason."}
      </p>
      {tile.jobId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="nodrag h-6 self-start px-2 text-[11px]"
          disabled={retry.isPending}
          onClick={() => retry.mutate(tile.jobId!)}
        >
          <HugeiconsIcon icon={RefreshIcon} className="size-3" />
          Retry
        </Button>
      ) : null}
    </div>
  )
}

function PendingTile({ tile }: { tile: BatchTile }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed">
      <ProgressRing fraction={tile.progress} label="Run progress" />
    </div>
  )
}

/**
 * The details sheet, with the two things the canvas can answer for it.
 *
 * `DetailsPanel` takes both as optional callbacks and silently drops the
 * affordances when they are missing — which is exactly what the canvas did
 * until now, so "Branch from this run" and the clickable lineage were both
 * rendered and then never rendered. They are wired here, once, for every
 * surface in this file that opens the panel.
 *
 * ⛔ Read-only. Branch seeds a *new node's draft*; it submits nothing.
 */
export function RunDetailsPanel({
  generationId,
  node,
  open,
  onOpenChange,
}: {
  generationId: string
  /** The node the branch is placed beside. */
  node: CanvasNodeDto
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const surface = useCanvasSurface()
  // Only fetched while the sheet is open; the panel fetches the same row and
  // the two share one query.
  const detail = useGeneration(open ? generationId : null)
  const run = detail.data?.generation ?? null

  return (
    <DetailsPanel
      generationId={generationId}
      open={open}
      onOpenChange={onOpenChange}
      onBranch={surface && run ? () => surface.branch(node, run) : undefined}
      onSelectGeneration={surface?.selectGeneration}
    />
  )
}

/**
 * One output, and everything you can do with it.
 *
 * The board's card menu is the same list — `outputActions` — rendered onto the
 * canvas tile, because "compare these two takes", "reveal it in Finder" and
 * "get it off this board" did not stop being the things people want from a
 * result when the board became a canvas. Right-click is the surface: a tile is
 * 120px of picture and a row of icons on it would bury the picture.
 *
 * "Use as reference" is left out on purpose. On a canvas a reference is an
 * edge, so the honest way to make this tile feed another node is to draw one.
 *
 * ⛔ Nothing here spends money. Branch seeds a new node's prompt and stops.
 */
function ResultTile({
  asset,
  siblings,
  generation,
  containerId,
  node,
  picked,
  onPick,
}: {
  asset: AssetDto
  /** The rest of this node's batch — the other side of a comparison. */
  siblings: readonly AssetDto[]
  /** The run behind this tile, when the node's page still holds it. */
  generation: GenerationDto | null
  containerId: string | null
  node: CanvasNodeDto
  picked: boolean
  onPick: () => void
}) {
  const surface = useCanvasSurface()
  const [addToOpen, setAddToOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const open = useOpenAsset()
  const reveal = useRevealAsset()
  const remove = useRemoveAssetFromContainer()
  const failure = open.error ?? reveal.error ?? remove.error

  const actions = outputActions({
    asset,
    onAddTo: () => setAddToOpen(true),
    // ⛔ Seeds a new node's prompt beside this one. It submits nothing.
    onBranch:
      surface && generation ? () => surface.branch(node, generation) : undefined,
    onCompare: () => setCompareOpen(true),
    onOpen: () => open.mutate(asset.id),
    onReveal: () => reveal.mutate(asset.id),
    onDetails: () => setDetailsOpen(true),
    onRemove: containerId
      ? () => remove.mutate({ containerId, assetId: asset.id })
      : undefined,
    canCompare: siblings.length > 0,
  }).filter((action) => action.id !== "reference")

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <button
              type="button"
              onClick={onPick}
              aria-pressed={picked}
              aria-label={picked ? "The pick" : "Make this the pick"}
              data-testid={`canvas-tile-${asset.id}`}
              className={cn(
                "nodrag relative h-full w-full overflow-hidden rounded-md bg-muted",
                picked
                  ? "ring-2 ring-primary ring-offset-1 ring-offset-background"
                  : "opacity-80 hover:opacity-100"
              )}
            />
          }
        >
          <AssetTile asset={asset} className="h-full w-full" />
          {picked ? (
            <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
              <HugeiconsIcon icon={Tick02Icon} className="size-3" />
            </span>
          ) : null}
        </ContextMenuTrigger>

        <ContextMenuContent>
          <OutputActionMenuItems actions={actions} />
        </ContextMenuContent>
      </ContextMenu>

      {failure ? (
        <p role="alert" className="text-[11px] text-destructive">
          {failure.message}
        </p>
      ) : null}

      <AddToContainerDialog
        asset={asset}
        open={addToOpen}
        onOpenChange={setAddToOpen}
      />

      {compareOpen ? (
        <CompareView
          left={asset}
          candidates={siblings}
          open={compareOpen}
          onOpenChange={setCompareOpen}
        />
      ) : null}

      {asset.generationId ? (
        <RunDetailsPanel
          generationId={asset.generationId}
          node={node}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      ) : null}
    </>
  )
}

export function GenerateNodeBody({ node }: { node: CanvasNodeDto }) {
  const surface = useCanvasSurface()
  /**
   * Which container's rows this node reads its siblings and outputs from.
   *
   * The node's own run answers it when there is one. There often is not: a
   * batch of siblings has no single `generationId` to resolve, and pruning a
   * run nulls the one a node did have. Falling back to the container the
   * workspace is pointed at is what keeps a batch node showing its tiles
   * instead of going blank — the tiles are then narrowed to this node's own
   * batch by `batchTiles`, so a wider page never leaks another run in.
   */
  const containerId =
    node.generation?.containerId ?? surface?.containerId ?? null
  const generations = useGenerations(containerId, { limit: PAGE_SIZE })
  const assets = useAssets(containerId, { limit: PAGE_SIZE })
  const jobs = useJobs()
  const pick = usePickCanvasNode()

  const tiles = batchTiles({
    node,
    generations: generations.data?.items ?? [],
    assets: assets.data?.items ?? [],
    jobs: jobs.data ?? [],
  })
  const progress = batchProgress(tiles)

  /**
   * The first successful output becomes the pick, once, as a default.
   *
   * ⛔ Deliberately *not* on the undo stack: it is not something the user did,
   * so there is nothing of theirs to take back, and putting it there would
   * make their next undo swallow a choice they never made. Every later change
   * of pick is theirs and is recorded.
   */
  // Keyed on the *id*, not the row: a refetch hands back an equal object with
  // a new identity, and an effect that watched the object would ask for the
  // same default pick again on every one.
  const firstOutputId =
    tiles.find((tile) => tile.state === "succeeded" && tile.asset)?.asset?.id ??
    null
  const pickMutate = pick.mutate
  useEffect(() => {
    if (node.pickAssetId !== null) return
    if (firstOutputId === null) return
    pickMutate({ id: node.id, assetId: firstOutputId })
  }, [node.id, node.pickAssetId, firstOutputId, pickMutate])

  const choose = (assetId: string) => {
    if (surface) {
      surface.pick(node, assetId)
      return
    }
    pick.mutate({ id: node.id, assetId })
  }

  if (tiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted-foreground">
        Nothing yet. Select this node and describe what you want in the bar
        below.
      </div>
    )
  }

  if (progress.active === tiles.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <ProgressRing fraction={progress.fraction} label="Run progress" />
      </div>
    )
  }

  const outputs = tiles.flatMap((tile) => (tile.asset ? [tile.asset] : []))
  const hasOutputs = outputs.length > 0
  // The rows the tiles were built from, so a tile's "Branch from this" has the
  // run in hand rather than opening a query of its own per tile.
  const runs = new Map(
    (generations.data?.items ?? []).map((run) => [run.id, run])
  )
  // Null, or pointing at an asset that is no longer one of the tiles — a pick
  // whose row was deleted is nulled by the foreign key, and either way the
  // node does not quietly fall back to another tile.
  const pickIsResolved = tiles.some(
    (tile) => tile.asset !== null && tile.asset.id === node.pickAssetId
  )
  /**
   * As square a grid as the batch allows, capped at four across.
   *
   * A hard cap of two columns turned a batch of 16 — which `MAX_BATCH` allows
   * — into an eight-row scroll inside a node the size of a postcard.
   */
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(tiles.length))))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="nowheel grid min-h-0 flex-1 gap-1 overflow-auto p-1"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {tiles.map((tile) =>
          tile.asset ? (
            <ResultTile
              key={tile.id}
              asset={tile.asset}
              siblings={outputs.filter((one) => one.id !== tile.asset!.id)}
              generation={runs.get(tile.generationId) ?? null}
              containerId={containerId}
              node={node}
              picked={node.pickAssetId === tile.asset.id}
              onPick={() => choose(tile.asset!.id)}
            />
          ) : tile.state === "failed" || tile.state === "canceled" ? (
            <FailedTile key={tile.id} tile={tile} />
          ) : (
            <PendingTile key={tile.id} tile={tile} />
          )
        )}
      </div>

      {hasOutputs && !pickIsResolved ? (
        <p
          role="status"
          className="shrink-0 border-t px-2 py-1 text-[11px] text-muted-foreground"
        >
          No pick selected. Choose which result downstream nodes should use.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The way into everything a run recorded: its parameters, its provider
 * response, its cost and its lineage.
 *
 * The board used to open this from a card menu. The canvas opens it from the
 * node's own header, because the node *is* the run — one button, and only once
 * the node has a generation to describe. ⛔ Read-only: the panel quotes what
 * already happened and submits nothing.
 */
export function DetailsAction({
  generationId,
  node,
}: {
  generationId: string
  node: CanvasNodeDto
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label="Run details"
        className="nodrag nopan size-5"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={InformationCircleIcon} className="size-3.5" />
      </Button>
      <RunDetailsPanel
        generationId={generationId}
        node={node}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

/** `image_gen` / `video_gen` as the header reads them, plus the model it ran. */
function GenerateNodeTitle({ node }: { node: CanvasNodeDto }) {
  const modelKey = node.generation ? modelKeyOf(node.generation) : null
  const model = useModel(modelKey)
  const kind = node.type === "video_gen" ? "Video" : "Image"
  return <>{model.data?.name ?? node.generation?.modelSlug ?? kind}</>
}

export function GenerateNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.node
  return (
    <NodeFrame
      node={node}
      selected={selected === true}
      title={<GenerateNodeTitle node={node} />}
      actions={
        node.generationId ? (
          <DetailsAction generationId={node.generationId} node={node} />
        ) : null
      }
    >
      <GenerateNodeBody node={node} />
    </NodeFrame>
  )
}
