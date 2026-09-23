"use client"

/**
 * What this node is looking at: one group per input the model declares, each
 * holding the pictures wired into it.
 *
 * On the canvas an edge *is* the reference, so this strip is a read-out of the
 * graph rather than a second place to hold a selection. Removing a thumbnail
 * deletes the edge, and the `+` creates the node the edge comes from — the
 * picker hands back assets, and each one becomes a media node placed to the
 * left of this one with an edge drawn into the chosen slot. There is no third
 * state where the bar holds a reference the canvas cannot see.
 *
 * Groups come from the model's own `referenceSlots`, never from labels we
 * invent. A group shows at most four thumbnails; past that it shows three and
 * a `+N`, and the whole slot opens as an inline gallery under the strip — not
 * a modal, because the bar is anchored to a node and must not jump. Text edges
 * are not drawn here: a note is a block in the prompt.
 *
 * Two things are drawn distinctly rather than quietly skipped: a generate node
 * with no pick, and a media node whose asset row is gone. Both block the run,
 * and `edges-to-inputs.ts` says so in a sentence; the strip shows *which*
 * thumbnail the sentence is about.
 *
 * ⛔ Nothing here submits or spends. Drawing an edge never starts a run.
 */
import { useCallback, useEffect, useId, useState } from "react"
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
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import {
  useCreateCanvasEdge,
  useCreateCanvasNode,
  useDeleteCanvasEdges,
} from "@/hooks/use-canvas"
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

import { useCanvasSurface } from "./canvas-context"

/** How many assets a container may offer the picker in one go. */
const PICKER_PAGE_SIZE = 500

/** A group with more than this many items shows three and a `+N`. */
const SHOW_ALL_UP_TO = 4

/** The gallery key for the group of edges no declared slot takes. */
export const UNASSIGNED = "__unassigned"

export interface CanvasReferenceStripProps {
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
  /**
   * The group whose gallery is open — a slot field, `"__unassigned"`, or
   * null. Held by the bar so the Full prompt panel's chips can open it too.
   */
  galleryFor: string | null
  onGalleryChange: (field: string | null) => void
  /**
   * `groupStrip` of the props above, when the caller has already computed it
   * — the bar does, for the Full prompt panel's chips. Computed here if not.
   */
  groups?: StripGroup[]
}

/** One wire into this node, as a thumbnail. */
interface EdgeItem {
  kind: "edge"
  key: string
  edgeId: string
  source: CanvasNodeDto
  /** The slot the edge feeds; null when it was drawn with none. */
  slotField: string | null
  asset: AssetDto | null
  /** Why this thumbnail cannot be used, when it cannot. */
  problem: string | null
}

/** One picture a prompt mention attaches, in the slot it resolved to. */
interface MentionItem {
  kind: "mention"
  key: string
  handle: string
  slotField: string
  thumbnailUrl: string | null
  substitution: string
}

export type StripItem = EdgeItem | MentionItem

export interface StripGroup {
  /** The slot, or null for the "Unassigned" group. */
  slot: ReferenceSlot | null
  /** Edge thumbs (wire order) then mention images — the order they are sent. */
  items: StripItem[]
  /** `slotCapacity(slot)`; null = unlimited or unknown. */
  capacity: number | null
  /** `remainingCapacity(...) === 0`. */
  full: boolean
}

/** One entry per incoming media or generate edge, in the order drawn. */
function readEdges(
  node: CanvasNodeDto,
  canvas: CanvasDto,
  declared: ReadonlySet<string>
): EdgeItem[] {
  const byId = new Map(canvas.nodes.map((one) => [one.id, one]))
  const out: EdgeItem[] = []
  for (const edge of incomingEdges(canvas.edges, node.id)) {
    const source = byId.get(edge.sourceNodeId)
    // A note is a block in the prompt, not a picture.
    if (!source || source.type === "text") continue
    const assetId =
      source.type === "media" ? source.assetId : source.pickAssetId
    const problem =
      assetId === null
        ? source.type === "media"
          ? "No asset"
          : "No pick"
        : edge.slotField === null
          ? "No slot"
          : // `edgesToInputs` blocks the run on it, so the strip says which.
            !declared.has(edge.slotField)
            ? "Unknown input"
            : null
    out.push({
      kind: "edge",
      key: edge.id,
      edgeId: edge.id,
      source,
      slotField: edge.slotField,
      asset: assetId ? source.asset : null,
      problem,
    })
  }
  return out
}

