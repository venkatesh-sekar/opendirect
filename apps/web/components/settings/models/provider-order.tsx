"use client"

/**
 * Settings → Models → provider preference (planning decision 4, design
 * §5.1–5.2).
 *
 * When a mapped model runs on several providers, main tries them in
 * `settings.providerOrder`, skipping any without a key and appending any
 * configured provider the list leaves out. This card is that list: drag a
 * row, or use its Up/Down buttons (a keyboard user can also pick a handle
 * up with Space and move it with the arrow keys, the same dnd-kit pattern as
 * `workspace/reference-strip.tsx`). Every change is saved at once.
 *
 * Providers without a key stay in the list — the order is a preference that
 * outlives a missing key — but read as inactive, with the way to add one.
 *
 * ⛔ Local settings only; nothing here reaches a provider.
 */
import { useState } from "react"
import Link from "next/link"
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
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  DragDropVerticalIcon,
} from "@hugeicons/core-free-icons"
import type { ProviderId } from "@opendirect/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import {
  PROVIDER_LABELS,
  useKeysSummary,
  useSettings,
  useUpdateSettings,
} from "@/lib/settings"

import { FieldError } from "../field-error"

const ALL_PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderId[]

/** The saved order, with every provider it leaves out appended (as main does). */
export function completeOrder(saved: readonly ProviderId[]): ProviderId[] {
  const order = saved.filter(
    (provider, index) =>
      ALL_PROVIDERS.includes(provider) && saved.indexOf(provider) === index
  )
  for (const provider of ALL_PROVIDERS) {
    if (!order.includes(provider)) order.push(provider)
  }
  return order
}

interface RowProps {
  provider: ProviderId
  position: number
  count: number
  configured: boolean
  usedFirst: boolean
  disabled: boolean
  onMove: (provider: ProviderId, to: number) => void
}

function ProviderRow({
  provider,
  position,
  count,
  configured,
  usedFirst,
  disabled,
  onMove,
}: RowProps) {
  const name = PROVIDER_LABELS[provider]
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider, disabled })

  return (
    <li
      ref={setNodeRef}
      data-provider={provider}
      data-configured={String(configured)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-1 text-sm",
        !configured && "bg-muted/40 text-muted-foreground",
        isDragging && "relative z-10 shadow-lg"
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${name}`}
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
      </button>
      <span
        aria-hidden
        className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums"
      >
        {position + 1}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium",
          configured && "text-foreground"
        )}
      >
        {name}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {configured ? (
          usedFirst ? (
            <Badge variant="secondary">Used first</Badge>
          ) : null
        ) : (
          <>
            <Badge variant="outline">No key</Badge>
            <Link
              href="/settings?tab=providers"
              className="text-xs text-primary underline-offset-4 hover:underline"
            >
              Add key<span className="sr-only"> for {name}</span>
            </Link>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} up`}
          focusableWhenDisabled
          disabled={disabled || position === 0}
          onClick={() => onMove(provider, position - 1)}
          className="aria-disabled:opacity-40"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Move ${name} down`}
          focusableWhenDisabled
          disabled={disabled || position === count - 1}
          onClick={() => onMove(provider, position + 1)}
          className="aria-disabled:opacity-40"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} />
        </Button>
      </span>
    </li>
  )
}

export function ProviderOrder() {
  const settings = useSettings()
  const keys = useKeysSummary()
  const update = useUpdateSettings()
  const [announcement, setAnnouncement] = useState("")

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // While a save is in flight, show the order being saved, not the old one.
  const saved =
    update.isPending && update.variables?.providerOrder
      ? update.variables.providerOrder
      : settings.data?.providerOrder
  const order = saved ? completeOrder(saved) : null
  const configured = (provider: ProviderId) =>
    keys.data?.[provider]?.present === true
  const firstConfigured = order?.find(configured) ?? null

  function move(provider: ProviderId, to: number) {
    if (!order) return
    const from = order.indexOf(provider)
    if (from < 0 || to < 0 || to >= order.length || from === to) return
    const next = arrayMove(order, from, to)
    update.mutate({ providerOrder: next })
    setAnnouncement(`${PROVIDER_LABELS[provider]} moved to position ${to + 1}.`)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!order || !over || active.id === over.id) return
    move(active.id as ProviderId, order.indexOf(over.id as ProviderId))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider preference</CardTitle>
        <CardDescription>
          When a model runs on several providers, OpenDirect uses the first one
          you have a key for. A canvas node can override this.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {order ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={order}
              strategy={verticalListSortingStrategy}
            >
              <ol aria-label="Provider order" className="flex flex-col gap-1.5">
                {order.map((provider, index) => (
                  <ProviderRow
                    key={provider}
                    provider={provider}
                    position={index}
                    count={order.length}
                    configured={configured(provider)}
                    usedFirst={provider === firstConfigured}
                    disabled={!settings.data}
                    onMove={move}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        ) : settings.isPending ? (
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : null}
        {order && firstConfigured === null && keys.data ? (
          <p className="text-xs text-muted-foreground">
            No provider has a key yet, so no mapped model can run.{" "}
            <Link
              href="/settings?tab=providers"
              className="text-primary underline-offset-4 hover:underline"
            >
              Add a key
            </Link>
            .
          </p>
        ) : null}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <FieldError>
          {settings.isError ? settings.error.message : null}
        </FieldError>
        <FieldError>{update.isError ? update.error.message : null}</FieldError>
      </CardContent>
    </Card>
  )
}
