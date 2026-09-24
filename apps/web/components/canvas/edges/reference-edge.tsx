"use client"

/**
 * An edge, and the slot it feeds.
 *
 * An edge on this canvas means one thing: "when the node on the right runs,
 * give it the node on the left." The label is the model's own input field —
 * `reference_images`, `first_frame`, `last_frame` — chosen automatically when
 * the edge is drawn (`firstFreeSlot`) and changeable from the label itself.
 *
 * Three states the label can be in, and each is the truth about a row:
 *
 * - **A slot.** The model declares it; the label shows the model's own name
 *   for it.
 * - **Unassigned.** A text edge has no slot at all, because its text is
 *   prepended to the prompt instead. So does an edge into a node that has not
 *   picked a model yet — there is nothing to ask.
 * - **Unresolved.** The edge carries a field the current model does not
 *   declare, because the model changed under it. It is shown as a problem
 *   rather than silently dropped: the stored field is the user's choice on a
 *   model they may go back to, and `edges-to-inputs.ts` blocks the run until
 *   they pick one this model has.
 *
 * The menu lists each slot with its role. On a family node, a slot the
 * current wiring rules out is disabled with the reason written under it; on
 * a concrete model whose roles are guesses, the menu offers "Map this
 * model…" in Settings → Models.
 *
 * ⛔ Re-labelling an edge writes one row. It never runs anything.
 */
import { memo, useId, useMemo, useState } from "react"
import Link from "next/link"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReferenceSlot, SlotAvailability } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

import { UNVERIFIED_HINT } from "@/components/models/role-badge"
import { useUpdateCanvasEdge } from "@/hooks/use-canvas"
import { useModel } from "@/hooks/use-models"
import {
  familyAvailability,
  isUnresolvedSlot,
  menuFilled,
  slotLabel,
  slotRoleText,
} from "@/lib/canvas/slots"
import { roleMeta } from "@/lib/registry/role-meta"

import type { CanvasFlowEdge } from "../nodes/types"

/** What a text edge, and an edge into a model-less node, reads as. */
export const UNASSIGNED_SLOT_LABEL = "No slot"

export interface EdgeSlotLabelProps {
  slotField: string | null
  slots: readonly ReferenceSlot[]
  onChange: (slotField: string | null) => void
  /** True while the target model's descriptor is still being fetched. */
  loading?: boolean
  /**
   * A family node's slot availability, judged as if this edge were not yet
   * in any slot — so the menu answers "where may this wire go?". Omitted for
   * a concrete model, whose slots are all usable (design §4.4).
   */
  availability?: Readonly<Record<string, SlotAvailability>>
  /**
   * The target's `provider:slug` when it is a concrete model. When any of its
   * slots is a guess, the menu offers to map it in Settings → Models.
   */
  mapModelKey?: string | null
}

/** The Models tab, opened on the mapping editor for `modelKey`. */
function mapHref(modelKey: string): string {
  return `/settings?tab=models&map=${encodeURIComponent(modelKey)}`
}

/**
 * The chip on the edge, and the menu behind it.
 *
 * Presentational on purpose — it is given the slots rather than fetching them,
 * so the three states above can be rendered and asserted without a viewport.
 *
 * The chip leads with the slot's role icon. A guessed role is underlined with
 * dots and says so on hover and focus; a slot the wiring rules out (a family
 * whose endpoint cannot take it) is drawn as a problem with the reason. Both
 * explanations are also the chip's accessible description, so nothing here
 * is hover-only.
 */
