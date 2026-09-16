"use client"

/**
 * What this node is looking at: one thumbnail per incoming edge, labelled
 * with the slot it feeds.
 *
 * On the canvas an edge *is* the reference, so this tray is a read-out of the
 * graph rather than a second place to hold a selection. Removing a thumbnail
 * deletes the edge, and the `+` creates the node the edge comes from — the
 * picker hands back assets, and each one becomes a media node placed to the
 * left of this one with an edge drawn into the chosen slot. There is no third
 * state where the bar holds a reference the canvas cannot see.
 *
 * Two things are drawn distinctly rather than quietly skipped: a generate node
 * with no pick, and a media node whose asset row is gone. Both block the run,
 * and `edges-to-inputs.ts` says so in a sentence; the tray shows *which*
 * thumbnail the sentence is about.
 *
 * ⛔ Nothing here submits or spends. Drawing an edge never starts a run.
 */
import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import type {
  AssetDto,
  AssetPage,
  CanvasDto,
  CanvasNodeDto,
  ReferenceSlot,
} from "@opendirect/contract"
import { cn } from "@workspace/ui/lib/utils"

import { useCreateCanvasEdge, useCreateCanvasNode } from "@/hooks/use-canvas"
import { useDeleteCanvasEdges } from "@/hooks/use-canvas"
import { queryKeys } from "@/hooks/query-keys"
import { incomingEdges } from "@/lib/canvas/edges-to-inputs"
import {
  aspectRatioOf,
  defaultNodeSize,
  spawnPosition,
  type Box,
} from "@/lib/canvas/layout"
import { slotLabel } from "@/lib/canvas/slots"
import { remainingCapacity, slotCapacity } from "@/lib/create/references"
import { invoke } from "@/lib/ipc"

import type { MentionOutcome } from "@/lib/mentions/resolve"

import { ReferencePicker } from "@/components/create/reference-picker"

/** How many assets a container may offer the picker in one go. */
const PICKER_PAGE_SIZE = 500

export interface ReferenceTrayProps {
  /** The generate node the bar belongs to. */
  node: CanvasNodeDto
  canvas: CanvasDto
  /** The chosen model's own slots — `descriptor.referenceSlots`. */
  slots: readonly ReferenceSlot[]
  /** Where the picker's assets come from; no container means no `+`. */
  containerId: string | null
  /** Says something the bar shows — a fetch that failed, a slot that is full. */
  onNotice?: (message: string) => void
  /**
   * What the prompt's mentions will contribute to *this* run. Read-only: a
   * mention is removed by deleting `@venkz` from the prompt, which is where it
   * came from.
   */
  mentions?: readonly MentionOutcome[]
}

interface Thumb {
  edgeId: string
  source: CanvasNodeDto
  /** The slot the edge feeds, or null for a text edge. */
  slotField: string | null
  asset: AssetDto | null
  /** Why this thumbnail cannot be used, when it cannot. */
  problem: string | null
}

function thumbnailUrl(asset: AssetDto | null): string | null {
  if (!asset) return null
  return asset.thumbnailUrl ?? (asset.kind === "image" ? asset.url : null)
}

function labelOf(thumb: Thumb): string {
  if (thumb.source.type === "text") return "Prompt"
  return thumb.slotField ?? "No slot"
}

function describe(thumb: Thumb): string {
  if (thumb.source.type === "text") return thumb.source.text ?? "Empty note"
  return (
    thumb.asset?.label ??
    thumb.asset?.originalName ??
    thumb.problem ??
    "Reference"
  )
}

/** One entry per incoming edge, in the order the user drew them. */
function readTray(node: CanvasNodeDto, canvas: CanvasDto): Thumb[] {
  const byId = new Map(canvas.nodes.map((one) => [one.id, one]))
  const out: Thumb[] = []
  for (const edge of incomingEdges(canvas.edges, node.id)) {
    const source = byId.get(edge.sourceNodeId)
    if (!source) continue
    if (source.type === "text") {
      out.push({
        edgeId: edge.id,
        source,
        slotField: null,
        asset: null,
        problem: null,
      })
      continue
    }
    const assetId =
      source.type === "media" ? source.assetId : source.pickAssetId
    const problem =
      assetId === null
        ? source.type === "media"
          ? "No asset"
          : "No pick"
        : edge.slotField === null
          ? "No slot"
          : null
    out.push({
      edgeId: edge.id,
      source,
      slotField: edge.slotField,
      asset: assetId ? source.asset : null,
      problem,
    })
  }
  return out
}

