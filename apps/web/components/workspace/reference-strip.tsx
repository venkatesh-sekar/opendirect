"use client"

/**
 * "References sent to the model, in order": the container's
 * `referenceAssetIds` as numbered thumbnails, with a "+" to choose more.
 *
 * The order is the point — `@mira` sends these images in exactly this order,
 * and the first is the character sheet — so dragging a thumbnail onto another
 * moves it there, and the keyboard can do the same (Space to pick up, arrows,
 * Space to drop). Every change is saved as it is made.
 *
 * The drag has its own `DndContext`. The shell's context carries assets to
 * sidebar rows and the canvas; a reorder inside this strip is not that, and a
 * nested context keeps the two from seeing each other's drags.
 *
 * ⛔ Nothing here spends. It edits which images a later, explicit Generate
 * will send.
 */
import { useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import type { ContainerNodeDto, ReferenceSlot } from "@opendirect/contract"
import { cn } from "@workspace/ui/lib/utils"

import { useAsset, useAssets } from "@/hooks/use-assets"
import { moveReference } from "@/lib/workspace/container-page"

import { AssetTile, assetLabel } from "@/components/canvas/nodes/asset-tile"
import { ReferencePicker } from "@/components/create/reference-picker"

/** The picker asks for this many of the container's assets at once. */
const PICKER_LIMIT = 500

/** A slot shaped like the one `@mira` fills: images, as many as chosen. */
const REFERENCES_SLOT: ReferenceSlot = {
  field: "references",
  label: "references",
  kind: "image",
  multiple: true,
  max: null,
  role: "reference",
} as ReferenceSlot

function Thumb({
  assetId,
  number,
  onRemove,
  disabled,
}: {
  assetId: string
  number: number
  onRemove: () => void
  disabled?: boolean
}) {
  const asset = useAsset(assetId)
  const label = asset.data ? assetLabel(asset.data) : `reference ${number}`
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assetId, disabled })
  return (
    <li
      ref={setNodeRef}
      data-asset-id={assetId}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group relative h-20 w-16 shrink-0 overflow-hidden rounded-md bg-muted",
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      {/* The handle fills the thumbnail; the list item stays a list item. */}
      <div
        {...attributes}
        {...listeners}
        aria-label={`Reference ${number}: ${label}. Drag to reorder.`}
        className="absolute inset-0 touch-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />
      {asset.data ? (
        <div aria-hidden className="pointer-events-none size-full">
          <AssetTile asset={asset.data} className="size-full" />
        </div>
      ) : asset.isError ? (
        <span className="flex size-full items-center justify-center p-1 text-center text-[10px] text-muted-foreground">
          Missing
        </span>
      ) : null}
      <span className="pointer-events-none absolute top-1 left-1 rounded bg-background/80 px-1.5 text-[11px] font-medium">
        {number}
      </span>
      <button
        type="button"
        aria-label={`Remove ${label} from references`}
        disabled={disabled}
        onClick={onRemove}
        className="absolute top-1 right-1 flex size-5 items-center justify-center rounded bg-background/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
      </button>
    </li>
  )
}

/** The "+" tile's dialog: every image in the container, current ones chosen. */
function AddReferences({
  node,
  onConfirm,
  onCancel,
}: {
  node: ContainerNodeDto
  onConfirm: (ids: string[]) => void
  onCancel: () => void
}) {
  const assets = useAssets(node.id, { limit: PICKER_LIMIT })
  if (!assets.data) return null
  return (
    <ReferencePicker
      open
      slot={REFERENCES_SLOT}
      capacity={null}
      assets={assets.data.items.filter((asset) => asset.kind === "image")}
      initialSelection={node.referenceAssetIds ?? []}
      sourceLabel={node.name}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}

export interface ReferenceStripProps {
  node: ContainerNodeDto
  /** Writes the new list — `null` for automatic selection. */
  onChange: (assetIds: string[] | null) => void
  saving?: boolean
  label?: string
}

export function ReferenceStrip({
  node,
  onChange,
  saving,
  label = "References sent to the model, in order",
}: ReferenceStripProps) {
  const [adding, setAdding] = useState(false)
  const references = node.referenceAssetIds ?? []
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onChange(moveReference(references, String(active.id), String(over.id)))
  }

  const remove = (assetId: string) => {
    const next = references.filter((id) => id !== assetId)
    onChange(next.length > 0 ? next : null)
  }

  const headingId = `references-${node.id}`
  return (
    <div className="flex flex-col gap-2">
      <span
        id={headingId}
        className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        {label}
      </span>
      <div className="flex flex-wrap items-start gap-2">
        {references.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={references}
              strategy={horizontalListSortingStrategy}
            >
              <ol aria-labelledby={headingId} className="flex gap-2">
                {references.map((assetId, index) => (
                  <Thumb
                    key={assetId}
                    assetId={assetId}
                    number={index + 1}
                    disabled={saving}
                    onRemove={() => remove(assetId)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        ) : null}
        <button
          type="button"
          aria-label="Add reference"
          disabled={saving}
          onClick={() => setAdding(true)}
          className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
        </button>
        {references.length === 0 ? (
          <p className="max-w-56 self-center text-xs text-muted-foreground">
            None chosen, so a mention picks an image by itself. Choose some to
            fix what is sent, and in which order.
          </p>
        ) : null}
      </div>
      {adding ? (
        <AddReferences
          node={node}
          onCancel={() => setAdding(false)}
          onConfirm={(ids) => {
            setAdding(false)
            onChange(ids.length > 0 ? ids : null)
          }}
        />
      ) : null}
    </div>
  )
}
