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
 * ⛔ Re-labelling an edge writes one row. It never runs anything.
 */
import { memo, useState } from "react"
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react"
import type { ReferenceSlot } from "@opendirect/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"

import { useUpdateCanvasEdge } from "@/hooks/use-canvas"
import { useModel } from "@/hooks/use-models"
import { isUnresolvedSlot, slotLabel } from "@/lib/canvas/slots"

import type { CanvasFlowEdge } from "../nodes/types"

/** What a text edge, and an edge into a model-less node, reads as. */
export const UNASSIGNED_SLOT_LABEL = "No slot"

export interface EdgeSlotLabelProps {
  slotField: string | null
  slots: readonly ReferenceSlot[]
  onChange: (slotField: string | null) => void
  /** True while the target model's descriptor is still being fetched. */
  loading?: boolean
}

/**
 * The chip on the edge, and the menu behind it.
 *
 * Presentational on purpose — it is given the slots rather than fetching them,
 * so the three states above can be rendered and asserted without a viewport.
 */
export function EdgeSlotLabel({
  slotField,
  slots,
  onChange,
  loading = false,
}: EdgeSlotLabelProps) {
  const [open, setOpen] = useState(false)
  // A model still loading has declared nothing *yet*, which is not the same as
  // declaring nothing — so its edges do not accuse the user of a broken slot.
  const unresolved = !loading && isUnresolvedSlot(slotField, slots)
  const text =
    slotField === null ? UNASSIGNED_SLOT_LABEL : slotLabel(slotField, slots)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-testid="edge-slot-label"
        data-unresolved={unresolved || undefined}
        aria-label={
          unresolved ? `Unresolved input slot: ${text}` : `Input slot: ${text}`
        }
        className={cn(
          "nodrag nopan pointer-events-auto rounded-full border px-2 py-0.5 text-[11px] leading-tight shadow-sm",
          unresolved
            ? "border-destructive bg-destructive/15 text-destructive"
            : "border-border bg-popover text-popover-foreground"
        )}
      >
        {unresolved ? `${text} · unresolved` : text}
      </PopoverTrigger>
      <PopoverContent align="center" className="w-56 p-1">
        {slots.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            {loading
              ? "Reading the model's inputs…"
              : "This node has no model yet, so it declares no input slots."}
          </p>
        ) : (
          slots.map((slot) => (
            <Button
              key={slot.field}
              type="button"
              size="sm"
              variant={slot.field === slotField ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => {
                setOpen(false)
                onChange(slot.field)
              }}
            >
              {slot.label}
            </Button>
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
      </PopoverContent>
    </Popover>
  )
}

const SlotControl = memo(function SlotControl({
  id,
  data,
}: Pick<EdgeProps<CanvasFlowEdge>, "id" | "data">) {
  const update = useUpdateCanvasEdge()
  const model = useModel(data?.targetModelKey ?? null)
  return (
    <EdgeSlotLabel
      slotField={data?.edge.slotField ?? null}
      slots={model.data?.referenceSlots ?? []}
      loading={model.isPending && (data?.targetModelKey ?? null) !== null}
      onChange={(slotField) => update.mutate({ id, slotField })}
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