/** An attached mention, narrowed so its slot and assets are readable. */
type MentionImage = Extract<MentionOutcome, { kind: "image" }>

function isMentionImage(outcome: MentionOutcome): outcome is MentionImage {
  return outcome.kind === "image"
}

/**
 * Why a mention will be prose rather than a picture, in the user's words.
 *
 * Shown *before* the run, because the whole point of resolving in the renderer
 * is that the plan is visible while it is still free to change.
 */
export function mentionNote(outcome: MentionOutcome): string {
  if (outcome.kind === "unresolved") {
    return `@${outcome.handle} → no character or scene with that handle`
  }
  if (outcome.kind === "image") return ""
  const because =
    outcome.reason === "no-image-slot"
      ? "this model has no image input"
      : outcome.reason === "slots-full"
        ? "the image slots are already wired"
        : "no reference image yet"
  return `@${outcome.handle} → text only (${because})`
}

/**
 * The tray's notes, rendered *below* the bar's control row rather than inside
 * it.
 *
 * The bar is anchored to a node by its top edge, so a line appearing beside
 * the thumbnails would push every control sideways as the user types. Below
 * the row the bar grows downward into empty canvas and nothing moves.
 */
export function MentionNotes({
  mentions,
}: {
  mentions: readonly MentionOutcome[]
}) {
  const notes = mentions.filter((outcome) => outcome.kind !== "image")
  if (notes.length === 0) return null
  return (
    <ul className="px-1">
      {notes.map((outcome) => (
        <li
          key={outcome.handle}
          data-testid="mention-note"
          data-handle={outcome.handle}
          className={cn(
            "text-xs",
            outcome.kind === "unresolved"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {mentionNote(outcome)}
        </li>
      ))}
    </ul>
  )
}

export function ReferenceTray({
  node,
  canvas,
  slots,
  containerId,
  onNotice,
  mentions = [],
}: ReferenceTrayProps) {
  const client = useQueryClient()
  const deleteEdges = useDeleteCanvasEdges()
  const createNode = useCreateCanvasNode()
  const createEdge = useCreateCanvasEdge()
  const [picker, setPicker] = useState<{
    slot: ReferenceSlot
    assets: AssetDto[]
    capacity: number | null
  } | null>(null)

  const thumbs = readTray(node, canvas)
  const notify = useCallback(
    (message: string) => onNotice?.(message),
    [onNotice]
  )

  const browse = useCallback(
    (slot: ReferenceSlot) => {
      if (!containerId) {
        notify("Open a container to choose references from it.")
        return
      }
      void client
        .fetchQuery<AssetPage>({
          queryKey: queryKeys.assets.byContainer(containerId, {
            limit: PICKER_PAGE_SIZE,
          }),
          queryFn: () =>
            invoke("assets:list", { containerId, limit: PICKER_PAGE_SIZE }),
        })
        .then((page) => {
          const usable = page.items.filter(
            (asset) => asset.kind !== "text" && asset.kind !== "prompt"
          )
          setPicker({ slot, assets: usable, capacity: slotCapacity(slot) })
        })
        .catch(() => notify("That container could not be read."))
    },
    [client, containerId, notify]
  )

  /**
   * The picked assets become nodes, then edges. Each one is placed to the left
   * of this node and out of everything already on the canvas, so a reference
   * never lands underneath the frame that uses it.
   */
  const confirm = useCallback(
    (slot: ReferenceSlot, assetIds: string[]) => {
      setPicker(null)
      if (assetIds.length === 0) return

      const origin: Box = {
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      }
      const occupied: Box[] = canvas.nodes.map((one) => ({
        x: one.x,
        y: one.y,
        width: one.width,
        height: one.height,
      }))
      const byId = new Map(canvas.nodes.map((one) => [one.id, one]))
      const known = new Map<string, AssetDto>(
        (picker?.assets ?? []).map((asset) => [asset.id, asset])
      )

      const run = async () => {
        for (const assetId of assetIds) {
          const asset = known.get(assetId) ?? byId.get(assetId)?.asset ?? null
          const size = defaultNodeSize(
            "media",
            aspectRatioOf(asset?.width, asset?.height)
          )
          const at = spawnPosition({
            origin,
            direction: "left",
            size,
            occupied,
          })
          occupied.push({ ...at, ...size })
          const created = await createNode.mutateAsync({
            type: "media",
            ...at,
            ...size,
            assetId,
          })
          await createEdge.mutateAsync({
            sourceNodeId: created.id,
            targetNodeId: node.id,
            slotField: slot.field,
          })
        }
      }

      void run().catch(() =>
        notify("That reference could not be added to the canvas.")
      )
    },
    [canvas.nodes, createEdge, createNode, node, notify, picker]
  )

  return (
    <div
      data-testid="canvas-reference-tray"
      className="flex shrink-0 items-center gap-1.5"
    >
      <ul className="flex items-center gap-1.5">
        {thumbs.map((thumb) => {
          const preview = thumbnailUrl(thumb.asset)
          const label = describe(thumb)
          return (
            <li key={thumb.edgeId} className="group relative">
              <span
                data-testid="reference-thumb"
                data-edge-id={thumb.edgeId}
                data-slot={thumb.slotField ?? ""}
                data-problem={thumb.problem ?? undefined}
                title={`${labelOf(thumb)} — ${label}`}
                className={cn(
                  "flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted text-center text-[0.6rem] leading-tight ring-1",
                  thumb.problem
                    ? "ring-dashed text-destructive ring-destructive/60"
                    : "text-muted-foreground ring-border"
                )}
              >
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt={label}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="line-clamp-3 px-0.5">
                    {thumb.problem ?? label}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block max-w-10 truncate text-center text-[0.6rem] text-muted-foreground">
                {labelOf(thumb)}
              </span>
              <button
                type="button"
                aria-label={`Disconnect ${labelOf(thumb)}`}
                onClick={() => deleteEdges.mutate([thumb.edgeId])}
                className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100"
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
              </button>
            </li>
          )
        })}

        {/*
          What the prompt is contributing. A dashed ring and an `@handle` badge
          say it came from the words rather than from a wire, and there is no ✕
          — it is removed by deleting `@venkz` from the prompt.
        */}
        {mentions.filter(isMentionImage).map((outcome) => {
          const preview =
            outcome.thumbnailUrls.find((url) => url !== null) ?? null
          return (
            <li key={`mention-${outcome.handle}`} className="relative">
              <span
                data-testid="mention-thumb"
                data-handle={outcome.handle}
                data-slot={outcome.slotField}
                title={`@${outcome.handle} → ${slotLabel(outcome.slotField, slots)} — ${outcome.substitution}`}
                className="ring-dashed relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted text-center text-[0.6rem] leading-tight text-muted-foreground ring-1 ring-primary/60"
              >
                {/* The picture the run will actually send, with the handle over
                  it so the tray still says where it came from. */}
                {preview ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt={`@${outcome.handle}`}
                      className="size-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-0.5 text-[0.55rem] text-foreground">
                      @{outcome.handle}
                    </span>
                  </>
                ) : (
                  <span className="line-clamp-3 px-0.5">@{outcome.handle}</span>
                )}
              </span>
              <span className="mt-0.5 block max-w-10 truncate text-center text-[0.6rem] text-muted-foreground">
                {slotLabel(outcome.slotField, slots)}
              </span>
            </li>
          )
        })}

        {slots.map((slot) => {
          const chosen = thumbs.filter(
            (thumb) => thumb.slotField === slot.field
          )
          const full =
            remainingCapacity(
              slot,
              chosen.map((one) => one.edgeId)
            ) === 0
          return (
            <li key={slot.field}>
              <button
                type="button"
                disabled={full}
                aria-label={`Add references to ${slot.label}`}
                onClick={() => browse(slot)}
                className={cn(
                  "flex size-10 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors",
                  full
                    ? "cursor-not-allowed opacity-40"
                    : "hover:border-primary hover:text-foreground"
                )}
              >
                <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
              </button>
            </li>
          )
        })}
      </ul>

      {picker ? (
        <ReferencePicker
          key={picker.slot.field}
          open
          slot={picker.slot}
          capacity={picker.capacity}
          assets={picker.assets}
          // ⛔ Nothing is preselected. The assets already wired in are nodes on
          // the canvas, not a selection this dialog can take back.
          initialSelection={[]}
          sourceLabel={null}
          onConfirm={(assetIds) => confirm(picker.slot, assetIds)}
          onCancel={() => setPicker(null)}
        />
      ) : null}
    </div>
  )
}
