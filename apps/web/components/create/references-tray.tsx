"use client"

/**
 * The references row: what this run is looking at, grouped by the slot each
 * asset feeds.
 *
 * The grouping is the point. A model can take first-frame, last-frame and a
 * list of style references, and "which of these is the last frame?" is not a
 * question a flat row of thumbnails can answer — so each group carries the
 * model's own field label and its remaining capacity, and the whole row is a
 * single drop target that routes by media kind.
 *
 * Dropping is one way in; the `+` on each group opens the picker over the
 * current board, which is how a container's worth of assets gets chosen
 * explicitly.
 */
import { useDroppable } from "@dnd-kit/core"
import type { AssetDto, ReferenceSlot } from "@opendirect/contract"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { cn } from "@workspace/ui/lib/utils"

import { remainingCapacity, slotCapacity } from "@/lib/create/references"

/** Marks the tray as a drop target for `useCreation`'s drag handler. */
export interface ReferencesDropData {
  type: "references"
}

export function isReferencesDropData(
  value: unknown
): value is ReferencesDropData {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "references"
  )
}

export interface ReferencesTrayProps {
  slots: readonly ReferenceSlot[]
  selection: Readonly<Record<string, string[]>>
  /** Resolved assets for whatever is selected, keyed by id. */
  assets: ReadonlyMap<string, AssetDto>
  onRemove: (slotField: string, assetId: string) => void
  onBrowse: (slotField: string) => void
}

function thumbnail(asset: AssetDto | undefined): string | null {
  if (!asset) return null
  return asset.thumbnailUrl ?? (asset.kind === "image" ? asset.url : null)
}

function capacityLabel(slot: ReferenceSlot, chosen: string[]): string {
  const capacity = slotCapacity(slot)
  if (capacity === null) return `${chosen.length}`
  const left = remainingCapacity(slot, chosen)
  return left === 0
    ? `${chosen.length}/${capacity} · full`
    : `${chosen.length}/${capacity}`
}

export function ReferencesTray({
  slots,
  selection,
  assets,
  onRemove,
  onBrowse,
}: ReferencesTrayProps) {
  const dropData: ReferencesDropData = { type: "references" }
  const { setNodeRef, isOver } = useDroppable({
    id: "references-tray",
    data: dropData,
  })

  if (slots.length === 0) return null

  const showGroupLabels = slots.length > 1

  return (
    <div
      ref={setNodeRef}
      data-testid="references-tray"
      data-over={isOver || undefined}
      className={cn(
        "flex flex-wrap items-start gap-x-5 gap-y-2 rounded-md border border-dashed px-3 py-2 transition-colors",
        isOver ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      {slots.map((slot) => {
        const chosen = selection[slot.field] ?? []
        const full = remainingCapacity(slot, chosen) === 0
        return (
          <div key={slot.field} className="flex min-w-0 items-center gap-2">
            {showGroupLabels ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {slot.label}
                <span className="ml-1.5 font-mono tabular-nums">
                  {capacityLabel(slot, chosen)}
                </span>
              </span>
            ) : null}

            <ul className="flex flex-wrap items-center gap-1.5">
              {chosen.map((assetId) => {
                const asset = assets.get(assetId)
                const preview = thumbnail(asset)
                const label =
                  asset?.label ?? asset?.originalName ?? "Reference asset"
                return (
                  <li key={assetId} className="group relative">
                    <span
                      data-testid="reference-chip"
                      data-asset-id={assetId}
                      className="block size-9 overflow-hidden rounded-md bg-muted ring-1 ring-border"
                    >
                      {preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview}
                          alt={label}
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[0.6rem] text-muted-foreground">
                          {asset?.kind ?? "?"}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${label} from ${slot.label}`}
                      onClick={() => onRemove(slot.field, assetId)}
                      className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-background opacity-0 transition-opacity group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} className="size-2.5" />
                    </button>
                  </li>
                )
              })}

              <li>
                <button
                  type="button"
                  disabled={full}
                  aria-label={`Add references to ${slot.label}`}
                  onClick={() => onBrowse(slot.field)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md border border-dashed text-muted-foreground transition-colors",
                    full
                      ? "cursor-not-allowed opacity-40"
                      : "hover:border-primary hover:text-foreground"
                  )}
                >
                  <HugeiconsIcon icon={PlusSignIcon} className="size-4" />
                </button>
              </li>
            </ul>

            {!showGroupLabels ? (
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {capacityLabel(slot, chosen)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