/**
 * The strip's groups: one per declared slot, in the model's order, then
 * "Unassigned" when some edge has no slot or one the model does not declare.
 * Mention pictures follow the wires in their slot, as they are sent.
 */
export function groupStrip(
  node: CanvasNodeDto,
  canvas: CanvasDto,
  slots: readonly ReferenceSlot[],
  mentions: readonly MentionOutcome[]
): StripGroup[] {
  const declared = new Set(slots.map((slot) => slot.field))
  const edges = readEdges(node, canvas, declared)
  const images = mentions.filter(isMentionImage).flatMap((outcome) =>
    outcome.assetIds.map((assetId, index): MentionItem => ({
      kind: "mention",
      key: `mention-${outcome.handle}-${assetId}`,
      handle: outcome.handle,
      slotField: outcome.slotField,
      thumbnailUrl: outcome.thumbnailUrls[index] ?? null,
      substitution: outcome.substitution,
    }))
  )

  const groups: StripGroup[] = slots.map((slot) => {
    const items: StripItem[] = [
      ...edges.filter((item) => item.slotField === slot.field),
      ...images.filter((item) => item.slotField === slot.field),
    ]
    return {
      slot,
      items,
      capacity: slotCapacity(slot),
      full:
        remainingCapacity(
          slot,
          items.map((item) => item.key)
        ) === 0,
    }
  })

  const unassigned = edges.filter(
    (item) => item.slotField === null || !declared.has(item.slotField)
  )
  if (unassigned.length > 0) {
    groups.push({ slot: null, items: unassigned, capacity: null, full: false })
  }
  return groups
}

function thumbnailUrl(asset: AssetDto | null): string | null {
  if (!asset) return null
  return asset.thumbnailUrl ?? (asset.kind === "image" ? asset.url : null)
}

function describe(item: EdgeItem): string {
  return (
    item.asset?.label ?? item.asset?.originalName ?? item.problem ?? "Reference"
  )
}

function groupKey(group: StripGroup): string {
  return group.slot?.field ?? UNASSIGNED
}

function groupLabel(group: StripGroup): string {
  return group.slot?.label ?? "Unassigned"
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

/** The picture a thumbnail draws, or the words when there is none. */
function ItemFace({ item }: { item: StripItem }) {
  if (item.kind === "mention") {
    // The picture the run will actually send, with the handle over it so the
    // strip still says where it came from.
    return item.thumbnailUrl ? (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbnailUrl}
          alt={`@${item.handle}`}
          className="size-full object-cover"
        />
        <span className="absolute inset-x-0 bottom-0 truncate bg-background/80 px-0.5 text-[0.55rem] text-foreground">
          @{item.handle}
        </span>
      </>
    ) : (
      <span className="line-clamp-3 px-0.5">@{item.handle}</span>
    )
  }
  const preview = thumbnailUrl(item.asset)
  const label = describe(item)
  return preview ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={preview} alt={label} className="size-full object-cover" />
  ) : (
    <span className="line-clamp-3 px-0.5">{item.problem ?? label}</span>
  )
}

/** The ring that says what a thumbnail is: a problem, a mention, or a wire. */
function ringOf(item: StripItem): string {
  if (item.kind === "mention") {
    return "ring-dashed text-muted-foreground ring-primary/60"
  }
  return item.problem
    ? "ring-dashed text-destructive ring-destructive/60"
    : "text-muted-foreground ring-border"
}

function titleOf(item: StripItem, slots: readonly ReferenceSlot[]): string {
  if (item.kind === "mention") {
    return `@${item.handle} → ${slotLabel(item.slotField, slots)} — ${item.substitution}`
  }
  return `${item.slotField ?? "No slot"} — ${describe(item)}`
}

