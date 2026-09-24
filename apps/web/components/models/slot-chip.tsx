"use client"

/**
 * One reference slot, drawn the same way everywhere a slot appears: the
 * Models settings tab, the mapping editor's preview, the model picker and
 * the canvas node (design §1–2).
 *
 * Left to right: the role's icon, the slot's own label, the media kind the
 * slot enforces, "×max" when it takes several, a dot when the endpoint
 * requires it, and "unverified" when a name guess rather than a mapping set
 * the role. When the endpoint choice says the slot cannot be filled right
 * now (`availability.available === false`), it is dimmed and says why.
 *
 * Anything a tooltip says is also in the accessible name or description, and
 * the chip takes keyboard focus whenever it has something to explain, so
 * nothing here is hover-only.
 */
import { useId } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReferenceSlot, SlotAvailability } from "@opendirect/contract"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { KIND_META, roleMeta } from "@/lib/registry/role-meta"

import { UNVERIFIED_HINT } from "./role-badge"

export interface SlotChipProps {
  slot: ReferenceSlot
  /** From `slotAvailability`; omitted means the slot is usable. */
  availability?: SlotAvailability
  /**
   * Draw "×max". Off where the caller already shows a count against the max
   * (the canvas strip's "1 / 4"), so the number is not said twice.
   */
  showMax?: boolean
  className?: string
}

/** "Characters, Character, image, up to 4, required, unverified". */
function accessibleName(slot: ReferenceSlot): string {
  const role = roleMeta(slot.role)
  const parts = [slot.label]
  if (role.label !== slot.label) parts.push(role.label)
  parts.push(KIND_META[slot.kind].label.toLowerCase())
  if (slot.multiple) {
    parts.push(slot.max !== null ? `up to ${slot.max}` : "several")
  }
  if (slot.required) parts.push("required")
  if (!slot.verified) parts.push("unverified")
  return parts.join(", ")
}

export function SlotChip({
  slot,
  availability,
  showMax = true,
  className,
}: SlotChipProps) {
  const role = roleMeta(slot.role)
  const kind = KIND_META[slot.kind]
  const describedBy = useId()
  const unavailable = availability?.available === false
  const reason = unavailable
    ? (availability?.reason ?? "This slot cannot be filled right now.")
    : null
  const explanation = [reason, slot.verified ? null : UNVERIFIED_HINT]
    .filter((line): line is string => line !== null)
    .join(" ")

  const chip = (
    <span
      data-testid="slot-chip"
      data-role={role.role}
      role="group"
      aria-label={accessibleName(slot)}
      aria-disabled={unavailable ? true : undefined}
      aria-describedby={explanation ? describedBy : undefined}
      tabIndex={explanation ? 0 : undefined}
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        !slot.verified && "border-dashed",
        unavailable && "opacity-50",
        className
      )}
    >
      <HugeiconsIcon
        icon={role.icon}
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 truncate">{slot.label}</span>
      <HugeiconsIcon
        icon={kind.icon}
        className="size-3 shrink-0 text-muted-foreground"
        aria-hidden
      />
      {slot.multiple && showMax ? (
        <span
          className="shrink-0 text-muted-foreground tabular-nums"
          aria-hidden
        >
          ×{slot.max ?? "n"}
        </span>
      ) : null}
      {slot.required ? (
        <span
          data-testid="slot-required"
          title="Required"
          className="size-1.5 shrink-0 rounded-full bg-primary"
          aria-hidden
        />
      ) : null}
      {slot.verified ? null : (
        <span className="shrink-0 text-muted-foreground" aria-hidden>
          unverified
        </span>
      )}
      {explanation ? (
        <span id={describedBy} className="sr-only">
          {explanation}
        </span>
      ) : null}
    </span>
  )

  if (!explanation) return chip

  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
    </Tooltip>
  )
}