export function EdgeSlotLabel({
  slotField,
  slots,
  onChange,
  loading = false,
  availability,
  mapModelKey = null,
}: EdgeSlotLabelProps) {
  const [open, setOpen] = useState(false)
  const describedBy = useId()
  // A model still loading has declared nothing *yet*, which is not the same as
  // declaring nothing — so its edges do not accuse the user of a broken slot.
  const unresolved = !loading && isUnresolvedSlot(slotField, slots)
  const text =
    slotField === null ? UNASSIGNED_SLOT_LABEL : slotLabel(slotField, slots)
  const current =
    slotField === null
      ? undefined
      : slots.find((slot) => slot.field === slotField)
  const ruledOut =
    slotField !== null && availability?.[slotField]?.available === false
      ? (availability[slotField]!.reason ?? "Not available here")
      : null
  const guessed = current !== undefined && !current.verified
  const explanation = [ruledOut, guessed ? UNVERIFIED_HINT : null]
    .filter((line): line is string => line !== null)
    .join(" ")
  const problem = unresolved || ruledOut !== null
  const offerMapping =
    mapModelKey !== null && slots.some((slot) => !slot.verified)

  const trigger = (
    <PopoverTrigger
      data-testid="edge-slot-label"
      data-unresolved={unresolved || undefined}
      data-unavailable={ruledOut !== null || undefined}
      data-role={current?.role}
      data-verified={current ? String(current.verified) : undefined}
      aria-label={
        unresolved ? `Unresolved input slot: ${text}` : `Input slot: ${text}`
      }
      aria-describedby={explanation ? describedBy : undefined}
      className={cn(
        "nodrag nopan pointer-events-auto inline-flex max-w-44 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight shadow-sm",
        problem
          ? "border-destructive bg-destructive/15 text-destructive"
          : "border-border bg-popover text-popover-foreground"
      )}
    >
      {current ? (
        <HugeiconsIcon
          icon={roleMeta(current.role).icon}
          className="size-3 shrink-0 opacity-70"
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          "truncate",
          guessed && "underline decoration-dotted underline-offset-2"
        )}
      >
        {unresolved ? `${text} · unresolved` : text}
      </span>
    </PopoverTrigger>
  )

  return (
    <>
      {explanation ? (
        <span id={describedBy} className="sr-only">
          {explanation}
        </span>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        {explanation ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <PopoverContent align="center" className="w-64 gap-0 p-1">
          {slots.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {loading
                ? "Reading the model's inputs…"
                : "This node has no model yet, so it declares no input slots."}
            </p>
          ) : (
            slots.map((slot) => (
              <SlotMenuItem
                key={slot.field}
                slot={slot}
                selected={slot.field === slotField}
                availability={availability?.[slot.field]}
                onChoose={() => {
                  setOpen(false)
                  onChange(slot.field)
                }}
              />
            ))
          )}
          <Button
            type="button"
            size="sm"
            variant={slotField === null ? "secondary" : "ghost"}
            className="w-full justify-start text-muted-foreground"
            onClick={() => {
              setOpen(false)
              onChange(null)
            }}
          >
            {UNASSIGNED_SLOT_LABEL}
          </Button>
          {offerMapping ? (
            <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
              Wrong input?{" "}
              <Link
                href={mapHref(mapModelKey)}
                className="text-primary underline-offset-4 hover:underline"
              >
                Map this model…
              </Link>
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
    </>
  )
}

/**
 * One slot in the menu: its role icon and label, then a second line with the
 * role (and "unverified" for a guess) or, when the wiring rules it out, the
 * reason. A ruled-out slot stays focusable (`aria-disabled`, not `disabled`)
 * so a keyboard or screen-reader user reaches the reason too.
 */
function SlotMenuItem({
  slot,
  selected,
  availability,
  onChoose,
}: {
  slot: ReferenceSlot
  selected: boolean
  availability: SlotAvailability | undefined
  onChoose: () => void
}) {
  const detailId = useId()
  const unavailable = availability?.available === false
  const detail = unavailable
    ? (availability?.reason ?? "Not available here")
    : slotRoleText(slot)
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "secondary" : "ghost"}
      disabled={unavailable}
      focusableWhenDisabled
      // A disabled item that is the edge's own slot says so: it is where the
      // wire sits now, not an option that happens to be greyed out.
      aria-label={
        unavailable && selected ? `${slot.label} (current)` : slot.label
      }
      aria-describedby={detailId}
      data-slot-field={slot.field}
      className="h-auto w-full items-start justify-start gap-2 py-1.5 text-left whitespace-normal aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
      onClick={onChoose}
    >
      <HugeiconsIcon
        icon={roleMeta(slot.role).icon}
        className="mt-0.5 size-3.5 text-muted-foreground"
        aria-hidden
      />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {slot.label}
          {unavailable && selected ? (
            <span className="text-muted-foreground"> (current)</span>
          ) : null}
        </span>
        <span
          id={detailId}
          className={cn(
            "text-[11px] leading-snug font-normal",
            unavailable ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {detail}
        </span>
      </span>
    </Button>
  )
}

const SlotControl = memo(function SlotControl({
  id,
  data,
}: Pick<EdgeProps<CanvasFlowEdge>, "id" | "data">) {
  const update = useUpdateCanvasEdge()
  // The target node's own query: a family's slots and endpoint follow its
  // override and wiring, and the prompt bar asks with the same options.
  const model = useModel(data?.targetModelKey ?? null, data?.targetModelOptions)
  const descriptor = model.data
  const slotField = data?.edge.slotField ?? null
  const filled = data?.targetModelOptions.filled
  const slotWires = data?.slotWires ?? 0
  // Judged as if this wire were not yet placed: the menu answers where it may
  // go.
  const availability = useMemo(
    () =>
      familyAvailability(
        descriptor,
        menuFilled(filled ?? [], slotField, slotWires)
      ),
    [descriptor, filled, slotField, slotWires]
  )
  return (
    <EdgeSlotLabel
      slotField={slotField}
      slots={descriptor?.referenceSlots ?? []}
      loading={model.isPending && (data?.targetModelKey ?? null) !== null}
      availability={availability}
      mapModelKey={descriptor && !descriptor.family ? descriptor.key : null}
      onChange={(next) => update.mutate({ id, slotField: next })}
    />
  )
})

export function ReferenceEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps<CanvasFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className="pointer-events-none absolute"
        >
          <SlotControl id={id} data={data} />
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