function countLabel(count: number): string {
  return `${count} ${count === 1 ? "image" : "images"}`
}

export function CanvasReferenceStrip({
  node,
  canvas,
  slots,
  containerId,
  onNotice,
  mentions = [],
  galleryFor,
  onGalleryChange,
  groups: given,
}: CanvasReferenceStripProps) {
  const client = useQueryClient()
  const surface = useCanvasSurface()
  const deleteEdges = useDeleteCanvasEdges()
  const createNode = useCreateCanvasNode()
  const createEdge = useCreateCanvasEdge()
  const [picker, setPicker] = useState<{
    slot: ReferenceSlot
    assets: AssetDto[]
    capacity: number | null
  } | null>(null)

  const groups = given ?? groupStrip(node, canvas, slots, mentions)
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const headed = slots.length > 1 || groups.some((group) => !group.slot)
  const gallery = groups.find((group) => groupKey(group) === galleryFor)

  // A gallery whose group is gone — its wires deleted, the model switched —
  // closes for good, rather than springing open when the group comes back.
  const stale = galleryFor !== null && !gallery
  useEffect(() => {
    if (stale) onGalleryChange(null)
  }, [stale, onGalleryChange])

  const notify = useCallback(
    (message: string) => onNotice?.(message),
    [onNotice]
  )

  /**
   * On a canvas the ✕ is the canvas's own undoable edge delete; a strip
   * rendered on its own (a test, a preview) deletes the edge directly.
   */
  const disconnect = (edgeId: string) => {
    if (surface?.disconnectEdges) surface.disconnectEdges([edgeId])
    else deleteEdges.mutate([edgeId])
  }

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
    // `nokey`: React Flow listens for Delete, Backspace and Space on the whole
    // document. A key meant for a thumbnail or the gallery must never delete
    // or pan the canvas behind it.
    <div
      data-testid="canvas-reference-strip"
      className="nokey flex min-w-0 shrink-0 flex-col gap-2"
    >
      <div className="flex items-end gap-3">
        <ul className="flex flex-wrap items-end gap-3">
          {groups.map((group) => {
            const key = groupKey(group)
            const label = groupLabel(group)
            const count = group.items.length
            const shown =
              count <= SHOW_ALL_UP_TO
                ? group.items
                : group.items.slice(0, SHOW_ALL_UP_TO - 1)
            const hidden = count - shown.length
            return (
              <li
                key={key}
                data-testid="strip-group"
                data-slot={key}
                className="flex flex-col gap-1"
              >
                {headed ? (
                  <div className="flex items-baseline gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                    {group.capacity !== null ? (
                      <>
                        <span>{label}</span>
                        <span className="font-mono tabular-nums">
                          {`${count} / ${group.capacity}`}
                        </span>
                      </>
                    ) : (
                      <span>{`${label} ${count}`}</span>
                    )}
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5">
                  {shown.map((item) => (
                    <StripThumb
                      key={item.key}
                      item={item}
                      slots={slots}
                      galleryLabel={label}
                      onOpen={() => onGalleryChange(key)}
                      onDisconnect={disconnect}
                    />
                  ))}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      aria-label={`Show all ${count} ${label}`}
                      onClick={() => onGalleryChange(key)}
                      className="h-10 min-w-12 rounded-md border bg-muted px-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      +{hidden}
                    </button>
                  ) : null}
                  {/* Unheaded, the count only earns its place once it is
                      the reason the + is off. */}
                  {!headed && group.full ? (
                    <span className="font-mono text-[10px] font-semibold text-muted-foreground tabular-nums">
                      {`${count} / ${group.capacity}`}
                    </span>
                  ) : null}
                  {group.slot ? (
                    <AddButton
                      slot={group.slot}
                      full={group.full}
                      capacity={group.capacity}
                      onAdd={browse}
                    />
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
        {total > 0 ? (
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
            {countLabel(total)}
          </span>
        ) : null}
      </div>

      {gallery ? (
        <StripGallery
          group={gallery}
          slots={slots}
          onDone={() => onGalleryChange(null)}
        />
      ) : null}

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

/** One thumbnail: a click opens its group's gallery; a wire's ✕ deletes it. */
function StripThumb({
  item,
  slots,
  galleryLabel,
  onOpen,
  onDisconnect,
}: {
  item: StripItem
  slots: readonly ReferenceSlot[]
  galleryLabel: string
  onOpen: () => void
  onDisconnect: (edgeId: string) => void
}) {
  const name = item.kind === "mention" ? `@${item.handle}` : describe(item)
  return (
    <div className="group relative">
      <button
        type="button"
        data-testid={
          item.kind === "mention" ? "mention-thumb" : "reference-thumb"
        }
        data-edge-id={item.kind === "edge" ? item.edgeId : undefined}
        data-handle={item.kind === "mention" ? item.handle : undefined}
        data-slot={item.slotField ?? ""}
        data-problem={
          item.kind === "edge" ? (item.problem ?? undefined) : undefined
        }
        aria-label={`Open ${galleryLabel} gallery at ${name}`}
        title={titleOf(item, slots)}
        onClick={onOpen}
        className={cn(
          "relative flex size-10 items-center justify-center overflow-hidden rounded-md bg-muted text-center text-[0.6rem] leading-tight ring-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          ringOf(item)
        )}
      >
        <ItemFace item={item} />
      </button>
      {/*
        A mention has no ✕: it is removed by deleting `@venkz` from the
        prompt, which is where it came from.
      */}
      {item.kind === "edge" ? (
        <button
          type="button"
          aria-label={`Disconnect ${name}`}
          onClick={() => onDisconnect(item.edgeId)}
          className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * A slot's `+`. When the slot is full it stays in place, disabled, and says
 * why — a disabled button fires no pointer or focus events, so the tooltip
 * hangs off a focusable span around it, and the button carries the reason as
 * its description for a screen reader.
 */
function AddButton({
  slot,
  full,
  capacity,
  onAdd,
}: {
  slot: ReferenceSlot
  full: boolean
  capacity: number | null
  onAdd: (slot: ReferenceSlot) => void
}) {
  const reasonId = useId()
  const reason = `${slot.label} is full (${capacity} / ${capacity})`
  const button = (
    <button
      type="button"
      disabled={full}
      aria-describedby={full ? reasonId : undefined}
      aria-label={`Add references to ${slot.label}`}
      onClick={() => onAdd(slot)}
      className={cn(
        "flex size-10 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors",
        full
          ? "cursor-not-allowed opacity-40"
          : "hover:border-primary hover:text-foreground"
      )}
    >
      <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
    </button>
  )
  if (!full) return button
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            data-testid="add-full-wrapper"
            className="inline-flex rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        {button}
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Every picture in one group, numbered in the order it is sent. Inline under
 * the strip rather than a dialog: the bar is anchored to a node, and a modal
 * would take the canvas away while the user is reading what feeds it.
 */
function StripGallery({
  group,
  slots,
  onDone,
}: {
  group: StripGroup
  slots: readonly ReferenceSlot[]
  onDone: () => void
}) {
  const label = groupLabel(group)
  return (
    <section
      aria-label={`${label} gallery`}
      className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5"
    >
      <header className="flex items-center gap-2 text-xs">
        <strong className="font-medium">{label}</strong>
        <span className="text-muted-foreground">
          {`· ${group.items.length} · `}
          {group.slot ? (
            <>
              sent as <span className="font-mono">{group.slot.field}</span>
            </>
          ) : (
            "not sent until each wire has an input"
          )}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          onClick={onDone}
        >
          Done
        </Button>
      </header>
      <ol className="grid max-h-52 grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1 overflow-auto">
        {group.items.map((item, index) => (
          <li
            key={item.key}
            data-testid="gallery-item"
            title={titleOf(item, slots)}
            className={cn(
              "relative flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted text-center text-[0.6rem] leading-tight ring-1",
              ringOf(item)
            )}
          >
            <ItemFace item={item} />
            <span className="absolute top-0 left-0 rounded-br bg-background/80 px-1 font-mono text-[0.55rem] text-foreground tabular-nums">
              {index + 1}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
