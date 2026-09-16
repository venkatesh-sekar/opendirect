"use client"

/**
 * Choosing which assets fill a reference slot.
 *
 * This is where the product's firmest rule shows up in the interface: when a
 * container holds more assets than the model takes, OpenDirect does not take
 * the first N. It opens this dialog with **nothing selected** and asks. The
 * count in the confirm button is the only thing that moves as you pick, and
 * the button stays disabled until the selection is within the model's limit.
 *
 * The "✨ Suggest" button is deliberately inert here. The local `claude` /
 * `codex` helpers exist now (`components/ai/`), but ranking references is not
 * one of the four — a helper that chose *which* assets to spend money on is a
 * bigger promise than describing one, and it is on the roadmap rather than in
 * the build. Until it exists the button is disabled and says so.
 */
import { useState } from "react"
import type { AssetDto, ReferenceSlot } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { referenceLimitMessage } from "@/lib/create/references"

export interface ReferencePickerProps {
  open: boolean
  slot: ReferenceSlot
  /** How many assets the slot can hold. */
  capacity: number | null
  /** Everything on offer, already resolved to assets. */
  assets: AssetDto[]
  /** What was already chosen for this slot; never anything newly dropped. */
  initialSelection: string[]
  /** The container the assets came from, when the drop had one. */
  sourceLabel: string | null
  onConfirm: (assetIds: string[]) => void
  onCancel: () => void
}

function thumbnail(asset: AssetDto): string | null {
  return asset.thumbnailUrl ?? (asset.kind === "image" ? asset.url : null)
}

export function ReferencePicker({
  open,
  slot,
  capacity,
  assets,
  initialSelection,
  sourceLabel,
  onConfirm,
  onCancel,
}: ReferencePickerProps) {
  /**
   * Seeded once, because the dialog is mounted only while it is open and is
   * keyed by slot — so every raise starts from what that slot actually holds.
   * A selection carried over from a previous drop would be a quiet auto-pick.
   */
  const [selected, setSelected] = useState<string[]>(initialSelection)

  const overCapacity = capacity !== null && selected.length > capacity
  const atCapacity = capacity !== null && selected.length >= capacity

  function toggle(assetId: string) {
    setSelected((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId]
    )
  }

  const heading =
    capacity === null
      ? `${assets.length} asset${assets.length === 1 ? "" : "s"}. ${slot.label} has no limit.`
      : referenceLimitMessage({
          sourceLabel,
          total: assets.length,
          capacity,
        })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select references</DialogTitle>
          <DialogDescription>
            {heading} Choose the ones to send as {slot.label}.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[22rem]">
          <ul
            role="listbox"
            aria-multiselectable
            aria-label={`Assets for ${slot.label}`}
            className="grid grid-cols-4 gap-2 p-0.5 sm:grid-cols-6"
          >
            {assets.map((asset) => {
              const chosen = selected.includes(asset.id)
              const order = selected.indexOf(asset.id) + 1
              const preview = thumbnail(asset)
              const label = asset.label ?? asset.originalName ?? asset.kind
              return (
                <li key={asset.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={chosen}
                    aria-label={label}
                    disabled={!chosen && atCapacity}
                    onClick={() => toggle(asset.id)}
                    className={cn(
                      "relative aspect-square w-full overflow-hidden rounded-md bg-muted outline-none",
                      "ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                      chosen && "ring-2 ring-primary",
                      !chosen && atCapacity && "opacity-40"
                    )}
                  >
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center px-1 text-center text-[0.65rem] text-muted-foreground">
                        {label}
                      </span>
                    )}
                    {chosen ? (
                      <span className="absolute top-1 left-1 flex size-5 items-center justify-center rounded-full bg-primary font-mono text-[0.65rem] text-primary-foreground tabular-nums">
                        {order}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>

        <DialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span
              data-testid="reference-selection-count"
              className={cn(
                "font-mono text-xs tabular-nums",
                overCapacity ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {capacity === null
                ? `${selected.length} selected`
                : `${selected.length} of ${capacity} selected`}
            </span>
            {capacity !== null ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button type="button" variant="ghost" size="sm" disabled />
                  }
                >
                  ✨ Suggest {capacity}
                </TooltipTrigger>
                <TooltipContent>
                  Suggestions need the local Claude or Codex helper, which
                  OpenDirect does not have yet.
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              disabled={selected.length === 0 || overCapacity}
              onClick={() => onConfirm(selected)}
            >
              {selected.length === 0
                ? "Use references"
                : `Use ${selected.length} reference${selected.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
